import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  CheckSquare,
  Cloud,
  Copy,
  Download,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { ImaCloudLibraryPanel } from '../components/ImaCloudLibraryPanel';
import { useToolbox } from '../context/ToolboxContext';
import { PRACTICE_CHECKLISTS } from '../data/checklists';
import { LEGAL_DATA_MANIFEST } from '../data/legalDataManifest';
import { copyToClipboard } from '../lib/clipboard';
import { searchStatuteEntries } from '../lib/statuteSearch';
import type { ChecklistInstance } from '../types/toolbox';

interface CivilArticleItem {
  no: number;
  label: string;
  book: string;
  chapter: string;
  section: string;
  summary: string;
  text: string;
  proviso: boolean;
  defaultRule: boolean;
  litTips: string[];
  nonLitTips: string[];
  interpRefs: { docTitle: string; label: string; snippet: string }[];
}

interface CompanionDocItem {
  id: string;
  kind: string;
  shortTitle: string;
  fullTitle: string;
  docNo: string;
  count: number;
  items: {
    no: number;
    label: string;
    section: string;
    text: string;
    linkedCivil: number[];
  }[];
}

interface LawsCorpusPayload {
  dataAsOf?: string;
  builtAt?: string;
  generatedAt?: string;
  civilCount: number;
  docCount: number;
  totalArticles: number;
  civilArticles: CivilArticleItem[];
  companionDocs: CompanionDocItem[];
}

interface UnifiedLawHit {
  key: string;
  lawTitle: string;
  fullLawTitle: string;
  articleNo: number;
  articleLabel: string;
  breadcrumb: string;
  summary?: string;
  text: string;
  litTips?: string[];
  nonLitTips?: string[];
  interpRefs?: { docTitle: string; label: string; snippet: string }[];
}

type ScopeFilter = 'all' | 'civil' | 'ip' | 'procedure' | 'company' | 'interp' | 'starred';

let cachedCorpus: LawsCorpusPayload | null = null;

export const LawsAndChecklistsTab: React.FC = () => {
  const {
    lawsInitialQuery,
    lawsSubView,
    lawsChecklistId,
    starredLaws,
    toggleStarLaw,
    checklists,
    setChecklists,
    sendToAi,
    showToast,
  } = useToolbox();

  const [subTab, setSubTab] = useState<'statutes' | 'ima_cloud' | 'checklists'>(lawsSubView);
  const [corpus, setCorpus] = useState<LawsCorpusPayload | null>(cachedCorpus);
  const [loading, setLoading] = useState(!cachedCorpus);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [query, setQuery] = useState(lawsInitialQuery || '');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Interactive Checklists State
  const [selectedTemplateId, setSelectedTemplateId] = useState(PRACTICE_CHECKLISTS[0].id);
  const [newCaseLabel, setNewCaseLabel] = useState('');
  const [activeInstanceId, setActiveInstanceId] = useState<string>('');

  useEffect(() => {
    setSubTab(lawsSubView);
  }, [lawsSubView]);

  useEffect(() => {
    if (lawsChecklistId && PRACTICE_CHECKLISTS.some((c) => c.id === lawsChecklistId)) {
      setSelectedTemplateId(lawsChecklistId);
    }
  }, [lawsChecklistId]);

  useEffect(() => {
    if (lawsInitialQuery && lawsSubView !== 'ima_cloud') {
      setQuery(lawsInitialQuery);
      setSubTab('statutes');
    }
  }, [lawsInitialQuery, lawsSubView]);

  useEffect(() => {
    if (cachedCorpus) {
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`${import.meta.env.BASE_URL}data/laws-offline.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: LawsCorpusPayload) => {
        if (!cancelled) {
          cachedCorpus = data;
          setCorpus(data);
          setLoadError(null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('离线法典语料包尚未缓存完成或网络读取失败，请检查网络后点击重试。');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  const allEntries = useMemo<UnifiedLawHit[]>(() => {
    if (!corpus) return [];
    const list: UnifiedLawHit[] = [];

    const linkedByCivilNo = new Map<number, { docTitle: string; label: string; snippet: string }[]>();
    for (const doc of corpus.companionDocs) {
      for (const it of doc.items) {
        if (Array.isArray(it.linkedCivil) && it.linkedCivil.length > 0) {
          const cleanSnippet = String(it.text || '').replace(/\s+/g, ' ').trim();
          const excerpt = cleanSnippet.length > 180 ? `${cleanSnippet.slice(0, 180)}…` : cleanSnippet;
          for (const civilNo of it.linkedCivil) {
            const bucket = linkedByCivilNo.get(civilNo) || [];
            if (bucket.length < 8) {
              bucket.push({
                docTitle: doc.shortTitle,
                label: it.label,
                snippet: excerpt,
              });
              linkedByCivilNo.set(civilNo, bucket);
            }
          }
        }
      }
    }

    for (const a of corpus.civilArticles) {
      const validRawRefs = Array.isArray(a.interpRefs)
        ? a.interpRefs.filter((r) => (r.docTitle || '').trim() || (r.snippet || '').trim())
        : [];
      const resolvedRefs =
        validRawRefs.length > 0 ? validRawRefs : linkedByCivilNo.get(a.no) || [];
      list.push({
        key: `civil:${a.no}`,
        lawTitle: '民法典',
        fullLawTitle: '中华人民共和国民法典',
        articleNo: a.no,
        articleLabel: a.label,
        breadcrumb: [a.book, a.chapter].filter(Boolean).join(' · '),
        summary: a.summary,
        text: a.text,
        litTips: a.litTips,
        nonLitTips: a.nonLitTips,
        interpRefs: resolvedRefs,
      });
    }

    for (const doc of corpus.companionDocs) {
      for (const it of doc.items) {
        list.push({
          key: `${doc.id}:${it.no}`,
          lawTitle: doc.shortTitle,
          fullLawTitle: doc.fullTitle || doc.shortTitle,
          articleNo: it.no,
          articleLabel: it.label,
          breadcrumb: [doc.docNo, it.section].filter(Boolean).join(' · '),
          text: it.text,
        });
      }
    }
    return list;
  }, [corpus]);

  const filteredStatutes = useMemo(() => {
    const q = query.trim();

    const matchScope = (item: UnifiedLawHit): boolean => {
      if (scope === 'starred') return starredLaws.includes(item.key);
      if (scope === 'civil') return item.lawTitle === '民法典';
      if (scope === 'ip') {
        return /著作权|商标|反不正当竞争|知识产权|网络侵害|人脸识别|个人信息|电子商务/.test(
          item.lawTitle
        );
      }
      if (scope === 'procedure') {
        return /民事诉讼|证据|仲裁/.test(item.lawTitle);
      }
      if (scope === 'company') {
        return /公司法|合伙企业|企业破产/.test(item.lawTitle);
      }
      if (scope === 'interp') {
        return /解释|规定/.test(item.lawTitle) && item.lawTitle !== '民法典';
      }
      return true;
    };

    const scoped = allEntries.filter(matchScope);

    if (!q) {
      if (scope === 'starred') return scoped;
      const hotKeys = new Set([
        'civil:585',
        'civil:577',
        'civil:561',
        'civil:563',
        'civil:1195',
        'civil:188',
        'civil:203',
        'law_copyright_2020:10',
        'law_copyright_2020:54',
      ]);
      const hot = scoped.filter((x) => hotKeys.has(x.key));
      return hot.length > 0 ? hot : scoped.slice(0, 30);
    }

    return searchStatuteEntries(scoped, q, 50);
  }, [allEntries, query, scope, starredLaws]);

  // Checklist Helpers
  const currentTemplate =
    PRACTICE_CHECKLISTS.find((c) => c.id === selectedTemplateId) || PRACTICE_CHECKLISTS[0];
  const templateInstances = checklists.filter((c) => c.templateId === currentTemplate.id);

  useEffect(() => {
    if (templateInstances.length > 0 && !templateInstances.some((i) => i.id === activeInstanceId)) {
      setActiveInstanceId(templateInstances[0].id);
    }
  }, [templateInstances, activeInstanceId]);

  const currentInstance: ChecklistInstance | null =
    templateInstances.find((i) => i.id === activeInstanceId) || null;

  const createInstance = () => {
    const label = newCaseLabel.trim() || `${currentTemplate.tag} · ${new Date().toLocaleDateString('zh-CN')}`;
    const inst: ChecklistInstance = {
      id: `chk-${Date.now()}`,
      templateId: currentTemplate.id,
      caseLabel: label,
      checkedKeys: [],
      updatedAt: new Date().toISOString(),
    };
    setChecklists([inst, ...checklists]);
    setActiveInstanceId(inst.id);
    setNewCaseLabel('');
    showToast(`已新建案件核查卡「${label}」`);
  };

  const toggleChecklistItem = (itemKey: string) => {
    if (!currentInstance) {
      const inst: ChecklistInstance = {
        id: `chk-${Date.now()}`,
        templateId: currentTemplate.id,
        caseLabel: `${currentTemplate.tag}（默认案件）`,
        checkedKeys: [itemKey],
        updatedAt: new Date().toISOString(),
      };
      setChecklists([inst, ...checklists]);
      setActiveInstanceId(inst.id);
      return;
    }
    const exists = currentInstance.checkedKeys.includes(itemKey);
    const nextKeys = exists
      ? currentInstance.checkedKeys.filter((k) => k !== itemKey)
      : [...currentInstance.checkedKeys, itemKey];
    setChecklists(
      checklists.map((c) =>
        c.id === currentInstance.id
          ? { ...c, checkedKeys: nextKeys, updatedAt: new Date().toISOString() }
          : c
      )
    );
  };

  const copyMissingChecklistItems = async () => {
    const checkedSet = new Set(currentInstance?.checkedKeys || []);
    const missing: string[] = [];
    currentTemplate.sections.forEach((sec, sIdx) => {
      sec.items.forEach((it, iIdx) => {
        if (!checkedSet.has(`${sIdx}-${iIdx}`)) {
          missing.push(`${missing.length + 1}. ${it}`);
        }
      });
    });

    const msg =
      missing.length === 0
        ? `【${currentTemplate.title}】全部核查项均已齐备！`
        : [
            `您好，就「${currentInstance?.caseLabel || currentTemplate.title}」事项，经初步核对现有材料，尚有以下几项材料/合规事项需进一步补充确认：`,
            ...missing,
            `请您抽空协助核实提供，以便我们推进下一步法律工作。`,
          ].join('\n');

    await copyToClipboard(msg);
    showToast('已复制《待补充材料催收清单》，可直接粘贴发给当事人');
  };

  const copyCitation = async (hit: UnifiedLawHit) => {
    const full = `《${hit.fullLawTitle}》${hit.articleLabel}：\n${hit.text}`;
    await copyToClipboard(full);
    setCopiedKey(hit.key);
    showToast(`已复制《${hit.lawTitle}》${hit.articleLabel}原文`);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  return (
    <div className="py-5 sm:py-8 px-4 sm:px-6 mx-auto max-w-6xl">
      {/* Top 3-Way Sub-View Switcher: Offline Laws | Online IMA Case & Law Cloud | Interactive Checklists */}
      <div className="grid grid-cols-3 rounded-lg border border-[#DED8CC] bg-white p-1 gap-1">
        <button
          type="button"
          onClick={() => setSubTab('statutes')}
          className={`flex items-center justify-center gap-1 rounded-md py-2.5 px-1 text-[11px] sm:text-sm font-bold transition-colors ${
            subTab === 'statutes'
              ? 'bg-[#0E223D] text-[#F6F4EF]'
              : 'text-slate-600 hover:text-[#11151C]'
          }`}
        >
          <BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[#D1B27A] flex-none" />
          <span className="whitespace-nowrap">离线法规(4111)</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('ima_cloud')}
          className={`flex items-center justify-center gap-1 rounded-md py-2.5 px-1 text-[11px] sm:text-sm font-bold transition-colors ${
            subTab === 'ima_cloud'
              ? 'bg-[#0E223D] text-[#F6F4EF]'
              : 'text-slate-600 hover:text-[#11151C]'
          }`}
        >
          <Cloud className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[#D1B27A] flex-none" />
          <span className="whitespace-nowrap">IMA案例法规库</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('checklists')}
          className={`flex items-center justify-center gap-1 rounded-md py-2.5 px-1 text-[11px] sm:text-sm font-bold transition-colors ${
            subTab === 'checklists'
              ? 'bg-[#0E223D] text-[#F6F4EF]'
              : 'text-slate-600 hover:text-[#11151C]'
          }`}
        >
          <CheckSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[#D1B27A] flex-none" />
          <span className="whitespace-nowrap">核对清单({PRACTICE_CHECKLISTS.length})</span>
        </button>
      </div>

      {subTab === 'ima_cloud' ? (
        <div className="mt-5">
          <ImaCloudLibraryPanel
            initialQuery={lawsSubView === 'ima_cloud' ? lawsInitialQuery : ''}
            offlineStatutes={allEntries}
            onSwitchToOffline={() => setSubTab('statutes')}
          />
        </div>
      ) : subTab === 'statutes' ? (
        <div className="mt-5 space-y-4">
          {/* Search & Scope Bar */}
          <div className="rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="font-display text-sm sm:text-base font-bold text-[#11151C]">
                法庭 / 看守所无信号离线秒查（民法典 + 著作权法 + 民诉法 + 25部核心司解）
              </span>
              <span className="flex-none whitespace-nowrap inline-flex items-center gap-1 rounded-full bg-emerald-950/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-900">
                <WifiOff className="h-3 w-3 text-emerald-700" /> 离线就绪 · 语料截至{' '}
                {corpus?.dataAsOf || LEGAL_DATA_MANIFEST.lawsOffline.asOf}
              </span>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="输入条号（如 585、54）0毫秒直达，或搜关键词（如 信息网络传播权、违约金调减、举证期限）…"
                className="w-full rounded-md border border-[#D8D1C3] bg-[#FAF9F6] pl-10 pr-4 py-2.5 text-xs sm:text-sm text-[#11151C] focus:border-[#0E223D] focus:bg-white focus:outline-none"
              />
            </div>

            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {(
                [
                  ['all', '全部法规 (4111条)'],
                  ['civil', '民法典 (1260条)'],
                  ['ip', '著作权/商标/反法/知产证据'],
                  ['procedure', '民诉法/民诉解释/证据/仲裁'],
                  ['company', '新公司法/合伙/破产'],
                  ['interp', '25部民商事核心司法解释'],
                  ['starred', `⭐ 常看法条收藏 (${starredLaws.length})`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setScope(id)}
                  className={`flex-none rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    scope === id
                      ? 'border-[#0E223D] bg-[#0E223D] text-white'
                      : 'border-[#DED8CC] bg-[#FAF9F6] text-slate-600 hover:border-[#0E223D]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Quick Jump Chips */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <span>庭审高频速跳：</span>
              {[
                ['585', '违约金调减(585)'],
                ['561', '债之冲抵(561)'],
                ['563', '法定解除(563)'],
                ['1195', '避风港通知删除(1195)'],
                ['信息网络传播权', '信息网络传播权'],
                ['法定赔偿', '知产法定赔偿'],
              ].map(([qVal, label]) => (
                <button
                  key={qVal}
                  type="button"
                  onClick={() => {
                    setScope('all');
                    setQuery(qVal);
                  }}
                  className="rounded bg-[#F3ECE0] px-2 py-0.5 font-medium text-[#7A5922] hover:bg-[#E7DBC6]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Results List */}
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500">正在加载离线法典语料包…</div>
          ) : loadError ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-center text-xs text-amber-950 space-y-2.5">
              <div className="font-bold text-sm">{loadError}</div>
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="rounded bg-[#0E223D] px-4 py-2 font-bold text-white"
              >
                重新加载离线法规语料包
              </button>
            </div>
          ) : filteredStatutes.length === 0 ? (
            <div className="rounded-lg border border-[#DED8CC] bg-white py-10 text-center text-xs text-slate-500">
              内置语料库已就绪，但未匹配到“{query.trim()}”，请尝试切换上方分类范围或精简关键词。
            </div>
          ) : (
            <div className="space-y-3">
              {filteredStatutes.map((hit) => {
                const isStarred = starredLaws.includes(hit.key);
                const isExpanded = expandedKey === hit.key;
                const hasExtras =
                  (hit.interpRefs && hit.interpRefs.length > 0) ||
                  (hit.litTips && hit.litTips.length > 0) ||
                  (hit.nonLitTips && hit.nonLitTips.length > 0);

                return (
                  <article
                    key={hit.key}
                    className="rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 shadow-[0_1px_2px_rgba(17,21,28,0.03)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-[#0E223D] px-2 py-0.5 text-[11px] font-semibold text-[#D1B27A]">
                            {hit.lawTitle}
                          </span>
                          <span className="font-display text-base font-bold text-[#11151C]">
                            {hit.articleLabel}
                          </span>
                          {hit.summary && (
                            <span className="text-xs font-semibold text-[#9A773E]">
                              〔{hit.summary}〕
                            </span>
                          )}
                        </div>
                        {hit.breadcrumb && (
                          <div className="mt-1 text-[11px] text-slate-400">
                            {hit.breadcrumb} ·{' '}
                            <a
                              href="https://flk.npc.gov.cn/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline hover:text-[#0E223D]"
                            >
                              国家法律法规数据库核对原文
                            </a>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleStarLaw(hit.key)}
                          className={`rounded border p-1.5 transition-colors ${
                            isStarred
                              ? 'border-[#B89254] bg-[#F3ECE0] text-[#9A773E]'
                              : 'border-[#DED8CC] bg-white text-slate-400 hover:text-[#9A773E]'
                          }`}
                          title="收藏法条"
                        >
                          <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-current' : ''}`} />
                        </button>

                        <button
                          type="button"
                          onClick={() => copyCitation(hit)}
                          className="inline-flex items-center gap-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-1 text-xs font-semibold text-[#11151C] hover:border-[#0E223D]"
                        >
                          {copiedKey === hit.key ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" /> 已复制
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> 复制引文
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            sendToAi(
                              'legal-sandbox',
                              `《${hit.lawTitle}》${hit.articleLabel}`,
                              `请围绕以下经核实的法条原文，分析其在诉讼实务中的适用要件与抗辩要点：\n\n《${hit.fullLawTitle}》${hit.articleLabel}：\n${hit.text}`
                            )
                          }
                          className="inline-flex items-center gap-1 rounded bg-[#0E223D] px-2.5 py-1 text-xs font-semibold text-[#F6F4EF]"
                        >
                          <Sparkles className="h-3 w-3 text-[#D1B27A]" /> 送AI研判
                        </button>
                      </div>
                    </div>

                    <p className="mt-3 whitespace-pre-line text-xs sm:text-[14px] leading-7 text-[#1B212B]">
                      {hit.text}
                    </p>

                    {hasExtras && (
                      <div className="mt-3 pt-2.5 border-t border-[#EFECE5]">
                        <button
                          type="button"
                          onClick={() => setExpandedKey(isExpanded ? null : hit.key)}
                          className="text-xs font-semibold text-[#0E223D] hover:text-[#9A773E]"
                        >
                          {isExpanded
                            ? '收起配套司法解释与诉辩实务提示 ▲'
                            : `展开配套司法解释 (${hit.interpRefs?.length || 0}) 与诉辩实务提示 ▼`}
                        </button>

                        {isExpanded && (
                          <div className="mt-3 space-y-3 rounded-md bg-[#FAF9F6] p-3.5 text-xs">
                            {hit.litTips && hit.litTips.length > 0 && (
                              <div>
                                <div className="font-bold text-[#0E223D] mb-1">诉讼请求与抗辩要点：</div>
                                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                                  {hit.litTips.map((t, idx) => (
                                    <li key={idx}>{t}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {hit.nonLitTips && hit.nonLitTips.length > 0 && (
                              <div>
                                <div className="font-bold text-[#0E223D] mb-1">非诉审查与风控提示：</div>
                                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                                  {hit.nonLitTips.map((t, idx) => (
                                    <li key={idx}>{t}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {hit.interpRefs && hit.interpRefs.length > 0 && (
                              <div>
                                <div className="font-bold text-[#9A773E] mb-1">同屏挂载司法解释：</div>
                                <div className="space-y-2">
                                  {hit.interpRefs.map((ref, idx) => (
                                    <div key={idx} className="rounded bg-white p-2.5 border border-[#EAE5DA]">
                                      <span className="font-bold text-[#11151C]">
                                        《{ref.docTitle}》{ref.label}：
                                      </span>
                                      <span className="text-slate-600">{ref.snippet}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Sub-View 2: Interactive Multi-Case Checklists */
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Template Picker */}
          <div className="lg:col-span-4 space-y-2.5">
            {PRACTICE_CHECKLISTS.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setSelectedTemplateId(tpl.id)}
                className={`w-full text-left rounded-lg border p-3.5 transition-colors ${
                  tpl.id === currentTemplate.id
                    ? 'border-[#0E223D] bg-[#0E223D] text-white'
                    : 'border-[#DED8CC] bg-white text-[#11151C] hover:border-[#B89254]'
                }`}
              >
                <div
                  className={`text-[10px] font-semibold uppercase tracking-wider ${
                    tpl.id === currentTemplate.id ? 'text-[#D1B27A]' : 'text-[#9A773E]'
                  }`}
                >
                  {tpl.tag}
                </div>
                <div className="mt-1 font-display text-sm font-bold">{tpl.title}</div>
              </button>
            ))}
          </div>

          {/* Active Checklist Card */}
          <div className="lg:col-span-8 rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-6 space-y-4">
            <div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#11151C]">
                {currentTemplate.title}
              </h2>
              <p className="mt-1 text-xs text-slate-600">{currentTemplate.subtitle}</p>
            </div>

            {/* Case Instance Bar */}
            <div className="rounded-md bg-[#FAF9F6] border border-[#EAE5DA] p-3 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={newCaseLabel}
                  onChange={(e) => setNewCaseLabel(e.target.value)}
                  placeholder="输入案件/客户名称新建独立勾选卡（如：某公司买卖合同纠纷案）"
                  className="flex-1 min-w-[200px] rounded border border-[#D8D1C3] bg-white px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={createInstance}
                  className="inline-flex items-center gap-1 rounded bg-[#0E223D] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  <Plus className="h-3.5 w-3.5 text-[#D1B27A]" /> 新建分案核查卡
                </button>
              </div>

              {templateInstances.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pt-1 no-scrollbar">
                  {templateInstances.map((inst) => (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => setActiveInstanceId(inst.id)}
                      className={`flex-none rounded px-2.5 py-1 text-xs font-medium ${
                        inst.id === currentInstance?.id
                          ? 'bg-[#B89254] font-bold text-[#11151C]'
                          : 'bg-white border border-[#DED8CC] text-slate-600'
                      }`}
                    >
                      {inst.caseLabel} ({inst.checkedKeys.length})
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Sections & Checkboxes */}
            <div className="space-y-4">
              {currentTemplate.sections.map((sec, sIdx) => (
                <div key={sec.heading}>
                  <h3 className="font-display text-sm font-bold text-[#0E223D] border-b border-[#EFECE5] pb-1.5 mb-2">
                    {sec.heading}
                  </h3>
                  <div className="space-y-2">
                    {sec.items.map((itemText, iIdx) => {
                      const key = `${sIdx}-${iIdx}`;
                      const checked = Boolean(currentInstance?.checkedKeys.includes(key));
                      return (
                        <label
                          key={key}
                          className={`flex items-start gap-2.5 rounded-md border p-2.5 cursor-pointer transition-colors ${
                            checked
                              ? 'border-emerald-200 bg-emerald-50/50 text-slate-500 line-through'
                              : 'border-[#EAE5DA] bg-[#FAF9F6] text-[#11151C] hover:border-[#B89254]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleChecklistItem(key)}
                            className="mt-1 h-4 w-4 rounded accent-[#0E223D]"
                          />
                          <span className="text-xs sm:text-[13px] leading-5">{itemText}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EFECE5] pt-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyMissingChecklistItems}
                  className="inline-flex items-center gap-1.5 rounded bg-[#B89254] px-3.5 py-2 text-xs font-bold text-[#11151C]"
                >
                  <Copy className="h-3.5 w-3.5" /> 一键复制「未齐材料催收清单」发微信
                </button>
                {currentTemplate.csvHref && (
                  <a
                    href={currentTemplate.csvHref}
                    download
                    className="inline-flex items-center gap-1.5 rounded border border-[#D8D1C3] bg-white px-3 py-2 text-xs font-semibold text-[#0E223D]"
                  >
                    <Download className="h-3.5 w-3.5" /> 下载配套授权链 CSV 模板
                  </a>
                )}
              </div>

              {currentInstance && (
                <button
                  type="button"
                  onClick={() =>
                    setChecklists(checklists.filter((c) => c.id !== currentInstance.id))
                  }
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" /> 删除当前分案卡
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
