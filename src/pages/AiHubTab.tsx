import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  FileUp,
  ImagePlus,
  KeyRound,
  Loader2,
  Lock,
  MessageSquarePlus,
  RotateCcw,
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
import { AI_SPECIALISTS_REGISTRY } from '../data/toolRegistry';
import { resolveVisionModel, streamAiCompletion, type ChatTurn } from '../lib/aiClient';
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

function stripMarkdownForWechat(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
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
    navigateTab,
    openLawsSearch,
    showToast,
  } = useToolbox();

  const [specialistId, setSpecialistId] = useState<AiSpecialistId>(activeSpecialistId);
  const [modelSlot, setModelSlot] = useState<'fast' | 'reasoning'>(byok.defaultModelSlot);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
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
  const [usedModelName, setUsedModelName] = useState('');

  const [sessionMappings, setSessionMappings] = useState<RedactionMapping[]>([]);
  const [autoRestoreView, setAutoRestoreView] = useState(true);
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [uiTurns, setUiTurns] = useState<UiConversationTurn[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pinUnlockInput, setPinUnlockInput] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const followUpImageRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

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

  // Sync preset & recommended model slot when switching specialist
  useEffect(() => {
    setModelSlot(specialist.recommendedSlot);
    setSelectedPreset(specialist.presetOptions?.[0]?.value || '');
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
    if (streaming || uiTurns.length > 0) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  const runGeneration = async (isFollowUp = false, overridePrompt?: string) => {
    if (!isOnline) {
      setErrorMsg('当前手机处于离线状态，AI 功能需要联网调用第三方大模型接口。');
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

    setErrorMsg(null);
    let resolvedKey = '';
    try {
      resolvedKey = await resolveApiKeyWithVault();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '密钥解锁失败');
      return;
    }

    // Apply automatic local redaction with incremental placeholder continuation across turns!
    let outboundText = effectiveText;
    const baseMappings = isFollowUp || uiTurns.length === 0 ? sessionMappings : [];
    let nextMappings = [...baseMappings];

    if (byok.autoRedactPrompt) {
      const red = redactLegalText(effectiveText, {
        existingMappings: baseMappings,
      });
      outboundText = red.redactedText;
      nextMappings = red.mappings;
      setSessionMappings(nextMappings);
    } else if (!isFollowUp && uiTurns.length > 0) {
      setSessionMappings([]);
    }

    const userPromptContent =
      !isFollowUp && selectedPreset
        ? `【特定业务立场与场景要求】\n${selectedPreset}\n\n【待处理材料正文】\n${outboundText}`
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
      setErrorMsg(err instanceof Error ? err.message : '生成中断');
      // Restore follow-up images if request failed so user doesn't have to re-pick screenshots
      if (isFollowUp && attachedImgs.length > 0) {
        setFollowUpImages(attachedImgs);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

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

  return (
    <div className="py-5 sm:py-8 px-4 sm:px-6 mx-auto max-w-6xl space-y-4">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3.5 flex items-start gap-2.5 text-xs text-amber-950">
          <WifiOff className="h-4 w-4 flex-none text-amber-700 mt-0.5" />
          <div>
            <div className="font-bold">当前处于离线模式（AI 智囊需联网）</div>
            <p className="mt-0.5 leading-5">
              AI 功能需在线直连您配置的第三方大模型 API；断网期间您可正常使用底部「离线工具」与「法典清单」全部本地功能。
            </p>
          </div>
        </div>
      )}

      {/* Missing API Key Banner */}
      {!hasReadyKey && (
        <div className="rounded-lg border border-[#B89254] bg-[#0E223D] p-4 text-[#F6F4EF] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <KeyRound className="h-5 w-5 flex-none text-[#D1B27A] mt-0.5" />
            <div>
              <div className="font-display text-sm font-bold text-white">
                首次使用请配置您个人的大模型 API Key（BYOK 自带密钥）
              </div>
              <p className="mt-0.5 text-xs text-slate-300">
                支持 DeepSeek、阿里云百炼、硅基流动、Kimi、智谱等，密钥仅保存在您本人的手机本地，律所不留存、零额外费用。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigateTab('settings')}
            className="flex-none rounded-md bg-[#B89254] px-4 py-2 text-xs font-bold text-[#11151C]"
          >
            前往 30 秒配置密钥 →
          </button>
        </div>
      )}

      {/* PIN Vault Unlock Inline Bar */}
      {byok.pinEnabled && !activeProvider.apiKey && activeProvider.apiKeyEncrypted && !sessionUnlockedPin && (
        <div className="rounded-lg border border-[#DED8CC] bg-white p-3.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#11151C]">
            <Lock className="h-4 w-4 text-[#B89254]" />
            <span>API 密钥受本机 PIN 码加密保护，请输入解锁本次会话：</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              inputMode="numeric"
              value={pinUnlockInput}
              onChange={(e) => setPinUnlockInput(e.target.value)}
              placeholder="输入安全 PIN"
              className="w-32 rounded border border-[#D8D1C3] px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await decryptWithPassphrase(activeProvider.apiKeyEncrypted!, pinUnlockInput.trim());
                  setSessionUnlockedPin(pinUnlockInput.trim());
                  setPinUnlockInput('');
                  showToast('本机密钥保险箱已解锁');
                } catch (err) {
                  showToast(err instanceof Error ? err.message : 'PIN 错误');
                }
              }}
              className="rounded bg-[#0E223D] px-3 py-1.5 text-xs font-semibold text-white"
            >
              解锁
            </button>
          </div>
        </div>
      )}

      {/* 6 Specialists Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {AI_SPECIALISTS_REGISTRY.map((sp) => {
          const active = sp.id === specialist.id;
          return (
            <button
              key={sp.id}
              type="button"
              onClick={() => {
                setSpecialistId(sp.id);
                resetConversation();
              }}
              className={`rounded-lg border p-3 text-left transition-all ${
                active
                  ? 'border-[#0E223D] bg-[#0E223D] text-white shadow-sm'
                  : 'border-[#DED8CC] bg-white text-[#11151C] hover:border-[#B89254]'
              }`}
            >
              <div
                className={`text-[10px] font-semibold uppercase tracking-wider ${
                  active ? 'text-[#D1B27A]' : 'text-[#9A773E]'
                }`}
              >
                {sp.code}
              </div>
              <div className="mt-1 font-display text-xs sm:text-[13px] font-bold leading-snug">
                {sp.shortTitle}
              </div>
              <div
                className={`mt-1 text-[10px] truncate ${
                  active ? 'text-slate-300' : 'text-slate-500'
                }`}
              >
                {sp.badge}
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Input, Docx + Screenshot Upload & Guardrails */}
        <div className="lg:col-span-5 rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5">
          <div>
            <h2 className="font-display text-lg font-bold text-[#11151C]">{specialist.title}</h2>
            <p className="mt-0.5 text-xs leading-5 text-slate-600">{specialist.desc}</p>
          </div>

          {/* Model Slot & Auto-Redact Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[#FAF9F6] border border-[#EAE5DA] p-2.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setModelSlot('fast')}
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  modelSlot === 'fast'
                    ? 'bg-[#0E223D] text-white'
                    : 'text-slate-600 hover:bg-white'
                }`}
              >
                <Zap className="h-3 w-3 text-[#D1B27A]" />
                极速模型
              </button>
              <button
                type="button"
                onClick={() => setModelSlot('reasoning')}
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  modelSlot === 'reasoning'
                    ? 'bg-[#0E223D] text-white'
                    : 'text-slate-600 hover:bg-white'
                }`}
              >
                <BrainCircuit className="h-3 w-3 text-[#D1B27A]" />
                深度推理
              </button>
            </div>

            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900 cursor-pointer">
              <input
                type="checkbox"
                checked={byok.autoRedactPrompt}
                onChange={(e) =>
                  updateByok({ ...byok, autoRedactPrompt: e.target.checked })
                }
                className="rounded accent-[#0E223D]"
              />
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
              文本自动脱敏
            </label>
          </div>

          {/* Preset Stance Selector */}
          {specialist.presetOptions && specialist.presetOptions.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-[#11151C] mb-1">
                选择代理立场 / 文书场景：
              </label>
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value)}
                className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 text-xs font-medium text-[#11151C] focus:border-[#0E223D] focus:outline-none"
              >
                {specialist.presetOptions.map((opt) => (
                  <option key={opt.label} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Document + Screenshot Upload Toolbar */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
              <span className="text-xs font-bold text-[#11151C]">案件材料 / 截图输入</span>
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
                  className="inline-flex items-center gap-1 rounded border border-[#0E223D]/25 bg-[#F6F4EF] px-2 py-1 text-[11px] font-semibold text-[#0E223D] hover:bg-[#EAE3D5]"
                >
                  <FileUp className="h-3.5 w-3.5" /> .docx/.txt
                </button>
                <button
                  type="button"
                  disabled={compressingImages || inputImages.length >= MAX_IMAGES_PER_TURN}
                  onClick={() => imageRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded border border-[#B89254] bg-[#F3ECE0] px-2 py-1 text-[11px] font-bold text-[#7A5922] hover:bg-[#E7DBC6] disabled:opacity-50"
                >
                  {compressingImages ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
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
                    className="p-1 text-slate-400 hover:text-slate-700"
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
              className="w-full rounded-md border border-[#D8D1C3] bg-[#FAF9F6] p-3 text-xs sm:text-sm leading-6 text-[#14181F] focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />

            {/* Attached Initial Screenshots Strip */}
            {inputImages.length > 0 && (
              <div className="mt-2.5 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  {inputImages.map((img) => (
                    <div
                      key={img.id}
                      className="relative group rounded-md border border-[#DED8CC] bg-[#FAF9F6] overflow-hidden"
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
                        className="absolute bottom-6 left-1 rounded bg-[#0E223D]/90 hover:bg-[#0E223D] border border-[#D1B27A]/60 px-1.5 py-0.5 text-[10px] font-bold text-[#D1B27A]"
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
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-5 text-amber-950 space-y-1">
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
                        当前「{activeProvider?.name.split('（')[0]}」未配置视觉识图模型（DeepSeek 官方暂仅支持纯文本）
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

          <div className="flex items-center gap-2">
            {!streaming ? (
              <button
                type="button"
                onClick={() => runGeneration(false)}
                disabled={!isOnline}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-[#0E223D] hover:bg-[#16325A] py-3 px-3 text-xs sm:text-sm font-bold text-[#F6F4EF] disabled:opacity-45"
              >
                <Sparkles className="h-4 w-4 text-[#D1B27A] flex-none" />
                <span className="truncate">
                  {uiTurns.length > 0 ? `重新发起「${specialist.shortTitle}」` : `启动「${specialist.shortTitle}」`}
                  （
                  {inputImages.length > 0
                    ? resolvedVisionModel || '需先配置识图模型'
                    : modelSlot === 'reasoning'
                    ? activeProvider?.reasoningModel || activeProvider?.fastModel
                    : activeProvider?.fastModel}
                  ）
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopGeneration}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-red-700 hover:bg-red-800 py-3 text-xs sm:text-sm font-bold text-white"
              >
                <Square className="h-4 w-4 fill-current" /> 停止流式输出
              </button>
            )}
          </div>
        </div>

        {/* Right: Multi-Turn Legal Consultation Thread + Follow-Up Refinement Dock */}
        <div className="lg:col-span-7 rounded-lg border border-[#0E223D] bg-[#0E223D] p-4 sm:p-5 text-[#F6F4EF] flex flex-col">
          {/* Header Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/15">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.18em] text-[#D1B27A]">
                  CN LAWYER AI OUTPUT · 多轮研判对话舱
                </span>
                {uiTurns.length > 0 && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    共 {uiTurns.length} 轮
                  </span>
                )}
                {streaming && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D1B27A]" />}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-300 truncate">
                {usedModelName
                  ? `最近调用：${usedModelName}`
                  : `就绪服务商：${activeProvider?.name.split('（')[0]}${resolvedVisionModel ? `（支持识图：${resolvedVisionModel}）` : ''}`}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {sessionMappings.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAutoRestoreView((v) => !v)}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
                    autoRestoreView
                      ? 'border-emerald-400/50 bg-emerald-950/60 text-emerald-200'
                      : 'border-white/20 bg-white/10 text-slate-200'
                  }`}
                >
                  {autoRestoreView
                    ? `✓ 已还原真名 (${sessionMappings.length})`
                    : `显示脱敏稿`}
                </button>
              )}

              {uiTurns.length > 0 && (
                <button
                  type="button"
                  onClick={resetConversation}
                  className="inline-flex items-center gap-1 rounded border border-white/20 bg-white/5 hover:bg-white/15 px-2.5 py-1 text-[11px] font-medium text-slate-200"
                  title="清空当前对话开始新案件"
                >
                  <MessageSquarePlus className="h-3 w-3 text-[#D1B27A]" /> 新开对话
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const raw = streaming ? streamingOutput : latestCompletedTurn?.assistantRaw || '';
                  if (!raw.trim()) return;
                  const visible = renderVisibleText(raw);
                  const dateTag = new Date().toISOString().slice(0, 10);
                  const fname = `${specialist.shortTitle}_${dateTag}.docx`;
                  downloadMarkdownReportDocx(
                    {
                      title: specialist.title,
                      subtitle: `生成日期：${dateTag} ｜ 供承办律师复核定稿使用`,
                      markdownBody: visible,
                    },
                    fname
                  );
                  showToast(`已导出可编辑 Word 文档：${fname}`);
                }}
                disabled={!latestDisplayText || streaming}
                className="inline-flex items-center gap-1 rounded border border-[#D1B27A]/60 bg-[#091628] hover:bg-white/15 px-2.5 py-1.5 text-xs font-semibold text-[#D1B27A] disabled:opacity-40 whitespace-nowrap"
                title="纯浏览器本地导出为标准 Word (.docx) 文书底稿"
              >
                <Download className="h-3.5 w-3.5" /> 导出 Word
              </button>

              <button
                type="button"
                onClick={() =>
                  copyTurnText('latest-wx', streaming ? streamingOutput : latestCompletedTurn?.assistantRaw || '', true)
                }
                disabled={!latestDisplayText}
                className="inline-flex items-center gap-1 rounded bg-white/15 hover:bg-white/25 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40 whitespace-nowrap"
                title="去除 Markdown 星号与井号，适合直接粘贴到微信对话框"
              >
                微信纯文本
              </button>

              <button
                type="button"
                onClick={() =>
                  copyTurnText('latest-full', streaming ? streamingOutput : latestCompletedTurn?.assistantRaw || '', false)
                }
                disabled={!latestDisplayText}
                className="inline-flex items-center gap-1 rounded bg-[#D1B27A] hover:bg-[#DEC28F] px-3 py-1.5 text-xs font-bold text-[#11151C] disabled:bg-white/15 disabled:text-slate-300 whitespace-nowrap"
              >
                {copiedId === 'latest-full' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedId === 'latest-full' ? '已复制' : '复制最新稿'}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-3 rounded bg-red-950/80 border border-red-400/50 p-3 text-xs text-red-100 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 flex-none text-red-300 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold">请求未能完成</div>
                <p className="leading-5">{errorMsg}</p>
              </div>
            </div>
          )}

          {/* Scrollable Multi-Turn Conversation Feed */}
          <div className="mt-3 flex-1 min-h-[300px] max-h-[560px] overflow-y-auto rounded bg-[#091628] p-3.5 sm:p-4 border border-white/10 space-y-4">
            {uiTurns.length === 0 && !streaming ? (
              <div className="text-xs sm:text-sm leading-7 text-slate-300 space-y-2.5">
                <p>输入案件文字、导入本地 <code className="text-[#D1B27A]">.docx</code> 合同，或点击 <strong className="text-[#D1B27A]">「传截图/拍照」</strong> 上传合同/聊天记录照片，流式法律分析将在此按轮次留痕呈现。</p>
                <ul className="space-y-1 text-xs text-slate-400 list-disc pl-4">
                  <li><strong>完整多轮追问改稿：</strong>首轮生成后，可在下方无限轮次追问修改（如调语气、补条款、改诉请），每一轮版本均完整保留可对比复制，支持随时撤回上一轮。</li>
                  <li><strong>多图截图识别：</strong>支持相册多选、现场拍照或电脑 <code className="text-slate-200">Ctrl+V</code> 粘贴截图（本地自动高清压缩，含图自动切换视觉模型）。</li>
                  <li><strong>跨轮本地脱敏还原：</strong>开启「文本自动脱敏」后，多轮追问沿用同一套密码本不撞号，返回屏幕毫秒级还原真实姓名与公司全称。</li>
                </ul>
              </div>
            ) : (
              <>
                {uiTurns.map((turn) => {
                  const visibleAns = renderVisibleText(turn.assistantRaw);
                  const reasoningOpen = Boolean(expandedReasoningIds[turn.id]);
                  return (
                    <div key={turn.id} className="space-y-2.5 pb-4 border-b border-white/10 last:border-0 last:pb-0">
                      {/* User Turn Bubble */}
                      <div className="rounded-lg bg-white/8 border border-white/10 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2 text-[10px] text-[#D1B27A] font-semibold">
                          <span>第 {turn.roundNo} 轮提问 / 修改指令</span>
                          {turn.userImages.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-emerald-300">
                              <Camera className="h-3 w-3" /> 附 {turn.userImages.length} 张截图
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-slate-200 leading-5 whitespace-pre-wrap line-clamp-4">
                          {turn.userDisplayText}
                        </p>
                        {turn.userImages.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {turn.userImages.map((img) => (
                              <img
                                key={img.id}
                                src={img.dataUrl}
                                alt={img.name}
                                className="h-14 w-14 rounded object-cover border border-white/20"
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Assistant Turn Output */}
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                          <span className="font-semibold text-[#D1B27A]">
                            ✦ 第 {turn.roundNo} 轮研判结果 · <span className="text-slate-400 font-normal">{turn.usedModel}</span>
                          </span>
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
                              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2 py-0.5 text-[10px] font-medium text-emerald-200"
                            >
                              <Download className="h-2.5 w-2.5" /> Word
                            </button>
                            <button
                              type="button"
                              onClick={() => copyTurnText(`${turn.id}-wx`, turn.assistantRaw, true)}
                              className="rounded bg-white/10 hover:bg-white/20 px-2 py-0.5 text-[10px] font-medium text-slate-200"
                            >
                              {copiedId === `${turn.id}-wx` ? '已复制' : '微信版'}
                            </button>
                            <button
                              type="button"
                              onClick={() => copyTurnText(turn.id, turn.assistantRaw, false)}
                              className="inline-flex items-center gap-1 rounded bg-[#B89254]/25 hover:bg-[#B89254]/40 px-2 py-0.5 text-[10px] font-semibold text-[#D1B27A]"
                            >
                              {copiedId === turn.id ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                              {copiedId === turn.id ? '已复制' : '复制本轮'}
                            </button>
                          </div>
                        </div>

                        {turn.reasoning && (
                          <div className="rounded border border-white/15 bg-[#0E223D]/70">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedReasoningIds((prev) => ({
                                  ...prev,
                                  [turn.id]: !prev[turn.id],
                                }))
                              }
                              className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-[#D1B27A]"
                            >
                              <span>💭 深度思考推导链（{turn.reasoning.length} 字）</span>
                              {reasoningOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                            {reasoningOpen && (
                              <div className="border-t border-white/10 px-3 py-2 max-h-40 overflow-y-auto text-[11px] leading-5 whitespace-pre-wrap text-slate-400">
                                {turn.reasoning}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="text-xs sm:text-sm leading-7 whitespace-pre-wrap text-slate-100">
                          {visibleAns}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Active Streaming Bubble */}
                {streaming && (
                  <div className="space-y-2.5 pt-2 border-t border-[#D1B27A]/30">
                    <div className="rounded-lg bg-white/8 border border-white/10 px-3 py-2 text-xs">
                      <div className="text-[10px] text-[#D1B27A] font-semibold">
                        第 {uiTurns.length + 1} 轮提问（生成中…）
                      </div>
                      <p className="mt-1 text-slate-200 leading-5 whitespace-pre-wrap line-clamp-3">
                        {streamingUserText}
                      </p>
                      {streamingUserImages.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {streamingUserImages.map((img) => (
                            <img
                              key={img.id}
                              src={img.dataUrl}
                              alt={img.name}
                              className="h-12 w-12 rounded object-cover border border-white/20"
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {streamingReasoning && (
                      <div className="rounded border border-white/15 bg-[#0E223D]/70 px-3 py-2 text-[11px] leading-5 text-slate-400 max-h-32 overflow-y-auto whitespace-pre-wrap">
                        💭 思考中：{streamingReasoning}
                      </div>
                    )}

                    <div className="text-xs sm:text-sm leading-7 whitespace-pre-wrap text-slate-100">
                      {renderVisibleText(streamingOutput) || '正在实时连接大模型输出，请稍候…'}
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={threadEndRef} />
          </div>

          {/* Multi-Turn Follow-Up Refinement Dock (with Screenshot Attach & Quick Refinement Chips) */}
          <div className="mt-3 pt-3 border-t border-white/15 space-y-2.5">
            {chatHistory.length > 0 && !streaming && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_REFINEMENT_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => runGeneration(true, chip)}
                        className="rounded-full border border-white/15 bg-white/8 hover:bg-white/15 px-2.5 py-0.5 text-[11px] text-slate-200 transition-colors"
                      >
                        + {chip}
                      </button>
                    ))}
                  </div>
                  {uiTurns.length > 1 && (
                    <button
                      type="button"
                      onClick={undoLastRound}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-[#D1B27A]"
                    >
                      <Undo2 className="h-3 w-3" /> 撤回上一轮
                    </button>
                  )}
                </div>

                {followUpImages.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded bg-white/8 p-2 border border-white/15">
                    {followUpImages.map((img) => (
                      <div key={img.id} className="relative">
                        <img
                          src={img.dataUrl}
                          alt={img.name}
                          onClick={() => setRedactingImageTarget({ bucket: 'followup', image: img })}
                          className="h-12 w-12 rounded object-cover border border-white/25 cursor-pointer"
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
                    <span className="text-[10px] text-amber-200">
                      {resolvedVisionModel
                        ? `将使用 ${resolvedVisionModel} 识别补充截图`
                        : '当前服务商未配置识图模型，请先在「我的配置」切换'}
                    </span>
                  </div>
                )}

                <div className="flex gap-1.5">
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
                    className="flex-none inline-flex items-center justify-center rounded border border-white/20 bg-white/10 hover:bg-white/20 px-2.5 py-2 text-xs text-[#D1B27A] disabled:opacity-40"
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
                    className="flex-1 min-w-0 rounded border border-white/20 bg-[#091628] px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-[#D1B27A] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => runGeneration(true)}
                    className="flex-none inline-flex items-center gap-1 rounded bg-[#B89254] hover:bg-[#C9A465] px-3.5 py-2 text-xs font-bold text-[#11151C]"
                  >
                    <Send className="h-3.5 w-3.5" /> 追问
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>
                {willUseVision && resolvedVisionModel
                  ? `👁️ 视觉模式就绪：${resolvedVisionModel}（请复核识图文字与法源）`
                  : '提示：AI 辅助初稿请由主办律师复核事实与法源后使用'}
              </span>
              <button
                type="button"
                onClick={() => openLawsSearch('', 'statutes')}
                className="inline-flex items-center gap-1 text-[#D1B27A] hover:underline font-medium"
              >
                <BookOpen className="h-3 w-3" /> 去离线法典核对原文
              </button>
            </div>
          </div>
        </div>
      </div>

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
