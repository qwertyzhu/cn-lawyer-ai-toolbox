import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Edit3,
  FileText,
  FolderUp,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  PauseCircle,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { AI_LEGAL_DISCLAIMER } from '../../data/legalDataManifest';
import { decryptWithPassphrase } from '../../lib/cryptoVault';
import { downloadOfficialSpcDocx, downloadZipBundle } from '../../lib/docxBuilder';
import { extractLocalDocumentText } from '../../lib/docxReader';
import {
  SPC_BATCH_MAX_FILES,
  buildSpcBatchZipEntries,
  deriveBatchCaseLabel,
  runSpcBatchQueue,
  sanitizeZipSegment,
  type SpcBatchItem,
} from '../../lib/spcBatchEngine';
import {
  buildResolvedSpcDocument,
  type OfficialSpcTemplate,
  type SpcTemplateCorpus,
} from '../../lib/spcOfficialTemplates';
import type { AiProviderConfig } from '../../types/toolbox';

interface SpcBatchPanelProps {
  corpus: SpcTemplateCorpus;
  tpl: OfficialSpcTemplate;
  items: SpcBatchItem[];
  onItemsChange: React.Dispatch<React.SetStateAction<SpcBatchItem[]>>;
  sharedInstruction: string;
  onSharedInstructionChange: (val: string) => void;
  autoRedact: boolean;
  onAutoRedactChange: (val: boolean) => void;
  modelSlot: 'fast' | 'reasoning';
  onModelSlotChange: (val: 'fast' | 'reasoning') => void;
  concurrency: 1 | 2 | 3;
  onConcurrencyChange: (val: 1 | 2 | 3) => void;
  batchRunning: boolean;
  onBatchRunningChange: (val: boolean) => void;
  isOnline: boolean;
  activeProvider: AiProviderConfig | undefined;
  hasApiKey: boolean;
  needsPinUnlock: boolean;
  pinInput: string;
  onPinInputChange: (val: string) => void;
  sessionUnlockedPin: string | null;
  onUnlockPinSuccess: (pin: string) => void;
  onNavigateSettings: () => void;
  onOpenItemInEditor: (item: SpcBatchItem) => void;
  onClearAllQueue: () => void;
  showToast: (msg: string) => void;
}

export const SpcBatchPanel: React.FC<SpcBatchPanelProps> = ({
  corpus,
  tpl,
  items,
  onItemsChange,
  sharedInstruction,
  onSharedInstructionChange,
  autoRedact,
  onAutoRedactChange,
  modelSlot,
  onModelSlotChange,
  concurrency,
  onConcurrencyChange,
  batchRunning,
  onBatchRunningChange,
  isOnline,
  activeProvider,
  hasApiKey,
  needsPinUnlock,
  pinInput,
  onPinInputChange,
  sessionUnlockedPin,
  onUnlockPinSuccess,
  onNavigateSettings,
  onOpenItemInEditor,
  onClearAllQueue,
  showToast,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [expandedMissingIds, setExpandedMissingIds] = useState<Record<string, boolean>>({});
  const [confirmTargetIds, setConfirmTargetIds] = useState<string[] | null>(null);

  const stats = useMemo(() => {
    let done = 0;
    let running = 0;
    let pending = 0;
    let error = 0;
    for (const item of items) {
      if (item.status === 'done') done++;
      else if (item.status === 'running') running++;
      else if (item.status === 'error') error++;
      else pending++;
    }
    const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0;
    return { total: items.length, done, running, pending, error, pct };
  }, [items]);

  const ingestFiles = async (rawFiles: File[]) => {
    if (!rawFiles.length) return;
    setBatchError('');
    const remain = Math.max(0, SPC_BATCH_MAX_FILES - items.length);
    if (remain === 0) {
      showToast(`单批最多支持 ${SPC_BATCH_MAX_FILES} 份起诉状，请先导出并清空已完成队列`);
      return;
    }

    setImporting(true);
    const slice = rawFiles.slice(0, remain);
    const added: SpcBatchItem[] = [];
    const failedNames: string[] = [];

    for (let i = 0; i < slice.length; i++) {
      const f = slice[i];
      try {
        const text = await extractLocalDocumentText(f);
        if (!text.trim()) {
          failedNames.push(`${f.name}（无文本内容）`);
          continue;
        }
        added.push({
          id: `batch_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
          sourceFilename: f.name,
          caseLabel: deriveBatchCaseLabel(f.name),
          sourceText: text.trim(),
          templateId: tpl.id,
          templateName: tpl.displayName,
          status: 'pending',
          updatedAt: Date.now(),
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : '解析失败';
        failedNames.push(`${f.name}（${reason}）`);
      }
    }

    setImporting(false);
    if (added.length > 0) {
      onItemsChange((prev) => [...prev, ...added]);
      showToast(`已本机解析导入 ${added.length} 份诉状（自动暂存本机，刷新不丢）`);
    }
    if (failedNames.length > 0) {
      setBatchError(`以下 ${failedNames.length} 份文件未能导入：${failedNames.slice(0, 5).join('；')}`);
    }
    if (rawFiles.length > remain) {
      showToast(`已导入前 ${remain} 份，超出单批 ${SPC_BATCH_MAX_FILES} 份上限的部分已跳过`);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await ingestFiles(files);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (batchRunning) return;
    const files = Array.from(e.dataTransfer.files || []);
    await ingestFiles(files);
  };

  const resolvePlainApiKey = async (): Promise<string | null> => {
    if (!isOnline) {
      setBatchError('当前处于离线模式，批量 AI 转写需要联网调用您的个人模型接口。');
      return null;
    }
    if (!activeProvider || !hasApiKey) {
      setBatchError('尚未配置个人大模型 API Key，请先前往「我的配置」绑定后再执行批量转写。');
      return null;
    }
    let plainKey = activeProvider.apiKey;
    if (activeProvider.apiKeyEncrypted) {
      const pin = sessionUnlockedPin || pinInput.trim();
      if (!pin) {
        setBatchError('密钥受本机 PIN 保护，请先在下方输入 PIN 码解锁后再启动批量转写。');
        return null;
      }
      try {
        plainKey = await decryptWithPassphrase(activeProvider.apiKeyEncrypted, pin);
        if (!sessionUnlockedPin) onUnlockPinSuccess(pin);
      } catch {
        setBatchError('PIN 码不正确，无法解密本机 API Key。');
        return null;
      }
    }
    return plainKey;
  };

  const requestStartBatch = (targetIds?: string[]) => {
    setBatchError('');
    const candidates = targetIds
      ? items.filter((x) => targetIds.includes(x.id))
      : items.filter((x) => x.status === 'pending' || x.status === 'error');
    if (candidates.length === 0) {
      showToast('队列中没有待处理或失败的案件');
      return;
    }
    setConfirmTargetIds(candidates.map((x) => x.id));
  };

  const executeBatch = async (targetIds: string[]) => {
    setConfirmTargetIds(null);
    setBatchError('');
    const plainKey = await resolvePlainApiKey();
    if (!plainKey || !activeProvider) return;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    onBatchRunningChange(true);

    try {
      const summary = await runSpcBatchQueue({
        items,
        targetIds,
        tpl,
        provider: { ...activeProvider, apiKey: plainKey },
        modelSlot,
        autoRedact,
        sharedInstruction,
        concurrency,
        signal: ctrl.signal,
        onItemUpdate: (itemId, patch) => {
          onItemsChange((prev) =>
            prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it))
          );
        },
      });

      if (summary.aborted) {
        showToast(`批量任务已暂停（本轮完成 ${summary.succeeded} 份），随时可点击继续续跑`);
      } else if (summary.failed > 0) {
        showToast(
          `本轮完成 ${summary.succeeded} 份，${summary.failed} 份失败（可点「仅重试失败项」）`
        );
      } else {
        showToast(`全部 ${summary.succeeded} 份要素式文书已生成，可直接一键打包下载 ZIP！`);
      }
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : '批量执行异常中断');
    } finally {
      abortRef.current = null;
      onBatchRunningChange(false);
    }
  };

  const handlePauseBatch = () => {
    abortRef.current?.abort();
  };

  const handleDownloadSingleItem = (item: SpcBatchItem) => {
    if (!item.draft) return;
    const targetTpl =
      corpus.templates.find((t) => t.id === item.draft?.templateId) ||
      corpus.templates.find((t) => t.id === item.templateId) ||
      tpl;
    const resolved = buildResolvedSpcDocument(targetTpl, item.draft);
    const filename = `${sanitizeZipSegment(item.caseLabel)}_要素式.docx`;
    downloadOfficialSpcDocx(resolved, filename);
    showToast(`已导出《${filename}》`);
  };

  const handleDownloadAllZip = () => {
    const built = buildSpcBatchZipEntries(corpus, items);
    if (built.exportedCount === 0) {
      showToast('暂无已生成的文书可打包，请先执行批量转写');
      return;
    }
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
      today.getDate()
    ).padStart(2, '0')}`;
    const zipName = `要素式起诉状批量导出_${sanitizeZipSegment(tpl.shortCause)}_${built.exportedCount}份_${stamp}.zip`;
    downloadZipBundle(built.entries, zipName);
    showToast(`已本地打包下载 ${built.exportedCount} 份 Word + 1 份核对清单（.zip）`);
  };

  const handleRemoveItem = (id: string) => {
    if (batchRunning) return;
    onItemsChange((prev) => prev.filter((x) => x.id !== id));
  };

  const handleClearQueueClick = () => {
    if (batchRunning) return;
    if (items.length > 0 && !window.confirm(`确定清空当前队列中的全部 ${items.length} 份案件草稿吗？`)) {
      return;
    }
    onClearAllQueue();
    setBatchError('');
    setConfirmTargetIds(null);
  };

  return (
    <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-4 shadow-xs">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#9A773E]">
            <Layers className="h-3.5 w-3.5 text-[#B89254]" />
            <span>批量多案队列 · 纯本机 IndexedDB 持久化（刷新/切页不丢）</span>
          </div>
          <h2 className="mt-0.5 font-display text-base font-bold text-[#11151C]">
            批量导入传统起诉状 → 批量生成《{tpl.displayName}》
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            一次最多导入 {SPC_BATCH_MAX_FILES} 份 .docx / .txt 传统起诉状；每份案件使用独立脱敏密码本（绝不串案），支持随时暂停、断点续跑、单案载入精修及一键打包下载 ZIP。
          </p>
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 cursor-pointer">
          <input
            type="checkbox"
            checked={autoRedact}
            disabled={batchRunning}
            onChange={(e) => onAutoRedactChange(e.target.checked)}
            className="accent-[#0E223D]"
          />
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          按案独立前置脱敏（推荐）
        </label>
      </div>

      {/* API Key / PIN guards */}
      {!hasApiKey && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
          <span>
            批量转写需要调用您的个人大模型 API Key（自带密钥、直连模型商）。请先前往「我的配置」完成绑定。
          </span>
          <button
            type="button"
            onClick={onNavigateSettings}
            className="inline-flex items-center gap-1 rounded-md bg-[#0E223D] px-3 py-1.5 font-bold text-[#F6F4EF]"
          >
            <KeyRound className="h-3.5 w-3.5 text-[#D1B27A]" /> 去配置 API Key
          </button>
        </div>
      )}

      {needsPinUnlock && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex flex-wrap items-center gap-2 text-xs text-amber-950">
          <Lock className="h-4 w-4 flex-none text-amber-700" />
          <span>密钥受本机 PIN 保护，请先解锁后执行批量转写：</span>
          <input
            type="password"
            value={pinInput}
            onChange={(e) => onPinInputChange(e.target.value)}
            placeholder="输入本机 PIN 码"
            className="w-36 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs focus:outline-none focus:border-[#0E223D]"
          />
        </div>
      )}

      {/* Drag & Drop Multi-File Importer */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!batchRunning) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
          dragging
            ? 'border-[#0E223D] bg-[#F3ECE0]/60'
            : 'border-[#D8D1C3] bg-[#FAF9F6] hover:border-[#B89254]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".docx,.txt"
          onChange={handleFileChange}
          className="hidden"
        />
        <FolderUp className="mx-auto h-7 w-7 text-[#9A773E]" />
        <div className="mt-2 text-xs font-bold text-[#0E223D]">
          将多份传统起诉状（.docx / .txt）拖到此处，或点击批量选择文件
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          全部文件均在您的浏览器本机解析提取正文，不上传原件；旧版 .doc 请先另存为 .docx 后导入。如需更换套用案由，直接在上方 113 份示范文本中切换即可。
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={batchRunning || importing}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345C] disabled:opacity-50 px-4 py-2 text-xs font-bold text-[#F6F4EF]"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D1B27A]" />
            ) : (
              <FolderUp className="h-3.5 w-3.5 text-[#D1B27A]" />
            )}
            <span>{items.length > 0 ? '继续追加导入起诉状' : '批量选择起诉状 (.docx/.txt)'}</span>
          </button>
          <span className="text-[11px] text-slate-500">
            当前队列：{items.length} / {SPC_BATCH_MAX_FILES} 份
          </span>
        </div>
      </div>

      {/* Shared Batch Parameters */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 rounded-xl border border-[#EAE5DA] bg-[#FAF9F6] p-3.5 text-xs">
        <div className="md:col-span-6 space-y-1">
          <label className="block text-[11px] font-bold text-[#0E223D]">
            全批统一补充要求（选填，将应用到本批每一份起诉状）
          </label>
          <input
            type="text"
            disabled={batchRunning}
            value={sharedInstruction}
            onChange={(e) => onSharedInstructionChange(e.target.value)}
            placeholder="例如：若原诉状未明示，默认勾选主张诉讼费；调解意愿勾选暂不确定"
            className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-1.5 text-xs focus:border-[#0E223D] focus:outline-none disabled:opacity-60"
          />
        </div>
        <div className="md:col-span-3 space-y-1">
          <label className="block text-[11px] font-bold text-[#0E223D]">提取模型档位</label>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#D8D1C3] bg-white p-0.5">
            <button
              type="button"
              disabled={batchRunning}
              onClick={() => onModelSlotChange('fast')}
              className={`rounded-md py-1 text-[11px] font-semibold ${
                modelSlot === 'fast'
                  ? 'bg-[#0E223D] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              极速模型
            </button>
            <button
              type="button"
              disabled={batchRunning}
              onClick={() => onModelSlotChange('reasoning')}
              className={`rounded-md py-1 text-[11px] font-semibold ${
                modelSlot === 'reasoning'
                  ? 'bg-[#0E223D] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              深度推理
            </button>
          </div>
        </div>
        <div className="md:col-span-3 space-y-1">
          <label className="block text-[11px] font-bold text-[#0E223D]">同时处理数（防限流）</label>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#D8D1C3] bg-white p-0.5">
            {([1, 2, 3] as const).map((n) => (
              <button
                key={n}
                type="button"
                disabled={batchRunning}
                onClick={() => onConcurrencyChange(n)}
                className={`rounded-md py-1 text-[11px] font-semibold ${
                  concurrency === n
                    ? 'bg-[#B89254] text-[#11151C] font-bold'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {n === 1 ? '1 稳妥' : n === 2 ? '2 推荐' : '3 提速'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {batchError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 flex-none mt-0.5" />
          <span className="break-words">{batchError}</span>
        </div>
      )}

      {/* Pre-Send Compliance Confirmation Box */}
      {confirmTargetIds && confirmTargetIds.length > 0 && !batchRunning && (
        <div className="rounded-xl border border-[#B89254] bg-[#FBF7EE] p-4 space-y-2.5 text-xs text-[#11151C]">
          <div className="flex items-start justify-between gap-2">
            <div className="font-bold text-[#0E223D] flex items-center gap-1.5">
              {autoRedact ? (
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-rose-600" />
              )}
              <span>批量外发前合规确认（即将处理 {confirmTargetIds.length} 份起诉状）</span>
            </div>
            <button
              type="button"
              onClick={() => setConfirmTargetIds(null)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="space-y-1 text-[11px] leading-5 text-slate-700 list-disc pl-4">
            <li>
              <strong>发送去向</strong>：将由本机浏览器直连发送至您自选的模型服务商{' '}
              <strong>{activeProvider?.name || '当前服务商'}</strong>（套用官方模板：
              <strong>《{tpl.displayName}》</strong>）。
            </li>
            <li>
              <strong>隐私边界</strong>：
              {autoRedact
                ? '已开启「按案独立前置脱敏」，每份案件使用独立替换表并在本机自动还原真名，案间绝不串号；规则脱敏对生僻姓名/简称可能存在遗漏，请先评估案情保密义务。'
                : '⚠ 您当前已关闭自动脱敏，起诉状原文将不经替换直接发往第三方模型服务商，请确认已获合规授权！'}
            </li>
            <li>
              <strong>人工复核义务</strong>：所有批量生成的 Word 均为草稿，提交法院前须结合导出的《批量生成核对清单》逐案核对原件与受案法院现行版本。
            </li>
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setConfirmTargetIds(null)}
              className="rounded-lg border border-[#D8D1C3] bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => executeBatch(confirmTargetIds)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345C] px-4 py-1.5 text-xs font-bold text-[#F6F4EF]"
            >
              <Play className="h-3.5 w-3.5 text-[#D1B27A]" /> 确认并立即开始批量转写
            </button>
          </div>
        </div>
      )}

      {/* Progress & Batch Controls */}
      {items.length > 0 && (
        <div className="rounded-xl border border-[#DED8CC] bg-[#FAF9F6] p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 font-semibold text-[#11151C]">
              <span>队列总进度：{stats.done} / {stats.total} 份（{stats.pct}%）</span>
              {stats.running > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">
                  <Loader2 className="h-3 w-3 animate-spin" /> 处理中 {stats.running}
                </span>
              )}
              {stats.pending > 0 && (
                <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                  待处理 {stats.pending}
                </span>
              )}
              {stats.error > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                  失败 {stats.error}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {!batchRunning ? (
                <>
                  {(stats.pending > 0 || stats.error > 0) && (
                    <button
                      type="button"
                      onClick={() => requestStartBatch()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345C] px-3.5 py-1.5 text-xs font-bold text-[#F6F4EF]"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-[#D1B27A]" />
                      {stats.done > 0
                        ? `继续未完成项 (${stats.pending + stats.error})`
                        : `开始批量转写 (${stats.pending + stats.error})`}
                    </button>
                  )}
                  {stats.error > 0 && stats.pending > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        requestStartBatch(items.filter((x) => x.status === 'error').map((x) => x.id))
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-800"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> 仅重试失败项 ({stats.error})
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={handlePauseBatch}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-50 hover:bg-amber-100 px-3.5 py-1.5 text-xs font-bold text-amber-950"
                >
                  <PauseCircle className="h-3.5 w-3.5 text-amber-700" /> 暂停队列（保留已完成）
                </button>
              )}

              {stats.done > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadAllZip}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#B89254] hover:bg-[#A68145] px-3.5 py-1.5 text-xs font-bold text-[#11151C] shadow-xs"
                >
                  <Archive className="h-3.5 w-3.5" /> 一键打包下载 ZIP（{stats.done} 份 Word + 核对清单）
                </button>
              )}

              <button
                type="button"
                disabled={batchRunning}
                onClick={handleClearQueueClick}
                className="inline-flex items-center gap-1 rounded-lg border border-[#D8D1C3] bg-white hover:border-rose-300 hover:text-rose-700 disabled:opacity-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600"
              >
                <Trash2 className="h-3.5 w-3.5" /> 清空队列
              </button>
            </div>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-[#E8E2D5]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#0E223D] to-[#B89254] transition-all duration-300"
              style={{ width: `${stats.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Per-Case Queue List */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, idx) => {
            const missingCount = item.missingChecklist?.length || 0;
            const expanded = Boolean(expandedMissingIds[item.id]);
            return (
              <div
                key={item.id}
                className={`rounded-xl border p-3.5 transition-colors ${
                  item.status === 'done'
                    ? 'border-emerald-200 bg-emerald-50/25'
                    : item.status === 'error'
                    ? 'border-rose-200 bg-rose-50/30'
                    : item.status === 'running'
                    ? 'border-[#B89254] bg-[#FBF7EE]/60'
                    : 'border-[#E5DFD3] bg-white'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2.5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-[#0E223D] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#D1B27A]">
                        #{String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="text-xs font-bold text-[#11151C] break-all">
                        {item.caseLabel}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        （{item.sourceText.length.toLocaleString()} 字）
                      </span>
                      {item.status === 'done' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" /> 已生成 · 填 {item.changedCount ?? 0} 项
                        </span>
                      )}
                      {item.status === 'running' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                          <Loader2 className="h-3 w-3 animate-spin" /> {item.progressNote || '提取中…'}
                        </span>
                      )}
                      {item.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          <Clock className="h-3 w-3" /> {item.progressNote || '待处理'}
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                          <AlertTriangle className="h-3 w-3" /> 提取失败
                        </span>
                      )}
                    </div>

                    {item.status === 'done' && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                        <span>模板：{item.templateName}</span>
                        {item.courtName && <span>受案法院：{item.courtName}</span>}
                        {(item.redactedEntityCount ?? 0) > 0 && (
                          <span className="text-emerald-700">
                            独立脱敏还原 {item.redactedEntityCount} 处
                          </span>
                        )}
                        {missingCount > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedMissingIds((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id],
                              }))
                            }
                            className="inline-flex items-center gap-0.5 font-semibold text-amber-800 hover:underline"
                          >
                            ⚠ {missingCount} 项待补漏
                            {expanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {item.status === 'error' && item.error && (
                      <div className="text-[11px] text-rose-700 break-words">{item.error}</div>
                    )}
                  </div>

                  {/* Per-Item Actions */}
                  <div className="flex flex-wrap items-center gap-1.5 flex-none">
                    {item.status === 'done' && item.draft && (
                      <>
                        <button
                          type="button"
                          disabled={batchRunning}
                          onClick={() => onOpenItemInEditor(item)}
                          className="inline-flex items-center gap-1 rounded-md border border-[#0E223D] bg-white hover:bg-[#0E223D] hover:text-white disabled:opacity-50 px-2.5 py-1 text-[11px] font-bold text-[#0E223D] transition-colors"
                          title="载入逐项编辑器与 AI 多轮改表助手精修，改完可一键保存回队列"
                        >
                          <Edit3 className="h-3 w-3" /> 载入精修
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadSingleItem(item)}
                          className="inline-flex items-center gap-1 rounded-md border border-[#D1B27A] bg-[#FBF7EE] hover:bg-[#F3E9D2] px-2.5 py-1 text-[11px] font-semibold text-[#7A5922]"
                        >
                          <Download className="h-3 w-3" /> Word
                        </button>
                      </>
                    )}
                    {!batchRunning && item.status !== 'running' && (
                      <button
                        type="button"
                        onClick={() => requestStartBatch([item.id])}
                        className="inline-flex items-center gap-1 rounded-md border border-[#D8D1C3] bg-white hover:border-[#0E223D] px-2 py-1 text-[11px] font-semibold text-slate-600"
                        title={item.status === 'done' ? '按当前模板重新提取此案' : '单独提取此案'}
                      >
                        <RotateCcw className="h-3 w-3" />
                        {item.status === 'done' ? '重跑' : '执行'}
                      </button>
                    )}
                    {!batchRunning && (
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="从队列移除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {expanded && missingCount > 0 && item.missingChecklist && (
                  <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-[11px] text-amber-950 space-y-1">
                    <div className="font-bold flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5 text-amber-700" />
                      AI 提示原诉状未提及、建议律师补充核实：
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {item.missingChecklist.map((m, mi) => (
                        <li key={mi}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] leading-5 text-slate-500 border-t border-[#EFECE5] pt-3">
        {AI_LEGAL_DISCLAIMER}
      </p>
    </section>
  );
};
