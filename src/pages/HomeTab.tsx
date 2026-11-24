import React, { useState } from 'react';
import {
  ArrowUpRight,
  BellRing,
  BookOpen,
  Building2,
  Clock,
  Copy,
  KeyRound,
  Search,
  Smartphone,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { ToolIcon } from '../components/ToolIcon';
import { SITE_CONFIG } from '../config/siteConfig';
import { useToolbox } from '../context/ToolboxContext';
import { AI_SPECIALISTS_REGISTRY, OFFLINE_TOOLS_REGISTRY } from '../data/toolRegistry';
import { copyToClipboard } from '../lib/clipboard';
import type { VerifiedLicenseInfo } from '../lib/licenseEngine';

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
    history,
    clearHistory,
    openTool,
    openLawsSearch,
    sendToAi,
    navigateTab,
    showToast,
  } = useToolbox();

  const activeProvider =
    byok.providers.find((p) => p.id === byok.activeProviderId) || byok.providers[0];
  const hasKey = Boolean(activeProvider?.apiKey || activeProvider?.apiKeyEncrypted);
  const [quickQuery, setQuickQuery] = useState('');

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
      openLawsSearch('', 'ima_cloud');
      return;
    }
    const artMatch = q.match(/^第?\s*(\d{1,4})\s*条?$/);
    if (artMatch && Number(artMatch[1]) <= 1260) {
      openLawsSearch(artMatch[1], 'statutes');
      setQuickQuery('');
      return;
    }
    openLawsSearch(q, isOnline ? 'ima_cloud' : 'statutes');
    setQuickQuery('');
  };

  return (
    <div className="py-4 sm:py-7 px-4 sm:px-6 mx-auto max-w-6xl space-y-5">
      {/* Hero Workbench Card */}
      <section className="rounded-xl bg-[#0E223D] p-4 sm:p-6 text-[#F6F4EF] border border-[#1A3761] shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium">
            {isOnline ? (
              <>
                <Wifi className="h-3 w-3 text-emerald-400" />
                <span>在线就绪 · {hasKey ? activeProvider.name.split('（')[0] : '待配个人API密钥'}</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-amber-300" />
                <span>离线模式 · 本地工具与4,111条法规全量可用</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenInstallGuide}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#D1B27A] hover:underline"
          >
            <Smartphone className="h-3.5 w-3.5" /> 新手速通 · 装到桌面
          </button>
        </div>

        <h1 className="mt-3 font-display text-xl sm:text-2xl font-bold tracking-wide text-white">
          {SITE_CONFIG.heroTitle}
        </h1>
        {SITE_CONFIG.authMode === 'license' ? (
          <div className="mt-2 inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md bg-[#091628]/90 border border-[#D1B27A]/35 px-3 py-1.5 text-xs">
            <span className="font-semibold text-[#D1B27A]">
              🏛️ 专属授权予：{license.holderName}（{license.role}）
            </span>
            <span className="text-slate-400 font-mono text-[11px]">
              编号 {license.serialNo} ｜ {license.expiresAt ? `有效至 ${license.expiresAt}` : '长期有效'}
            </span>
          </div>
        ) : (
          <div className="mt-2 inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md bg-[#091628]/90 border border-[#D1B27A]/35 px-3 py-1.5 text-xs">
            <span className="font-semibold text-[#D1B27A]">
              ⚖️ 开源免费 · 离线优先 · 全部数据仅存本机
            </span>
            <span className="text-slate-400 text-[11px]">
              Apache-2.0 开源工作台 ｜ 免登录开箱即用
            </span>
          </div>
        )}

        {/* One-Tap Hero Legal Lookup / IMA Q&A Bar */}
        <form onSubmit={handleQuickLookup} className="mt-3.5 flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#D1B27A]" />
            <input
              type="search"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder="输条号秒查民法典（如 585），或输案由/问题查法典与案例库…"
              className="w-full rounded-lg border border-white/20 bg-[#091628]/85 pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-[#D1B27A] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="flex-none rounded-lg bg-[#B89254] hover:bg-[#C9A467] px-3.5 py-2 text-xs font-bold text-[#11151C] whitespace-nowrap"
          >
            {isOnline ? 'AI查库 / 查条文' : '离线查条文'}
          </button>
        </form>

        {/* Quick Bridges */}
        <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-white/12">
          {SITE_CONFIG.oaUrl ? (
            <a
              href={SITE_CONFIG.oaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-xs font-semibold text-white transition-colors"
            >
              <span className="inline-flex items-center gap-1.5 truncate">
                <Building2 className="h-3.5 w-3.5 text-[#D1B27A] flex-none" />
                {SITE_CONFIG.oaLabel}
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 flex-none" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => openTool('elements-complaint')}
              className="flex items-center justify-between rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-xs font-semibold text-white transition-colors"
            >
              <span className="inline-flex items-center gap-1.5 truncate">
                <Building2 className="h-3.5 w-3.5 text-[#D1B27A] flex-none" />
                要素式起诉状
              </span>
              <span className="text-[10px] text-[#D1B27A]">14类</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => openLawsSearch('', 'statutes')}
            className="flex items-center justify-between rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-xs font-semibold text-white transition-colors"
          >
            <span className="inline-flex items-center gap-1.5 truncate">
              <BookOpen className="h-3.5 w-3.5 text-[#D1B27A] flex-none" />
              离线法典秒查
            </span>
            <span className="text-[10px] text-[#D1B27A]">4111条</span>
          </button>

          <button
            type="button"
            onClick={() => openLawsSearch('', 'ima_cloud')}
            className="flex items-center justify-between gap-1 rounded-lg bg-white/10 hover:bg-white/15 px-2.5 sm:px-3 py-2 text-xs font-semibold text-white transition-colors"
          >
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <Sparkles className="h-3.5 w-3.5 text-[#D1B27A] flex-none" />
              <span className="truncate">IMA案例问答</span>
            </span>
            <span className="flex-none whitespace-nowrap text-[10px] text-emerald-300">4.48万+</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTab('settings')}
            className="flex items-center justify-between rounded-lg bg-[#B89254] hover:bg-[#C8A366] px-3 py-2 text-xs font-bold text-[#11151C] transition-colors"
          >
            <span className="inline-flex items-center gap-1.5 truncate">
              <KeyRound className="h-3.5 w-3.5 flex-none" />
              {hasKey ? 'AI 密钥已就绪' : '配个人 API Key'}
            </span>
            <span>→</span>
          </button>
        </div>
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
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    tool.sourceTag === '律师新增'
                      ? 'bg-[#F3ECE0] text-[#7A5922]'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {tool.sourceTag}
                </span>
              </div>
              <div className="mt-2.5">
                <div className="font-display text-sm font-bold text-[#11151C]">
                  {tool.shortTitle}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 truncate">{tool.kicker}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* AI Specialists Quick Entry */}
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-[#B89254]" />
            <h2 className="font-display text-base sm:text-lg font-bold text-[#11151C]">
              BYOK 在线法律 AI 专席（自带密钥 · 自动脱敏）
            </h2>
          </div>
          <button
            type="button"
            onClick={() => navigateTab('ai')}
            className="text-xs font-semibold text-[#0E223D]"
          >
            进入 AI 智囊舱 →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {AI_SPECIALISTS_REGISTRY.map((sp) => (
            <button
              key={sp.id}
              type="button"
              onClick={() => sendToAi(sp.id, sp.shortTitle, '')}
              className="rounded-xl border border-[#DED8CC] bg-white p-3.5 text-left hover:border-[#B89254] transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-sm font-bold text-[#0E223D] min-w-0 truncate">{sp.title}</span>
                <span className="flex-none whitespace-nowrap rounded bg-[#F3ECE0] px-2 py-0.5 text-[10px] font-semibold text-[#7A5922]">
                  {sp.badge}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-slate-600 line-clamp-2">{sp.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Recent Offline Calculation History */}
      <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between border-b border-[#EFECE5] pb-2.5">
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-[#B89254]" />
            <h3 className="font-display text-sm sm:text-base font-bold text-[#11151C]">
              最近本机测算与脱敏记录（仅存手机本地）
            </h3>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" /> 清空
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">
            暂无最近记录。使用任意计算器点击「存入本机测算记录」后，可在开庭或见客户时离线随时翻看。
          </p>
        ) : (
          <div className="mt-3 divide-y divide-[#EFECE5]">
            {history.slice(0, 5).map((item) => (
              <div key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                <div
                  onClick={() => openTool(item.toolId)}
                  className="min-w-0 flex-1 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#0E223D]">{item.toolTitle}</span>
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
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
