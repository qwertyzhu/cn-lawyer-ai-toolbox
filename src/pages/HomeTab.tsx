import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  BellRing,
  BookOpen,
  Briefcase,
  Building2,
  Copy,
  Download,
  FileSpreadsheet,
  KeyRound,
  Layers,
  Plus,
  Search,
  Smartphone,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { ToolIcon } from '../components/ToolIcon';
import { SITE_CONFIG } from '../config/siteConfig';
import { useToolbox } from '../context/ToolboxContext';
import { AI_SPECIALISTS_REGISTRY, OFFLINE_TOOLS_REGISTRY } from '../data/toolRegistry';
import { copyToClipboard } from '../lib/clipboard';
import { downloadMarkdownReportDocx } from '../lib/docxBuilder';
import type { VerifiedLicenseInfo } from '../lib/licenseEngine';
import {
  describeAiReadiness,
  getOfflinePackState,
  onOfflinePackStateChange,
  retryOfflinePacks,
  type OfflinePackState,
} from '../lib/pwaUpdate';
import { classifyGlobalStatuteQuery } from '../lib/statuteSearch';

interface HomeTabProps {
  license: VerifiedLicenseInfo;
  onOpenInstallGuide: () => void;
}

export const HomeTab: React.FC<HomeTabProps> = ({ license, onOpenInstallGuide }) => {
  const {
    isOnline,
    byok,
    pinnedTools,
    deadlines,
    setDeadlines,
    scratchpads,
    setScratchpads,
    history,
    clearHistory,
    lawyerProfile,
    casePockets,
    activeCaseId,
    setActiveCaseId,
    addCasePocket,
    deleteCasePocket,
    openTool,
    openLawsSearch,
    sendToAi,
    navigateTab,
    showToast,
  } = useToolbox();

  const activeProvider =
    byok.providers.find((p) => p.id === byok.activeProviderId) || byok.providers[0];
  const aiStatus = describeAiReadiness(activeProvider);
  const [offlinePack, setOfflinePack] = useState<OfflinePackState>(() => getOfflinePackState());
  useEffect(() => onOfflinePackStateChange(setOfflinePack), []);
  const [quickQuery, setQuickQuery] = useState('');
  const [showNewCaseForm, setShowNewCaseForm] = useState(false);
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const [newCaseNo, setNewCaseNo] = useState('');
  const [newCaseCourt, setNewCaseCourt] = useState('');
  const [newCaseParties, setNewCaseParties] = useState('');

  const activeCase = casePockets.find((c) => c.id === activeCaseId) || null;
  const visibleHistory = activeCase
    ? history.filter((h) => h.caseId === activeCase.id)
    : history;
  // Strictly match by explicit caseId so items belonging to Case B or unassigned items NEVER silently bleed into Case A's brief!
  const activeCaseDeadlines = activeCase
    ? deadlines.filter((d) => d.caseId === activeCase.id)
    : [];
  const activeCaseNotes = activeCase
    ? scratchpads.filter((n) => n.caseId === activeCase.id)
    : [];
  const unassignedSimilarDeadlines =
    activeCase && activeCase.title.trim()
      ? deadlines.filter((d) => !d.caseId && d.caseName.includes(activeCase.title.trim()))
      : [];
  const unassignedSimilarNotes =
    activeCase && activeCase.title.trim()
      ? scratchpads.filter((n) => !n.caseId && n.title.includes(activeCase.title.trim()))
      : [];
  const claimableUnassignedCount =
    unassignedSimilarDeadlines.length + unassignedSimilarNotes.length;

  const handleClaimUnassignedForActiveCase = () => {
    if (!activeCase || claimableUnassignedCount === 0) return;
    const dlIds = new Set(unassignedSimilarDeadlines.map((d) => d.id));
    const noteIds = new Set(unassignedSimilarNotes.map((n) => n.id));
    if (dlIds.size > 0) {
      setDeadlines(
        deadlines.map((d) => (dlIds.has(d.id) ? { ...d, caseId: activeCase.id } : d))
      );
    }
    if (noteIds.size > 0) {
      setScratchpads(
        scratchpads.map((n) => (noteIds.has(n.id) ? { ...n, caseId: activeCase.id } : n))
      );
    }
    showToast(`已将 ${claimableUnassignedCount} 条未归案记录正式认领至「${activeCase.title}」`);
  };

  const handleCreateCase = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCaseTitle.trim()) {
      showToast('请输入案件简称（如：某买卖合同纠纷）');
      return;
    }
    addCasePocket({
      title: newCaseTitle.trim(),
      caseNo: newCaseNo.trim() || undefined,
      court: newCaseCourt.trim() || undefined,
      clientName: newCaseParties.trim() || undefined,
    });
    setNewCaseTitle('');
    setNewCaseNo('');
    setNewCaseCourt('');
    setNewCaseParties('');
    setShowNewCaseForm(false);
  };

  const handleExportCaseBrief = () => {
    if (!activeCase) return;
    const today = new Date().toISOString().slice(0, 10);
    const md: string[] = [
      `## 一、案件基础档案`,
      `- **案件简称**：${activeCase.title}`,
      ...(activeCase.caseNo ? [`- **案号**：${activeCase.caseNo}`] : []),
      ...(activeCase.court ? [`- **受案机关/法院**：${activeCase.court}`] : []),
      ...(activeCase.clientName ? [`- **当事人信息**：${activeCase.clientName}`] : []),
      ...(lawyerProfile.name
        ? [
            `- **承办律师**：${lawyerProfile.name}${lawyerProfile.firmName ? `（${lawyerProfile.firmName}）` : ''}${lawyerProfile.licenseNo ? ` ｜ 执业证号：${lawyerProfile.licenseNo}` : ''}${lawyerProfile.phone ? ` ｜ 电话：${lawyerProfile.phone}` : ''}`,
          ]
        : []),
      '',
      `## 二、关联测算与文书留痕（共 ${visibleHistory.length} 条）`,
      ...(visibleHistory.length === 0
        ? ['暂无已归入本案的测算记录（选中本案件口袋后，在任意计算器或诉状工具点击“存入本机记录”即可自动归档）。']
        : visibleHistory.flatMap((h, i) => [
            `### ${i + 1}. ${h.toolTitle}（${new Date(h.createdAt).toLocaleDateString('zh-CN')}）`,
            `- **摘要**：${h.summary}`,
            h.detailText.slice(0, 1200),
            '',
          ])),
      '',
      `## 三、保全续封与重要法定期限（共 ${activeCaseDeadlines.length} 项）`,
      ...(activeCaseDeadlines.length === 0
        ? ['暂无关联期限提醒。']
        : activeCaseDeadlines.map(
            (d, i) =>
              `${i + 1}. **${d.title}**（${d.caseName}）｜ 届满日：${d.dueDate} ｜ 预警日：${d.warnDate}${d.notes ? ` ｜ 备注：${d.notes}` : ''}`
          )),
      '',
      `## 四、会见 / 庭审 / 咨询速记摘要（共 ${activeCaseNotes.length} 篇）`,
      ...(activeCaseNotes.length === 0
        ? ['暂无关联速记笔录。']
        : activeCaseNotes.flatMap((n, i) => [
            `### ${i + 1}. ${n.title}`,
            ...(n.facts ? [`- **核心事实**：${n.facts}`] : []),
            ...(n.disputes ? [`- **争议焦点**：${n.disputes}`] : []),
            ...(n.missingEvidence ? [`- **待补证据**：${n.missingEvidence}`] : []),
            ...(n.todoItems ? [`- **待办事项**：${n.todoItems}`] : []),
            '',
          ])),
    ];
    const safeName = activeCase.title.replace(/[\\/:*?"<>|]/g, '_');
    const fname = `案件初评估简报_${safeName}_${today}.docx`;
    downloadMarkdownReportDocx(
      {
        title: `案件初评估简报 — ${activeCase.title}`,
        subtitle: `导出日期：${today}${lawyerProfile.name ? ` ｜ 承办律师：${lawyerProfile.name}` : ''} ｜ 纯本地离线归档`,
        markdownBody: md.join('\n'),
      },
      fname
    );
    showToast(`已导出《${fname}》`);
  };

  const pinnedMetaList = OFFLINE_TOOLS_REGISTRY.filter((t) => pinnedTools.includes(t.id));
  const activeDeadlines = deadlines
    .filter((d) => !d.completed)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 3);

  const getDaysUntil = (ymd: string): number | null => {
    if (!ymd) return null;
    const due = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(due.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / (24 * 3600 * 1000));
  };

  const handleQuickLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickQuery.trim();
    if (!q) {
      openLawsSearch('', 'statutes');
      return;
    }
    const route = classifyGlobalStatuteQuery(q);
    openLawsSearch(route.statuteQuery, 'statutes');
    setQuickQuery('');
  };

  const handleCloudCaseLookup = () => {
    const q = quickQuery.trim();
    openLawsSearch(q, 'ima_cloud');
    setQuickQuery('');
  };

  const handleOpenComplaintWithSample = () => {
    try {
      sessionStorage.setItem('spc2025_auto_load_demo_sample', '1');
    } catch {
      // ignore
    }
    openTool('elements-complaint');
  };

  return (
    <div className="py-4 sm:py-7 px-4 sm:px-6 mx-auto max-w-6xl space-y-5">
      {/* Hero Workbench Card: Zero-Key First-Minute Actions + Honest 3-State Pills */}
      <section className="rounded-xl bg-[#0E223D] p-4 sm:p-6 text-[#F6F4EF] border border-[#1A3761] shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5">
              {isOnline ? (
                <>
                  <Wifi className="h-3 w-3 text-emerald-400" />
                  <span>网络在线</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 text-amber-300" />
                  <span>当前离线</span>
                </>
              )}
            </span>

            {offlinePack.status === 'ready' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/70 border border-emerald-400/30 px-2.5 py-0.5 text-emerald-200">
                <span>● 计算器离线就绪 · 法规/模板包 {offlinePack.readyCount}/{offlinePack.totalCount}</span>
              </span>
            ) : offlinePack.status === 'dev_local' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/70 border border-emerald-400/30 px-2.5 py-0.5 text-emerald-200">
                <span>● 本地直连就绪（计算器+法条模板库）</span>
              </span>
            ) : offlinePack.status === 'syncing' || offlinePack.status === 'checking' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-950/70 border border-sky-400/30 px-2.5 py-0.5 text-sky-200">
                <span>计算器可用 · 法规/模板包缓存中 ({offlinePack.readyCount}/{offlinePack.totalCount})</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => retryOfflinePacks()}
                className="inline-flex items-center gap-1 rounded-full bg-amber-950/80 border border-amber-400/40 px-2.5 py-0.5 text-amber-200 hover:bg-amber-900"
              >
                <span>计算器可用 · 法规/模板包 {offlinePack.readyCount}/{offlinePack.totalCount} 点此缓存</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => navigateTab('settings')}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/15 px-2.5 py-0.5 text-slate-200"
              title={aiStatus.detailLabel}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  aiStatus.state === 'verified'
                    ? 'bg-emerald-400'
                    : aiStatus.state === 'untested'
                    ? 'bg-amber-400'
                    : 'bg-slate-400'
                }`}
              />
              <span>{aiStatus.shortLabel}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenInstallGuide}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#D1B27A] hover:underline"
          >
            <Smartphone className="h-3.5 w-3.5" /> 装到桌面/手机
          </button>
        </div>

        <h1 className="mt-3 font-display text-xl sm:text-2xl font-bold tracking-wide text-white">
          {SITE_CONFIG.heroTitle}
        </h1>
        <p className="mt-1 text-xs text-slate-300">
          无需注册、无需配置 API Key 即可直接在浏览器本地完成最高法要素式起诉状导出、4,111 条法典检索与证据 PDF 分卷。
        </p>

        {/* Primary 3 Zero-Key First-Minute Entry Cards */}
        <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="rounded-lg border border-[#D1B27A]/50 bg-[#091628]/90 p-3 flex flex-col justify-between gap-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-white">
                  <FileSpreadsheet className="h-4 w-4 text-[#D1B27A] flex-none" />
                  写起诉状 / 答辩状
                </span>
                <span className="rounded bg-[#B89254]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#D1B27A]">
                  113份原表
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-300">
                最高法《法〔2025〕82号》官方表格，免密钥直接勾选导出标准 Word
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => openTool('elements-complaint')}
                className="rounded bg-[#B89254] hover:bg-[#C9A467] px-2.5 py-1 text-[11px] font-bold text-[#11151C]"
              >
                打开模板开填 →
              </button>
              <button
                type="button"
                onClick={handleOpenComplaintWithSample}
                className="rounded border border-white/20 bg-white/5 hover:bg-white/10 px-2 py-1 text-[11px] text-slate-200"
              >
                载入虚构样例体验
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => openLawsSearch('', 'statutes')}
            className="rounded-lg border border-white/15 bg-white/8 hover:bg-white/12 p-3 text-left flex flex-col justify-between gap-2 transition-colors"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-white">
                  <BookOpen className="h-4 w-4 text-[#D1B27A] flex-none" />
                  查离线法条与司解
                </span>
                <span className="text-[10px] font-semibold text-[#D1B27A]">4,111条</span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-300">
                支持「585」「民法典第585条」0毫秒直达原文及同屏司法解释
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#D1B27A]">进入离线法条检索 →</span>
          </button>

          <button
            type="button"
            onClick={() => openTool('evidence-pdf-toolkit')}
            className="rounded-lg border border-white/15 bg-white/8 hover:bg-white/12 p-3 text-left flex flex-col justify-between gap-2 transition-colors"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-white">
                  <Layers className="h-4 w-4 text-[#D1B27A] flex-none" />
                  处理证据 PDF 分卷
                </span>
                <span className="text-[10px] font-semibold text-[#D1B27A]">零上传</span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-300">
                截图合并转 A4、连续证据页码水印、10MB 网上立案字节实测切分
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#D1B27A]">打开证据 PDF 工具箱 →</span>
          </button>
        </div>

        {/* Unified Local-First Statute Search Bar + Separate Cloud Case Lookup Button */}
        <form onSubmit={handleQuickLookup} className="mt-3.5 flex flex-wrap sm:flex-nowrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#D1B27A]" />
            <input
              type="search"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder="搜本地法条（如 585、民法典第585条、违约金调减）…"
              className="w-full rounded-lg border border-white/20 bg-[#091628]/85 pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-[#D1B27A] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#B89254] hover:bg-[#C9A467] px-3.5 py-2 text-xs font-bold text-[#11151C] whitespace-nowrap"
          >
            查本地法条
          </button>
          <button
            type="button"
            onClick={handleCloudCaseLookup}
            className="rounded-lg border border-white/20 bg-white/10 hover:bg-white/15 px-3 py-2 text-xs font-semibold text-white whitespace-nowrap"
          >
            查云端案例库 (4.48万+)
          </button>
        </form>
      </section>

      {/* Active Preservation / Execution Deadline Alerts */}
      {activeDeadlines.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 sm:p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
              <BellRing className="h-4 w-4 text-amber-700" />
              <span>在办保全续封与执行期限预警</span>
            </div>
            <button
              type="button"
              onClick={() => openTool('preservation-deadline')}
              className="text-xs font-semibold text-[#0E223D] underline"
            >
              管理全部 ({deadlines.filter((d) => !d.completed).length})
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {activeDeadlines.map((d) => {
              const daysLeft = getDaysUntil(d.dueDate);
              const badgeCls =
                daysLeft !== null && daysLeft <= 15
                  ? 'bg-red-100 text-red-800 border-red-200'
                  : daysLeft !== null && daysLeft <= 45
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200';
              const badgeText =
                daysLeft === null
                  ? ''
                  : daysLeft < 0
                  ? `已逾期 ${Math.abs(daysLeft)} 天`
                  : daysLeft === 0
                  ? '今日届满！'
                  : `剩 ${daysLeft} 天`;
              return (
                <div
                  key={d.id}
                  onClick={() => openTool('preservation-deadline')}
                  className="cursor-pointer rounded-lg bg-white border border-amber-200 p-2.5 text-xs hover:border-[#0E223D] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-[#11151C] truncate">{d.title}</div>
                    {badgeText && (
                      <span
                        className={`flex-none rounded border px-1.5 py-0.5 font-num text-[10px] font-bold ${badgeCls}`}
                      >
                        {badgeText}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-num text-[11px] text-amber-800">
                    续封预警：{d.warnDate} ｜ 届满：{d.dueDate}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Pinned Quick-Launch Grid (Thumb-friendly 2x4 / 4x2) */}
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="font-display text-base sm:text-lg font-bold text-[#11151C]">
            常用离线工具金刚区
          </h2>
          <button
            type="button"
            onClick={() => navigateTab('tools')}
            className="text-xs font-semibold text-[#0E223D] hover:text-[#9A773E]"
          >
            查看全部 12 项工具 →
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          {pinnedMetaList.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => openTool(tool.id)}
              className="group flex flex-col justify-between rounded-xl border border-[#DED8CC] bg-white p-3.5 text-left active:scale-[0.99] hover:border-[#0E223D] transition-all shadow-[0_1px_2px_rgba(17,21,28,0.03)]"
            >
              <div className="flex items-center justify-between">
                <div className="rounded-lg bg-[#F6F4EF] p-2 text-[#0E223D] group-hover:bg-[#0E223D] group-hover:text-[#D1B27A] transition-colors">
                  <ToolIcon name={tool.iconName} className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2.5">
                <div className="font-display text-sm font-bold text-[#11151C] leading-snug line-clamp-2">
                  {tool.shortTitle}
                </div>
                <div className="mt-0.5 text-[11px] leading-4 text-slate-500 line-clamp-2">{tool.kicker}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* AI Specialists Quick Entry (Optional BYOK, positioned after offline core tools) */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#B89254]" />
            <h2 className="font-display text-base sm:text-lg font-bold text-[#11151C]">
              AI 法律辅助专席
            </h2>
            <span className="rounded-full border border-[#DED8CC] bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
              可选 · 需自配个人 API Key · 发送前自动预脱敏
            </span>
          </div>
          <div className="flex items-center gap-3">
            {aiStatus.state === 'unconfigured' && (
              <button
                type="button"
                onClick={() => navigateTab('settings')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#7A5922] hover:underline"
              >
                <KeyRound className="h-3.5 w-3.5" /> 配置 API Key
              </button>
            )}
            <button
              type="button"
              onClick={() => navigateTab('ai')}
              className="text-xs font-semibold text-[#0E223D]"
            >
              进入 AI 智囊舱 →
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {AI_SPECIALISTS_REGISTRY.map((sp) => (
            <button
              key={sp.id}
              type="button"
              onClick={() => sendToAi(sp.id, sp.shortTitle, '')}
              className="rounded-xl border border-[#DED8CC] bg-white p-3.5 text-left hover:border-[#B89254] transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-sm font-bold text-[#0E223D] leading-snug line-clamp-2">
                  {sp.shortTitle}
                </span>
                <span className="flex-none whitespace-nowrap rounded bg-[#F3ECE0] px-2 py-0.5 text-[10px] font-semibold text-[#7A5922]">
                  {sp.badge}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-600 line-clamp-2">{sp.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Lightweight Local Case Pocket + Recent Calculation History */}
      <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-3">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-[#B89254]" />
            <h3 className="font-display text-sm sm:text-base font-bold text-[#11151C]">
              轻案件口袋 & 本机测算留痕
            </h3>
            <span className="rounded-full bg-[#F6F3EB] border border-[#E5DEC9] px-2 py-0.5 text-[10px] font-semibold text-[#7A5922]">
              纯本地零上传
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowNewCaseForm((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-[#C9A463] bg-[#FAF6EC] hover:bg-[#F3ECE0] px-2.5 py-1 text-xs font-bold text-[#7A5922] transition-colors"
            >
              {showNewCaseForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showNewCaseForm ? '收起' : '新建案件口袋'}
            </button>
            {!activeCase && history.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" /> 清空
              </button>
            )}
          </div>
        </div>

        {/* Inline New Case Form */}
        {showNewCaseForm && (
          <form
            onSubmit={handleCreateCase}
            className="rounded-xl border border-[#E5DEC9] bg-[#FAF8F3] p-3.5 space-y-2.5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                value={newCaseTitle}
                onChange={(e) => setNewCaseTitle(e.target.value)}
                placeholder="案件简称（必填，如：甲公司买卖合同货款案）"
                className="rounded-lg border border-[#D8D1C3] bg-white px-3 py-2 text-xs text-[#11151C] focus:border-[#0E223D] focus:outline-none"
              />
              <input
                type="text"
                value={newCaseParties}
                onChange={(e) => setNewCaseParties(e.target.value)}
                placeholder="委托人 / 对方当事人（选填）"
                className="rounded-lg border border-[#D8D1C3] bg-white px-3 py-2 text-xs text-[#11151C] focus:border-[#0E223D] focus:outline-none"
              />
              <input
                type="text"
                value={newCaseCourt}
                onChange={(e) => setNewCaseCourt(e.target.value)}
                placeholder="受案法院 / 仲裁委（选填）"
                className="rounded-lg border border-[#D8D1C3] bg-white px-3 py-2 text-xs text-[#11151C] focus:border-[#0E223D] focus:outline-none"
              />
              <input
                type="text"
                value={newCaseNo}
                onChange={(e) => setNewCaseNo(e.target.value)}
                placeholder="案号（选填，如：（2026）浙01民初...）"
                className="rounded-lg border border-[#D8D1C3] bg-white px-3 py-2 text-xs text-[#11151C] focus:border-[#0E223D] focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500">
                选中案件口袋后，所有新保存的诉讼费/LPR/律师费/诉状测算会自动归入该案。
              </span>
              <button
                type="submit"
                className="rounded-lg bg-[#0E223D] hover:bg-[#17345D] px-3.5 py-1.5 text-xs font-bold text-[#F6F4EF]"
              >
                创建并选中
              </button>
            </div>
          </form>
        )}

        {/* Case Switcher Pills */}
        {casePockets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveCaseId('')}
              className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                !activeCaseId
                  ? 'border-[#0E223D] bg-[#0E223D] text-white'
                  : 'border-[#DED8CC] bg-[#FAF9F6] text-slate-600 hover:border-[#B89254]'
              }`}
            >
              全部记录 ({history.length})
            </button>
            {casePockets.map((cp) => {
              const isSelected = cp.id === activeCaseId;
              const cnt = history.filter((h) => h.caseId === cp.id).length;
              return (
                <button
                  key={cp.id}
                  type="button"
                  onClick={() => setActiveCaseId(cp.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                    isSelected
                      ? 'border-[#B89254] bg-gradient-to-r from-[#0E223D] to-[#17345D] text-[#E5CB96] shadow-xs'
                      : 'border-[#DED8CC] bg-white text-[#11151C] hover:border-[#B89254]'
                  }`}
                >
                  📁 {cp.title}
                  {cnt > 0 ? ` (${cnt})` : ''}
                </button>
              );
            })}
          </div>
        )}

        {/* Active Case Dossier Bar */}
        {activeCase && (
          <div className="rounded-xl border border-[#DFD2B8] bg-gradient-to-r from-[#FDFBF6] to-[#F7F2E6] p-3 flex flex-wrap items-center justify-between gap-2.5">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-bold text-[#0E223D]">
                  当前在办：{activeCase.title}
                </span>
                {activeCase.caseNo && (
                  <span className="rounded bg-white border border-[#E2DAC7] px-2 py-0.5 font-mono text-[10.5px] text-slate-600">
                    {activeCase.caseNo}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
                {activeCase.court && <span>机关：{activeCase.court}</span>}
                {activeCase.clientName && <span>当事人：{activeCase.clientName}</span>}
                <span>
                  归档统计：{visibleHistory.length} 条测算 · {activeCaseDeadlines.length} 条期限 · {activeCaseNotes.length} 篇速记
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 flex-none">
              {claimableUnassignedCount > 0 && (
                <button
                  type="button"
                  onClick={handleClaimUnassignedForActiveCase}
                  className="rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900"
                  title="发现未绑定案件口袋但名称包含本案简称的期限或速记；严格隔离模式下未自动混入简报，点此可手动认领归入本案"
                >
                  认领 {claimableUnassignedCount} 条未归案同名记录
                </button>
              )}
              <button
                type="button"
                onClick={handleExportCaseBrief}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345D] px-3 py-1.5 text-xs font-bold text-[#E5CB96] shadow-xs transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> 导出《案件初评估简报.docx》
              </button>
              <button
                type="button"
                onClick={() => deleteCasePocket(activeCase.id)}
                className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-red-300 hover:text-red-600"
                title="移除此案件口袋"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {visibleHistory.length === 0 ? (
          <p className="py-5 text-center text-xs text-slate-500">
            {activeCase
              ? `「${activeCase.title}」口袋内暂无测算留痕。保持本口袋选中状态，在诉讼费/LPR/要素式诉状中点“存入本机记录”将自动归档至此。`
              : '暂无最近记录。使用任意计算器点击「存入本机测算记录」后，可在开庭或见客户时离线随时翻看，也可新建「案件口袋」按案归组导出简报。'}
          </p>
        ) : (
          <div className="divide-y divide-[#EFECE5]">
            {visibleHistory.slice(0, 6).map((item) => {
              const linkedCase = item.caseId ? casePockets.find((c) => c.id === item.caseId) : null;
              return (
                <div key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div
                    onClick={() => openTool(item.toolId)}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-[#0E223D]">{item.toolTitle}</span>
                      {linkedCase && !activeCase && (
                        <span className="rounded bg-[#F3ECE0] px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5922]">
                          {linkedCase.title}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">
                        {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-600 truncate">{item.summary}</div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await copyToClipboard(item.detailText);
                      showToast('已复制该条测算完整明细');
                    }}
                    className="flex-none inline-flex items-center gap-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-[#0E223D]"
                  >
                    <Copy className="h-3 w-3" /> 复制
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
