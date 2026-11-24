import type {
  ByokSettings,
  CalculationHistoryItem,
  ChecklistInstance,
  DeadlineReminderItem,
  OfflineToolId,
  ScratchpadNote,
} from '../types/toolbox';
import { exportEncryptedSyncCode, importEncryptedSyncCode } from './cryptoVault.ts';
import { toolboxStorage } from './storage.ts';

const SYNC_PREFS_KEY = 'cn_lawyer_box_cloud_sync_prefs_v1';
const SYNC_META_KEY = 'cn_lawyer_box_cloud_sync_meta_v1';
const FEE_SHEET_KEY = 'lf-sheet';
const FEE_MINE_KEY = 'lf-mine';

export interface CloudSyncPrefs {
  enabled: boolean;
  syncByok: boolean;
  syncWorkspace: boolean;
  useE2eePassphrase: boolean;
}

export interface CloudSyncMeta {
  ownerKey: string;
  revision: number;
  lastSyncedAt: number;
  localModifiedAt: number;
  lastDeviceLabel: string;
}

export interface CloudSyncSnapshot {
  schemaVersion: 1;
  syncedAt: number;
  deviceLabel: string;
  byok?: ByokSettings;
  workspace?: {
    pinnedTools: OfflineToolId[];
    starredLaws: string[];
    deadlines: DeadlineReminderItem[];
    checklists: ChecklistInstance[];
    scratchpads: ScratchpadNote[];
    history: CalculationHistoryItem[];
    feeSheetRaw?: string | null;
    feeMineRaw?: string | null;
  };
}

export interface CloudSyncPullResponse {
  ok: boolean;
  supported?: boolean;
  exists?: boolean;
  revision?: number;
  updatedAt?: number;
  clientEncrypted?: boolean;
  deviceLabel?: string;
  payload?: CloudSyncSnapshot | string | null;
  error?: string;
}

export interface CloudSyncPushResponse {
  ok: boolean;
  conflict?: boolean;
  revision?: number;
  updatedAt?: number;
  serverRevision?: number;
  serverUpdatedAt?: number;
  clientEncrypted?: boolean;
  deviceLabel?: string;
  payload?: CloudSyncSnapshot | string | null;
  error?: string;
}

export const DEFAULT_CLOUD_SYNC_PREFS: CloudSyncPrefs = {
  enabled: true,
  syncByok: true,
  syncWorkspace: true,
  useE2eePassphrase: false,
};

export function getCloudSyncPrefs(): CloudSyncPrefs {
  try {
    const raw = localStorage.getItem(SYNC_PREFS_KEY);
    if (!raw) return { ...DEFAULT_CLOUD_SYNC_PREFS };
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      syncByok: parsed.syncByok !== false,
      syncWorkspace: parsed.syncWorkspace !== false,
      useE2eePassphrase: Boolean(parsed.useE2eePassphrase),
    };
  } catch {
    return { ...DEFAULT_CLOUD_SYNC_PREFS };
  }
}

export function saveCloudSyncPrefs(prefs: CloudSyncPrefs): void {
  try {
    localStorage.setItem(SYNC_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function getCloudSyncMeta(): CloudSyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (!raw) {
      return { ownerKey: '', revision: 0, lastSyncedAt: 0, localModifiedAt: 0, lastDeviceLabel: '' };
    }
    const parsed = JSON.parse(raw);
    return {
      ownerKey: String(parsed.ownerKey || ''),
      revision: Number(parsed.revision) || 0,
      lastSyncedAt: Number(parsed.lastSyncedAt) || 0,
      localModifiedAt: Number(parsed.localModifiedAt) || 0,
      lastDeviceLabel: String(parsed.lastDeviceLabel || ''),
    };
  } catch {
    return { ownerKey: '', revision: 0, lastSyncedAt: 0, localModifiedAt: 0, lastDeviceLabel: '' };
  }
}

export function saveCloudSyncMeta(meta: CloudSyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // ignore
  }
}

export function touchLocalSyncModified(ownerKey: string): CloudSyncMeta {
  const prev = getCloudSyncMeta();
  const next: CloudSyncMeta = {
    ...prev,
    ownerKey: ownerKey || prev.ownerKey,
    localModifiedAt: Date.now(),
  };
  saveCloudSyncMeta(next);
  return next;
}

export function detectDeviceLabel(): string {
  if (typeof navigator === 'undefined') return '桌面浏览器';
  const ua = navigator.userAgent || '';
  const inWeChat = /MicroMessenger/i.test(ua);
  if (/iPhone|iPad|iPod/i.test(ua)) return inWeChat ? 'iOS 微信内置' : 'iOS Safari / PWA';
  if (/Android/i.test(ua)) return inWeChat ? '安卓微信内置' : '安卓浏览器';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac 桌面端';
  if (/Windows/i.test(ua)) return 'Windows 桌面端';
  return '桌面浏览器';
}

export function hasMeaningfulLocalConfig(): boolean {
  try {
    const byok = toolboxStorage.getByok();
    const hasKeyOrCustomProvider =
      byok.providers.length > 1 ||
      byok.providers.some((p) => Boolean((p.apiKey && p.apiKey.trim()) || p.apiKeyEncrypted));
    if (hasKeyOrCustomProvider) return true;
    if (toolboxStorage.getDeadlines().length > 0) return true;
    if (toolboxStorage.getChecklists().length > 0) return true;
    if (toolboxStorage.getScratchpads().length > 0) return true;
    if (toolboxStorage.getHistory().length > 0) return true;
    const feeRaw = localStorage.getItem(FEE_SHEET_KEY);
    if (feeRaw) {
      const fee = JSON.parse(feeRaw);
      if (fee && (fee.author || fee.phone || fee.firm)) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function buildLocalSyncSnapshot(prefs: CloudSyncPrefs): CloudSyncSnapshot {
  const snap: CloudSyncSnapshot = {
    schemaVersion: 1,
    syncedAt: Date.now(),
    deviceLabel: detectDeviceLabel(),
  };
  if (prefs.syncByok) {
    snap.byok = toolboxStorage.getByok();
  }
  if (prefs.syncWorkspace) {
    let feeSheetRaw: string | null = null;
    let feeMineRaw: string | null = null;
    try {
      feeSheetRaw = localStorage.getItem(FEE_SHEET_KEY);
      feeMineRaw = localStorage.getItem(FEE_MINE_KEY);
    } catch {
      // ignore
    }
    snap.workspace = {
      pinnedTools: toolboxStorage.getPinnedTools(),
      starredLaws: toolboxStorage.getStarredLaws(),
      deadlines: toolboxStorage.getDeadlines(),
      checklists: toolboxStorage.getChecklists(),
      scratchpads: toolboxStorage.getScratchpads(),
      history: toolboxStorage.getHistory(),
      feeSheetRaw,
      feeMineRaw,
    };
  }
  return snap;
}

export function applyCloudSyncSnapshot(
  snap: CloudSyncSnapshot,
  prefs: CloudSyncPrefs
): { providerCount: number; appliedByok: boolean; appliedWorkspace: boolean } {
  let appliedByok = false;
  let appliedWorkspace = false;
  let providerCount = 0;

  if (prefs.syncByok && snap.byok && Array.isArray(snap.byok.providers) && snap.byok.providers.length > 0) {
    toolboxStorage.saveByok(snap.byok);
    appliedByok = true;
    providerCount = snap.byok.providers.length;
  }

  if (prefs.syncWorkspace && snap.workspace) {
    const ws = snap.workspace;
    if (Array.isArray(ws.pinnedTools) && ws.pinnedTools.length > 0) {
      toolboxStorage.savePinnedTools(ws.pinnedTools);
    }
    if (Array.isArray(ws.starredLaws)) {
      toolboxStorage.saveStarredLaws(ws.starredLaws);
    }
    if (Array.isArray(ws.deadlines)) {
      toolboxStorage.saveDeadlines(ws.deadlines);
    }
    if (Array.isArray(ws.checklists)) {
      toolboxStorage.saveChecklists(ws.checklists);
    }
    if (Array.isArray(ws.scratchpads)) {
      toolboxStorage.saveScratchpads(ws.scratchpads);
    }
    if (Array.isArray(ws.history)) {
      try {
        localStorage.setItem('cn_lawyer_box_calc_history_v1', JSON.stringify(ws.history.slice(0, 40)));
      } catch {
        // ignore
      }
    }
    try {
      if (typeof ws.feeSheetRaw === 'string' && ws.feeSheetRaw.trim()) {
        localStorage.setItem(FEE_SHEET_KEY, ws.feeSheetRaw);
      }
      if (typeof ws.feeMineRaw === 'string' && ws.feeMineRaw.trim()) {
        localStorage.setItem(FEE_MINE_KEY, ws.feeMineRaw);
      }
    } catch {
      // ignore
    }
    appliedWorkspace = true;
  }

  return { providerCount, appliedByok, appliedWorkspace };
}

export function resetLocalUserWorkspaceForAccountSwitch(): void {
  const keysToClear = [
    'cn_lawyer_box_byok_v1',
    'cn_lawyer_box_calc_history_v1',
    'cn_lawyer_box_deadlines_v1',
    'cn_lawyer_box_checklists_v1',
    'cn_lawyer_box_scratchpads_v1',
    'cn_lawyer_box_pinned_tools_v1',
    'cn_lawyer_box_starred_laws_v1',
    'cn_lawyer_box_elements_complaint_draft_v1',
    FEE_SHEET_KEY,
    'lf-sheet-author-manual',
    SYNC_META_KEY,
  ];
  for (const k of keysToClear) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
}

export async function encodeSyncSnapshotForUpload(
  snap: CloudSyncSnapshot,
  passphrase: string
): Promise<{ clientEncrypted: boolean; payload: CloudSyncSnapshot | string }> {
  const cleanPass = passphrase.trim();
  if (!cleanPass) {
    return { clientEncrypted: false, payload: snap };
  }
  const cipher = await exportEncryptedSyncCode(JSON.stringify(snap), cleanPass);
  return { clientEncrypted: true, payload: cipher };
}

export async function decodeSyncSnapshotFromCloud(
  clientEncrypted: boolean,
  payload: CloudSyncSnapshot | string | null | undefined,
  passphrase: string
): Promise<CloudSyncSnapshot> {
  if (!payload) {
    throw new Error('云端同步内容为空');
  }
  if (!clientEncrypted) {
    if (typeof payload === 'string') {
      return JSON.parse(payload) as CloudSyncSnapshot;
    }
    return payload;
  }
  const cleanPass = passphrase.trim();
  if (!cleanPass) {
    throw new Error('E2EE_LOCKED');
  }
  if (typeof payload !== 'string') {
    throw new Error('云端加密载荷格式无效');
  }
  const plainJson = await importEncryptedSyncCode(payload, cleanPass);
  return JSON.parse(plainJson) as CloudSyncSnapshot;
}

export async function pullCloudVault(licenseRawCode: string): Promise<CloudSyncPullResponse> {
  const resp = await fetch('/api/sync/vault', {
    method: 'GET',
    headers: {
      'X-Toolbox-License': licenseRawCode,
    },
    cache: 'no-store',
  });
  const data = (await resp.json().catch(() => null)) as CloudSyncPullResponse | null;
  if (!resp.ok || !data) {
    throw new Error(data?.error || `拉取云端同步失败 (HTTP ${resp.status})`);
  }
  return data;
}

export async function pushCloudVault(params: {
  licenseRawCode: string;
  snapshot: CloudSyncSnapshot;
  baseRevision: number;
  force?: boolean;
  e2eePassphrase?: string;
}): Promise<CloudSyncPushResponse> {
  const { clientEncrypted, payload } = await encodeSyncSnapshotForUpload(
    params.snapshot,
    params.e2eePassphrase || ''
  );
  const resp = await fetch('/api/sync/vault', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Toolbox-License': params.licenseRawCode,
    },
    body: JSON.stringify({
      updatedAt: params.snapshot.syncedAt,
      baseRevision: params.baseRevision,
      force: Boolean(params.force),
      clientEncrypted,
      deviceLabel: params.snapshot.deviceLabel,
      payload,
    }),
  });
  const data = (await resp.json().catch(() => null)) as CloudSyncPushResponse | null;
  if (resp.status === 409 && data?.conflict) {
    return data;
  }
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.error || `上传云端同步失败 (HTTP ${resp.status})`);
  }
  return data;
}

export async function deleteCloudVault(licenseRawCode: string): Promise<void> {
  const resp = await fetch('/api/sync/vault', {
    method: 'DELETE',
    headers: {
      'X-Toolbox-License': licenseRawCode,
    },
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.error || `清空云端同步副本失败 (HTTP ${resp.status})`);
  }
}
