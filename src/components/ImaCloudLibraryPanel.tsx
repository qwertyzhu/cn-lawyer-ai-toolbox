import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  KeyRound,
  Loader2,
  Lock,
  MessageSquareText,
  Search,
  Sparkles,
  Square,
  WifiOff,
  X,
} from 'lucide-react';
import { SITE_CONFIG } from '../config/siteConfig';
import { useToolbox } from '../context/ToolboxContext';
import { AI_LEGAL_DISCLAIMER } from '../data/legalDataManifest';
import { streamAiCompletion } from '../lib/aiClient';
import { copyToClipboard } from '../lib/clipboard';
import { decryptWithPassphrase } from '../lib/cryptoVault';
import { downloadMarkdownReportDocx } from '../lib/docxBuilder';
import { getSavedLicense } from '../lib/licenseEngine';

export interface OfflineLawLite {
  key: string;
  lawTitle: string;
  fullLawTitle: string;
  articleLabel: string;
  summary?: string;
  text: string;
}

interface PublicKbMeta {
  alias: 'law_cases' | 'national_laws';
  name: string;
  badge: string;
  subtitle: string;
  canReadOriginal: boolean;
  externalOnly: boolean;
  shareUrl: string;
  contentCount: string;
  memberCount: string;
  recommendedQuestions?: string[];
}

interface ImaEntryItem {
  itemKey: string;
  title: string;
  kind: 'folder' | 'pdf' | 'word' | 'text' | 'file';
  highlight?: string;
  canReadOriginal?: boolean;
}

interface BreadcrumbNode {
  folderKey: string;
  name: string;
}

interface ExtractedDocResult {
  item: ImaEntryItem;
  text: string;
  charCount: number;
  fullCharCount: number;
  pageCount: number;
  truncated: boolean;
  isScannedPdf?: boolean;
  legacyDoc?: boolean;
  notice?: string;
}

const IMA_LAW_CASES_SHARE_URL = SITE_CONFIG.publicImaShareUrl;

const DEFAULT_SAMPLE_QUESTIONS = [
  '买卖合同未约定违约金，逾期付款利息按什么标准计算？',
  '股东未届出资期限转让股权，原股东是否承担补充责任？',
  '劳动合同违法解除 2N 赔偿金与经济补偿金如何认定？',
  '建设工程实际施工人突破合同相对性主张工程款的条件是什么？',
];

const HOT_FILE_KEYWORDS = [
  '指导性案例',
  '法答网',
  '民法典',
  '公司法',
  '股东出资',
  '建设工程',
  '劳动争议',
  '信息网络传播权',
  '人工智能',
  '强制执行',
];

function matchLocalOfflineLaws(
  statutes: OfflineLawLite[],
  query: string,
  terms: string[]
): OfflineLawLite[] {
  if (!statutes.length) return [];
  const cleanTerms = Array.from(
    new Set(
      [...terms, ...query.split(/[\s，,。；;？?！!、]+/)]
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 12)
    )
  ).slice(0, 6);

  if (cleanTerms.length === 0) return [];

  const scored: { item: OfflineLawLite; score: number }[] = [];
  for (const st of statutes) {
    const hay = `${st.lawTitle} ${st.articleLabel} ${st.summary || ''} ${st.text}`;
    let hits = 0;
    let score = 0;
    for (const kw of cleanTerms) {
      if (hay.includes(kw)) {
        hits += 1;
        score += st.summary?.includes(kw) ? 35 : st.lawTitle.includes(kw) ? 20 : 15;
      }
    }
    if (hits > 0) {
      if (hits >= 2) score += hits * 22;
      if (st.lawTitle === '民法典') score += 6;
      scored.push({ item: st, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.item);
}

export const ImaCloudLibraryPanel: React.FC<{
  initialQuery?: string;
  offlineStatutes?: OfflineLawLite[];
  onSwitchToOffline: () => void;
}> = ({ initialQuery = '', offlineStatutes = [], onSwitchToOffline }) => {
  const {
    isOnline,
    byok,
    sessionUnlockedPin,
    setSessionUnlockedPin,
    navigateTab,
    sendToAi,
    showToast,
  } = useToolbox();

  const [lawCasesMeta, setLawCasesMeta] = useState<PublicKbMeta | null>(null);
  const [nationalMeta, setNationalMeta] = useState<PublicKbMeta | null>(null);
  const [imaApiReady, setImaApiReady] = useState<boolean | null>(null);

  // Two clean modes: AI Q&A with real citations | Direct File Search & Folder Browser
  const [panelMode, setPanelMode] = useState<'qa' | 'files'>(() =>
    initialQuery.trim() && initialQuery.trim().length > 10 ? 'qa' : 'qa'
  );

  // --- Mode 1: Built-in RAG AI Q&A State ---
  const [qaInput, setQaInput] = useState(initialQuery);
  const [qaRunning, setQaRunning] = useState(false);
  const [qaStageText, setQaStageText] = useState('');
  const [qaUsedTerms, setQaUsedTerms] = useState<string[]>([]);
  const [qaMatchedFiles, setQaMatchedFiles] = useState<ImaEntryItem[]>([]);
  const [qaExtractedDocs, setQaExtractedDocs] = useState<ExtractedDocResult[]>([]);
  const [qaMatchedLaws, setQaMatchedLaws] = useState<OfflineLawLite[]>([]);
  const [qaAnswer, setQaAnswer] = useState('');
  const [qaUsedModel, setQaUsedModel] = useState('');
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaNoKeyMode, setQaNoKeyMode] = useState(false);
  const [qaCopied, setQaCopied] = useState(false);
  const [pinPromptOpen, setPinPromptOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // --- Mode 2: File Search & Folder Browser State ---
  const [fileQuery, setFileQuery] = useState(initialQuery);
  const [fileViewMode, setFileViewMode] = useState<'browse' | 'search'>(
    initialQuery.trim() ? 'search' : 'browse'
  );
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbNode[]>([]);
  const [currentFolderKey, setCurrentFolderKey] = useState('');
  const [items, setItems] = useState<ImaEntryItem[]>([]);
  const [usedSearchTerms, setUsedSearchTerms] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [isEnd, setIsEnd] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // --- Shared Document Reader Drawer (Text + Original PDF + AI Actions) ---
  const [previewItem, setPreviewItem] = useState<ImaEntryItem | null>(null);
  const [previewView, setPreviewView] = useState<'text' | 'pdf'>('text');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<ExtractedDocResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pdfTicketUrl, setPdfTicketUrl] = useState<string>('');
  const [pdfTicketLoading, setPdfTicketLoading] = useState(false);
  const [inDocFilter, setInDocFilter] = useState('');
  const [copiedDoc, setCopiedDoc] = useState(false);
  const previewCardRef = useRef<HTMLDivElement | null>(null);

  const activeProvider = useMemo(
    () => byok.providers.find((p) => p.id === byok.activeProviderId) || byok.providers[0],
    [byok]
  );
  const hasAnyKey = Boolean(activeProvider?.apiKey?.trim() || activeProvider?.apiKeyEncrypted);

  const getLicenseToken = () => getSavedLicense()?.rawCode || '';

  const authHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      'X-Toolbox-License': getLicenseToken(),
    }),
    []
  );

  // Fetch public catalog metadata (counts + recommended questions + share URLs)
  useEffect(() => {
    if (!isOnline || SITE_CONFIG.staticDemoMode) {
      setImaApiReady(false);
      return;
    }
    fetch('/api/ima/catalog', {
      headers: { 'X-Toolbox-License': getLicenseToken() },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setImaApiReady(Boolean(data?.ok && data?.configured));
        if (data.ok && Array.isArray(data.libraries)) {
          const lc = data.libraries.find((l: PublicKbMeta) => l.alias === 'law_cases') || null;
          const nl = data.libraries.find((l: PublicKbMeta) => l.alias === 'national_laws') || null;
          if (lc) setLawCasesMeta(lc);
          if (nl) setNationalMeta(nl);
        }
      })
      .catch(() => {
        setImaApiReady(false);
      });
  }, [isOnline]);

  const loadFolder = useCallback(
    async (folderKey = '', appendCursor = '') => {
      if (!isOnline) return;
      setLoadingFiles(true);
      setFileError(null);
      try {
        const resp = await fetch('/api/ima/browse', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ kb: 'law_cases', folderKey, cursor: appendCursor }),
        });
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error || '目录读取失败');

        setFileViewMode('browse');
        setUsedSearchTerms([]);
        setCurrentFolderKey(folderKey);
        setBreadcrumbs(data.breadcrumbs || []);
        setItems((prev) => (appendCursor ? [...prev, ...(data.items || [])] : data.items || []));
        setNextCursor(data.nextCursor || '');
        setIsEnd(Boolean(data.isEnd));
      } catch (err) {
        setFileError(
          err instanceof Error
            ? err.message
            : '当前环境未配置腾讯 IMA OpenAPI 凭证（在 .env 填入后即可在箱内浏览云库目录，或直接点击上方按钮跳转 IMA 官方端）'
        );
      } finally {
        setLoadingFiles(false);
      }
    },
    [isOnline, authHeaders]
  );

  const runFileSearch = useCallback(
    async (qStr: string, appendCursor = '') => {
      const cleanQ = qStr.trim();
      if (!cleanQ) {
        loadFolder('');
        return;
      }
      if (!isOnline) return;
      setLoadingFiles(true);
      setFileError(null);
      try {
        const resp = await fetch('/api/ima/search', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            kb: 'law_cases',
            query: cleanQ,
            cursor: appendCursor,
            smart: true,
          }),
        });
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error || '检索失败');

        setFileViewMode('search');
        setUsedSearchTerms(Array.isArray(data.usedTerms) ? data.usedTerms : []);
        setItems((prev) => (appendCursor ? [...prev, ...(data.items || [])] : data.items || []));
        setNextCursor(data.nextCursor || '');
        setIsEnd(Boolean(data.isEnd));
      } catch (err) {
        setFileError(err instanceof Error ? err.message : '检索请求失败');
      } finally {
        setLoadingFiles(false);
      }
    },
    [isOnline, authHeaders, loadFolder]
  );

  // Initial load for file browser + auto-hydrate incoming query (only when backend IMA gateway is active)
  useEffect(() => {
    if (!isOnline || imaApiReady !== true) return;
    const incoming = initialQuery.trim();
    if (incoming) {
      setQaInput(incoming);
      setFileQuery(incoming);
      setPreviewItem(null);
      runFileSearch(incoming);
      // Also pre-hydrate Stage 1 source cards in Q&A mode without spending any LLM tokens
      fetch('/api/ima/search', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ kb: 'law_cases', query: incoming, filesOnly: true, smart: true }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.ok) return;
          const terms: string[] = Array.isArray(data.usedTerms) ? data.usedTerms : [incoming];
          setQaUsedTerms(terms);
          setQaMatchedFiles(Array.isArray(data.items) ? data.items.slice(0, 12) : []);
          setQaMatchedLaws(matchLocalOfflineLaws(offlineStatutes, incoming, terms));
        })
        .catch(() => {
          // ignore silent prefill failure
        });
    } else {
      loadFolder('');
    }
  }, [isOnline, imaApiReady, initialQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // S-4: Request a short-lived (60s) opaque ticket via POST header auth instead of putting ?lic= in URLs
  const requestFileTicketUrl = useCallback(
    async (item: ImaEntryItem, download = false): Promise<string> => {
      const resp = await fetch('/api/ima/file-ticket', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          itemKey: item.itemKey,
          name: item.title,
          download,
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok || !data?.url) {
        throw new Error(data?.error || `获取临时文件凭据失败 (${resp.status})`);
      }
      return String(data.url);
    },
    [authHeaders]
  );

  const handleDownloadOriginal = useCallback(
    async (item: ImaEntryItem) => {
      try {
        const ticketUrl = await requestFileTicketUrl(item, true);
        const a = document.createElement('a');
        a.href = ticketUrl;
        a.download = item.title;
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        showToast(err instanceof Error ? err.message : '下载原件失败，请稍后重试');
      }
    },
    [requestFileTicketUrl, showToast]
  );

  const handleOpenPdfNewTab = useCallback(
    async (item: ImaEntryItem) => {
      const win = window.open('about:blank', '_blank', 'noopener,noreferrer');
      try {
        const ticketUrl = await requestFileTicketUrl(item, false);
        if (win) {
          win.location.href = ticketUrl;
        } else {
          window.open(ticketUrl, '_blank', 'noopener,noreferrer');
        }
      } catch (err) {
        if (win) win.close();
        showToast(err instanceof Error ? err.message : '无法打开 PDF 预览，请稍后重试');
      }
    },
    [requestFileTicketUrl, showToast]
  );

  useEffect(() => {
    if (!previewItem || previewItem.kind !== 'pdf' || previewView !== 'pdf') {
      setPdfTicketUrl('');
      setPdfTicketLoading(false);
      return;
    }
    let cancelled = false;
    setPdfTicketLoading(true);
    setPdfTicketUrl('');
    requestFileTicketUrl(previewItem, false)
      .then((url) => {
        if (!cancelled) setPdfTicketUrl(url);
      })
      .catch((err) => {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : '获取原版 PDF 临时凭据失败');
        }
      })
      .finally(() => {
        if (!cancelled) setPdfTicketLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewItem, previewView, requestFileTicketUrl]);

  const extractSingleDoc = useCallback(
    async (item: ImaEntryItem, maxChars = 36000): Promise<ExtractedDocResult> => {
      const resp = await fetch('/api/ima/extract', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          itemKey: item.itemKey,
          title: item.title,
          kind: item.kind,
          maxChars,
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || `正文提取失败 (${resp.status})`);
      }
      return {
        item,
        text: data.text || '',
        charCount: data.charCount || 0,
        fullCharCount: data.fullCharCount || 0,
        pageCount: data.pageCount || 1,
        truncated: Boolean(data.truncated),
        isScannedPdf: Boolean(data.isScannedPdf),
        legacyDoc: Boolean(data.legacyDoc),
        notice: data.notice || '',
      };
    },
    [authHeaders]
  );

  const handleOpenItem = async (item: ImaEntryItem) => {
    if (item.kind === 'folder') {
      setPanelMode('files');
      setFileQuery('');
      loadFolder(item.itemKey);
      return;
    }

    setPreviewItem(item);
    setPreviewDoc(null);
    setPreviewError(null);
    setInDocFilter('');
    setPreviewView('text');
    setPreviewLoading(true);

    setTimeout(() => {
      previewCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);

    try {
      const extracted = await extractSingleDoc(item, 40000);
      setPreviewDoc(extracted);
      if (extracted.isScannedPdf && item.kind === 'pdf') {
        setPreviewView('pdf');
      }
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : '无法解析文档正文，请切换原版 PDF 或点击「下载原件」查看。'
      );
      if (item.kind === 'pdf') {
        setPreviewView('pdf');
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const resolveUsableProvider = async (explicitPin?: string) => {
    if (!activeProvider) return null;
    if (activeProvider.apiKey?.trim()) {
      return activeProvider;
    }
    if (activeProvider.apiKeyEncrypted) {
      const pinToUse = explicitPin || sessionUnlockedPin || '';
      if (!pinToUse) {
        setPinPromptOpen(true);
        setPinError('');
        return 'NEED_PIN' as const;
      }
      try {
        const plainKey = await decryptWithPassphrase(activeProvider.apiKeyEncrypted, pinToUse);
        if (explicitPin) setSessionUnlockedPin(explicitPin);
        return { ...activeProvider, apiKey: plainKey };
      } catch {
        setPinPromptOpen(true);
        setPinError('PIN 口令不正确，请重新输入');
        return 'NEED_PIN' as const;
      }
    }
    return null;
  };

  const runKnowledgeQa = async (questionOverride?: string, explicitPin?: string) => {
    const q = (questionOverride ?? qaInput).trim();
    if (!q) {
      showToast('请先输入法律问题或案件争议关键词');
      return;
    }
    if (!isOnline) {
      showToast('当前处于离线模式，请联网后再查云库');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPanelMode('qa');
    setQaInput(q);
    setQaRunning(true);
    setQaError(null);
    setQaNoKeyMode(false);
    setQaAnswer('');
    setQaUsedModel('');
    setQaMatchedFiles([]);
    setQaExtractedDocs([]);
    setQaMatchedLaws([]);
    setQaStageText('第 1/3 步：正在联合检索 4.48 万份《法律法规案例库》与 4,111 条离线核心法典…');

    try {
      // Stage 1: Smart multi-term search on IMA law_cases (gracefully degrades to local 4,111 statutes if IMA OpenAPI is not configured)
      let terms: string[] = q.split(/[\s，,。；;？?！!、]+/).filter((s) => s.length >= 2).slice(0, 4);
      let matchedItems: ImaEntryItem[] = [];

      if (imaApiReady !== false) {
        try {
          const searchResp = await fetch('/api/ima/search', {
            method: 'POST',
            headers: authHeaders(),
            signal: controller.signal,
            body: JSON.stringify({
              kb: 'law_cases',
              query: q,
              filesOnly: true,
              smart: true,
            }),
          });
          const searchData = await searchResp.json().catch(() => null);
          if (searchResp.ok && searchData?.ok) {
            if (Array.isArray(searchData.usedTerms) && searchData.usedTerms.length > 0) {
              terms = searchData.usedTerms;
            }
            matchedItems = Array.isArray(searchData.items) ? searchData.items : [];
          }
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') throw err;
          // Static deployment or unconfigured IMA API -> gracefully continue with local 4,111 offline laws!
        }
      }

      const localLaws = matchLocalOfflineLaws(offlineStatutes, q, terms);

      setQaUsedTerms(terms);
      setQaMatchedFiles(matchedItems.slice(0, 12));
      setQaMatchedLaws(localLaws);

      // Stage 2: Extract real full text from top readable docs (skip scanned-only PDFs automatically)
      const candidates = matchedItems
        .filter((it) => it.kind === 'pdf' || it.kind === 'word' || it.kind === 'text')
        .slice(0, 5);

      const extractedList: ExtractedDocResult[] = [];
      if (candidates.length > 0) {
        setQaStageText(
          `第 2/3 步：命中 ${matchedItems.length} 份权威文献，正在实时提取前 ${Math.min(
            3,
            candidates.length
          )} 篇 PDF/Word 正文用于核验引用…`
        );

        for (const cand of candidates) {
          if (extractedList.length >= 3 || controller.signal.aborted) break;
          try {
            const docRes = await extractSingleDoc(cand, 7500);
            if (docRes.text && docRes.text.length >= 40 && !docRes.isScannedPdf) {
              extractedList.push(docRes);
              setQaExtractedDocs([...extractedList]);
            }
          } catch {
            // gracefully continue to next candidate
          }
        }
      }

      if (controller.signal.aborted) return;

      // Stage 3: Stream citation-backed legal Q&A via lawyer's personal BYOK LLM
      const resolvedProvider = await resolveUsableProvider(explicitPin);
      if (resolvedProvider === 'NEED_PIN') {
        setQaRunning(false);
        setQaStageText('检索与原文提取已就绪，请输入个人 PIN 口令解锁 API Key 后继续生成研判。');
        return;
      }

      if (!resolvedProvider) {
        setQaNoKeyMode(true);
        setQaStageText('');
        setQaRunning(false);
        return;
      }

      setQaStageText(
        `第 3/3 步：已载入 ${localLaws.length} 条现行法典 + ${extractedList.length} 篇案例库原文，正由您的 ${resolvedProvider.name.split('（')[0]} 生成带出处研判…`
      );

      const contextBlocks: string[] = [];
      if (localLaws.length > 0) {
        contextBlocks.push(
          '【一、本箱离线权威法典原文】\n' +
            localLaws
              .map(
                (l, i) =>
                  `[法条${i + 1}] 《${l.fullLawTitle}》${l.articleLabel}：\n${l.text}`
              )
              .join('\n\n')
        );
      }

      if (extractedList.length > 0) {
        contextBlocks.push(
          '【二、公开 IMA《法律法规案例库》实时抽取原文】\n' +
            extractedList
              .map(
                (d, i) =>
                  `[文献${i + 1}] 标题：《${d.item.title}》（${d.pageCount} 页，节选 ${d.charCount} 字）\n正文节选：\n${d.text.slice(0, 6000)}`
              )
              .join('\n\n---\n\n')
        );
      }

      const systemPrompt = [
        '你是一位严谨的中国资深诉讼与商事法律研究顾问。',
        '你的任务是【严格基于下方检索召回的权威法条与《法律法规案例库》真实原文】回答律师的办案提问。',
        '必须严格遵守以下专业红线：',
        '1. 输出结构固定为三部分：「一、核心实务结论」「二、权威法条与案例库依据（须逐条写明 [法条X] / [文献X] 及完整名称）」「三、办案操作与庭审/谈判要点」。',
        '2. 凡引用条文或案例裁判规则，必须来自下方提供的真实材料；严禁凭空编造未出现在材料中的案号、司法解释文号或不存在的条款。',
        '3. 如果下方检索材料未覆盖提问的某个细分细节，必须在结论中明确写明「本轮检索文献未直接覆盖该细分点，建议点击上方直达 IMA 官方知识库或在北大法宝进一步核验」，绝不糊弄编造。',
        '4. 语言克制、精准、直接给律师能落地的裁判口径与证据清单，避免空话套话。',
      ].join('\n');

      const userPrompt =
        `【律师提问】\n${q}\n\n` +
        (contextBlocks.length > 0
          ? `${contextBlocks.join('\n\n==================\n\n')}\n\n请基于以上真实文献原文给出带出处的实务研判。`
          : '（本轮按关键词在标题库中暂未命中直接原文，请先给出通用现行法框架思路，并醒目提醒律师在腾讯 IMA 官方知识库或北大法宝复核最新原文与案例。）');

      const result = await streamAiCompletion({
        provider: resolvedProvider,
        modelSlot: byok.defaultModelSlot || 'fast',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        signal: controller.signal,
        onChunk: (delta) => {
          setQaAnswer((prev) => prev + delta);
        },
      });

      setQaUsedModel(result.usedModel);
      setQaStageText('');
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setQaStageText('已手动停止生成');
      } else {
        setQaError(err instanceof Error ? err.message : '知识库 AI 问答执行失败');
        setQaStageText('');
      }
    } finally {
      setQaRunning(false);
    }
  };

  const openOfficialImaWithQuestion = async (url: string, textToCopy?: string) => {
    if (textToCopy?.trim()) {
      await copyToClipboard(textToCopy.trim());
      showToast('已复制您的提问到剪贴板，进入 IMA 后直接粘贴即可免费问答');
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const filteredPreviewLines = useMemo(() => {
    if (!previewDoc?.text) return '';
    const kw = inDocFilter.trim();
    if (!kw) return previewDoc.text;
    const matched = previewDoc.text
      .split('\n')
      .filter((line) => line.toLowerCase().includes(kw.toLowerCase()));
    return matched.length > 0
      ? matched.join('\n')
      : `（正文中未匹配到“${kw}”，可清空筛选查看完整全文）`;
  }, [previewDoc, inDocFilter]);

  if (!isOnline) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-center space-y-3">
        <WifiOff className="mx-auto h-8 w-8 text-amber-700" />
        <h3 className="font-display text-base font-bold text-amber-950">
          当前处于断网离线模式，无法连接腾讯 IMA 云端案例库
        </h3>
        <p className="text-xs text-amber-900 max-w-md mx-auto leading-5">
          联网后即可对 4.48 万份《法律法规案例库（持续更新）》进行带出处 AI 问答与 PDF 原文直读。断网期间请使用旁侧已缓存的 4,111 条离线核心法规库。
        </p>
        <button
          type="button"
          onClick={onSwitchToOffline}
          className="rounded-md bg-[#0E223D] px-4 py-2 text-xs font-bold text-white"
        >
          切换至离线核心法规库（4,111条）→
        </button>
      </div>
    );
  }

  const lawShareUrl = lawCasesMeta?.shareUrl || IMA_LAW_CASES_SHARE_URL;
  const sampleQuestions =
    lawCasesMeta?.recommendedQuestions && lawCasesMeta.recommendedQuestions.length > 0
      ? [...DEFAULT_SAMPLE_QUESTIONS.slice(0, 2), ...lawCasesMeta.recommendedQuestions.slice(0, 2)]
      : DEFAULT_SAMPLE_QUESTIONS;

  return (
    <div className="space-y-4">
      {/* Top Hero: Primary Readable Cloud Library + Direct Official IMA Jump Links */}
      <div className="rounded-xl bg-[#0E223D] text-[#F6F4EF] border border-[#1A3761] p-4 sm:p-5 shadow-sm space-y-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#B89254]/20 border border-[#D1B27A]/40 px-2.5 py-0.5 text-[11px] font-semibold text-[#D1B27A]">
                <Cloud className="h-3 w-3" /> 开源作者维护公开库（lawyer朱思浩）· 持续更新
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-num text-[11px] font-bold text-emerald-300">
                {lawCasesMeta?.contentCount
                  ? `${Number(lawCasesMeta.contentCount).toLocaleString('zh-CN')} 份权威文献`
                  : '44,800+ 份权威文献'}
              </span>
            </div>
            <h2 className="mt-2 font-display text-lg sm:text-xl font-bold text-white">
              {SITE_CONFIG.publicImaLibraryName} · AI 查库与原件直读
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              收录人民法院案例库参考案例、2026 最新法律/司法解释、法答网精选、各省高院指导文件、规章及国标。可<strong>一键直达腾讯 IMA 官方端享受全库免费不限次语义问答</strong>，在服务端配置个人 IMA OpenAPI 后还可解锁本箱内 PDF 原文直读与双库联查。
            </p>
          </div>
        </div>

        {/* Direct Official Jump Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/12">
          <button
            type="button"
            onClick={() => openOfficialImaWithQuestion(lawShareUrl, qaInput)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#B89254] hover:bg-[#C9A467] px-3.5 py-2 text-xs font-bold text-[#11151C] shadow-xs transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            去腾讯 IMA 打开本库（免费无限语义问答）
          </button>

          <button
            type="button"
            onClick={async () => {
              await copyToClipboard('国家法律知识库');
              showToast('已复制「国家法律知识库」，前往 IMA 客户端/网页版粘贴搜索即可查阅 39.6 万条全文');
              window.open(nationalMeta?.shareUrl || 'https://ima.qq.com/', '_blank', 'noopener,noreferrer');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 hover:bg-white/18 px-3 py-2 text-xs font-semibold text-white transition-colors"
          >
            <BookOpen className="h-3.5 w-3.5 text-[#D1B27A]" />
            国家法律知识库 (39.6万条 · IMA官方端)
            <ExternalLink className="h-3 w-3 text-slate-300" />
          </button>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300 sm:ml-auto">
            <a
              href="https://flk.npc.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 hover:text-[#D1B27A] underline underline-offset-2"
            >
              国家法律法规数据库 <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-slate-500">·</span>
            <a
              href="https://rmfyalk.court.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 hover:text-[#D1B27A] underline underline-offset-2"
            >
              人民法院案例库 <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        <div className="text-[11px] text-slate-400 leading-4">
          说明：外部第三方维护的《国家法律知识库》受腾讯接口权限限制（代码 220030），不支持第三方接口直读原文，因此已改为一键直达 IMA 官方端查阅；本箱内直读与 AI 问答专注服务您 100% 可调原件的 4.48 万份《法律法规案例库》+ 本地 4,111 条离线法典。
        </div>
      </div>

      {/* Mode Switcher: Built-in Citation AI Q&A | Exact File Search & Folder Browser */}
      <div className="grid grid-cols-2 rounded-xl border border-[#DED8CC] bg-white p-1 gap-1">
        <button
          type="button"
          onClick={() => setPanelMode('qa')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 px-2 text-xs sm:text-sm font-bold transition-colors ${
            panelMode === 'qa'
              ? 'bg-[#0E223D] text-[#F6F4EF]'
              : 'text-slate-600 hover:text-[#11151C]'
          }`}
        >
          <Sparkles className="h-4 w-4 text-[#D1B27A] flex-none" />
          <span>知识库 AI 问答（带真实出处）</span>
        </button>
        <button
          type="button"
          onClick={() => setPanelMode('files')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 px-2 text-xs sm:text-sm font-bold transition-colors ${
            panelMode === 'files'
              ? 'bg-[#0E223D] text-[#F6F4EF]'
              : 'text-slate-600 hover:text-[#11151C]'
          }`}
        >
          <FolderOpen className="h-4 w-4 text-[#D1B27A] flex-none" />
          <span>搜文件 / 浏览 4.48 万份目录</span>
        </button>
      </div>

      {/* ===================== MODE 1: BUILT-IN RAG AI Q&A ===================== */}
      {panelMode === 'qa' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs sm:text-sm font-bold text-[#11151C] flex items-center gap-1.5">
                <MessageSquareText className="h-4 w-4 text-[#B89254]" />
                直接问一个办案法律问题（先查库抽 PDF 原文，再由个人大模型带出处作答）
              </div>
              <span className="text-[11px] text-slate-500">
                {hasAnyKey
                  ? `已就绪：${activeProvider.name.split('（')[0]}`
                  : '未配 Key 也可先免费查库抽原文'}
              </span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                runKnowledgeQa();
              }}
              className="space-y-2.5"
            >
              <textarea
                rows={2}
                value={qaInput}
                onChange={(e) => setQaInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    runKnowledgeQa();
                  }
                }}
                placeholder="输入具体案情问题或争议焦点（如：股东未届出资期限转让股权，原股东是否承担补充责任？ / 买卖合同未约定违约金逾期利息怎么算？）…"
                className="w-full rounded-lg border border-[#D8D1C3] bg-[#FAF9F6] p-3 text-xs sm:text-sm text-[#11151C] focus:border-[#0E223D] focus:bg-white focus:outline-none"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={qaRunning}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#163257] px-4 py-2 text-xs sm:text-sm font-bold text-[#F6F4EF] disabled:opacity-60"
                  >
                    {qaRunning ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[#D1B27A]" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-[#D1B27A]" />
                    )}
                    {qaRunning ? '查库研判中…' : '查库并 AI 带出处作答'}
                  </button>

                  {qaRunning && (
                    <button
                      type="button"
                      onClick={() => abortRef.current?.abort()}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
                    >
                      <Square className="h-3 w-3 fill-current" /> 停止
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => openOfficialImaWithQuestion(lawShareUrl, qaInput)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#D8D1C3] bg-[#FAF9F6] hover:border-[#B89254] px-3 py-2 text-xs font-semibold text-[#7A5922]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> 复制问题去 IMA 免费问
                  </button>
                </div>

                <span className="text-[11px] text-slate-400">快捷键 Ctrl/⌘ + Enter 发送</span>
              </div>
            </form>

            {/* Sample Lawyer Questions */}
            <div className="pt-2 border-t border-[#EFECE5] space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-500">律师高频实务提问示例（点击即查）：</div>
              <div className="flex flex-wrap gap-1.5">
                {sampleQuestions.map((sq) => (
                  <button
                    key={sq}
                    type="button"
                    disabled={qaRunning}
                    onClick={() => runKnowledgeQa(sq)}
                    className="rounded-md bg-[#F6F4EF] border border-[#E5DEC9] hover:border-[#B89254] px-2.5 py-1 text-left text-[11px] font-medium text-[#14181F] transition-colors"
                  >
                    {sq}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Inline PIN Unlock Prompt if user's BYOK key is PIN-encrypted */}
          {pinPromptOpen && (
            <div className="rounded-xl border border-[#B89254] bg-[#FDF9F0] p-4 flex flex-wrap items-center gap-3">
              <Lock className="h-4 w-4 text-[#9A773E] flex-none" />
              <div className="text-xs text-[#11151C] flex-1 min-w-[180px]">
                您的个人 API Key 已受 PIN 口令加密保护，请输入口令解锁后继续生成 AI 研判：
                {pinError && <span className="ml-2 text-red-600 font-semibold">{pinError}</span>}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && pinInput.trim()) {
                      setPinPromptOpen(false);
                      runKnowledgeQa(qaInput, pinInput.trim());
                    }
                  }}
                  placeholder="输入 PIN 口令"
                  className="w-32 rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!pinInput.trim()) return;
                    setPinPromptOpen(false);
                    runKnowledgeQa(qaInput, pinInput.trim());
                  }}
                  className="rounded bg-[#0E223D] px-3 py-1.5 text-xs font-bold text-white"
                >
                  解锁并作答
                </button>
              </div>
            </div>
          )}

          {/* Live Stage Progress */}
          {qaStageText && (
            <div className="rounded-xl border border-[#0E223D]/20 bg-[#F4F7FB] px-4 py-3 flex items-center gap-2.5 text-xs font-medium text-[#0E223D]">
              {qaRunning && <Loader2 className="h-4 w-4 animate-spin flex-none text-[#B89254]" />}
              <span>{qaStageText}</span>
            </div>
          )}

          {qaError && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 flex-none mt-0.5 text-red-700" />
              <div>
                <div className="font-bold">AI 问答未完成：{qaError}</div>
                <div className="mt-1 text-red-800">
                  下方已保留本轮从知识库召回的权威法条与 PDF 原件，您仍可直接点击查阅，或点击上方「复制问题去 IMA 免费问」。
                </div>
              </div>
            </div>
          )}

          {/* Friendly No-Key Bridge Banner (Still displays retrieved laws & PDFs below!) */}
          {qaNoKeyMode && (
            <div className="rounded-xl border border-[#B89254]/50 bg-[#FDF9F0] p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs sm:text-sm font-bold text-[#7A5922]">
                  已为您从双库精准检索出 {qaMatchedLaws.length} 条现行法条 + {qaMatchedFiles.length} 份权威案例/法规文献！
                </div>
              </div>
              <p className="text-xs text-slate-700 leading-5">
                您尚未在本设备填写个人大模型 API Key，因此仅展示检索到的原始法条与可点击阅读的 PDF 文献。如需 AI 自动阅读并提炼综合意见，您可二选一：
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigateTab('settings')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] px-3.5 py-2 text-xs font-bold text-white"
                >
                  <KeyRound className="h-3.5 w-3.5 text-[#D1B27A]" /> 1 分钟去配个人 API Key
                </button>
                <button
                  type="button"
                  onClick={() => openOfficialImaWithQuestion(lawShareUrl, qaInput)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#B89254] px-3.5 py-2 text-xs font-bold text-[#11151C]"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> 复制问题 → 去腾讯 IMA 官方端免费问答
                </button>
              </div>
            </div>
          )}

          {/* Streaming AI Citation-Backed Legal Analysis */}
          {qaAnswer && (
            <div className="rounded-xl border-2 border-[#0E223D] bg-white shadow-sm overflow-hidden">
              <div className="bg-[#0E223D] px-4 py-3 text-[#F6F4EF] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#D1B27A]">
                    法规案例库 · 带出处实务研判
                    {qaUsedModel ? ` · ${qaUsedModel}` : ''}
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    已参考 {qaMatchedLaws.length} 条离线法典 + {qaExtractedDocs.length} 篇云端 PDF/Word 真实原文
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyToClipboard(qaAnswer);
                      if (ok) {
                        setQaCopied(true);
                        showToast('已复制带出处研判结论');
                        setTimeout(() => setQaCopied(false), 1800);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded bg-white/15 hover:bg-white/25 px-2.5 py-1.5 text-xs font-semibold text-white"
                  >
                    {qaCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    复制
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadMarkdownReportDocx(
                        {
                          title: '法律检索与案例库研判备忘录',
                          subtitle: `检索问题：${qaInput.slice(0, 60)}`,
                          markdownBody: qaAnswer,
                        },
                        `法规案例库研判_${qaInput.slice(0, 16)}.docx`
                      );
                      showToast('已导出可编辑 Word (.docx)');
                    }}
                    className="inline-flex items-center gap-1 rounded bg-white/15 hover:bg-white/25 px-2.5 py-1.5 text-xs font-semibold text-white"
                  >
                    <Download className="h-3.5 w-3.5" /> 导出 Word
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      sendToAi(
                        'legal-sandbox',
                        `知识库追问：${qaInput.slice(0, 18)}`,
                        `此前针对问题「${qaInput}」在法规案例库已得出如下初步研判，请结合我的具体案情进一步深入推演诉讼策略与举证方案：\n\n${qaAnswer}`
                      )
                    }
                    className="inline-flex items-center gap-1 rounded bg-[#B89254] px-2.5 py-1.5 text-xs font-bold text-[#11151C]"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> 进 AI 智囊深聊
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-5 whitespace-pre-wrap text-xs sm:text-[14px] leading-7 text-[#14181F]">
                {qaAnswer}
              </div>
              <div className="border-t border-[#EFECE5] bg-[#FAF7F0] px-4 py-2 text-[11px] text-[#7A5922]">
                {AI_LEGAL_DISCLAIMER}
              </div>
            </div>
          )}

          {/* Cited & Retrieved Source Cards (Click Any to Read Full Clean Text or Download PDF) */}
          {(qaExtractedDocs.length > 0 || qaMatchedFiles.length > 0 || qaMatchedLaws.length > 0) && (
            <div className="rounded-xl border border-[#DED8CC] bg-white p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-2">
                <div className="text-xs sm:text-sm font-bold text-[#0E223D]">
                  本次溯源参考的权威文献与现行法条（点击即验原文）
                </div>
                {qaUsedTerms.length > 0 && (
                  <div className="text-[11px] text-slate-500">
                    检索关键词：{qaUsedTerms.map((t) => `「${t}」`).join(' ')}
                  </div>
                )}
              </div>

              {/* Cloud IMA Docs */}
              {qaMatchedFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-[#7A5922]">
                    一、《法律法规案例库（持续更新）》命中原件（优先展示中国法规、司法解释、案例库参考案例与法答网）：
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {qaMatchedFiles.slice(0, 8).map((item) => {
                      const extractedIdx = qaExtractedDocs.findIndex(
                        (d) => d.item.itemKey === item.itemKey
                      );
                      const isFedToAi = extractedIdx >= 0;
                      return (
                        <button
                          key={item.itemKey}
                          type="button"
                          onClick={() => handleOpenItem(item)}
                          className={`rounded-lg border p-3 text-left transition-all hover:border-[#0E223D] ${
                            isFedToAi
                              ? 'border-[#B89254] bg-[#FDFBF6]'
                              : 'border-[#EAE5DA] bg-[#FAF9F6]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <FileText
                                className={`h-4 w-4 flex-none mt-0.5 ${
                                  item.kind === 'pdf' ? 'text-red-700' : 'text-[#0E223D]'
                                }`}
                              />
                              <span className="text-xs font-bold text-[#11151C] leading-5 break-all">
                                {item.title}
                              </span>
                            </div>
                            {isFedToAi && (
                              <span className="flex-none rounded bg-[#0E223D] px-1.5 py-0.5 text-[10px] font-bold text-[#D1B27A]">
                                文献{extractedIdx + 1} · 已读
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 text-[11px] text-slate-500 flex items-center justify-between">
                            <span>
                              {isFedToAi
                                ? `已提取 ${qaExtractedDocs[extractedIdx].pageCount} 页 / ${qaExtractedDocs[extractedIdx].fullCharCount.toLocaleString('zh-CN')} 字`
                                : '点击抽取纯净中文正文或阅读 PDF'}
                            </span>
                            <span className="font-semibold text-[#0E223D]">查原文 →</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Matched Local Offline Statutes */}
              {qaMatchedLaws.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#EFECE5]">
                  <div className="text-[11px] font-bold text-[#0E223D]">
                    二、本箱离线核心法典同步命中条文（4,111 条权威条文）：
                  </div>
                  <div className="space-y-1.5">
                    {qaMatchedLaws.map((law, idx) => (
                      <div
                        key={law.key}
                        className="rounded-lg border border-[#EAE5DA] bg-[#FAF9F6] p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#0E223D]">
                            [法条{idx + 1}] 《{law.fullLawTitle}》{law.articleLabel}
                            {law.summary ? ` 〔${law.summary}〕` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              await copyToClipboard(`《${law.fullLawTitle}》${law.articleLabel}：\n${law.text}`);
                              showToast(`已复制《${law.lawTitle}》${law.articleLabel}`);
                            }}
                            className="flex-none text-[11px] font-semibold text-[#7A5922] hover:underline"
                          >
                            复制条文
                          </button>
                        </div>
                        <p className="mt-1 text-slate-700 leading-5 line-clamp-3">{law.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================== MODE 2: SMART FILE SEARCH & BROWSER ===================== */}
      {panelMode === 'files' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPreviewItem(null);
                runFileSearch(fileQuery);
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                  placeholder="支持多词组合搜（如：买卖合同 违约金 / 股东出资 / 法答网 / 指导性案例）…"
                  className="w-full rounded-lg border border-[#D8D1C3] bg-[#FAF9F6] pl-10 pr-3 py-2.5 text-xs sm:text-sm text-[#11151C] focus:border-[#0E223D] focus:bg-white focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={loadingFiles}
                className="flex-none rounded-lg bg-[#0E223D] px-4 py-2.5 text-xs sm:text-sm font-bold text-[#F6F4EF]"
              >
                智能找文件
              </button>
              {fileViewMode === 'search' && (
                <button
                  type="button"
                  onClick={() => {
                    setFileQuery('');
                    setPreviewItem(null);
                    loadFolder('');
                  }}
                  className="flex-none rounded-lg border border-[#DED8CC] bg-[#FAF9F6] px-3 py-2.5 text-xs font-semibold text-slate-700"
                >
                  回根目录
                </button>
              )}
            </form>

            {/* Quick Topic Chips */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <span>高频直达：</span>
              {HOT_FILE_KEYWORDS.map((kw) => (
                <button
                  key={kw}
                  type="button"
                  onClick={() => {
                    setFileQuery(kw);
                    setPreviewItem(null);
                    runFileSearch(kw);
                  }}
                  className="rounded bg-[#F3ECE0] px-2 py-0.5 font-medium text-[#7A5922] hover:bg-[#E7DBC6]"
                >
                  {kw}
                </button>
              ))}
            </div>

            {fileViewMode === 'search' && usedSearchTerms.length > 0 && (
              <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
                <span>
                  已智能按 {usedSearchTerms.map((t) => `「${t}」`).join(' + ')} 联合检索，并优先置顶中国现行法规、司法解释、案例库与法答网
                </span>
                <button
                  type="button"
                  onClick={() => runKnowledgeQa(fileQuery)}
                  className="font-bold text-[#0E223D] underline"
                >
                  改用 AI 读原文总结 →
                </button>
              </div>
            )}

            {/* Folder Breadcrumbs */}
            {fileViewMode === 'browse' && breadcrumbs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 border-t border-[#EFECE5] pt-2.5 text-xs">
                <FolderOpen className="h-3.5 w-3.5 text-[#B89254] mr-1" />
                {breadcrumbs.map((bc, idx) => (
                  <React.Fragment key={`${bc.folderKey}-${idx}`}>
                    {idx > 0 && <ChevronRight className="h-3 w-3 text-slate-400" />}
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewItem(null);
                        loadFolder(bc.folderKey);
                      }}
                      className={`rounded px-1.5 py-0.5 hover:bg-[#F6F4EF] ${
                        idx === breadcrumbs.length - 1
                          ? 'font-bold text-[#0E223D]'
                          : 'text-slate-600'
                      }`}
                    >
                      {bc.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {fileError && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3.5 text-xs text-red-900">
              {fileError}
            </div>
          )}

          {/* Results / Folder Entries List */}
          <div className="rounded-xl border border-[#DED8CC] bg-white overflow-hidden">
            <div className="px-4 py-2.5 bg-[#FAF9F6] border-b border-[#EFECE5] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <span className="whitespace-nowrap font-medium">
                {fileViewMode === 'search'
                  ? `智能检索「${fileQuery}」返回 ${items.length} 份文献`
                  : `当前目录已加载 ${items.length} 项`}
              </span>
              <span className="text-[11px] text-slate-400">
                点击任意 PDF / Word 即刻抽取中文正文，手机微信零白屏
              </span>
            </div>

            {loadingFiles && items.length === 0 ? (
              <div className="py-14 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[#0E223D]" />
                正在实时连接《法律法规案例库》…
              </div>
            ) : items.length === 0 ? (
              <div className="py-12 px-4 text-center text-xs text-slate-500 space-y-2">
                <div>未匹配到对应标题文献，可尝试换用核心案由词（如“买卖合同”“股东出资”“法答网”），或直接去腾讯 IMA 官方端做全库全文语义检索。</div>
                <button
                  type="button"
                  onClick={() => openOfficialImaWithQuestion(lawShareUrl, fileQuery)}
                  className="inline-flex items-center gap-1 rounded-md bg-[#0E223D] px-3 py-1.5 text-xs font-bold text-white"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-[#D1B27A]" /> 去腾讯 IMA 全文语义检索
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[#EFECE5]">
                {items.map((item) => {
                  const isFolder = item.kind === 'folder';
                  return (
                    <button
                      key={item.itemKey}
                      type="button"
                      onClick={() => handleOpenItem(item)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#FAF8F3] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isFolder ? (
                          <Folder className="h-4 w-4 flex-none text-[#B89254] fill-[#F3ECE0]" />
                        ) : item.kind === 'pdf' ? (
                          <FileText className="h-4 w-4 flex-none text-red-700" />
                        ) : item.kind === 'word' ? (
                          <FileSpreadsheet className="h-4 w-4 flex-none text-blue-800" />
                        ) : (
                          <FileText className="h-4 w-4 flex-none text-[#0E223D]" />
                        )}

                        <div className="min-w-0">
                          <div className="text-xs sm:text-sm font-semibold text-[#11151C] break-all">
                            {item.title}
                          </div>
                          {item.highlight && (
                            <div className="mt-0.5 text-[11px] text-slate-500 line-clamp-1">
                              {item.highlight}
                            </div>
                          )}
                        </div>
                      </div>

                      <span className="flex-none inline-flex items-center gap-1 rounded border border-[#E4DFD4] bg-[#FAF9F6] px-2 py-0.5 text-[11px] font-medium text-[#0E223D]">
                        {isFolder ? (
                          <>
                            进入目录 <ChevronRight className="h-3 w-3" />
                          </>
                        ) : (
                          '读正文 / AI提炼'
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {!isEnd && nextCursor && (
              <div className="border-t border-[#EFECE5] p-3 text-center bg-[#FAF9F6]">
                <button
                  type="button"
                  disabled={loadingFiles}
                  onClick={() =>
                    fileViewMode === 'search'
                      ? runFileSearch(fileQuery, nextCursor)
                      : loadFolder(currentFolderKey, nextCursor)
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#0E223D] bg-white px-4 py-1.5 text-xs font-bold text-[#0E223D] hover:bg-[#0E223D] hover:text-white transition-colors"
                >
                  {loadingFiles && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  加载下一页更多文献
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== SHARED FULL-TEXT & PDF READER DRAWER ===================== */}
      {previewItem && (
        <div
          ref={previewCardRef}
          className="rounded-xl border-2 border-[#0E223D] bg-white shadow-lg overflow-hidden"
        >
          <div className="bg-[#0E223D] px-4 py-3 text-[#F6F4EF] flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider text-[#D1B27A]">
                IMA 权威原件在线调阅
                {previewDoc
                  ? ` · ${previewDoc.pageCount} 页 · ${previewDoc.fullCharCount.toLocaleString('zh-CN')} 字`
                  : ''}
              </div>
              <div className="font-display text-sm sm:text-base font-bold text-white break-all">
                {previewItem.title}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {previewDoc?.text && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyToClipboard(`【${previewItem.title}】\n${previewDoc.text}`);
                      if (!ok) {
                        showToast('复制受限，请长按正文手动复制');
                        return;
                      }
                      setCopiedDoc(true);
                      showToast('已复制提取正文');
                      setTimeout(() => setCopiedDoc(false), 1800);
                    }}
                    className="inline-flex items-center gap-1 rounded bg-white/15 hover:bg-white/25 px-2.5 py-1.5 text-xs font-semibold text-white"
                  >
                    {copiedDoc ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    复制正文
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      sendToAi(
                        'legal-sandbox',
                        previewItem.title,
                        `以下是从《法律法规案例库》调取的权威文献原文《${previewItem.title}》，请提炼其核心裁判规则/法条适用要件，并指出我方在诉讼中应如何援引或应对抗辩：\n\n${previewDoc.text.slice(0, 14000)}`
                      )
                    }
                    className="inline-flex items-center gap-1 rounded bg-[#B89254] px-2.5 py-1.5 text-xs font-bold text-[#11151C]"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> 送 AI 提炼裁判要旨
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => handleDownloadOriginal(previewItem)}
                className="inline-flex items-center gap-1 rounded border border-white/25 bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-xs font-semibold text-white"
              >
                <Download className="h-3.5 w-3.5" /> 下载原件
              </button>

              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white"
                title="关闭预览"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Sub-bar: Switch between Clean Text & Original PDF + Single-Doc Quick AI Actions */}
          <div className="px-4 py-2.5 bg-[#FAF9F6] border-b border-[#EFECE5] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPreviewView('text')}
                className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                  previewView === 'text'
                    ? 'bg-[#0E223D] text-white'
                    : 'border border-[#DED8CC] bg-white text-slate-600'
                }`}
              >
                纯净文字版（手机推荐）
              </button>
              {previewItem.kind === 'pdf' && (
                <>
                  <button
                    type="button"
                    onClick={() => setPreviewView('pdf')}
                    className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                      previewView === 'pdf'
                        ? 'bg-[#0E223D] text-white'
                        : 'border border-[#DED8CC] bg-white text-slate-600'
                    }`}
                  >
                    原版 PDF 排版
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenPdfNewTab(previewItem)}
                    className="inline-flex items-center gap-1 rounded-md border border-[#DED8CC] bg-white hover:border-[#0E223D] px-2.5 py-1 text-xs font-semibold text-[#0E223D]"
                  >
                    <ExternalLink className="h-3 w-3" /> 新窗全屏
                  </button>
                </>
              )}
            </div>

            {previewDoc?.text && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    sendToAi(
                      'legal-sandbox',
                      `类案检索摘要：${previewItem.title}`,
                      `请将以下权威文献/案例《${previewItem.title}》整理成可直接提交法庭的《类案检索报告摘要》（含基本案情、争议焦点、裁判要旨、与本案可比对要素）：\n\n${previewDoc.text.slice(0, 14000)}`
                    )
                  }
                  className="rounded border border-[#D8D1C3] bg-white hover:border-[#B89254] px-2 py-1 text-[11px] font-semibold text-[#7A5922]"
                >
                  生成类案检索摘要
                </button>
                <button
                  type="button"
                  onClick={() => {
                    downloadMarkdownReportDocx(
                      {
                        title: previewItem.title.replace(/\.[^.]+$/, ''),
                        subtitle: '来源：公开 IMA《法律法规案例库》正文提取版',
                        markdownBody: previewDoc.text,
                        includeAiDisclaimer: false,
                      },
                      `${previewItem.title.replace(/\.[^.]+$/, '')}_可编辑版.docx`
                    );
                    showToast('已转为可编辑 Word (.docx) 下载');
                  }}
                  className="rounded border border-[#D8D1C3] bg-white hover:border-[#0E223D] px-2 py-1 text-[11px] font-semibold text-[#0E223D]"
                >
                  转可编辑 Word
                </button>
              </div>
            )}
          </div>

          <div className="p-4 bg-[#FAF9F6]">
            {previewView === 'pdf' && previewItem.kind === 'pdf' ? (
              <div className="space-y-2">
                {pdfTicketLoading || !pdfTicketUrl ? (
                  <div className="py-12 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-[#0E223D]" />
                    正在签发 60 秒一次性 PDF 阅读凭据…
                  </div>
                ) : (
                  <iframe
                    title={previewItem.title}
                    src={pdfTicketUrl}
                    className="w-full h-[62vh] rounded border border-[#DED8CC] bg-white"
                  />
                )}
                <p className="text-[11px] text-slate-500 text-center">
                  微信或手机端如遇 PDF 缩放不便，可切换上方「纯净文字版」流畅阅读，或点「下载原件」。
                </p>
              </div>
            ) : previewLoading ? (
              <div className="py-12 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[#0E223D]" />
                正在从《法律法规案例库》拉取并提取纯净中文正文…
              </div>
            ) : previewError ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 space-y-2">
                <div className="font-bold">{previewError}</div>
                <div className="flex flex-wrap gap-2">
                  {previewItem.kind === 'pdf' && (
                    <button
                      type="button"
                      onClick={() => setPreviewView('pdf')}
                      className="rounded bg-[#0E223D] px-3 py-1.5 text-xs font-bold text-white"
                    >
                      查看原版 PDF
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDownloadOriginal(previewItem)}
                    className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950"
                  >
                    下载原件
                  </button>
                </div>
              </div>
            ) : previewDoc?.isScannedPdf ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 space-y-2">
                <div className="font-bold">该 PDF 为纯扫描影印件，无可复制文字层</div>
                <p>请点击上方「原版 PDF 排版」直接翻阅影印原件，或点击「下载原件」保存后送入 AI 智囊识图。</p>
              </div>
            ) : previewDoc?.legacyDoc ? (
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-700">
                {previewDoc.notice}
              </div>
            ) : (
              <div className="space-y-2.5">
                {previewDoc?.text && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="search"
                        value={inDocFilter}
                        onChange={(e) => setInDocFilter(e.target.value)}
                        placeholder="在本文内快速筛选段落关键词（如：裁判要旨、违约金、本院认为）…"
                        className="w-full rounded-md border border-[#D8D1C3] bg-white pl-8 pr-3 py-1.5 text-xs focus:border-[#0E223D] focus:outline-none"
                      />
                    </div>
                    {previewDoc.truncated && (
                      <span className="text-[11px] text-amber-800">
                        正文较长（共 {previewDoc.fullCharCount.toLocaleString('zh-CN')} 字），在线预览前{' '}
                        {previewDoc.charCount.toLocaleString('zh-CN')} 字，完整版请点「下载原件」
                      </span>
                    )}
                  </div>
                )}

                <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap font-sans text-xs sm:text-sm leading-7 text-[#14181F] bg-white p-4 rounded border border-[#EAE5DA]">
                  {filteredPreviewLines || '请点击上方「下载原件」查看该文件。'}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
