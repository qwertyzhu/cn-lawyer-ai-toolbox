import React, { useState } from 'react';
import { ArrowRight, Pin, Search, WifiOff } from 'lucide-react';
import { ToolIcon } from '../components/ToolIcon';
import { ToolProShell } from '../components/ToolProShell';
import { useToolbox } from '../context/ToolboxContext';
import { OFFLINE_TOOLS_REGISTRY, TOOL_CATEGORIES_META } from '../data/toolRegistry';
import type { OfflineToolId, ToolCategoryCode } from '../types/toolbox';

// 6 Ported & Pro-upgraded Website Tools
import { DateCalculator } from '../tools/website/DateCalculator';
import { EvidencePdfToolkit } from '../tools/website/EvidencePdfToolkit';
import { InjuryCompensationCalculator } from '../tools/website/InjuryCompensationCalculator';
import { LaborCompensationCalculator } from '../tools/website/LaborCompensationCalculator';
import { LitigationFeeCalculator } from '../tools/website/LitigationFeeCalculator';
import { LprInterestCalculator } from '../tools/website/LprInterestCalculator';

// 6 Newly Built Extra Offline Tools
import { ElementsComplaintTool } from '../tools/extra/ElementsComplaintTool';
import { LawyerFeeQuoteTool } from '../tools/extra/LawyerFeeQuoteTool';
import { LocalRedactorTool } from '../tools/extra/LocalRedactorTool';
import { MeetingScratchpadTool } from '../tools/extra/MeetingScratchpadTool';
import { PreservationDeadlineTool } from '../tools/extra/PreservationDeadlineTool';
import { RmbAndDebtOffsetTool } from '../tools/extra/RmbAndDebtOffsetTool';

function renderToolComponent(toolId: OfflineToolId): React.ReactNode {
  switch (toolId) {
    case 'elements-complaint':
      return <ElementsComplaintTool />;
    case 'litigation-fee-calculator':
      return <LitigationFeeCalculator />;
    case 'lpr-interest-calculator':
      return <LprInterestCalculator />;
    case 'date-calculator':
      return <DateCalculator />;
    case 'labor-compensation':
      return <LaborCompensationCalculator />;
    case 'injury-compensation':
      return <InjuryCompensationCalculator />;
    case 'evidence-pdf-toolkit':
      return <EvidencePdfToolkit />;
    case 'local-redactor':
      return <LocalRedactorTool />;
    case 'lawyer-fee-quote':
      return <LawyerFeeQuoteTool />;
    case 'preservation-deadline':
      return <PreservationDeadlineTool />;
    case 'rmb-debt-offset':
      return <RmbAndDebtOffsetTool />;
    case 'meeting-scratchpad':
      return <MeetingScratchpadTool />;
  }
}

export const ToolsTab: React.FC = () => {
  const { activeToolId, openTool, pinnedTools, togglePinTool, showToast } = useToolbox();
  const [catFilter, setCatFilter] = useState<'all' | ToolCategoryCode>('all');
  const [filterText, setFilterText] = useState('');

  if (activeToolId) {
    return <ToolProShell toolId={activeToolId}>{renderToolComponent(activeToolId)}</ToolProShell>;
  }

  const kw = filterText.trim().toLowerCase();

  return (
    <div className="py-5 sm:py-8 px-4 sm:px-6 mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9A773E]">
            <WifiOff className="h-3.5 w-3.5 text-emerald-700" />
            <span>LOCAL-FIRST TOOLS · 核心填表与测算本地离线（AI 辅写按需联网）</span>
          </div>
          <h1 className="mt-1.5 font-display text-2xl sm:text-3xl font-bold text-[#11151C]">
            本地随身办案工具全集（12 项）
          </h1>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="筛选工具名称或关键词…"
            className="w-full rounded-lg border border-[#D8D1C3] bg-white pl-9 pr-3 py-2 text-xs text-[#11151C] focus:border-[#0E223D] focus:outline-none"
          />
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        <button
          type="button"
          onClick={() => setCatFilter('all')}
          className={`flex-none rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            catFilter === 'all'
              ? 'border-[#0E223D] bg-[#0E223D] text-white'
              : 'border-[#DED8CC] bg-white text-slate-600'
          }`}
        >
          全部工具 (12)
        </button>
        {TOOL_CATEGORIES_META.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCatFilter(cat.id)}
            className={`flex-none rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              catFilter === cat.id
                ? 'border-[#0E223D] bg-[#0E223D] text-white'
                : 'border-[#DED8CC] bg-white text-slate-600'
            }`}
          >
            {cat.title}
          </button>
        ))}
      </div>

      {/* Categorized Sections */}
      <div className="space-y-7">
        {TOOL_CATEGORIES_META.filter((c) => catFilter === 'all' || c.id === catFilter).map((cat) => {
          const items = OFFLINE_TOOLS_REGISTRY.filter(
            (t) =>
              t.category === cat.id &&
              (!kw ||
                t.title.toLowerCase().includes(kw) ||
                t.desc.toLowerCase().includes(kw) ||
                t.keywords.some((k) => k.toLowerCase().includes(kw)))
          );
          if (items.length === 0) return null;

          return (
            <section key={cat.id}>
              <div className="border-b border-[#DED8CC] pb-2 mb-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9A773E]">
                  {cat.en}
                </div>
                <h2 className="font-display text-lg font-bold text-[#11151C]">{cat.title}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{cat.subtitle}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {items.map((tool) => {
                  const pinned = pinnedTools.includes(tool.id);
                  return (
                    <div
                      key={tool.id}
                      onClick={() => openTool(tool.id)}
                      className="group cursor-pointer rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 hover:border-[#0E223D] transition-all flex flex-col justify-between shadow-[0_1px_2px_rgba(17,21,28,0.03)]"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="rounded-lg bg-[#F6F4EF] p-2.5 text-[#0E223D] group-hover:bg-[#0E223D] group-hover:text-[#D1B27A] transition-colors">
                              <ToolIcon name={tool.iconName} className="h-5 w-5" />
                            </div>
                            <div>
                              <span className="text-[11px] font-semibold text-[#9A773E]">
                                {tool.kicker}
                              </span>
                              <h3 className="font-display text-base font-bold text-[#11151C]">
                                {tool.title}
                              </h3>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePinTool(tool.id);
                              showToast(pinned ? '已取消首页置顶' : '已置顶到工作台首页');
                            }}
                            className={`rounded p-1.5 transition-colors ${
                              pinned
                                ? 'bg-[#F3ECE0] text-[#9A773E]'
                                : 'text-slate-300 hover:text-slate-600'
                            }`}
                            title="置顶到首页"
                          >
                            <Pin className="h-4 w-4" />
                          </button>
                        </div>

                        <p className="mt-3 text-xs leading-6 text-slate-600">{tool.desc}</p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#F1EDE4] flex items-center justify-between text-xs">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                            tool.sourceTag === '律师新增'
                              ? 'bg-[#F3ECE0] text-[#7A5922]'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {tool.sourceTag} · 离线秒开
                        </span>
                        <span className="inline-flex items-center gap-1 font-bold text-[#0E223D] group-hover:translate-x-0.5 transition-transform">
                          打开工具 <ArrowRight className="h-3.5 w-3.5 text-[#B89254]" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
