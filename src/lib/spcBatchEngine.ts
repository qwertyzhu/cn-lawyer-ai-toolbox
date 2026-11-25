/**
 * Pure local batch conversion engine for Supreme People's Court《法〔2025〕82号》element-style pleadings.
 *
 * Design guarantees:
 * 1. Per-case isolated redaction: every complaint runs its own fresh redaction map so entities
 *    from Case A can NEVER leak or cross-contaminate Case B.
 * 2. Local-only persistence: batch queue & generated drafts are saved strictly in local IndexedDB
 *    (with graceful localStorage fallback) and are NEVER uploaded to any sync server.
 * 3. Crash / reload resume: any item left in 'running' state after a page reload automatically
 *    resets to 'pending' while preserving all completed drafts.
 */

import { AI_LEGAL_DISCLAIMER } from '../data/legalDataManifest.ts';
import { streamAiCompletion, type ChatTurn } from './aiClient.ts';
import { buildOfficialSpcDocxBytes, type GenericZipEntry } from './docxBuilder.ts';
import { redactLegalText, restoreRedactedText } from './redactor.ts';
import {
  applySpcAiPatch,
  buildResolvedSpcDocument,
  createInitialSpcDraft,
  type OfficialSpcDraftState,
  type OfficialSpcTemplate,
  type SpcAiPatchPayload,
  type SpcTemplateCorpus,
} from './spcOfficialTemplates.ts';
import type { AiProviderConfig, RedactionMapping } from '../types/toolbox';

export type SpcBatchItemStatus = 'pending' | 'running' | 'done' | 'error';

export interface SpcBatchItem {
  id: string;
  sourceFilename: string;
  caseLabel: string;
  sourceText: string;
  templateId: string;
  templateName: string;
  status: SpcBatchItemStatus;
  error?: string;
  progressNote?: string;
  draft?: OfficialSpcDraftState;
  courtName?: string;
  changedCount?: number;
  redactedEntityCount?: number;
  missingChecklist?: string[];
  summary?: string;
  updatedAt: number;
}

export interface SpcBatchQueueState {
  templateId: string;
  sharedInstruction: string;
  autoRedact: boolean;
  modelSlot: 'fast' | 'reasoning';
  concurrency: 1 | 2 | 3;
  items: SpcBatchItem[];
  updatedAt: number;
}

export const SPC_BATCH_MAX_FILES = 50;
const IDB_NAME = 'cn_lawyer_spc_batch_db_v1';
const IDB_STORE = 'queue';
const IDB_KEY = 'current';
const LS_FALLBACK_KEY = 'cn_lawyer_spc_batch_queue_fallback_v1';

export function deriveBatchCaseLabel(filename: string): string {
  const stripped = String(filename || '未命名诉状')
    .replace(/\.[^.]+$/, '')
    .trim();
  return stripped || '未命名诉状';
}

export function sanitizeZipSegment(name: string): string {
  return String(name || '未命名')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '未命名';
}

export function extractFirstJsonObjectFromReply(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1)) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

export function restoreDeepRedactedStrings<T>(value: T, mappings: RedactionMapping[]): T {
  if (!mappings.length) return value;
  if (typeof value === 'string') {
    return restoreRedactedText(value, mappings) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => restoreDeepRedactedStrings(item, mappings)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = restoreDeepRedactedStrings(v, mappings);
    }
    return out as T;
  }
  return value;
}

export function buildSpcExtractionPromptPayload(
  tpl: OfficialSpcTemplate,
  promptMaterial: string,
  options?: { sharedInstruction?: string; hasImages?: boolean }
): { systemPrompt: string; userContent: string; editableRowCount: number } {
  const editableRowSpecs = tpl.rows
    .filter((r) => r.kind === 'field' || r.kind === 'full_input' || r.kind === 'grid')
    .map((r) => {
      if (r.kind === 'grid' && r.cells) {
        return { id: r.id, kind: 'grid', cells: r.cells };
      }
      return {
        id: r.id,
        kind: r.kind,
        label: (r.label || '').replace(/\n/g, ''),
        officialTemplate: r.templateText || '',
      };
    });

  const extraRule = options?.sharedInstruction?.trim()
    ? `\n6. **律师本批统一补充要求**：${options.sharedInstruction.trim()}`
    : '';

  const systemPrompt = `你是中国资深诉讼律师助手，专责将律师提供的传统诉状、答辩状、裁判文书或案件材料，严格按照最高人民法院《法〔2025〕82号》官方示范文本《${tpl.displayName}》的原始表格结构**全量逐行**填充为 JSON，绝不遗漏原文已写明的任何当事人、电话、住所、金额、日期、作品/标的、诉讼请求、权利种类、侵权方式、事实理由、受案法院与具状人。
铁律（必须严格遵守）：
1. **逐行通扫防遗漏**：你必须逐条对照下方全部 ${editableRowSpecs.length} 行（尤其是长勾选项如“权利种类”“侵权行为方式”“赔偿经济损失”“合理费用”“是否主张诉讼费用”“发生时间地点”），只要原文有提及，就必须填入对应行并把命中的“□”改为“☑”，未命中的保持“□”！
2. **保留官方前缀与换行**：必须完整保留每个栏目官方原文中的提示前缀、换行和选项结构（如“名称：”“住所地：”“法定代表人：”“联系电话：”“经济损失  元”“是□ 否□”），只把提取到的事实填入对应空白处。
3. **严禁编造**：材料中未出现的统一社会信用代码、身份证号、版权登记号、具体网址、金额或日期，严禁脑补；把材料未提供但该官方表需要的重要缺口写入 "missingChecklist" 数组提醒律师人工补填。
4. **保留脱敏占位符**：若材料含 [公司主体A]、[当事人甲]、[手机号1] 等脱敏占位符，必须原样保留在输出值中以便本机自动还原。
5. 只输出一个合法 JSON 对象，格式如下：
{
  "rowValues": {
    "行id（如 r03）": "保留官方原行文字并填好内容、勾选☑后的完整单元格文本"
  },
  "gridValues": {
    "仅多列行id（如 r01 案号/案由）": ["案号", "具体案号", "案由", "具体案由"]
  },
  "signerName": "从“具状人/答辩人/申请人”提取的名称（无则留空）",
  "signDate": "原文若明确写明日期则填，否则留空",
  "courtName": "从“此致/此呈 XX人民法院”提取的受案法院名称（无则留空）",
  "summary": "一句话概述本次已自动填入的核心栏目",
  "missingChecklist": ["原诉状未提及、建议律师补充核实的要素1", "要素2"]
}${extraRule}

以下是当前最高法官方示范文本《${tpl.displayName}》的全部 ${editableRowSpecs.length} 行结构：
${JSON.stringify(editableRowSpecs)}`;

  const userContent = promptMaterial
    ? `请逐行通扫并严格对照最高法官方《${tpl.displayName}》全部栏目，无遗漏提取以下材料并输出 JSON：\n\n${promptMaterial}`
    : options?.hasImages
    ? `请识别所附材料图片，逐行通扫并严格对照最高法官方《${tpl.displayName}》全部栏目提取并输出 JSON。`
    : `请对照最高法官方《${tpl.displayName}》输出结构化 JSON。`;

  return { systemPrompt, userContent, editableRowCount: editableRowSpecs.length };
}

export type BatchCompletionFn = (args: {
  provider: AiProviderConfig;
  modelSlot: 'fast' | 'reasoning';
  messages: ChatTurn[];
  temperature?: number;
  signal?: AbortSignal;
  onChunk?: (delta: string) => void;
}) => Promise<{ content: string }>;

export interface RunSpcBatchOptions {
  items: SpcBatchItem[];
  targetIds?: string[];
  tpl: OfficialSpcTemplate;
  provider: AiProviderConfig;
  modelSlot: 'fast' | 'reasoning';
  autoRedact: boolean;
  sharedInstruction?: string;
  concurrency?: 1 | 2 | 3;
  signal?: AbortSignal;
  completeFn?: BatchCompletionFn;
  onItemUpdate: (itemId: string, patch: Partial<SpcBatchItem>) => void;
}

export interface RunSpcBatchSummary {
  totalTargeted: number;
  succeeded: number;
  failed: number;
  aborted: boolean;
}

/**
 * Processes selected items in parallel (bounded concurrency 1-3) with strictly isolated
 * per-case redaction maps so Case A entities can never leak into Case B.
 */
export async function runSpcBatchQueue(options: RunSpcBatchOptions): Promise<RunSpcBatchSummary> {
  const {
    items,
    targetIds,
    tpl,
    provider,
    modelSlot,
    autoRedact,
    sharedInstruction,
    concurrency = 2,
    signal,
    completeFn = (args) =>
      streamAiCompletion({
        ...args,
        onChunk: (delta) => args.onChunk?.(delta),
      }),
    onItemUpdate,
  } = options;

  const targetSet = targetIds ? new Set(targetIds) : null;
  const queue = items.filter((item) =>
    targetSet ? targetSet.has(item.id) : item.status === 'pending' || item.status === 'error'
  );

  let cursor = 0;
  let succeeded = 0;
  let failed = 0;
  let aborted = false;

  const workerCount = Math.max(1, Math.min(3, concurrency, queue.length || 1));

  const processOne = async (item: SpcBatchItem): Promise<void> => {
    if (signal?.aborted) {
      aborted = true;
      return;
    }

    const cleanSource = item.sourceText.trim();
    if (!cleanSource) {
      failed++;
      onItemUpdate(item.id, {
        status: 'error',
        error: '该文件未提取到有效文本内容（若为纯图片扫描件，请先 OCR 转为文字或使用单案识图模式）。',
        progressNote: '',
        updatedAt: Date.now(),
      });
      return;
    }

    onItemUpdate(item.id, {
      status: 'running',
      error: '',
      progressNote: '正在本机脱敏并提取要素…',
      templateId: tpl.id,
      templateName: tpl.displayName,
      updatedAt: Date.now(),
    });

    // Strict per-case isolated redaction: NEVER share mappings across cases
    let mappings: RedactionMapping[] = [];
    let promptMaterial = cleanSource;
    if (autoRedact) {
      const red = redactLegalText(cleanSource, { existingMappings: [] });
      promptMaterial = red.redactedText;
      mappings = red.mappings;
    }

    const { systemPrompt, userContent } = buildSpcExtractionPromptPayload(tpl, promptMaterial, {
      sharedInstruction,
    });

    let receivedChars = 0;
    let lastProgressAt = 0;
    try {
      const res = await completeFn({
        provider,
        modelSlot,
        temperature: 0.1,
        signal,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        onChunk: (delta) => {
          receivedChars += delta.length;
          const now = Date.now();
          if (now - lastProgressAt > 250) {
            lastProgressAt = now;
            onItemUpdate(item.id, {
              progressNote: `正在逐行填充官方表…（已接收 ${receivedChars} 字）`,
            });
          }
        },
      });

      const parsed = extractFirstJsonObjectFromReply(res.content);
      if (!parsed) {
        throw new Error('模型返回内容未能解析为标准 JSON，可单独点击重试或切换「深度推理」模型。');
      }

      const restored = restoreDeepRedactedStrings(parsed, mappings) as SpcAiPatchPayload;
      const baseDraft = createInitialSpcDraft(tpl);
      const applied = applySpcAiPatch(tpl, baseDraft, restored);
      const missingList = Array.isArray(restored.missingChecklist)
        ? restored.missingChecklist.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      const summaryText =
        (typeof restored.summary === 'string' && restored.summary.trim()) ||
        `已填充 ${applied.changedLabels.length} 项官方要素`;

      succeeded++;
      onItemUpdate(item.id, {
        status: 'done',
        error: '',
        progressNote: '',
        templateId: tpl.id,
        templateName: tpl.displayName,
        draft: applied.nextDraft,
        courtName: typeof restored.courtName === 'string' ? restored.courtName.trim() : '',
        changedCount: applied.changedLabels.length,
        redactedEntityCount: mappings.length,
        missingChecklist: missingList,
        summary: summaryText,
        updatedAt: Date.now(),
      });
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        aborted = true;
        onItemUpdate(item.id, {
          status: 'pending',
          error: '',
          progressNote: '已手动暂停，可随时点击继续续跑',
          updatedAt: Date.now(),
        });
        return;
      }
      failed++;
      onItemUpdate(item.id, {
        status: 'error',
        error: err instanceof Error ? err.message : '批量提取失败',
        progressNote: '',
        updatedAt: Date.now(),
      });
    }
  };

  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < queue.length && !signal?.aborted) {
      const idx = cursor++;
      const item = queue[idx];
      if (!item) break;
      await processOne(item);
    }
  });

  await Promise.all(workers);
  return {
    totalTargeted: queue.length,
    succeeded,
    failed,
    aborted: aborted || Boolean(signal?.aborted),
  };
}

/**
 * Builds all completed official .docx bytes + a UTF-8 BOM checklist report ready for single-click ZIP download.
 */
export function buildSpcBatchZipEntries(
  corpus: SpcTemplateCorpus,
  items: SpcBatchItem[],
  nowDate = new Date()
): { entries: GenericZipEntry[]; exportedCount: number; skippedCount: number } {
  const entries: GenericZipEntry[] = [];
  const reportLines: string[] = [];
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const stamp = `${nowDate.getFullYear()}-${pad2(nowDate.getMonth() + 1)}-${pad2(nowDate.getDate())} ${pad2(nowDate.getHours())}:${pad2(nowDate.getMinutes())}`;

  let exportedCount = 0;
  let skippedCount = 0;

  reportLines.push('============================================================');
  reportLines.push('要素式起诉状 / 答辩状批量生成核对清单');
  reportLines.push(`生成时间：${stamp}`);
  reportLines.push(`队列总数：${items.length} 份`);
  reportLines.push('============================================================');
  reportLines.push('');

  items.forEach((item, index) => {
    const seq = pad2(index + 1);
    if (item.status !== 'done' || !item.draft) {
      skippedCount++;
      reportLines.push(
        `[${seq}] 未导出｜原文件：${item.sourceFilename}｜状态：${
          item.status === 'error' ? `失败（${item.error || '未知错误'}）` : '待处理'
        }`
      );
      reportLines.push('');
      return;
    }

    const tpl =
      corpus.templates.find((t) => t.id === item.draft?.templateId) ||
      corpus.templates.find((t) => t.id === item.templateId);
    if (!tpl) {
      skippedCount++;
      reportLines.push(`[${seq}] 未导出｜原文件：${item.sourceFilename}｜原因：未找到对应示范文本模板`);
      reportLines.push('');
      return;
    }

    const resolved = buildResolvedSpcDocument(tpl, item.draft);
    const docxBytes = buildOfficialSpcDocxBytes(resolved);
    const safeBase = sanitizeZipSegment(item.caseLabel || deriveBatchCaseLabel(item.sourceFilename));
    const outName = `${seq}_${safeBase}_要素式.docx`;
    entries.push({ name: outName, data: docxBytes });
    exportedCount++;

    reportLines.push(`[${seq}] 已生成｜导出文件：${outName}`);
    reportLines.push(`     原文件：${item.sourceFilename}`);
    reportLines.push(`     采用示范文本：${tpl.displayName}`);
    if (item.courtName) reportLines.push(`     识别受案法院：${item.courtName}`);
    reportLines.push(
      `     填充情况：已自动填充 ${item.changedCount ?? 0} 项要素${
        item.redactedEntityCount ? `（本机独立脱敏并还原 ${item.redactedEntityCount} 处实体）` : ''
      }`
    );
    if (item.missingChecklist && item.missingChecklist.length > 0) {
      reportLines.push(`     ⚠ 待律师人工补充/核实项（${item.missingChecklist.length} 项）：`);
      item.missingChecklist.forEach((m, mi) => {
        reportLines.push(`        ${mi + 1}. ${m}`);
      });
    } else {
      reportLines.push('     待补充项：AI 未标记明显缺口（仍请对照原件逐栏复核）');
    }
    reportLines.push('');
  });

  reportLines.push('------------------------------------------------------------');
  reportLines.push(`汇总：成功导出 ${exportedCount} 份 Word（.docx），未导出 ${skippedCount} 份。`);
  reportLines.push(AI_LEGAL_DISCLAIMER);

  // Prefix UTF-8 BOM so Windows Notepad & WPS open Chinese characters cleanly
  const reportText = `\uFEFF${reportLines.join('\r\n')}`;
  entries.unshift({ name: '00_批量生成核对清单.txt', data: reportText });

  return { entries, exportedCount, skippedCount };
}

// ---- Zero-Dependency Local-Only IndexedDB Storage (with localStorage fallback) ----

function openBatchDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function normalizeLoadedQueue(raw: Partial<SpcBatchQueueState> | null): SpcBatchQueueState | null {
  if (!raw || !Array.isArray(raw.items)) return null;
  const normalizedItems: SpcBatchItem[] = raw.items.map((item) =>
    item.status === 'running'
      ? {
          ...item,
          status: 'pending',
          progressNote: '上次处理因页面重载中断，可点击继续续跑',
        }
      : item
  );
  return {
    templateId: typeof raw.templateId === 'string' ? raw.templateId : '',
    sharedInstruction: typeof raw.sharedInstruction === 'string' ? raw.sharedInstruction : '',
    autoRedact: typeof raw.autoRedact === 'boolean' ? raw.autoRedact : true,
    modelSlot: raw.modelSlot === 'reasoning' ? 'reasoning' : 'fast',
    concurrency: raw.concurrency === 1 || raw.concurrency === 3 ? raw.concurrency : 2,
    items: normalizedItems,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

export async function loadSpcBatchQueueLocal(): Promise<SpcBatchQueueState | null> {
  const db = await openBatchDb();
  if (db) {
    try {
      const result = await new Promise<Partial<SpcBatchQueueState> | null>((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => resolve((req.result as Partial<SpcBatchQueueState>) || null);
        req.onerror = () => resolve(null);
      });
      db.close();
      if (result) return normalizeLoadedQueue(result);
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (!raw) return null;
    return normalizeLoadedQueue(JSON.parse(raw) as Partial<SpcBatchQueueState>);
  } catch {
    return null;
  }
}

export async function saveSpcBatchQueueLocal(state: SpcBatchQueueState): Promise<void> {
  const db = await openBatchDb();
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(state, IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      try {
        localStorage.removeItem(LS_FALLBACK_KEY);
      } catch {
        // ignore
      }
      return;
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
  try {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(state));
  } catch {
    // ignore quota error
  }
}

export async function clearSpcBatchQueueLocal(): Promise<void> {
  const db = await openBatchDb();
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
  try {
    localStorage.removeItem(LS_FALLBACK_KEY);
  } catch {
    // ignore
  }
}
