import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bookmark,
  BookOpen,
  BrainCircuit,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Compass,
  Copy,
  Download,
  Eye,
  Feather,
  FileSignature,
  FileText,
  FileUp,
  GitBranch,
  ImagePlus,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  MessageSquarePlus,
  MessageSquareQuote,
  RotateCcw,
  Scale,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Undo2,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { useToolbox } from '../context/ToolboxContext';
import { ImageRedactModal } from '../components/ImageRedactModal';
import { LegalMarkdownView } from '../components/LegalMarkdownView';
import { AI_LEGAL_DISCLAIMER } from '../data/legalDataManifest';
import { AI_SPECIALISTS_REGISTRY } from '../data/toolRegistry';
import {
  AiDirectConnectError,
  resolveVisionModel,
  streamAiCompletion,
  type ChatTurn,
} from '../lib/aiClient';
import { copyToClipboard } from '../lib/clipboard';
import { decryptWithPassphrase } from '../lib/cryptoVault';
import { downloadMarkdownReportDocx } from '../lib/docxBuilder';
import { extractLocalDocumentText } from '../lib/docxReader';
import { compressImageFileToAttachment } from '../lib/imageUtils';
import { redactLegalText, restoreRedactedText } from '../lib/redactor';
import type { AiImageAttachment, AiSpecialistId, RedactionMapping } from '../types/toolbox';

interface UiConversationTurn {
  id: string;
  roundNo: number;
  userDisplayText: string;
  userImages: AiImageAttachment[];
  assistantRaw: string;
  reasoning: string;
  usedModel: string;
}

const MAX_IMAGES_PER_TURN = 6;

const QUICK_REFINEMENT_CHIPS = [
  '语气更克制专业，去掉套话',
  '压缩成 250 字内，方便直接发微信',
  '补充管辖、送达与律师费承担条款',
  '改站在对方/法官视角指出我方漏洞',
];

const SPECIALIST_ICONS: Record<AiSpecialistId, React.ComponentType<{ className?: string }>> = {
  'contract-review': FileSignature,
  'de-ai-polish': Feather,
  'timeline-elements': GitBranch,
  'cross-exam-questions': Scale,
  'client-wechat-reply': MessageSquareQuote,
  'legal-sandbox': Compass,
};

const SPECIALIST_PILLARS: Record<AiSpecialistId, string[]> = {
  'contract-review': [
    '逐条定位商业硬伤',
    '直接给可粘贴示范条款',
    '严禁编造法条序号',
    '支持 .docx 原文直读',
  ],
  'de-ai-polish': [
    '只改表达不改法律含义',
    '程序性结构语一字不动',
    '区分诉讼与非诉体例',
    '附 7 列实质修改核对表',
  ],
  'timeline-elements': [
    '事实与待核事项分离',
    '输出标准时间线大事记表',
    '按民/刑/行/执拆解要件',
    '生成面谈追补证据清单',
  ],
  'cross-exam-questions': [
    '真实/合法/关联/证明力四维',
    '识别复印件与电子数据瑕疵',
    '封闭式发问锁死庭审答复',
    '标注当庭核对原件提示',
  ],
  'client-wechat-reply': [
    '250–500 字适配手机阅读',
    '纯文本清晰分段去星号',
    '严守不包赢与保密红线',
    '自然嵌入执业审慎边界',
  ],
  'legal-sandbox': [
    '事实·判断·建议·风险四分离',
    '严禁捏造指导案例与案号',
    '不确定条号标注待核对',
    '支持双模型多轮自由推演',
  ],
};

function stripMarkdownForWechat(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}

interface PendingOutboundPreview {
  isFollowUp: boolean;
  effectiveText: string;
  outboundCustomNote: string;
  attachedImgs: AiImageAttachment[];
}

function renderHighlightedOutboundPreview(text: string): React.ReactNode {
  const parts = text.split(
    /(\[(?:当事人|公司主体|身份证号|统一信用代码|银行账号|联系电话|电子邮箱|关联案号|详细地址|涉密主体)[^\]]{0,16}\])/g
  );
  return parts.map((part, idx) =>
    idx % 2 === 1 ? (
      <mark
        key={idx}
        className="mx-0.5 rounded bg-emerald-100 border border-emerald-300/80 px-1 py-0.5 font-semibold text-emerald-950"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  );
}

export const AiHubTab: React.FC = () => {
  const {
    isOnline,
    byok,
    updateByok,
    sessionUnlockedPin,
    setSessionUnlockedPin,
    activeSpecialistId,
    aiHandoff,
    clearAiHandoff,
    lawyerProfile,
    savedPrompts,
    addSavedPrompt,
    deleteSavedPrompt,
    recordToolHit,
    navigateTab,
    openLawsSearch,
    showToast,
  } = useToolbox();

  const [specialistId, setSpecialistId] = useState<AiSpecialistId>(activeSpecialistId);
  const [modelSlot, setModelSlot] = useState<'fast' | 'reasoning'>(byok.defaultModelSlot);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [customSceneNote, setCustomSceneNote] = useState<string>('');
  const [inputText, setInputText] = useState('');
  const [inputImages, setInputImages] = useState<AiImageAttachment[]>([]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [followUpImages, setFollowUpImages] = useState<AiImageAttachment[]>([]);
  const [compressingImages, setCompressingImages] = useState(false);
  const [redactingImageTarget, setRedactingImageTarget] = useState<{
    bucket: 'initial' | 'followup';
    image: AiImageAttachment;
  } | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [streamingUserText, setStreamingUserText] = useState('');
  const [streamingUserImages, setStreamingUserImages] = useState<AiImageAttachment[]>([]);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isCorsDirectError, setIsCorsDirectError] = useState(false);
  const [usedModelName, setUsedModelName] = useState('');

  const [sessionMappings, setSessionMappings] = useState<RedactionMapping[]>([]);
  const [autoRestoreView, setAutoRestoreView] = useState(true);
  const [formattedView, setFormattedView] = useState(true);
  const [skipPreviewThisSession, setSkipPreviewThisSession] = useState(false);
  const [customSensitiveTerms, setCustomSensitiveTerms] = useState<string[]>([]);
  const [customTermDraft, setCustomTermDraft] = useState('');
  const [pendingPreview, setPendingPreview] = useState<PendingOutboundPreview | null>(null);
  const [confirmDisableRedactOpen, setConfirmDisableRedactOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [uiTurns, setUiTurns] = useState<UiConversationTurn[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pinUnlockInput, setPinUnlockInput] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const followUpImageRef = useRef<HTMLInputElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);

  const specialist = useMemo(
    () => AI_SPECIALISTS_REGISTRY.find((s) => s.id === specialistId) || AI_SPECIALISTS_REGISTRY[0],
    [specialistId]
  );

  const activeProvider = useMemo(
    () => byok.providers.find((p) => p.id === byok.activeProviderId) || byok.providers[0],
    [byok]
  );

  const resolvedVisionModel = useMemo(() => resolveVisionModel(activeProvider), [activeProvider]);

  const hasReadyKey = Boolean(
    activeProvider &&
      (activeProvider.apiKey?.trim() || (byok.pinEnabled && activeProvider.apiKeyEncrypted))
  );

  const isPinLocked = Boolean(
    byok.pinEnabled && !activeProvider?.apiKey && activeProvider?.apiKeyEncrypted && !sessionUnlockedPin
  );

  // Sync preset & recommended model slot when switching specialist
  useEffect(() => {
    setModelSlot(specialist.recommendedSlot);
    setSelectedPreset(specialist.presetOptions?.[0]?.value || '');
    setCustomSceneNote('');
    setErrorMsg(null);
  }, [specialist]);

  // Consume cross-tool AI handoff payload
  useEffect(() => {
    if (aiHandoff) {
      setSpecialistId(aiHandoff.specialistId);
      setInputText(aiHandoff.promptContext);
      setInputImages([]);
      setFollowUpImages([]);
      setUiTurns([]);
      setChatHistory([]);
      setStreamingOutput('');
      setStreamingReasoning('');
      setErrorMsg(null);
      if (aiHandoff.sourceTitle === '本地已脱敏案件材料') {
        try {
          const savedMap = sessionStorage.getItem('cn_lawyer_last_redaction_map');
          sessionStorage.removeItem('cn_lawyer_last_redaction_map');
          setSessionMappings(savedMap ? JSON.parse(savedMap) : []);
        } catch {
          setSessionMappings([]);
        }
      } else {
        setSessionMappings([]);
      }
      clearAiHandoff();
    }
  }, [aiHandoff, clearAiHandoff]);

  useEffect(() => {
    if ((streaming || uiTurns.length > 0) && threadScrollRef.current) {
      threadScrollRef.current.scrollTo({
        top: threadScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [uiTurns.length, streaming]);

  const renderVisibleText = (raw: string): string => {
    if (!raw) return '';
    if (autoRestoreView && sessionMappings.length > 0) {
      return restoreRedactedText(raw, sessionMappings);
    }
    return raw;
  };

  const latestCompletedTurn = uiTurns.length > 0 ? uiTurns[uiTurns.length - 1] : null;
  const latestDisplayText = streaming
    ? renderVisibleText(streamingOutput)
    : latestCompletedTurn
    ? renderVisibleText(latestCompletedTurn.assistantRaw)
    : '';

  const resetConversation = () => {
    if (streaming) abortRef.current?.abort();
    setUiTurns([]);
    setChatHistory([]);
    setStreamingOutput('');
    setStreamingReasoning('');
    setStreamingUserText('');
    setStreamingUserImages([]);
    setFollowUpInput('');
    setFollowUpImages([]);
    setSessionMappings([]);
    setErrorMsg(null);
    setUsedModelName('');
  };

  const handleUnlockPin = async () => {
    if (!activeProvider?.apiKeyEncrypted || !pinUnlockInput.trim()) {
      showToast('请输入安全 PIN 码');
      return;
    }
    try {
      await decryptWithPassphrase(activeProvider.apiKeyEncrypted, pinUnlockInput.trim());
      setSessionUnlockedPin(pinUnlockInput.trim());
      setPinUnlockInput('');
      showToast('本机密钥保险箱已解锁');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PIN 错误');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const extracted = await extractLocalDocumentText(file);
      setInputText((prev) => (prev ? `${prev}\n\n${extracted}` : extracted));
      showToast(`已在本地解析「${file.name}」（共 ${extracted.length} 字）`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '文档解析失败');
    } finally {
      e.target.value = '';
    }
  };

  const attachImages = async (files: FileList | File[], target: 'initial' | 'followup') => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;

    const existingCount = target === 'initial' ? inputImages.length : followUpImages.length;
    const room = MAX_IMAGES_PER_TURN - existingCount;
    if (room <= 0) {
      showToast(`单轮最多上传 ${MAX_IMAGES_PER_TURN} 张截图`);
      return;
    }

    const toProcess = list.slice(0, room);
    setCompressingImages(true);
    try {
      const processed: AiImageAttachment[] = [];
      for (const f of toProcess) {
        processed.push(await compressImageFileToAttachment(f));
      }
      if (target === 'initial') {
        setInputImages((prev) => [...prev, ...processed]);
      } else {
        setFollowUpImages((prev) => [...prev, ...processed]);
      }
      const totalKb = processed.reduce((acc, x) => acc + x.sizeKb, 0);
      showToast(`已添加 ${processed.length} 张截图（本地压缩后共 ${totalKb} KB）`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '图片处理失败');
    } finally {
      setCompressingImages(false);
    }
  };

  const handlePasteImages = async (
    e: React.ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>,
    target: 'initial' | 'followup'
  ) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      await attachImages(pastedFiles, target);
    }
  };

  const resolveApiKeyWithVault = async (): Promise<string> => {
    if (activeProvider.apiKey?.trim()) {
      return activeProvider.apiKey.trim();
    }
    if (byok.pinEnabled && activeProvider.apiKeyEncrypted) {
      const pinToUse = sessionUnlockedPin || pinUnlockInput.trim();
      if (!pinToUse) {
        throw new Error('请先输入您的本地 4–8 位安全 PIN 码解锁 API 密钥');
      }
      const decrypted = await decryptWithPassphrase(activeProvider.apiKeyEncrypted, pinToUse);
      setSessionUnlockedPin(pinToUse);
      return decrypted;
    }
    throw new Error('尚未配置大模型 API Key，请点击前往「我的配置」填入个人密钥');
  };

  const executeGeneration = async (params: {
    isFollowUp: boolean;
    effectiveText: string;
    outboundCustomNote: string;
    attachedImgs: AiImageAttachment[];
  }) => {
    const { isFollowUp, effectiveText, outboundCustomNote: rawCustomNote, attachedImgs } = params;
    setErrorMsg(null);
    setIsCorsDirectError(false);

    let resolvedKey = '';
    try {
      resolvedKey = await resolveApiKeyWithVault();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '密钥解锁失败');
      return;
    }

    // Apply automatic local redaction with incremental placeholder continuation across turns!
    let outboundText = effectiveText;
    let outboundCustomNote = rawCustomNote;
    const baseMappings = isFollowUp || uiTurns.length === 0 ? sessionMappings : [];
    let nextMappings = [...baseMappings];

    if (byok.autoRedactPrompt) {
      const red = redactLegalText(effectiveText, {
        existingMappings: baseMappings,
        customTerms: customSensitiveTerms,
      });
      outboundText = red.redactedText;
      nextMappings = red.mappings;
      if (!isFollowUp && outboundCustomNote) {
        const noteRed = redactLegalText(outboundCustomNote, {
          existingMappings: nextMappings,
          customTerms: customSensitiveTerms,
        });
        outboundCustomNote = noteRed.redactedText;
        nextMappings = noteRed.mappings;
      }
      setSessionMappings(nextMappings);
    } else if (!isFollowUp && uiTurns.length > 0) {
      setSessionMappings([]);
    }

    const combinedStance = [selectedPreset.trim(), outboundCustomNote ? `补充特别要求：${outboundCustomNote}` : '']
      .filter(Boolean)
      .join('\n');

    const userPromptContent =
      !isFollowUp && combinedStance
        ? `【特定业务立场与场景要求】\n${combinedStance}\n\n【待处理材料正文】\n${outboundText}`
        : outboundText;

    const newUserTurn: ChatTurn = {
      role: 'user',
      content: userPromptContent,
      ...(attachedImgs.length > 0 ? { images: attachedImgs } : {}),
    };

    const nextTurns: ChatTurn[] = isFollowUp
      ? [...chatHistory, newUserTurn]
      : [{ role: 'system', content: specialist.systemPrompt }, newUserTurn];

    setStreaming(true);
    if (!isFollowUp) {
      recordToolHit(`ai:${specialist.id}`);
    }
    setStreamingUserText(effectiveText);
    setStreamingUserImages(attachedImgs);
    setStreamingOutput('');
    setStreamingReasoning('');
    if (isFollowUp) {
      setFollowUpInput('');
      setFollowUpImages([]);
    } else {
      setUiTurns([]);
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await streamAiCompletion({
        provider: { ...activeProvider, apiKey: resolvedKey },
        modelSlot,
        messages: nextTurns,
        signal: ctrl.signal,
        onChunk: (c, r) => {
          if (c) setStreamingOutput((prev) => prev + c);
          if (r) setStreamingReasoning((prev) => prev + r);
        },
      });
      setUsedModelName(res.usedModel);
      const completedAssistantTurn: ChatTurn = { role: 'assistant', content: res.content };
      setChatHistory([...nextTurns, completedAssistantTurn]);
      setUiTurns((prev) => [
        ...(isFollowUp ? prev : []),
        {
          id: `turn-${Date.now()}`,
          roundNo: (isFollowUp ? prev.length : 0) + 1,
          userDisplayText: effectiveText,
          userImages: attachedImgs,
          assistantRaw: res.content,
          reasoning: res.reasoning,
          usedModel: res.usedModel,
        },
      ]);
      setStreamingOutput('');
      setStreamingReasoning('');
      setStreamingUserText('');
      setStreamingUserImages([]);
    } catch (err) {
      setIsCorsDirectError(err instanceof AiDirectConnectError);
      setErrorMsg(err instanceof Error ? err.message : '生成中断');
      if (isFollowUp && attachedImgs.length > 0) {
        setFollowUpImages(attachedImgs);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const runGeneration = async (isFollowUp = false, overridePrompt?: string) => {
    if (!isOnline) {
      setErrorMsg('当前设备处于离线状态，AI 功能需要联网调用第三方大模型接口。');
      return;
    }

    const rawText = (overridePrompt !== undefined ? overridePrompt : isFollowUp ? followUpInput : inputText).trim();
    const attachedImgs = isFollowUp ? [...followUpImages] : [...inputImages];

    if (!rawText && attachedImgs.length === 0) {
      showToast('请先输入案件文字、导入 .docx 文档或上传截图');
      return;
    }

    const effectiveText =
      rawText ||
      (isFollowUp
        ? '请结合我刚刚补充上传的截图内容，更新并完善上一轮的法律分析与改稿建议。'
        : '请先完整识别上方截图中的关键文字、主体、时间与金额信息，并严格按照当前专席要求输出专业法律分析。');

    const pendingPayload: PendingOutboundPreview = {
      isFollowUp,
      effectiveText,
      outboundCustomNote: isFollowUp ? '' : customSceneNote.trim(),
      attachedImgs,
    };

    // L-2: Show Outbound Redaction Preview before leaving device unless opted out for this session
    if (byok.autoRedactPrompt && !skipPreviewThisSession) {
      setPendingPreview(pendingPayload);
      return;
    }

    await executeGeneration(pendingPayload);
  };

  const livePreviewResult = useMemo(() => {
    if (!pendingPreview) return null;
    const baseMappings =
      pendingPreview.isFollowUp || uiTurns.length === 0 ? sessionMappings : [];
    const textRed = redactLegalText(pendingPreview.effectiveText, {
      existingMappings: baseMappings,
      customTerms: customSensitiveTerms,
    });
    let noteText = pendingPreview.outboundCustomNote;
    let totalReplaced = textRed.totalReplaced;
    let mergedMappings = textRed.mappings;
    if (!pendingPreview.isFollowUp && noteText) {
      const noteRed = redactLegalText(noteText, {
        existingMappings: mergedMappings,
        customTerms: customSensitiveTerms,
      });
      noteText = noteRed.redactedText;
      totalReplaced += noteRed.totalReplaced;
      mergedMappings = noteRed.mappings;
    }
    return {
      redactedText: textRed.redactedText,
      redactedNote: noteText,
      totalReplaced,
      mappings: mergedMappings,
    };
  }, [pendingPreview, uiTurns.length, sessionMappings, customSensitiveTerms]);

  const undoLastRound = () => {
    if (streaming || uiTurns.length <= 1) return;
    setUiTurns((prev) => prev.slice(0, -1));
    setChatHistory((prev) => prev.slice(0, -2));
    showToast('已撤回上一轮追问，可重新调整提问方向');
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const copyTurnText = async (id: string, rawText: string, stripMarkdown = false) => {
    const visible = renderVisibleText(rawText);
    if (!visible) return;
    const out = stripMarkdown ? stripMarkdownForWechat(visible) : visible;
    const ok = await copyToClipboard(out);
    if (!ok) {
      showToast('复制受限，请长按正文手动复制');
      return;
    }
    setCopiedId(id);
    showToast(stripMarkdown ? '已复制微信纯文本版（已去星号）' : '已复制成品文书');
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
  };

  const anyPendingImages = inputImages.length > 0 || followUpImages.length > 0;
  const historyHasImages = chatHistory.some((m) => m.images && m.images.length > 0);
  const willUseVision = anyPendingImages || historyHasImages;
  const activeModelDisplay =
    inputImages.length > 0
      ? resolvedVisionModel || '需先配置识图模型'
      : modelSlot === 'reasoning'
      ? activeProvider?.reasoningModel || activeProvider?.fastModel
      : activeProvider?.fastModel;

  const ActiveSpecialistIcon = SPECIALIST_ICONS[specialist.id];
  const activePillars = SPECIALIST_PILLARS[specialist.id];
  const providerShortName = activeProvider?.name.split('（')[0] || '未配置服务商';

  return (
    <div className="py-5 sm:py-7 px-4 sm:px-6 mx-auto max-w-[1240px] space-y-4">
      {/* Subtle Architectural Masthead */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#102747] to-[#081527] border border-[#B89254]/40 flex items-center justify-center shadow-[0_6px_16px_-8px_rgba(14,34,61,0.55)] flex-none">
            <Sparkles className="h-4 w-4 text-[#DFC086]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#9A7538]">
                COUNSEL AI WORKBENCH
              </span>
              <span className="hidden sm:inline-block h-1 w-1 rounded-full bg-[#C9A463]/70" />
              <span className="hidden sm:inline-block text-[10.5px] font-medium text-slate-500">
                全领域办案专席 · 本地脱敏守护
              </span>
            </div>
            <h1 className="font-display text-lg sm:text-[21px] font-bold tracking-[0.02em] text-[#0E223D] leading-tight">
              AI 法律智囊舱
            </h1>
          </div>
        </div>

        {/* Right: Active Provider Quick Switch Pill */}
        <button
          type="button"
          onClick={() => navigateTab('settings')}
          className="group inline-flex items-center gap-2 rounded-full border border-[#DFD7C5] bg-white/90 hover:bg-white hover:border-[#B89254] px-3.5 py-1.5 text-xs shadow-[0_4px_14px_-10px_rgba(14,34,61,0.22)] transition-all"
          title="前往「我的配置」切换模型或服务商"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              !isOnline
                ? 'bg-amber-400'
                : hasReadyKey
                ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]'
                : 'bg-rose-400'
            }`}
          />
          <span className="font-semibold text-[#0E223D] max-w-[130px] truncate">{providerShortName}</span>
          {activeProvider?.useCorsRelayFallback && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300/80 px-2 py-0.5 text-[10px] font-bold text-amber-900"
              title="您已在配置中显式开启服务器无状态转发；默认直连模式下请求不经过站点服务器"
            >
              经服务器转发
            </span>
          )}
          {resolvedVisionModel && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-[#F5F0E4] px-2 py-0.5 text-[10px] font-medium text-[#7D5E29]">
              <Eye className="h-2.5 w-2.5" /> 识图就绪
            </span>
          )}
          <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#0E223D] group-hover:translate-x-0.5 transition-all" />
        </button>
      </div>

      {/* Offline Banner */}
      {!isOnline && (
        <div className="rounded-xl border border-amber-300/80 bg-gradient-to-r from-amber-50 to-[#FFFDF7] p-3.5 flex items-start gap-2.5 text-xs text-amber-950 shadow-sm">
          <WifiOff className="h-4 w-4 flex-none text-amber-700 mt-0.5" />
          <div>
            <div className="font-bold">当前处于离线模式（AI 智囊需联网）</div>
            <p className="mt-0.5 leading-5 text-amber-900/90">
              AI 功能需在线直连您配置的第三方大模型 API；断网期间您可正常使用「离线工具」与「法典清单」全部本地功能。
            </p>
          </div>
        </div>
      )}

      {/* Missing API Key Banner */}
      {!hasReadyKey && (
        <div className="relative overflow-hidden rounded-2xl border border-[#B89254]/70 bg-gradient-to-r from-[#0E223D] via-[#132C50] to-[#0A192E] p-4 sm:p-5 text-[#F6F4EF] shadow-[0_14px_34px_-18px_rgba(14,34,61,0.5)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#D1B27A]/15 border border-[#D1B27A]/40 flex items-center justify-center flex-none">
              <KeyRound className="h-4 w-4 text-[#DFC086]" />
            </div>
            <div>
              <div className="font-display text-sm sm:text-[15px] font-bold text-white">
                首次使用请配置您个人的大模型 API Key（BYOK 自带密钥）
              </div>
              <p className="mt-0.5 text-xs text-slate-300 leading-5">
                支持 DeepSeek、阿里云百炼、硅基流动、Kimi、智谱等，密钥仅加密保存于您本机或个人同步槽位，零额外平台费。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigateTab('settings')}
            className="flex-none rounded-xl bg-gradient-to-r from-[#CFA968] to-[#DFBE82] hover:brightness-105 px-4 py-2.5 text-xs font-bold text-[#0E1A2B] shadow-sm transition-all"
          >
            前往 30 秒配置密钥 →
          </button>
        </div>
      )}

      {/* Refined PIN Vault Unlock Strip */}
      {isPinLocked && (
        <div className="rounded-xl border border-[#DFD2B8] bg-gradient-to-r from-[#FDFBF6] via-white to-[#FAF5E9] px-4 py-2.5 shadow-[0_8px_22px_-16px_rgba(14,34,61,0.22)] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 text-xs font-semibold text-[#11151C]">
            <span className="h-7 w-7 rounded-lg bg-[#F4ECDC] border border-[#E2D2B2] flex items-center justify-center flex-none">
              <Lock className="h-3.5 w-3.5 text-[#9A7538]" />
            </span>
            <span>API 密钥受本机 PIN 码加密保护，请输入解锁本次会话</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              inputMode="numeric"
              value={pinUnlockInput}
              onChange={(e) => setPinUnlockInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlockPin()}
              placeholder="输入安全 PIN"
              className="w-32 rounded-lg border border-[#D8CEB9] bg-white px-3 py-1.5 text-xs text-[#0E223D] placeholder:text-slate-400 focus:border-[#0E223D] focus:ring-2 focus:ring-[#B89254]/20 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleUnlockPin}
              className="rounded-lg bg-[#0E223D] hover:bg-[#17345D] px-3.5 py-1.5 text-xs font-semibold text-[#F6F4EF] shadow-sm transition-colors"
            >
              解锁
            </button>
          </div>
        </div>
      )}

      {/* 6 Specialists Architectural Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {AI_SPECIALISTS_REGISTRY.map((sp) => {
          const active = sp.id === specialist.id;
          const IconComp = SPECIALIST_ICONS[sp.id];
          return (
            <button
              key={sp.id}
              type="button"
              onClick={() => {
                setSpecialistId(sp.id);
                resetConversation();
              }}
              className={`group relative overflow-hidden rounded-xl border p-3.5 text-left transition-all duration-200 ${
                active
                  ? 'border-[#1E3A63] bg-gradient-to-br from-[#102747] via-[#0E223D] to-[#081527] text-white shadow-[0_14px_28px_-14px_rgba(14,34,61,0.58)]'
                  : 'border-[#E4DEC9] bg-white/95 hover:bg-white text-[#11151C] hover:-translate-y-0.5 hover:border-[#C7A468] hover:shadow-[0_12px_24px_-16px_rgba(14,34,61,0.25)]'
              }`}
            >
              {active && (
                <>
                  <div className="absolute inset-x-0 top-0 h-[2.5px] bg-gradient-to-r from-[#B89254] via-[#E5CB96] to-[#B89254]/40" />
                  <div className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full bg-[#D1B27A]/14 blur-xl" />
                </>
              )}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`font-num text-[10.5px] font-semibold tracking-[0.14em] ${
                    active ? 'text-[#E0C38A]' : 'text-[#9A7538]'
                  }`}
                >
                  {sp.code}
                </span>
                <span
                  className={`h-6 w-6 rounded-lg flex items-center justify-center transition-colors ${
                    active
                      ? 'bg-white/10 border border-[#D1B27A]/30 text-[#E5CB96]'
                      : 'bg-[#F6F2E8] text-[#85642B] group-hover:bg-[#0E223D] group-hover:text-[#DFC086]'
                  }`}
                >
                  <IconComp className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="mt-2 font-display text-[13px] sm:text-[14px] font-bold leading-snug tracking-[0.02em]">
                {sp.shortTitle}
              </div>
              <div
                className={`mt-1 text-[10.5px] truncate ${
                  active ? 'text-slate-300/90' : 'text-slate-500'
                }`}
              >
                {sp.badge}
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Executive Two-Column Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Precision Legal Intake Folio */}
        <div className="lg:col-span-5 rounded-2xl border border-[#E2DAC7] bg-white shadow-[0_18px_44px_-26px_rgba(14,34,61,0.22)] flex flex-col overflow-hidden">
          <div className="h-[3px] w-full bg-gradient-to-r from-[#0E223D] via-[#B89254] to-[#E5DEC9]" />
          <div className="p-4 sm:p-5 space-y-4 flex-1 flex flex-col">
            {/* Specialist Heading */}
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-[#E6D7BA] bg-[#FBF7EE] px-2.5 py-0.5 text-[10.5px] font-semibold text-[#8A6529]">
                <ActiveSpecialistIcon className="h-3 w-3" />
                <span>{specialist.code}</span>
                <span className="text-[#C9A463]">·</span>
                <span>{specialist.badge}</span>
              </div>
              <h2 className="mt-2 font-display text-[18px] sm:text-[20px] font-bold leading-snug text-[#0E223D]">
                {specialist.title}
              </h2>
              <p className="mt-1 text-xs leading-[1.65] text-slate-600">{specialist.desc}</p>
            </div>

            {/* Engine Segmented Switch + Tactile Redaction Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F7F4EC] border border-[#EAE2D0] p-1.5">
              <div className="inline-flex items-center rounded-lg bg-[#EAE3D3]/80 p-0.5">
                <button
                  type="button"
                  onClick={() => setModelSlot('fast')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    modelSlot === 'fast'
                      ? 'bg-[#0E223D] text-white shadow-sm'
                      : 'text-slate-600 hover:text-[#0E223D]'
                  }`}
                >
                  <Zap className={`h-3 w-3 ${modelSlot === 'fast' ? 'text-[#E0C38A]' : 'text-[#9A7538]'}`} />
                  极速模型
                </button>
                <button
                  type="button"
                  onClick={() => setModelSlot('reasoning')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    modelSlot === 'reasoning'
                      ? 'bg-[#0E223D] text-white shadow-sm'
                      : 'text-slate-600 hover:text-[#0E223D]'
                  }`}
                >
                  <BrainCircuit
                    className={`h-3 w-3 ${modelSlot === 'reasoning' ? 'text-[#E0C38A]' : 'text-[#9A7538]'}`}
                  />
                  深度推理
                </button>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={byok.autoRedactPrompt}
                onClick={() => {
                  if (byok.autoRedactPrompt) {
                    setConfirmDisableRedactOpen(true);
                  } else {
                    updateByok({ ...byok, autoRedactPrompt: true });
                    showToast('已开启本地自动脱敏与发送前出站预览');
                  }
                }}
                className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  byok.autoRedactPrompt
                    ? 'bg-emerald-50/90 text-emerald-900 border border-emerald-200/80'
                    : 'bg-amber-50/90 text-amber-900 border border-amber-300'
                }`}
              >
                <ShieldCheck
                  className={`h-3.5 w-3.5 ${byok.autoRedactPrompt ? 'text-emerald-600' : 'text-slate-400'}`}
                />
                <span>文本自动脱敏</span>
                <span
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                    byok.autoRedactPrompt ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                      byok.autoRedactPrompt ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>
            </div>

            {/* Grouped Practice Scenario Selector Card */}
            {specialist.presetOptions && specialist.presetOptions.length > 0 && (
              <div className="rounded-xl border border-[#EAE2D0] bg-[#FAF8F3] p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <label className="text-xs font-bold text-[#0E223D]">
                    代理立场 / 文书场景
                  </label>
                  <span className="hidden sm:inline text-[10.5px] font-medium text-[#9A7538]">
                    民商 · 知产 · 刑事 · 行政 · 执行 · 非诉
                  </span>
                </div>
                <div className="relative">
                  <select
                    value={selectedPreset}
                    onChange={(e) => setSelectedPreset(e.target.value)}
                    className="appearance-none w-full rounded-lg border border-[#DCD4C1] bg-white pl-3 pr-9 py-2.5 text-xs font-medium text-[#11151C] shadow-[0_1px_2px_rgba(14,34,61,0.04)] transition-colors hover:border-[#B89254] focus:border-[#0E223D] focus:ring-2 focus:ring-[#B89254]/20 focus:outline-none"
                  >
                    {(() => {
                      const hasGroups = specialist.presetOptions.some((o) => Boolean(o.group));
                      if (!hasGroups) {
                        return specialist.presetOptions.map((opt) => (
                          <option key={opt.label} value={opt.value}>
                            {opt.label}
                          </option>
                        ));
                      }
                      const groups: { name: string; items: typeof specialist.presetOptions }[] = [];
                      for (const opt of specialist.presetOptions) {
                        const gName = opt.group || '通用场景';
                        let found = groups.find((g) => g.name === gName);
                        if (!found) {
                          found = { name: gName, items: [] };
                          groups.push(found);
                        }
                        found.items.push(opt);
                      }
                      return groups.map((g) => (
                        <optgroup key={g.name} label={`── ${g.name} ──`}>
                          {g.items.map((opt) => (
                            <option key={`${g.name}-${opt.label}`} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </optgroup>
                      ));
                    })()}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8C6E3B]" />
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={customSceneNote}
                    onChange={(e) => setCustomSceneNote(e.target.value)}
                    placeholder="选填：补充具体文书名、审级或特别要求（如：二审上诉状 / 发给公安经侦 / 1500 字内）"
                    className="flex-1 min-w-0 rounded-lg border border-[#E6DFCE] bg-white/90 px-3 py-2 text-[11.5px] text-[#11151C] placeholder:text-slate-400 transition-colors focus:bg-white focus:border-[#0E223D] focus:ring-2 focus:ring-[#B89254]/15 focus:outline-none"
                  />
                  {customSceneNote.trim() && (
                    <button
                      type="button"
                      onClick={() => addSavedPrompt('', customSceneNote.trim(), specialist.id)}
                      className="flex-none inline-flex items-center gap-1 rounded-lg border border-[#D4B47C] bg-[#FBF6EA] hover:bg-[#F2E7CF] px-2.5 py-2 text-[11px] font-semibold text-[#7A5922] whitespace-nowrap transition-colors"
                      title="把当前补充要求存入我的常用指令收藏夹（同步随激活码跨端保存）"
                    >
                      <Bookmark className="h-3 w-3" /> 收藏
                    </button>
                  )}
                </div>
                {savedPrompts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[10px] font-semibold text-[#9A7538]">常用指令：</span>
                    {savedPrompts.slice(0, 8).map((sp) => (
                      <span
                        key={sp.id}
                        className="group inline-flex items-center gap-1 rounded-full border border-[#E2DAC7] bg-white hover:border-[#B89254] pl-2.5 pr-1.5 py-0.5 text-[10.5px] text-slate-600 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (chatHistory.length > 0 && !streaming) {
                              setFollowUpInput(sp.content);
                              showToast(`已填入追问指令「${sp.label}」`);
                            } else {
                              setCustomSceneNote(sp.content);
                              showToast(`已填入特别要求「${sp.label}」`);
                            }
                          }}
                          className="hover:text-[#0E223D] font-medium"
                          title={sp.content}
                        >
                          {sp.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSavedPrompt(sp.id)}
                          className="rounded-full p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                          title="移除该收藏指令"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Unified Material Composer Frame */}
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex flex-col rounded-xl border border-[#DCD4C1] bg-[#FCFBF8] overflow-hidden transition-all focus-within:bg-white focus-within:border-[#0E223D] focus-within:ring-2 focus-within:ring-[#0E223D]/8">
                {/* Composer Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 px-3 py-2 bg-[#F5F2EA]/85 border-b border-[#EAE2D0]">
                  <span className="text-xs font-bold text-[#0E223D]">案件材料 / 截图输入</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".docx,.txt,.md,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <input
                      ref={imageRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        if (e.target.files) attachImages(e.target.files, 'initial');
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#D8D0BE] bg-white hover:border-[#0E223D] px-2.5 py-1 text-[11px] font-semibold text-[#0E223D] shadow-[0_1px_2px_rgba(14,34,61,0.03)] transition-colors"
                    >
                      <FileUp className="h-3 w-3 text-[#8C6E3B]" /> .docx/.txt
                    </button>
                    <button
                      type="button"
                      disabled={compressingImages || inputImages.length >= MAX_IMAGES_PER_TURN}
                      onClick={() => imageRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#C9A463]/80 bg-[#F7EFE0] hover:bg-[#EFE3CA] px-2.5 py-1 text-[11px] font-bold text-[#7A5922] transition-colors disabled:opacity-50"
                    >
                      {compressingImages ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Camera className="h-3 w-3" />
                      )}
                      传截图/拍照 ({inputImages.length}/{MAX_IMAGES_PER_TURN})
                    </button>
                    {(inputText || inputImages.length > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          setInputText('');
                          setInputImages([]);
                          setSessionMappings([]);
                        }}
                        className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 transition-colors"
                        title="清空输入"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onPaste={(e) => handlePasteImages(e, 'initial')}
                  rows={8}
                  placeholder={`${specialist.placeholder}\n（支持直接 Ctrl+V 粘贴截图，或点上方“传截图/拍照”上传合同/聊天记录照片）`}
                  className="legal-scroll flex-1 min-h-[176px] w-full resize-y bg-transparent p-3.5 text-xs sm:text-[13.5px] leading-[1.75] text-[#14181F] placeholder:text-slate-400 focus:outline-none"
                />
                {inputText.length > 0 && (
                  <div className="flex items-center justify-between px-3.5 py-1.5 border-t border-[#EFEAE0] bg-[#FAF8F3]/70 text-[10.5px] text-slate-500">
                    <span>支持直接 Ctrl+V 粘贴补充截图</span>
                    <span className="font-num font-medium text-[#7D5E29]">
                      已输入 {inputText.length.toLocaleString()} 字
                    </span>
                  </div>
                )}
              </div>

              {/* Attached Initial Screenshots Strip */}
              {inputImages.length > 0 && (
                <div className="mt-2.5 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    {inputImages.map((img) => (
                      <div
                        key={img.id}
                        className="relative group rounded-lg border border-[#DED8CC] bg-[#FAF9F6] overflow-hidden shadow-xs"
                      >
                        <img
                          src={img.dataUrl}
                          alt={img.name}
                          className="h-20 w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setRedactingImageTarget({ bucket: 'initial', image: img })
                          }
                          className="absolute bottom-6 left-1 rounded-md bg-[#0E223D]/90 hover:bg-[#0E223D] border border-[#D1B27A]/60 px-1.5 py-0.5 text-[10px] font-bold text-[#E2C692]"
                          title="用手指或鼠标涂抹遮盖敏感信息"
                        >
                          涂抹打码
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setInputImages((prev) => prev.filter((x) => x.id !== img.id))
                          }
                          className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 text-white hover:bg-red-600"
                          title="移除图片"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <div className="px-1.5 py-0.5 text-[10px] text-slate-600 truncate bg-white/95">
                          {img.sizeKb}KB · {img.width}×{img.height}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Confidentiality & Vision Model Status Alert */}
                  <div className="rounded-xl border border-amber-300/80 bg-amber-50/90 p-2.5 text-[11px] leading-5 text-amber-950 space-y-1">
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 flex-none text-amber-700 mt-0.5" />
                      <span>
                        <strong>截图保密提醒：</strong>纯文本已自动脱敏，但图片画面无法自动遮挡真实姓名/身份证号，发送前请点击图片上的「涂抹打码」直接在本地永久遮盖敏感区域。
                      </span>
                    </div>
                    {resolvedVisionModel ? (
                      <div className="flex items-center gap-1 text-emerald-800 font-semibold pl-5">
                        <Eye className="h-3 w-3" />
                        含图将自动调用视觉模型：{resolvedVisionModel}
                      </div>
                    ) : (
                      <div className="pl-5 flex flex-wrap items-center justify-between gap-1.5 text-red-800 font-semibold">
                        <span>
                          当前「{providerShortName}」未配置视觉识图模型（DeepSeek 官方暂仅支持纯文本）
                        </span>
                        <button
                          type="button"
                          onClick={() => navigateTab('settings')}
                          className="underline text-[#0E223D]"
                        >
                          前往切换/配置识图模型 →
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Signature Primary Action Button */}
            <div className="pt-0.5">
              {!streaming ? (
                <button
                  type="button"
                  onClick={() => runGeneration(false)}
                  disabled={!isOnline}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0E223D] via-[#153156] to-[#0E223D] hover:brightness-110 py-3.5 px-4 text-xs sm:text-sm font-bold text-[#F8F5EE] ring-1 ring-inset ring-[#D1B27A]/35 shadow-[0_12px_26px_-14px_rgba(14,34,61,0.65)] transition-all hover:-translate-y-[0.5px] active:translate-y-0 disabled:opacity-45 disabled:hover:translate-y-0"
                >
                  <Sparkles className="h-4 w-4 text-[#E2C692] flex-none" />
                  <span className="truncate">
                    {uiTurns.length > 0 ? `重新发起「${specialist.shortTitle}」` : `启动「${specialist.shortTitle}」`}
                  </span>
                  {activeModelDisplay && (
                    <span className="hidden sm:inline-block max-w-[160px] truncate rounded-md bg-white/10 border border-white/10 px-2 py-0.5 text-[10.5px] font-medium text-[#E5CB96]">
                      {activeModelDisplay}
                    </span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-700 to-red-800 hover:brightness-110 py-3.5 text-xs sm:text-sm font-bold text-white shadow-sm transition-all"
                >
                  <Square className="h-4 w-4 fill-current" /> 停止流式输出
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: Executive Counsel Reading Desk & Multi-Turn Consultation Thread */}
        <div className="lg:col-span-7 rounded-2xl border border-[#DDD5C3] bg-white shadow-[0_20px_48px_-26px_rgba(14,34,61,0.22)] flex flex-col overflow-hidden">
          {/* Obsidian Architectural Top Bar */}
          <div className="relative bg-gradient-to-r from-[#0C1D35] via-[#102646] to-[#091628] px-4 sm:px-5 py-3.5 text-[#F6F4EF] border-b border-[#B89254]/35 space-y-2.5">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#D1B27A]/75 to-transparent" />
            {/* Row 1: Desk Title & Session Utilities */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#DFC086] truncate">
                  ✦ CN LAWYER COUNSEL DESK · 多轮研判工作舱
                </span>
                {uiTurns.length > 0 && (
                  <span className="rounded-full bg-emerald-400/15 border border-emerald-400/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 flex-none">
                    共 {uiTurns.length} 轮
                  </span>
                )}
                {streaming && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E2C692] flex-none" />}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {sessionMappings.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAutoRestoreView((v) => !v)}
                    className={`rounded-md px-2 py-1 text-[10.5px] font-semibold border transition-colors ${
                      autoRestoreView
                        ? 'border-emerald-400/50 bg-emerald-950/60 text-emerald-200'
                        : 'border-white/20 bg-white/10 text-slate-200'
                    }`}
                  >
                    {autoRestoreView ? `✓ 已还原真名 (${sessionMappings.length})` : '显示脱敏稿'}
                  </button>
                )}

                {(uiTurns.length > 0 || streaming) && (
                  <button
                    type="button"
                    onClick={() => setFormattedView((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/8 hover:bg-white/16 px-2 py-1 text-[10.5px] font-medium text-slate-200 transition-colors"
                    title="切换文书阅读排版与原始 Markdown 纯文本"
                  >
                    <FileText className="h-3 w-3 text-[#DFC086]" />
                    {formattedView ? '源码' : '排版'}
                  </button>
                )}

                {uiTurns.length > 0 && (
                  <button
                    type="button"
                    onClick={resetConversation}
                    className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/8 hover:bg-white/16 px-2 py-1 text-[10.5px] font-medium text-slate-200 transition-colors"
                    title="清空当前对话开始新案件"
                  >
                    <MessageSquarePlus className="h-3 w-3 text-[#DFC086]" /> 新开对话
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: Live Model Status & Export/Copy Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-300/95 min-w-0">
                <span
                  className={`h-1.5 w-1.5 rounded-full flex-none ${
                    streaming ? 'bg-[#E2C692] animate-pulse' : 'bg-emerald-400'
                  }`}
                />
                <span className="truncate">
                  {usedModelName
                    ? `最近调用：${usedModelName}`
                    : `就绪服务商：${providerShortName}${resolvedVisionModel ? ` · 识图：${resolvedVisionModel}` : ''}`}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 flex-none">
                <button
                  type="button"
                  onClick={() => {
                    const raw = streaming ? streamingOutput : latestCompletedTurn?.assistantRaw || '';
                    if (!raw.trim()) return;
                    const visible = renderVisibleText(raw);
                    const dateTag = new Date().toISOString().slice(0, 10);
                    const fname = `${specialist.shortTitle}_${dateTag}.docx`;
                    const lawyerTag = lawyerProfile.name
                      ? ` ｜ 承办律师：${lawyerProfile.name}${lawyerProfile.firmName ? `（${lawyerProfile.firmName}）` : ''}`
                      : '';
                    downloadMarkdownReportDocx(
                      {
                        title: specialist.title,
                        subtitle: `生成日期：${dateTag}${lawyerTag} ｜ 供承办律师复核定稿使用`,
                        markdownBody: visible,
                      },
                      fname
                    );
                    showToast(`已导出可编辑 Word 文档：${fname}`);
                  }}
                  disabled={!latestDisplayText || streaming}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#D1B27A]/55 bg-[#D1B27A]/12 hover:bg-[#D1B27A]/22 px-2.5 py-1 text-[11.5px] font-semibold text-[#E6CD9A] disabled:opacity-40 whitespace-nowrap transition-colors"
                  title="纯浏览器本地导出为标准 Word (.docx) 文书底稿"
                >
                  <Download className="h-3 w-3" /> 导出 Word
                </button>

                <button
                  type="button"
                  onClick={() =>
                    copyTurnText(
                      'latest-wx',
                      streaming ? streamingOutput : latestCompletedTurn?.assistantRaw || '',
                      true
                    )
                  }
                  disabled={!latestDisplayText}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11.5px] font-semibold text-white disabled:opacity-40 whitespace-nowrap transition-colors"
                  title="去除 Markdown 星号与井号，适合直接粘贴到微信对话框"
                >
                  微信纯文本
                </button>

                <button
                  type="button"
                  onClick={() =>
                    copyTurnText(
                      'latest-full',
                      streaming ? streamingOutput : latestCompletedTurn?.assistantRaw || '',
                      false
                    )
                  }
                  disabled={!latestDisplayText}
                  className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-[#CFA968] to-[#E0C185] hover:brightness-105 px-3 py-1 text-[11.5px] font-bold text-[#0E1A2B] shadow-xs disabled:from-white/10 disabled:to-white/10 disabled:text-slate-400 whitespace-nowrap transition-all"
                >
                  {copiedId === 'latest-full' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedId === 'latest-full' ? '已复制' : '复制最新稿'}
                </button>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="mx-4 sm:mx-5 mt-3.5 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-900 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 flex-none text-red-600 mt-0.5" />
              <div className="space-y-1.5 flex-1">
                <div className="font-bold">请求未能完成</div>
                <p className="leading-5 text-red-800">{errorMsg}</p>
                {isCorsDirectError && (
                  <button
                    type="button"
                    onClick={() => navigateTab('settings')}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#0E223D] hover:bg-[#17345D] px-3 py-1.5 text-[11px] font-bold text-[#F6F4EF]"
                  >
                    前往「我的配置」显式开启跨域中转 →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Warm Ivory Editorial Reading Canvas */}
          <div
            ref={threadScrollRef}
            className="legal-scroll flex-1 min-h-[380px] max-h-[620px] overflow-y-auto bg-[#FAF8F3] p-4 sm:p-5 space-y-4"
          >
            {uiTurns.length === 0 && !streaming ? (
              <div className="h-full flex flex-col justify-center">
                <div className="rounded-xl border border-[#E7E0CF] bg-white p-5 sm:p-6 shadow-[0_8px_28px_-18px_rgba(14,34,61,0.14)] space-y-4">
                  {/* Ready Header */}
                  <div className="flex items-start gap-3.5">
                    <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-[#102747] to-[#081527] border border-[#B89254]/45 flex items-center justify-center text-[#E5CB96] shadow-[0_8px_18px_-10px_rgba(14,34,61,0.6)] flex-none">
                      <ActiveSpecialistIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#9A7538]">
                        {specialist.code} · 执业专席待命中
                      </div>
                      <h3 className="mt-0.5 font-display text-base sm:text-[17px] font-bold text-[#0E223D]">
                        {specialist.shortTitle}工作台已就绪
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        在左侧输入案情文字、导入本地 <code className="rounded bg-[#F3EFE4] px-1 py-0.5 text-[#0E223D] font-mono text-[11px]">.docx</code>，或粘贴/上传证据截图，流式成稿与核对表格将在此处以文书排版呈现。
                      </p>
                    </div>
                  </div>

                  {/* Specialist-Specific Craft Pillars */}
                  <div className="rounded-xl border border-[#EAE1CE] bg-gradient-to-br from-[#FCF9F2] to-[#F7F2E6] p-3.5">
                    <div className="text-[11px] font-bold text-[#7D5E29] mb-2">
                      当前专席内置实务纪律
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {activePillars.map((pillar) => (
                        <div key={pillar} className="flex items-center gap-2 text-xs text-[#232B38]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#B89254] flex-none" />
                          <span>{pillar}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 3 Tactile Capability Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="rounded-xl border border-[#ECE6D8] bg-[#FCFBF8] p-3 space-y-1">
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0E223D]">
                        <Layers className="h-3.5 w-3.5 text-[#9A7538]" />
                        多轮追问留痕
                      </div>
                      <p className="text-[11px] leading-[1.6] text-slate-500">
                        首轮成稿后可无限轮次微调语气与诉请，每轮版本独立可导 Word 或撤回。
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#ECE6D8] bg-[#FCFBF8] p-3 space-y-1">
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0E223D]">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
                        跨轮本地脱敏
                      </div>
                      <p className="text-[11px] leading-[1.6] text-slate-500">
                        沿用同一密码本不撞号，补充要求同步脱敏，返回屏幕毫秒级还原真名。
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#ECE6D8] bg-[#FCFBF8] p-3 space-y-1">
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0E223D]">
                        <Camera className="h-3.5 w-3.5 text-[#9A7538]" />
                        多图识读打码
                      </div>
                      <p className="text-[11px] leading-[1.6] text-slate-500">
                        支持相册多选与 Ctrl+V 贴图，发送前可本地涂抹遮盖敏感证件区域。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {uiTurns.map((turn) => {
                  const visibleAns = renderVisibleText(turn.assistantRaw);
                  const reasoningOpen = Boolean(expandedReasoningIds[turn.id]);
                  return (
                    <div key={turn.id} className="space-y-3">
                      {/* User Turn Folio Note */}
                      <div className="rounded-xl border border-[#E6DFCE] bg-[#F2EEE4]/85 px-3.5 py-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2 text-[10.5px] font-semibold text-[#8A6529]">
                          <span>第 {turn.roundNo} 轮提问 / 修改指令</span>
                          {turn.userImages.length > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-emerald-800 border border-emerald-200/70">
                              <Camera className="h-3 w-3" /> 附 {turn.userImages.length} 张截图
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[#2A3241] leading-5 whitespace-pre-wrap line-clamp-4">
                          {turn.userDisplayText}
                        </p>
                        {turn.userImages.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {turn.userImages.map((img) => (
                              <img
                                key={img.id}
                                src={img.dataUrl}
                                alt={img.name}
                                className="h-14 w-14 rounded-lg object-cover border border-[#D8D0BE] shadow-xs"
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Assistant Turn Archival Paper Sheet */}
                      <div className="rounded-xl border border-[#E5DEC9] bg-white p-4 sm:p-5 shadow-[0_8px_24px_-16px_rgba(14,34,61,0.16)] space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#EFEAE0]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="h-2 w-2 rounded-full bg-[#B89254] flex-none" />
                            <span className="font-display text-xs sm:text-[13px] font-bold text-[#0E223D]">
                              第 {turn.roundNo} 轮研判成稿
                            </span>
                            <span className="rounded-md bg-[#F6F3EB] border border-[#EAE2D0] px-2 py-0.5 text-[10px] font-medium text-slate-600 truncate max-w-[180px]">
                              {turn.usedModel}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const dateTag = new Date().toISOString().slice(0, 10);
                                const fname = `${specialist.shortTitle}_第${turn.roundNo}轮_${dateTag}.docx`;
                                downloadMarkdownReportDocx(
                                  {
                                    title: specialist.title,
                                    subtitle: `第 ${turn.roundNo} 轮研判结果 ｜ 日期：${dateTag}`,
                                    markdownBody: visibleAns,
                                  },
                                  fname
                                );
                                showToast(`已导出 Word：${fname}`);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-[#E2DAC7] bg-[#FAF8F3] hover:border-[#0E223D] px-2 py-1 text-[10.5px] font-semibold text-[#0E223D] transition-colors"
                            >
                              <Download className="h-2.5 w-2.5 text-[#8A6529]" /> Word
                            </button>
                            <button
                              type="button"
                              onClick={() => copyTurnText(`${turn.id}-wx`, turn.assistantRaw, true)}
                              className="rounded-md border border-[#E2DAC7] bg-[#FAF8F3] hover:border-[#0E223D] px-2 py-1 text-[10.5px] font-medium text-slate-700 transition-colors"
                            >
                              {copiedId === `${turn.id}-wx` ? '已复制' : '微信版'}
                            </button>
                            <button
                              type="button"
                              onClick={() => copyTurnText(turn.id, turn.assistantRaw, false)}
                              className="inline-flex items-center gap-1 rounded-md border border-[#D4B47C]/70 bg-[#FBF6EA] hover:bg-[#F3E8D1] px-2 py-1 text-[10.5px] font-semibold text-[#7A5922] transition-colors"
                            >
                              {copiedId === turn.id ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                              {copiedId === turn.id ? '已复制' : '复制本轮'}
                            </button>
                          </div>
                        </div>

                        {turn.reasoning && (
                          <div className="rounded-lg border border-[#EAE2D0] bg-[#FAF8F3]">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedReasoningIds((prev) => ({
                                  ...prev,
                                  [turn.id]: !prev[turn.id],
                                }))
                              }
                              className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold text-[#7D5E29]"
                            >
                              <span>深度思考推导链（{turn.reasoning.length} 字）</span>
                              {reasoningOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                            {reasoningOpen && (
                              <div className="legal-scroll border-t border-[#EAE2D0] px-3 py-2.5 max-h-44 overflow-y-auto text-[11px] leading-5 whitespace-pre-wrap text-slate-500">
                                {turn.reasoning}
                              </div>
                            )}
                          </div>
                        )}

                        {formattedView ? (
                          <LegalMarkdownView content={visibleAns} />
                        ) : (
                          <div className="text-xs sm:text-[13.5px] leading-[1.8] whitespace-pre-wrap text-[#1B2230] font-mono">
                            {visibleAns}
                          </div>
                        )}
                        <div className="pt-2 border-t border-[#EFEAE0] text-[11px] text-[#8A6529]">
                          {AI_LEGAL_DISCLAIMER}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Active Streaming Sheet */}
                {streaming && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-[#E6DFCE] bg-[#F2EEE4]/85 px-3.5 py-2.5 text-xs">
                      <div className="text-[10.5px] font-semibold text-[#8A6529]">
                        第 {uiTurns.length + 1} 轮提问（生成中…）
                      </div>
                      <p className="mt-1 text-[#2A3241] leading-5 whitespace-pre-wrap line-clamp-3">
                        {streamingUserText}
                      </p>
                      {streamingUserImages.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {streamingUserImages.map((img) => (
                            <img
                              key={img.id}
                              src={img.dataUrl}
                              alt={img.name}
                              className="h-12 w-12 rounded-lg object-cover border border-[#D8D0BE]"
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-[#D8C7A4] bg-white p-4 sm:p-5 shadow-[0_8px_24px_-16px_rgba(14,34,61,0.18)] space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-[#EFEAE0] text-xs font-semibold text-[#0E223D]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#B89254]" />
                        <span>正在实时起草第 {uiTurns.length + 1} 轮研判成稿…</span>
                      </div>

                      {streamingReasoning && (
                        <div className="legal-scroll rounded-lg border border-[#EAE2D0] bg-[#FAF8F3] px-3 py-2 text-[11px] leading-5 text-slate-500 max-h-32 overflow-y-auto whitespace-pre-wrap">
                          深度思考中：{streamingReasoning}
                        </div>
                      )}

                      {streamingOutput ? (
                        formattedView ? (
                          <LegalMarkdownView content={renderVisibleText(streamingOutput)} />
                        ) : (
                          <div className="text-xs sm:text-[13.5px] leading-[1.8] whitespace-pre-wrap text-[#1B2230]">
                            {renderVisibleText(streamingOutput)}
                          </div>
                        )
                      ) : (
                        <div className="text-xs text-slate-500 leading-6">
                          正在实时连接大模型接口并按专席实务纪律起草，请稍候…
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Grounded Follow-Up Refinement Dock */}
          <div className="bg-[#F4F1E8] border-t border-[#E5DEC9] px-4 sm:px-5 py-3 space-y-2.5">
            {chatHistory.length > 0 && !streaming && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_REFINEMENT_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => runGeneration(true, chip)}
                        className="rounded-full border border-[#DDD4C0] bg-white hover:border-[#B89254] hover:text-[#0E223D] px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-[0_1px_2px_rgba(14,34,61,0.03)] transition-all"
                      >
                        + {chip}
                      </button>
                    ))}
                  </div>
                  {uiTurns.length > 1 && (
                    <button
                      type="button"
                      onClick={undoLastRound}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-[#0E223D]"
                    >
                      <Undo2 className="h-3 w-3" /> 撤回上一轮
                    </button>
                  )}
                </div>

                {followUpImages.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white p-2 border border-[#E2DAC7]">
                    {followUpImages.map((img) => (
                      <div key={img.id} className="relative">
                        <img
                          src={img.dataUrl}
                          alt={img.name}
                          onClick={() => setRedactingImageTarget({ bucket: 'followup', image: img })}
                          className="h-12 w-12 rounded-lg object-cover border border-[#D8D0BE] cursor-pointer"
                          title="点击进入本地涂抹打码"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setFollowUpImages((prev) => prev.filter((x) => x.id !== img.id))
                          }
                          className="absolute -top-1 -right-1 rounded-full bg-red-600 p-0.5 text-white"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                    <span className="text-[10.5px] text-[#7A5922] font-medium">
                      {resolvedVisionModel
                        ? `将使用 ${resolvedVisionModel} 识别补充截图`
                        : '当前服务商未配置识图模型，请先在「我的配置」切换'}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-1.5 rounded-xl border border-[#D8CFBC] bg-white p-1.5 shadow-xs focus-within:border-[#0E223D] focus-within:ring-2 focus-within:ring-[#B89254]/15">
                  <input
                    ref={followUpImageRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      if (e.target.files) attachImages(e.target.files, 'followup');
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={compressingImages || followUpImages.length >= MAX_IMAGES_PER_TURN}
                    onClick={() => followUpImageRef.current?.click()}
                    className="flex-none inline-flex items-center justify-center rounded-lg bg-[#F6F2E8] hover:bg-[#ECE4D2] p-2 text-[#85642B] transition-colors disabled:opacity-40"
                    title="追问时补充上传截图"
                  >
                    <ImagePlus className="h-4 w-4" />
                  </button>
                  <input
                    type="text"
                    value={followUpInput}
                    onChange={(e) => setFollowUpInput(e.target.value)}
                    onPaste={(e) => handlePasteImages(e, 'followup')}
                    onKeyDown={(e) => e.key === 'Enter' && runGeneration(true)}
                    placeholder="继续追问修改（支持粘贴/附补充截图，如：把违约金改成日万分之五）…"
                    className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-xs text-[#11151C] placeholder:text-slate-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => runGeneration(true)}
                    className="flex-none inline-flex items-center gap-1 rounded-lg bg-[#0E223D] hover:bg-[#17345D] px-3.5 py-2 text-xs font-bold text-[#F6F4EF] transition-colors"
                  >
                    <Send className="h-3.5 w-3.5 text-[#E0C38A]" /> 追问
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
              <span>
                {willUseVision && resolvedVisionModel
                  ? `视觉模式就绪：${resolvedVisionModel} ｜ ${AI_LEGAL_DISCLAIMER}`
                  : AI_LEGAL_DISCLAIMER}
              </span>
              <button
                type="button"
                onClick={() => openLawsSearch('', 'statutes')}
                className="inline-flex items-center gap-1 text-[#8C6526] hover:text-[#0E223D] font-semibold transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5" /> 去离线法典核对原文 →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* L-2: Outbound Redaction Preview Modal */}
      {pendingPreview && livePreviewResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B172A]/60 backdrop-blur-[2px] p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#D8CEB9] bg-white shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="bg-[#0E223D] px-5 py-3.5 text-[#F6F4EF] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span className="font-display text-sm sm:text-base font-bold">
                  脱敏出站预览 · 发送前核对
                </span>
                <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-200">
                  本次已替换 {livePreviewResult.totalReplaced} 处
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPendingPreview(null)}
                className="rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1">
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs leading-5 text-amber-950 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 flex-none text-amber-700 mt-0.5" />
                <div>
                  <strong>规则引擎边界提示：</strong>
                  自动脱敏基于规则识别，可能遗漏生僻人名、品牌简称、项目代号或特殊商号，发送至第三方大模型前请人工扫读下方将发出的脱敏文本；如发现漏网词汇，可立即在下方追加自定义敏感词。
                </div>
              </div>

              {/* Add custom sensitive term inline */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customTermDraft}
                    onChange={(e) => setCustomTermDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const t = customTermDraft.trim();
                        if (t.length >= 2 && !customSensitiveTerms.includes(t)) {
                          setCustomSensitiveTerms((prev) => [...prev, t]);
                          setCustomTermDraft('');
                        }
                      }
                    }}
                    placeholder="发现遗漏的真实姓名/简称/项目名？输入后按回车立即追加遮蔽…"
                    className="flex-1 rounded-lg border border-[#D8CEB9] bg-[#FAF9F6] px-3 py-2 text-xs text-[#11151C] focus:bg-white focus:border-[#0E223D] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const t = customTermDraft.trim();
                      if (t.length < 2) {
                        showToast('自定义敏感词至少需要 2 个字符');
                        return;
                      }
                      if (!customSensitiveTerms.includes(t)) {
                        setCustomSensitiveTerms((prev) => [...prev, t]);
                      }
                      setCustomTermDraft('');
                    }}
                    className="flex-none rounded-lg bg-[#0E223D] hover:bg-[#17345D] px-3.5 py-2 text-xs font-bold text-[#F6F4EF]"
                  >
                    追加遮蔽词
                  </button>
                </div>
                {customSensitiveTerms.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-500">已追加敏感词：</span>
                    {customSensitiveTerms.map((term) => (
                      <span
                        key={term}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-medium text-emerald-900"
                      >
                        {term}
                        <button
                          type="button"
                          onClick={() =>
                            setCustomSensitiveTerms((prev) => prev.filter((x) => x !== term))
                          }
                          className="text-emerald-700 hover:text-red-700"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actual Outbound Text Preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                  <span>即将发往外部大模型（{providerShortName}）的实际文本：</span>
                  {activeProvider?.useCorsRelayFallback ? (
                    <span className="text-amber-800">传输路径：经服务器无状态转发</span>
                  ) : (
                    <span className="text-emerald-800">传输路径：浏览器直连 HTTPS</span>
                  )}
                </div>
                <div className="max-h-[34vh] overflow-y-auto rounded-xl border border-[#DDD5C3] bg-[#FAF8F3] p-3.5 text-xs leading-6 text-[#14181F] whitespace-pre-wrap break-words">
                  {livePreviewResult.redactedNote && (
                    <div className="mb-2 pb-2 border-b border-[#E5DEC9]">
                      <span className="font-bold text-[#7A5922]">【补充特别要求】</span>
                      {renderHighlightedOutboundPreview(livePreviewResult.redactedNote)}
                    </div>
                  )}
                  {renderHighlightedOutboundPreview(livePreviewResult.redactedText)}
                </div>
              </div>

              {pendingPreview.attachedImgs.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900">
                  另附 <strong>{pendingPreview.attachedImgs.length}</strong> 张截图原图：图片画面不经文本脱敏规则处理，请确认已用「涂抹打码」遮盖敏感信息。
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={skipPreviewThisSession}
                  onChange={(e) => setSkipPreviewThisSession(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#0E223D]"
                />
                <span>本次页面会话不再弹出出站预览（仍继续执行本地自动脱敏；刷新页面后恢复弹窗核对）</span>
              </label>
            </div>

            <div className="border-t border-[#EAE2D0] bg-[#FAF8F3] px-5 py-3 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingPreview(null)}
                className="rounded-lg border border-[#D4CEC2] bg-white hover:border-[#0E223D] px-4 py-2 text-xs font-semibold text-slate-700"
              >
                返回修改原文
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pendingPreview;
                  setPendingPreview(null);
                  executeGeneration(target);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345D] px-4 py-2 text-xs font-bold text-[#F6F4EF]"
              >
                <Send className="h-3.5 w-3.5 text-[#E0C38A]" /> 确认按此脱敏稿发送
              </button>
            </div>
          </div>
        </div>
      )}

      {/* L-2: Explicit Confirmation Modal when turning OFF Auto-Redaction */}
      {confirmDisableRedactOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B172A]/60 backdrop-blur-[2px] p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-300 bg-white shadow-2xl overflow-hidden">
            <div className="bg-amber-600 px-5 py-3.5 text-white flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-none" />
              <span className="font-display text-sm font-bold">确认关闭本地自动脱敏？</span>
            </div>
            <div className="p-5 space-y-3 text-xs leading-6 text-slate-700">
              <p>
                关闭<strong>「文本自动脱敏」</strong>后，您在输入框或导入 Word 中的<strong>真实当事人姓名、公司全称、身份证号、手机号、银行账号及法院案号</strong>将直接原文发往外部第三方大模型接口。
              </p>
              <p className="text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                如处理的是公开裁判文书、法规条款或已人工脱敏的草稿，可以临时关闭；若涉及真实委托人未公开案情，强烈建议保持开启。
              </p>
            </div>
            <div className="border-t border-[#EFEAE0] bg-[#FAF8F3] px-5 py-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDisableRedactOpen(false)}
                className="rounded-lg bg-[#0E223D] px-4 py-2 text-xs font-bold text-white"
              >
                保持开启（推荐）
              </button>
              <button
                type="button"
                onClick={() => {
                  updateByok({ ...byok, autoRedactPrompt: false });
                  setConfirmDisableRedactOpen(false);
                  showToast('已临时关闭自动脱敏，请注意不要发送未脱敏涉密案情');
                }}
                className="rounded-lg border border-amber-400 bg-white hover:bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900"
              >
                我已知晓风险，确认关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <ImageRedactModal
        image={redactingImageTarget?.image || null}
        onClose={() => setRedactingImageTarget(null)}
        onSave={(updated) => {
          if (!redactingImageTarget) return;
          if (redactingImageTarget.bucket === 'initial') {
            setInputImages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          } else {
            setFollowUpImages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          }
          setRedactingImageTarget(null);
          showToast('已完成本地截图涂抹打码');
        }}
      />
    </div>
  );
};
