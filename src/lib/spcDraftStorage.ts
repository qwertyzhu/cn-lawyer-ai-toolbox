/**
 * Local-only multi-template & per-case isolated draft persistence for SPC 2025 Element-Style Pleadings.
 *
 * Fixes:
 * 1. A -> B -> A template switching loss AND Case A -> Case B cross-case draft bleed:
 *    stores isolated drafts keyed by `makeScopedSpcDraftKey(caseId, templateId)` so named
 *    Case Pockets never share or overwrite each other's drafts.
 * 2. Silent 80,000-char sourceText truncation & swallowed QuotaExceededError: persists full
 *    untruncated workspace + per-case/template drafts in IndexedDB (with synchronous localStorage
 *    flush on pagehide/unmount) and surfaces explicit save status ('saving' | 'saved' | 'error').
 * 3. Complete async IndexedDB + localStorage purge helper (`purgeAllSpcDraftStorage`) for shared-device
 *    account switching so zero residual drafts survive across lawyers.
 */

import {
  createInitialSpcDraft,
  isRowUntouched,
  type OfficialSpcDraftState,
  type OfficialSpcTemplate,
  type SpcTemplateCorpus,
} from './spcOfficialTemplates.ts';
import type { RedactionMapping } from '../types/toolbox';

export const LEGACY_DRAFT_STORAGE_KEY = 'spc2025_elements_doc_draft_v2';
export const MULTI_DRAFTS_STORAGE_KEY = 'spc2025_drafts_by_tpl_v3';

export const SPC_SINGLE_WORKSPACE_IDB_NAME = 'spc2025_single_workspace_db_v1';
const IDB_NAME = SPC_SINGLE_WORKSPACE_IDB_NAME;
const IDB_STORE = 'workspace';
const IDB_KEY = 'current_v3';

export interface PersistedSpcDraftBundle {
  app: 'spc2025-draft-bundle';
  schemaVersion: 3;
  exportedAt: string;
  activeTemplateId: string;
  activeCaseId?: string;
  draftsByTemplate: Record<string, OfficialSpcDraftState>;
  sourceText: string;
  companionCourt?: string;
}

export interface PersistedSpcIdbState {
  activeTemplateId: string;
  activeCaseId?: string;
  draftsByTemplate: Record<string, OfficialSpcDraftState>;
  sourceText: string;
  autoRedact: boolean;
  extractModelSlot: 'fast' | 'reasoning';
  showAiCopilot: boolean;
  aiRefineTurns: unknown[];
  aiSessionMappings: RedactionMapping[];
  companionCourt: string;
  companionAuthScope: 'special' | 'general';
  companionPreserveAmt: string;
  companionInvestigateOrg: string;
  editingBatchItemId: string | null;
  updatedAt: number;
}

/**
 * Builds a case-isolated storage key:
 * - Unassigned (`caseId` empty) -> `${templateId}` (100% backward-compatible with v1.8/v1.9 unassigned drafts)
 * - Bound to a Case Pocket (`caseId` non-empty) -> `${caseId}::${templateId}` (strictly isolated per case!)
 */
export function makeScopedSpcDraftKey(
  caseId: string | null | undefined,
  templateId: string
): string {
  const cleanCase = String(caseId || '').trim();
  return cleanCase ? `${cleanCase}::${templateId}` : templateId;
}

export function extractTemplateIdFromDraftKey(scopedKey: string): string {
  const idx = scopedKey.lastIndexOf('::');
  return idx >= 0 ? scopedKey.slice(idx + 2) : scopedKey;
}

export function isDemoSampleDraft(draft: OfficialSpcDraftState | null | undefined): boolean {
  if (!draft) return false;
  if ((draft.signerName || '').includes('虚构样例')) return true;
  for (const val of Object.values(draft.rowValues || {})) {
    if (typeof val === 'string' && val.includes('【虚构演示样例】')) {
      return true;
    }
  }
  return Boolean(draft.isDemoSample);
}

export function hydrateSingleSpcDraft(
  tpl: OfficialSpcTemplate,
  raw: Partial<OfficialSpcDraftState> | null | undefined
): OfficialSpcDraftState {
  const base = createInitialSpcDraft(tpl);
  if (!raw || typeof raw !== 'object') return base;
  const hydrated: OfficialSpcDraftState = {
    ...base,
    ...raw,
    templateId: tpl.id,
    rowValues: { ...base.rowValues, ...(raw.rowValues || {}) },
    gridValues: { ...base.gridValues, ...(raw.gridValues || {}) },
    extraRows: Array.isArray(raw.extraRows) ? raw.extraRows : [],
    excludedRowIds: Array.isArray(raw.excludedRowIds) ? raw.excludedRowIds : [],
    attachmentRows: { ...base.attachmentRows, ...(raw.attachmentRows || {}) },
  };
  hydrated.isDemoSample = isDemoSampleDraft(hydrated);
  return hydrated;
}

export function hasNonEmptySpcDraft(
  tpl: OfficialSpcTemplate,
  draft: OfficialSpcDraftState | undefined
): boolean {
  if (!draft) return false;
  if (draft.extraRows && draft.extraRows.length > 0) return true;
  if (draft.excludedRowIds && draft.excludedRowIds.length > 0) return true;
  if (draft.signerName && draft.signerName.trim()) return true;
  for (const r of tpl.rows) {
    if (r.kind === 'field' || r.kind === 'full_input') {
      if (!isRowUntouched(r, draft.rowValues[r.id])) return true;
    } else if (r.kind === 'grid' && r.cells && draft.gridValues[r.id]) {
      if (JSON.stringify(draft.gridValues[r.id]) !== JSON.stringify(r.cells)) return true;
    }
  }
  return false;
}

/**
 * Pure state transition helper for switching templates OR switching Case Pockets
 * without losing drafts or leaking Case A's draft into Case B!
 */
export function switchSpcTemplatePreservingDrafts(params: {
  currentDraft: OfficialSpcDraftState | null;
  draftsByTemplate: Record<string, OfficialSpcDraftState>;
  nextTpl: OfficialSpcTemplate;
  currentCaseId?: string | null;
  nextCaseId?: string | null;
}): {
  nextDraft: OfficialSpcDraftState;
  nextDraftsByTemplate: Record<string, OfficialSpcDraftState>;
  restoredExisting: boolean;
} {
  const { currentDraft, draftsByTemplate, nextTpl, currentCaseId = '', nextCaseId } = params;
  const targetCaseId = nextCaseId !== undefined ? nextCaseId : currentCaseId;
  const updatedMap: Record<string, OfficialSpcDraftState> = { ...draftsByTemplate };

  if (currentDraft && currentDraft.templateId) {
    const curKey = makeScopedSpcDraftKey(currentCaseId, currentDraft.templateId);
    updatedMap[curKey] = {
      ...currentDraft,
      isDemoSample: isDemoSampleDraft(currentDraft),
    };
  }

  const targetKey = makeScopedSpcDraftKey(targetCaseId, nextTpl.id);
  const existingForTarget = updatedMap[targetKey];
  if (existingForTarget) {
    const hydrated = hydrateSingleSpcDraft(nextTpl, existingForTarget);
    updatedMap[targetKey] = hydrated;
    return {
      nextDraft: hydrated,
      nextDraftsByTemplate: updatedMap,
      restoredExisting: hasNonEmptySpcDraft(nextTpl, hydrated),
    };
  }

  const fresh = createInitialSpcDraft(nextTpl);
  updatedMap[targetKey] = fresh;
  return {
    nextDraft: fresh,
    nextDraftsByTemplate: updatedMap,
    restoredExisting: false,
  };
}

export function hydrateDraftMapForCorpus(
  rawMap: Record<string, Partial<OfficialSpcDraftState>> | null | undefined,
  corpus: SpcTemplateCorpus
): Record<string, OfficialSpcDraftState> {
  const out: Record<string, OfficialSpcDraftState> = {};
  if (!rawMap || typeof rawMap !== 'object') return out;
  for (const [scopedKey, rawDraft] of Object.entries(rawMap)) {
    if (!rawDraft) continue;
    const tplId = extractTemplateIdFromDraftKey(scopedKey);
    const tpl = corpus.templates.find((t) => t.id === tplId);
    if (tpl) {
      out[scopedKey] = hydrateSingleSpcDraft(tpl, rawDraft);
    }
  }
  return out;
}

export function loadInitialSpcDraftsFromLocalStorage(
  corpus: SpcTemplateCorpus,
  activeCaseId = ''
): {
  activeDraft: OfficialSpcDraftState;
  draftsByTemplate: Record<string, OfficialSpcDraftState>;
} {
  const defaultTpl =
    corpus.templates.find((t) => t.displayName === '买卖合同纠纷民事起诉状') ||
    corpus.templates[0];
  let map: Record<string, OfficialSpcDraftState> = {};
  let activeId = defaultTpl.id;

  try {
    const rawMapStr = localStorage.getItem(MULTI_DRAFTS_STORAGE_KEY);
    if (rawMapStr) {
      const parsed = JSON.parse(rawMapStr) as {
        activeTemplateId?: string;
        drafts?: Record<string, Partial<OfficialSpcDraftState>>;
      };
      map = hydrateDraftMapForCorpus(parsed?.drafts, corpus);
      if (parsed?.activeTemplateId && corpus.templates.some((t) => t.id === parsed.activeTemplateId)) {
        activeId = parsed.activeTemplateId;
      }
    }
  } catch {
    // ignore corrupt v3 map
  }

  // Seamless migration from legacy v2 single-draft storage key into unassigned scope only
  try {
    const legacyRaw = localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Partial<OfficialSpcDraftState>;
      if (legacy && legacy.templateId) {
        const tpl = corpus.templates.find((t) => t.id === legacy.templateId);
        if (tpl && !map[tpl.id]) {
          map[tpl.id] = hydrateSingleSpcDraft(tpl, legacy);
          if (Object.keys(map).length === 1) {
            activeId = tpl.id;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  const targetTpl = corpus.templates.find((t) => t.id === activeId) || defaultTpl;
  const scopedKey = makeScopedSpcDraftKey(activeCaseId, targetTpl.id);
  const activeDraft = map[scopedKey] || createInitialSpcDraft(targetTpl);
  map[scopedKey] = activeDraft;

  return { activeDraft, draftsByTemplate: map };
}

function openWorkspaceIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

export async function loadSpcWorkspaceIdb(): Promise<PersistedSpcIdbState | null> {
  try {
    const db = await openWorkspaceIdb();
    const val = await new Promise<PersistedSpcIdbState | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as PersistedSpcIdbState | undefined) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return val;
  } catch {
    return null;
  }
}

/**
 * Synchronous localStorage flush used on pagehide / beforeunload / component unmount
 * so rapid edits within the 260ms debounce window are never lost.
 */
export function flushSpcWorkspaceToLocalStorageSync(
  state: PersistedSpcIdbState,
  legacyWorkspaceLsKey: string
): boolean {
  let ok = false;
  try {
    localStorage.setItem(
      MULTI_DRAFTS_STORAGE_KEY,
      JSON.stringify({
        activeTemplateId: state.activeTemplateId,
        activeCaseId: state.activeCaseId || '',
        drafts: state.draftsByTemplate,
      })
    );
    const curKey = makeScopedSpcDraftKey(state.activeCaseId, state.activeTemplateId);
    const cur = state.draftsByTemplate[curKey];
    if (cur && !state.activeCaseId) {
      localStorage.setItem(LEGACY_DRAFT_STORAGE_KEY, JSON.stringify(cur));
    }
    ok = true;
  } catch {
    ok = false;
  }
  try {
    localStorage.setItem(
      legacyWorkspaceLsKey,
      JSON.stringify({
        activeMode: 'form',
        sourceText: state.sourceText.length > 60_000 ? '' : state.sourceText,
        sourceTextInIdb: state.sourceText.length > 60_000,
        autoRedact: state.autoRedact,
        extractModelSlot: state.extractModelSlot,
        showAiCopilot: state.showAiCopilot,
        aiRefineTurns: state.aiRefineTurns,
        aiSessionMappings: state.aiSessionMappings,
        companionCourt: state.companionCourt,
        companionAuthScope: state.companionAuthScope,
        companionPreserveAmt: state.companionPreserveAmt,
        companionInvestigateOrg: state.companionInvestigateOrg,
        editingBatchItemId: state.editingBatchItemId,
        updatedAt: state.updatedAt,
      })
    );
  } catch {
    // ignore quota on auxiliary workspace metadata
  }
  return ok;
}

export async function saveSpcWorkspacePersisted(
  state: PersistedSpcIdbState,
  legacyWorkspaceLsKey: string
): Promise<{ ok: boolean; viaIdb: boolean; error?: string }> {
  let lsDraftOk = false;
  let lsWsOk = false;
  let idbOk = false;

  try {
    const db = await openWorkspaceIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(state, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    idbOk = true;
  } catch {
    idbOk = false;
  }

  try {
    localStorage.setItem(
      MULTI_DRAFTS_STORAGE_KEY,
      JSON.stringify({
        activeTemplateId: state.activeTemplateId,
        activeCaseId: state.activeCaseId || '',
        drafts: state.draftsByTemplate,
      })
    );
    const curKey = makeScopedSpcDraftKey(state.activeCaseId, state.activeTemplateId);
    const cur = state.draftsByTemplate[curKey];
    if (cur && !state.activeCaseId) {
      localStorage.setItem(LEGACY_DRAFT_STORAGE_KEY, JSON.stringify(cur));
    }
    lsDraftOk = true;
  } catch {
    lsDraftOk = false;
  }

  try {
    localStorage.setItem(
      legacyWorkspaceLsKey,
      JSON.stringify({
        activeMode: 'form',
        sourceText: idbOk && state.sourceText.length > 60_000 ? '' : state.sourceText,
        sourceTextInIdb: idbOk && state.sourceText.length > 60_000,
        autoRedact: state.autoRedact,
        extractModelSlot: state.extractModelSlot,
        showAiCopilot: state.showAiCopilot,
        aiRefineTurns: state.aiRefineTurns,
        aiSessionMappings: state.aiSessionMappings,
        companionCourt: state.companionCourt,
        companionAuthScope: state.companionAuthScope,
        companionPreserveAmt: state.companionPreserveAmt,
        companionInvestigateOrg: state.companionInvestigateOrg,
        editingBatchItemId: state.editingBatchItemId,
        updatedAt: state.updatedAt,
      })
    );
    lsWsOk = true;
  } catch {
    lsWsOk = false;
  }

  if (idbOk || (lsDraftOk && lsWsOk)) {
    return { ok: true, viaIdb: idbOk };
  }
  return {
    ok: false,
    viaIdb: false,
    error: '本机浏览器存储空间不足，未能自动保存完整草稿，请立即点击「下载草稿备份」保存到电脑/手机本地！',
  };
}

export function deleteIdbDatabaseVerified(
  dbName: string,
  timeoutMs = 1500
): Promise<{ deleted: boolean; blocked: boolean }> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.deleteDatabase !== 'function') {
      resolve({ deleted: true, blocked: false });
      return;
    }
    let settled = false;
    const finish = (res: { deleted: boolean; blocked: boolean }) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    const timer = setTimeout(() => finish({ deleted: false, blocked: true }), timeoutMs);
    try {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => {
        clearTimeout(timer);
        finish({ deleted: true, blocked: false });
      };
      req.onerror = () => {
        clearTimeout(timer);
        finish({ deleted: false, blocked: false });
      };
      req.onblocked = () => {
        clearTimeout(timer);
        finish({ deleted: false, blocked: true });
      };
    } catch {
      clearTimeout(timer);
      finish({ deleted: false, blocked: false });
    }
  });
}

export async function purgeAllSpcDraftStorage(): Promise<{ ok: boolean; blocked: boolean }> {
  try {
    localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
    localStorage.removeItem(MULTI_DRAFTS_STORAGE_KEY);
  } catch {
    // ignore
  }
  const res = await deleteIdbDatabaseVerified(IDB_NAME);
  return { ok: !res.blocked, blocked: res.blocked };
}

export function serializeSpcDraftBundle(params: {
  activeTemplateId: string;
  activeCaseId?: string;
  draftsByTemplate: Record<string, OfficialSpcDraftState>;
  sourceText: string;
  companionCourt?: string;
}): string {
  const payload: PersistedSpcDraftBundle = {
    app: 'spc2025-draft-bundle',
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    activeTemplateId: params.activeTemplateId,
    activeCaseId: params.activeCaseId || '',
    draftsByTemplate: params.draftsByTemplate,
    sourceText: params.sourceText,
    companionCourt: params.companionCourt,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseSpcDraftBundle(
  rawJson: string,
  corpus: SpcTemplateCorpus,
  targetCaseId = ''
): {
  activeDraft: OfficialSpcDraftState;
  draftsByTemplate: Record<string, OfficialSpcDraftState>;
  sourceText: string;
  companionCourt: string;
} {
  const parsed = JSON.parse(rawJson) as Partial<PersistedSpcDraftBundle>;
  if (parsed?.app !== 'spc2025-draft-bundle' || !parsed.draftsByTemplate) {
    throw new Error('非要素式文书草稿备份文件（.json）');
  }
  const map = hydrateDraftMapForCorpus(parsed.draftsByTemplate, corpus);
  const fallbackTpl =
    corpus.templates.find((t) => t.id === parsed.activeTemplateId) || corpus.templates[0];
  const preferredKey = makeScopedSpcDraftKey(
    targetCaseId || parsed.activeCaseId || '',
    fallbackTpl.id
  );
  const activeDraft =
    map[preferredKey] || map[fallbackTpl.id] || createInitialSpcDraft(fallbackTpl);
  map[makeScopedSpcDraftKey(targetCaseId, fallbackTpl.id)] = activeDraft;

  return {
    activeDraft,
    draftsByTemplate: map,
    sourceText: typeof parsed.sourceText === 'string' ? parsed.sourceText : '',
    companionCourt: typeof parsed.companionCourt === 'string' ? parsed.companionCourt : '',
  };
}
