import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckSquare, Search, Sparkles, Wrench, X } from 'lucide-react';
import { useToolbox } from '../context/ToolboxContext';
import { PRACTICE_CHECKLISTS } from '../data/checklists';
import { AI_SPECIALISTS_REGISTRY, OFFLINE_TOOLS_REGISTRY } from '../data/toolRegistry';
import { classifyGlobalStatuteQuery } from '../lib/statuteSearch';

interface CommandSearchModalProps {
  open: boolean;
  onClose: () => void;
}

export const CommandSearchModal: React.FC<CommandSearchModalProps> = ({ open, onClose }) => {
  const { openTool, openLawsSearch, sendToAi } = useToolbox();
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    const rawTrimmed = q.trim();
    const kw = rawTrimmed.toLowerCase();
    const routeHint = classifyGlobalStatuteQuery(rawTrimmed);

    const matchedTools = OFFLINE_TOOLS_REGISTRY.filter(
      (t) =>
        !kw ||
        t.title.toLowerCase().includes(kw) ||
        t.desc.toLowerCase().includes(kw) ||
        t.keywords.some((k) => k.toLowerCase().includes(kw))
    ).slice(0, 6);

    const matchedAi = AI_SPECIALISTS_REGISTRY.filter(
      (a) => !kw || a.title.toLowerCase().includes(kw) || a.desc.toLowerCase().includes(kw)
    ).slice(0, 4);

    const matchedChecklists = PRACTICE_CHECKLISTS.filter(
      (c) => !kw || c.title.toLowerCase().includes(kw) || c.tag.toLowerCase().includes(kw)
    );

    return { routeHint, matchedTools, matchedAi, matchedChecklists };
  }, [q]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-start justify-center p-3 sm:pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-[#DED8CC] bg-[#F6F4EF] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-[#DED8CC] bg-white px-4 py-3">
          <Search className="h-4 w-4 text-[#B89254]" />
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (results.routeHint.isArticleLookup) {
                openLawsSearch(results.routeHint.statuteQuery, 'statutes');
                onClose();
              } else if (results.matchedTools.length > 0 && q.trim()) {
                openTool(results.matchedTools[0].id);
                onClose();
              } else if (q.trim()) {
                openLawsSearch(q.trim(), 'statutes');
                onClose();
              }
            }}
            placeholder="秒搜：输“585”“民法典第585条”“诉讼费”“PDF”直达离线条文或办案工具…"
            className="flex-1 bg-transparent text-sm text-[#11151C] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-3 space-y-3">
          {results.routeHint.isArticleLookup && (
            <button
              type="button"
              onClick={() => {
                openLawsSearch(results.routeHint.statuteQuery, 'statutes');
                onClose();
              }}
              className="w-full flex items-center justify-between rounded-lg bg-[#0E223D] p-3 text-left text-white"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#D1B27A]" />
                <span className="text-xs sm:text-sm font-bold">
                  直达本地离线法规库：{results.routeHint.displayTargetLabel}
                </span>
              </div>
              <span className="text-xs text-[#D1B27A]">回车查看 →</span>
            </button>
          )}

          {q.trim() && !results.routeHint.isArticleLookup && (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => {
                  openLawsSearch(q.trim(), 'statutes');
                  onClose();
                }}
                className="w-full flex items-center justify-between rounded-lg border border-[#0E223D]/30 bg-white p-2.5 text-left"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-[#0E223D]">
                  <BookOpen className="h-4 w-4 text-[#B89254]" />
                  <span>在 4,111 条离线法典与司法解释中检索「{q.trim()}」</span>
                </div>
                <span className="text-xs text-slate-400">离线 →</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  openLawsSearch(q.trim(), 'ima_cloud');
                  onClose();
                }}
                className="w-full flex items-center justify-between rounded-lg bg-[#0E223D] p-2.5 text-left text-white"
              >
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Sparkles className="h-4 w-4 text-[#D1B27A]" />
                  <span>在《法律法规案例库（4.48万份）》AI 问答与查原件「{q.trim()}」</span>
                </div>
                <span className="text-xs text-[#D1B27A]">AI查库 →</span>
              </button>
            </div>
          )}

          {results.matchedTools.length > 0 && (
            <div>
              <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                离线办案工具
              </div>
              <div className="space-y-1">
                {results.matchedTools.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      openTool(t.id);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between rounded-lg bg-white border border-[#EAE5DA] px-3 py-2.5 text-left hover:border-[#0E223D]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Wrench className="h-3.5 w-3.5 flex-none text-[#0E223D]" />
                      <span className="truncate text-xs font-bold text-[#11151C]">{t.title}</span>
                    </div>
                    <span className="flex-none text-[10px] text-[#9A773E]">{t.kicker}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.matchedAi.length > 0 && (
            <div>
              <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                在线 BYOK AI 专席
              </div>
              <div className="space-y-1">
                {results.matchedAi.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      sendToAi(a.id, a.shortTitle, '');
                      onClose();
                    }}
                    className="w-full flex items-center justify-between rounded-lg bg-white border border-[#EAE5DA] px-3 py-2.5 text-left hover:border-[#B89254]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles className="h-3.5 w-3.5 flex-none text-[#B89254]" />
                      <span className="truncate text-xs font-bold text-[#11151C]">{a.title}</span>
                    </div>
                    <span className="flex-none text-[10px] text-slate-500">{a.badge}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.matchedChecklists.length > 0 && (
            <div>
              <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                实务核对清单
              </div>
              <div className="space-y-1">
                {results.matchedChecklists.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      openLawsSearch('', 'checklists', c.id);
                      onClose();
                    }}
                    className="w-full flex items-center gap-2 rounded-lg bg-white border border-[#EAE5DA] px-3 py-2 text-left hover:border-[#0E223D]"
                  >
                    <CheckSquare className="h-3.5 w-3.5 flex-none text-emerald-700" />
                    <span className="truncate text-xs font-semibold text-[#11151C]">{c.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
