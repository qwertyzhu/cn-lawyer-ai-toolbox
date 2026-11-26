/**
 * Local-only multi-template draft & long-material persistence for SPC 2025 Element-Style Pleadings.
 *
 * Fixes:
 * 1. A -> B -> A template switching loss: stores an isolated draft per `templateId` so switching
 *    templates NEVER wipes filled fields on previous templates.
 * 2. Silent 80,000-char sourceText truncation & swallowed QuotaExceededError: persists full
 *    untruncated workspace + per-template drafts in IndexedDB (with synchronous localStorage
 *    mirror when within quota) and surfaces explicit save status ('saving' | 'saved' | 'error').
 * 3. Portable local draft JSON export/import so lawyers can manually download/restore drafts anytime.
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

const IDB_NAME = 'spc2025_single_workspace_db_v1';
const IDB_STORE = 'workspace';
const IDB_KEY = 'current_v3';

export interface PersistedSpcDraftBundle {
  app: 'spc2025-draft-bundle';
  schemaVersion: 3;
  exportedAt: string;
  activeTemplateId: string;
  draftsByTemplate: Record<string, OfficialSpcDraftState>;
  sourceText: string;
  companionCourt?: string;
}

export interface PersistedSpcIdbState {
  activeTemplateId: string;
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

export function hydrateSingleSpcDraft(
  tpl: OfficialSpcTemplate,
  raw: Partial<OfficialSpcDraftState> | null | undefined
): OfficialSpcDraftState {
  const base = createInitialSpcDraft(tpl);
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    templateId: tpl.id,
    rowValues: { ...base.rowValues, ...(raw.rowValues || {}) },
    gridValues: { ...base.gridValues, ...(raw.gridValues || {}) },
    extraRows: Array.isArray(raw.extraRows) ? raw.extraRows : [],
    excludedRowIds: Array.isArray(raw.excludedRowIds) ? raw.excludedRowIds : [],
    attachmentRows: { ...base.attachmentRows, ...(raw.attachmentRows || {}) },
  };
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

export function switchSpcTemplatePreservingDrafts(params: {
  currentDraft: OfficialSpcDraftState | null;
  draftsByTemplate: Record<string, OfficialSpcDraftState>;
  nextTpl: OfficialSpcTemplate;
}): {
  nextDraft: OfficialSpcDraftState;
  nextDraftsByTemplate: Record<string, OfficialSpcDraftState>;
  restoredExisting: boolean;
} {
  const { currentDraft, draftsByTemplate, nextTpl } = params;
  const updatedMap: Record<string, OfficialSpcDraftState> = { ...draftsByTemplate };
  if (currentDraft && currentDraft.templateId) {
    updatedMap[currentDraft.templateId] = currentDraft;
  }
  const existingForTarget = updatedMap[nextTpl.id];
  if (existingForTarget) {
    const hydrated = hydrateSingleSpcDraft(nextTpl, existingForTarget);
    updatedMap[nextTpl.id] = hydrated;
    return {
      nextDraft: hydrated,
      nextDraftsByTemplate: updatedMap,
      restoredExisting: hasNonEmptySpcDraft(nextTpl, hydrated),
    };
  }
  const fresh = createInitialSpcDraft(nextTpl);
  updatedMap[nextTpl.id] = fresh;
  return {
    nextDraft: fresh,
    nextDraftsByTemplate: updatedMap,
    restoredExisting: false,
  };
}

export function loadInitialSpcDraftsFromLocalStorage(corpus: SpcTemplateCorpus): {
  activeDraft: OfficialSpcDraftState;
  draftsByTemplate: Record<string, OfficialSpcDraftState>;
} {
  const defaultTpl =
    corpus.templates.find((t) => t.displayName === '买卖合同纠纷民事起诉状') ||
    corpus.templates[0];
  const map: Record<string, OfficialSpcDraftState> = {};
  let activeId = defaultTpl.id;

  try {
    const rawMapStr = localStorage.getItem(MULTI_DRAFTS_STORAGE_KEY);
    if (rawMapStr) {
      const parsed = JSON.parse(rawMapStr) as {
        activeTemplateId?: string;
        drafts?: Record<string, Partial<OfficialSpcDraftState>>;
      };
      if (parsed?.drafts && typeof parsed.drafts === 'object') {
        for (const [tid, rawDraft] of Object.entries(parsed.drafts)) {
          const tpl = corpus.templates.find((t) => t.id === tid);
          if (tpl && rawDraft) {
            map[tid] = hydrateSingleSpcDraft(tpl, rawDraft);
          }
        }
      }
      if (parsed?.activeTemplateId && corpus.templates.some((t) => t.id === parsed.activeTemplateId)) {
        activeId = parsed.activeTemplateId;
      }
    }
  } catch {
    // ignore corrupt v3 map
  }

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
  const activeDraft = map[targetTpl.id] || createInitialSpcDraft(targetTpl);
  map[targetTpl.id] = activeDraft;

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
        drafts: state.draftsByTemplate,
      })
    );
    const cur = state.draftsByTemplate[state.activeTemplateId];
    if (cur) {
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

export function serializeSpcDraftBundle(params: {
  activeTemplateId: string;
  draftsByTemplate: Record<string, OfficialSpcDraftState>;
  sourceText: string;
  companionCourt?: string;
}): string {
  const payload: PersistedSpcDraftBundle = {
    app: 'spc2025-draft-bundle',
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    activeTemplateId: params.activeTemplateId,
    draftsByTemplate: params.draftsByTemplate,
    sourceText: params.sourceText,
    companionCourt: params.companionCourt,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseSpcDraftBundle(
  rawJson: string,
  corpus: SpcTemplateCorpus
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
  const map: Record<string, OfficialSpcDraftState> = {};
  for (const [tid, d] of Object.entries(parsed.draftsByTemplate)) {
    const tpl = corpus.templates.find((t) => t.id === tid);
    if (tpl && d) {
      map[tid] = hydrateSingleSpcDraft(tpl, d);
    }
  }
  const fallbackTpl =
    corpus.templates.find((t) => t.id === parsed.activeTemplateId) || corpus.templates[0];
  const activeDraft = map[fallbackTpl.id] || createInitialSpcDraft(fallbackTpl);
  map[fallbackTpl.id] = activeDraft;

  return {
    activeDraft,
    draftsByTemplate: map,
    sourceText: typeof parsed.sourceText === 'string' ? parsed.sourceText : '',
    companionCourt: typeof parsed.companionCourt === 'string' ? parsed.companionCourt : '',
  };
}
