import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  Copy,
  FileUp,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
  X,
} from 'lucide-react';
import { useToolbox } from '../../context/ToolboxContext';
import { copyToClipboard } from '../../lib/clipboard';
import { extractLocalDocumentText } from '../../lib/docxReader';
import { redactLegalText, restoreRedactedText } from '../../lib/redactor';
import type { AiSpecialistId } from '../../types/toolbox';

const CATEGORY_BADGES: Record<string, string> = {
  name: '当事人姓名',
  company: '公司/机构',
  id_card: '身份证号',
  credit_code: '统一信用代码',
  phone: '手机号',
  email: '电子邮箱',
  bank_card: '银行卡/账号',
  case_no: '法院案号',
  address: '详细地址',
  custom: '自定义敏感词',
};

const DEMO_SAMPLE = `原告：杭州星河光影文化传媒有限公司，统一社会信用代码：91330105MA2K88991X，住所地：浙江省杭州市拱墅区大关路100号绿地中心11幢901室。
法定代表人：林建国，联系电话：13858129988，联系邮箱：linjg@xinghefilm.cn。
被告：陈志强，男，身份证号：33010619890512341X，收款银行账号：6222021202009876543。
案情摘要：就前案（2025）浙0105民初4321号和解协议履行事宜，被告陈志强至今未向原告杭州星河智能设备有限公司支付涉案设备采购结算尾款。`;

export const LocalRedactorTool: React.FC = () => {
  const { sendToAi, recordCalculation, showToast } = useToolbox();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'redact' | 'restore'>('redact');
  const [rawInput, setRawInput] = useState('');
  const [aiDraftInput, setAiDraftInput] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [opts, setOpts] = useState({
    redactNames: true,
    redactCompanies: true,
    redactIds: true,
    redactPhones: true,
    redactBanks: true,
    redactCaseNos: true,
    redactAddresses: true,
  });
  const [copied, setCopied] = useState(false);

  const result = useMemo(
    () => redactLegalText(rawInput, { ...opts, customTerms }),
    [rawInput, opts, customTerms]
  );

  const restoredOutput = useMemo(
    () => restoreRedactedText(aiDraftInput, result.mappings),
    [aiDraftInput, result.mappings]
  );

  const handleAddCustomTerm = () => {
    const clean = customInput.trim();
    if (clean.length < 2) return;
    if (!customTerms.includes(clean)) {
      setCustomTerms([...customTerms, clean]);
    }
    setCustomInput('');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await extractLocalDocumentText(file);
      setRawInput(text);
      showToast(`已在手机本地读取「${file.name}」（未上传网络）`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      e.target.value = '';
    }
  };

  const handleCopy = async (text: string) => {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (!ok) {
      showToast('复制受限，请长按手动复制');
      return;
    }
    setCopied(true);
    showToast('已复制到剪贴板');
    setTimeout(() => setCopied(false), 1800);
  };

  const pushToAi = (specialistId: AiSpecialistId) => {
    if (!result.redactedText.trim()) {
      showToast('请先粘贴或导入需要脱敏的案件材料');
      return;
    }
    // Store latest mappings in sessionStorage so AI Hub can also 1-click restore!
    try {
      sessionStorage.setItem('cn_lawyer_last_redaction_map', JSON.stringify(result.mappings));
    } catch {
      // ignore
    }
    sendToAi(specialistId, '本地预脱敏案件材料（请人工复核）', result.redactedText);
  };

  return (
    <div className="py-5 sm:py-8 px-4 sm:px-6 mx-auto max-w-6xl">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9A773E]">
        <ShieldAlert className="h-3.5 w-3.5 text-[#B89254]" />
        <span>LOCAL PRIVACY SHIELD · 100% 浏览器内存运行</span>
      </div>
      <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-[#11151C]">
        本地案件材料一键脱敏与还原器
      </h1>
      <p className="mt-1.5 text-xs sm:text-sm leading-6 text-slate-600">
        投喂第三方大模型 API 前的执业保密护盾：自动将真名、公司、证件、账号替换为可读代号；AI 生成文书后切至「反向还原」即可一秒恢复真实主体全称。
      </p>

      {/* Mode Switcher */}
      <div className="mt-5 grid grid-cols-2 rounded-lg border border-[#DED8CC] bg-white p-1">
        <button
          type="button"
          onClick={() => setMode('redact')}
          className={`flex items-center justify-center gap-1.5 rounded-md py-2.5 text-xs sm:text-sm font-semibold transition-colors ${
            mode === 'redact'
              ? 'bg-[#0E223D] text-[#F6F4EF] shadow-sm'
              : 'text-slate-600 hover:text-[#11151C]'
          }`}
        >
          <ShieldCheck className="h-4 w-4 text-[#D1B27A]" />
          第一步：本地脱敏替换
        </button>
        <button
          type="button"
          onClick={() => setMode('restore')}
          className={`flex items-center justify-center gap-1.5 rounded-md py-2.5 text-xs sm:text-sm font-semibold transition-colors ${
            mode === 'restore'
              ? 'bg-[#0E223D] text-[#F6F4EF] shadow-sm'
              : 'text-slate-600 hover:text-[#11151C]'
          }`}
        >
          <Unlock className="h-4 w-4 text-[#D1B27A]" />
          第二步：AI 成稿反向还原 ({result.mappings.length})
        </button>
      </div>

      {mode === 'redact' ? (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Input & Rules */}
          <div className="lg:col-span-6 space-y-4">
            <div className="rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <label className="font-display text-sm font-bold text-[#11151C]">
                  原始涉密案件文本 / 合同条款
                </label>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".docx,.txt,.md,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded border border-[#0E223D]/25 bg-[#F6F4EF] px-2.5 py-1 text-xs font-medium text-[#0E223D] hover:bg-[#EDE8DD]"
                  >
                    <FileUp className="h-3.5 w-3.5" /> 导入 .docx/.txt
                  </button>
                  <button
                    type="button"
                    onClick={() => setRawInput(DEMO_SAMPLE)}
                    className="rounded border border-[#DED8CC] px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    填入示例
                  </button>
                  {rawInput && (
                    <button
                      type="button"
                      onClick={() => setRawInput('')}
                      className="rounded p-1 text-slate-400 hover:text-slate-700"
                      title="清空"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                rows={9}
                placeholder="在此粘贴合同、起诉状、笔录或客户聊天记录（所有处理仅在您手机内存中完成，断网亦可运行）…"
                className="w-full rounded-md border border-[#D8D1C3] bg-[#FAF9F6] p-3 text-xs sm:text-sm leading-6 text-[#14181F] focus:border-[#0E223D] focus:bg-white focus:outline-none"
              />

              {/* Toggle Switches */}
              <div className="mt-4">
                <div className="text-xs font-semibold text-slate-700 mb-2">自动识别类别：</div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['redactCompanies', '公司/机构全称'],
                      ['redactNames', '当事人姓名'],
                      ['redactIds', '身份证/信用代码'],
                      ['redactPhones', '手机/邮箱'],
                      ['redactBanks', '银行账号'],
                      ['redactCaseNos', '法院案号'],
                      ['redactAddresses', '详细地址'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setOpts((p) => ({ ...p, [key]: !p[key] }))}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        opts[key]
                          ? 'border-[#0E223D] bg-[#0E223D] text-white'
                          : 'border-[#DED8CC] bg-white text-slate-500'
                      }`}
                    >
                      {opts[key] ? '✓ ' : ''}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Sensitive Words */}
              <div className="mt-4 pt-3 border-t border-[#EFECE5]">
                <div className="text-xs font-semibold text-slate-700 mb-1.5">
                  补充特定涉密简称 / 作品名 / 项目代号（可选）：
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCustomTerm()}
                    placeholder="如：某剧名、客户简称，回车添加"
                    className="flex-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-1.5 text-xs focus:border-[#0E223D] focus:bg-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomTerm}
                    className="inline-flex items-center gap-1 rounded bg-[#0E223D] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    <Plus className="h-3.5 w-3.5" /> 添加
                  </button>
                </div>
                {customTerms.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {customTerms.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded bg-[#F3ECE0] px-2 py-0.5 text-xs font-medium text-[#7A5922]"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => setCustomTerms(customTerms.filter((x) => x !== t))}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Redacted Result & Mapping Table */}
          <div className="lg:col-span-6 space-y-4">
            <div className="rounded-lg border border-[#0E223D] bg-[#0E223D] p-4 sm:p-5 text-[#F6F4EF]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#D1B27A]">
                    PRE-REDACTED DRAFT · 自动预脱敏稿（外发前请人工通读复核）
                  </div>
                  <div className="mt-0.5 text-xs text-slate-300">
                    共识别 {result.mappings.length} 个敏感实体，累计替换 {result.totalReplaced} 处
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(result.redactedText)}
                  disabled={!result.redactedText}
                  className="inline-flex items-center gap-1.5 rounded bg-[#B89254] px-3 py-1.5 text-xs font-bold text-[#11151C] disabled:opacity-40"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? '已复制' : '复制预脱敏稿'}
                </button>
              </div>

              <div className="mt-2.5 rounded border border-amber-400/50 bg-amber-950/50 px-2.5 py-1.5 text-[11px] leading-5 text-amber-100">
                合规提示：本地规则脱敏无法保证 100% 识别口语叙述中的生僻姓名、机构简称或非常规地址；发送给第三方模型前请务必人工核对，遗漏主体可在左下方补充涉密词。
              </div>

              <div className="mt-3 max-h-60 overflow-y-auto rounded bg-[#091628] p-3 text-xs sm:text-sm leading-6 whitespace-pre-wrap text-slate-100 border border-white/10">
                {result.redactedText || '等待输入待脱敏文本…'}
              </div>

              {/* Direct Handoff to AI Specialists */}
              <div className="mt-4 pt-3 border-t border-white/15">
                <div className="text-[11px] font-medium text-[#D1B27A] mb-2">
                  复核无误后送入 AI 智囊舱（仍会弹出最终出站预览，并携带本地密码本）：
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => pushToAi('contract-review')}
                    className="inline-flex items-center justify-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-2 text-xs font-semibold text-white"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[#D1B27A]" /> 送 AI 审合同
                  </button>
                  <button
                    type="button"
                    onClick={() => pushToAi('de-ai-polish')}
                    className="inline-flex items-center justify-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-2 text-xs font-semibold text-white"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[#D1B27A]" /> 送 AI 去AI味
                  </button>
                  <button
                    type="button"
                    onClick={() => pushToAi('timeline-elements')}
                    className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-2 text-xs font-semibold text-white"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[#D1B27A]" /> 拆解时间线
                  </button>
                </div>
              </div>
            </div>

            {/* Mapping Codebook */}
            <div className="rounded-lg border border-[#DED8CC] bg-white p-4">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="font-display text-sm font-bold text-[#11151C]">
                  本地脱敏密码本对照表（不出手机）
                </h3>
                {result.mappings.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      recordCalculation(
                        'local-redactor',
                        '案件脱敏对照表',
                        `共脱敏 ${result.mappings.length} 项主体信息`,
                        result.mappings
                          .map((m) => `${m.placeholder} = ${m.original}（${m.count}处）`)
                          .join('\n')
                      )
                    }
                    className="text-xs font-medium text-[#0E223D] underline"
                  >
                    暂存密码本
                  </button>
                )}
              </div>
              {result.mappings.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">尚未识别到敏感实体。</p>
              ) : (
                <div className="max-h-52 overflow-y-auto divide-y divide-[#EFECE5]">
                  {result.mappings.map((m) => (
                    <div
                      key={m.placeholder}
                      className="flex items-center justify-between gap-2 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex-none rounded bg-[#0E223D] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#D1B27A]">
                          {m.placeholder}
                        </span>
                        <ArrowRightLeft className="h-3 w-3 flex-none text-slate-400" />
                        <span className="truncate font-medium text-[#11151C]">{m.original}</span>
                      </div>
                      <span className="flex-none rounded bg-[#F6F4EF] px-2 py-0.5 text-[10px] text-slate-600">
                        {CATEGORY_BADGES[m.category]} ×{m.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Step 2: Reverse Restore View */
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5">
            <label className="block font-display text-sm font-bold text-[#11151C] mb-2">
              粘贴大模型返回的带代号文书（含 [公司主体A] / [当事人甲]）
            </label>
            <textarea
              value={aiDraftInput}
              onChange={(e) => setAiDraftInput(e.target.value)}
              rows={10}
              placeholder="把外部 AI 生成好的审查意见、代理词或律师函粘贴到这里，右侧将立即用本地密码本精准还原所有真实姓名与公司名称…"
              className="w-full rounded-md border border-[#D8D1C3] bg-[#FAF9F6] p-3 text-xs sm:text-sm leading-6 focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>

          <div className="rounded-lg border border-[#0E223D] bg-[#0E223D] p-4 sm:p-5 text-[#F6F4EF] flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#D1B27A]">
                  RESTORED FINAL DOCUMENT · 真实主体还原成品
                </div>
                <div className="text-xs text-slate-300 mt-0.5">
                  当前挂载 {result.mappings.length} 条本地密码本映射
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(restoredOutput)}
                disabled={!restoredOutput}
                className="inline-flex items-center gap-1.5 rounded bg-[#B89254] px-3 py-1.5 text-xs font-bold text-[#11151C] disabled:opacity-40"
              >
                <Copy className="h-3.5 w-3.5" /> 一键复制还原定稿
              </button>
            </div>
            <div className="flex-1 min-h-[220px] rounded bg-[#091628] p-3.5 text-xs sm:text-sm leading-6 whitespace-pre-wrap text-slate-100 border border-white/10">
              {restoredOutput || '粘贴带占位符的文本后，此处实时显示还原后的完整真实文书…'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
