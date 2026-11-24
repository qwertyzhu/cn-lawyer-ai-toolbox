import React, { useState } from 'react';
import { ChevronDown, ChevronUp, HelpCircle, Table2 } from 'lucide-react';
import toolQuickRefData from '../data/toolQuickRef.json';

export type ToolSeoRouteKey = keyof typeof toolQuickRefData;

interface ToolQuickRefSectionProps {
  routeKey: ToolSeoRouteKey;
}

export const ToolQuickRefSection: React.FC<ToolQuickRefSectionProps> = ({ routeKey }) => {
  const entry = toolQuickRefData[routeKey];
  const [expanded, setExpanded] = useState(false);

  if (!entry) return null;

  return (
    <section
      aria-label={entry.heading}
      className="mt-8 rounded-lg border border-[#DED8CC] bg-white overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 sm:px-6 text-left hover:bg-[#FAF8F4] transition-colors"
      >
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9A773E]">
            离线实务速查基准表
          </div>
          <div className="mt-0.5 font-display text-sm sm:text-base font-bold text-[#11151C] truncate">
            {entry.tableTitle}
          </div>
        </div>
        <span className="inline-flex flex-none items-center gap-1 rounded border border-[#DED8CC] bg-[#F6F4EF] px-2.5 py-1 text-xs font-medium text-[#0E223D]">
          {expanded ? (
            <>
              收起 <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              展开速查 <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[#EFECE5] p-4 sm:p-6 space-y-6">
          <div>
            <div className="flex items-center gap-2 pb-2.5">
              <Table2 className="h-4 w-4 text-[#B89254]" />
              <h3 className="font-display text-sm font-bold text-[#11151C]">{entry.tableTitle}</h3>
            </div>
            <div className="max-w-full overflow-x-auto rounded border border-[#E4DFD4]">
              <table className="w-full min-w-[480px] border-collapse text-left text-xs leading-6">
                <thead>
                  <tr className="bg-[#0E223D] text-[#F6F4EF]">
                    {entry.tableHeaders.map((header) => (
                      <th key={header} className="whitespace-nowrap px-3 py-2 font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFECE5]">
                  {entry.tableRows.map((row, idx) => (
                    <tr key={idx} className={idx % 2 === 1 ? 'bg-[#FAF9F6]' : 'bg-white'}>
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className={`px-3 py-2 align-top ${
                            cIdx === 0 ? 'whitespace-nowrap font-semibold text-[#11151C]' : 'text-slate-600'
                          }`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 pb-2">
              <HelpCircle className="h-4 w-4 text-[#B89254]" />
              <h3 className="font-display text-sm font-bold text-[#11151C]">裁判与计算口径实务要点</h3>
            </div>
            <div className="divide-y divide-[#EFECE5]">
              {entry.faqs.map((faq) => (
                <div key={faq.question} className="py-3 first:pt-1 last:pb-0">
                  <h4 className="text-xs sm:text-[13.5px] font-bold text-[#11151C]">
                    {faq.question}
                  </h4>
                  <p className="mt-1 text-xs leading-6 text-slate-600">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
