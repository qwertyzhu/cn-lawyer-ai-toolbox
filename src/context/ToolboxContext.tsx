import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  AiHandoffPayload,
  AiSpecialistId,
  ByokSettings,
  CalculationHistoryItem,
  CasePocket,
  ChecklistInstance,
  DeadlineReminderItem,
  LawyerProfile,
  MainTabId,
  OfflineToolId,
  SavedAiPrompt,
  ScratchpadNote,
} from '../types/toolbox';
import type { VerifiedLicenseInfo } from '../lib/licenseEngine';
import {
  applyCloudSyncSnapshot,
  buildLocalSyncSnapshot,
  decodeSyncSnapshotFromCloud,
  deleteCloudVault,
  getCloudSyncMeta,
  getCloudSyncPrefs,
  hasMeaningfulLocalConfig,
  pingAnonymousToolHit,
  pullCloudVault,
  pushCloudVault,
  saveCloudSyncMeta,
  saveCloudSyncPrefs,
  touchLocalSyncModified,
  type CloudSyncPrefs,
} from '../lib/cloudSync';
import { toolboxStorage } from '../lib/storage';

export interface CloudSyncStatusState {
  status: 'idle' | 'syncing' | 'synced' | 'locked' | 'conflict' | 'offline' | 'error';
  lastSyncedAt: number;
  revision: number;
  deviceLabel: string;
  clientEncrypted: boolean;
  errorMsg: string;
}

interface ToolboxContextValue {
  activeTab: MainTabId;
  activeToolId: OfflineToolId | null;
  activeSpecialistId: AiSpecialistId;
  lawsInitialQuery: string;
  lawsSubView: 'statutes' | 'ima_cloud' | 'checklists';
  lawsChecklistId: string;
  isOnline: boolean;
  toastMessage: string | null;

  byok: ByokSettings;
  updateByok: (next: ByokSettings) => void;
  sessionUnlockedPin: string | null;
  setSessionUnlockedPin: (pin: string | null) => void;

  syncPrefs: CloudSyncPrefs;
  updateSyncPrefs: (patch: Partial<CloudSyncPrefs>) => void;
  syncState: CloudSyncStatusState;
  sessionSyncPassphrase: string;
  setSessionSyncPassphrase: (pass: string) => void;
  triggerCloudPush: (force?: boolean, silent?: boolean, overridePassphrase?: string) => Promise<boolean>;
  triggerCloudPull: (silent?: boolean, overridePassphrase?: string) => Promise<boolean>;
  clearCloudVaultBackup: () => Promise<void>;

  history: CalculationHistoryItem[];
  recordCalculation: (toolId: OfflineToolId, toolTitle: string, summary: string, detailText: string) => void;
  clearHistory: () => void;

  deadlines: DeadlineReminderItem[];
  setDeadlines: (items: DeadlineReminderItem[]) => void;

  checklists: ChecklistInstance[];
  setChecklists: (items: ChecklistInstance[]) => void;

  scratchpads: ScratchpadNote[];
  setScratchpads: (notes: ScratchpadNote[]) => void;

  pinnedTools: OfflineToolId[];
  togglePinTool: (id: OfflineToolId) => void;

  starredLaws: string[];
  toggleStarLaw: (key: string) => void;

  lawyerProfile: LawyerProfile;
  updateLawyerProfile: (profile: LawyerProfile) => void;

  savedPrompts: SavedAiPrompt[];
  addSavedPrompt: (label: string, content: string, specialistId?: AiSpecialistId) => void;
  deleteSavedPrompt: (id: string) => void;

  casePockets: CasePocket[];
  activeCaseId: string;
  setActiveCaseId: (caseId: string) => void;
  addCasePocket: (input: Omit<CasePocket, 'id' | 'createdAt' | 'updatedAt'>) => CasePocket;
  updateCasePocket: (id: string, patch: Partial<Omit<CasePocket, 'id' | 'createdAt'>>) => void;
  deleteCasePocket: (id: string) => void;

  recordToolHit: (toolId: string) => void;

  aiHandoff: AiHandoffPayload | null;
  clearAiHandoff: () => void;

  navigateTab: (tab: MainTabId) => void;
  openTool: (toolId: OfflineToolId | null) => void;
  openLawsSearch: (
    query?: string,
    subView?: 'statutes' | 'ima_cloud' | 'checklists',
    checklistId?: string
  ) => void;
  sendToAi: (specialistId: AiSpecialistId, sourceTitle: string, promptContext: string) => void;
  showToast: (msg: string) => void;
  refreshAllFromDisk: () => void;
}

const ToolboxContext = createContext<ToolboxContextValue | null>(null);

const VALID_TABS: readonly MainTabId[] = ['home', 'tools', 'ai', 'laws', 'settings'];
const VALID_TOOLS: readonly OfflineToolId[] = [
  'elements-complaint',
  'litigation-fee-calculator',
  'lpr-interest-calculator',
  'date-calculator',
  'labor-compensation',
  'injury-compensation',
  'evidence-pdf-toolkit',
  'local-redactor',
  'lawyer-fee-quote',
  'preservation-deadline',
  'rmb-debt-offset',
  'meeting-scratchpad',
];

function parseRouteHash(): { tab: MainTabId; toolId: OfflineToolId | null } {
  if (typeof window === 'undefined') return { tab: 'home', toolId: null };
  const raw = window.location.hash.replace(/^#/, '').trim();
  if (!raw) return { tab: 'home', toolId: null };
  const params = new URLSearchParams(raw);
  const tool = params.get('tool') as OfflineToolId | null;
  if (tool && (VALID_TOOLS as readonly string[]).includes(tool)) {
    return { tab: 'tools', toolId: tool };
  }
  const tab = params.get('tab') as MainTabId | null;
  if (tab && (VALID_TABS as readonly string[]).includes(tab)) {
    return { tab, toolId: null };
  }
  return { tab: 'home', toolId: null };
}

function buildRouteHash(tab: MainTabId, toolId: OfflineToolId | null): string {
  if (tab === 'tools' && toolId) return `#tool=${encodeURIComponent(toolId)}`;
  if (tab !== 'home') return `#tab=${encodeURIComponent(tab)}`;
  return '';
}

export const ToolboxProvider: React.FC<{
  license?: VerifiedLicenseInfo | null;
  children: React.ReactNode;
}> = ({ license = null, children }) => {
  const initialRoute = parseRouteHash();
  const [activeTab, setActiveTab] = useState<MainTabId>(initialRoute.tab);
  const [activeToolId, setActiveToolId] = useState<OfflineToolId | null>(initialRoute.toolId);
  const [activeSpecialistId, setActiveSpecialistId] = useState<AiSpecialistId>('contract-review');
  const [lawsInitialQuery, setLawsInitialQuery] = useState('');
  const [lawsSubView, setLawsSubView] = useState<'statutes' | 'ima_cloud' | 'checklists'>('statutes');
  const [lawsChecklistId, setLawsChecklistId] = useState('');
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [byok, setByok] = useState<ByokSettings>(() => toolboxStorage.getByok());
  const [sessionUnlockedPin, setSessionUnlockedPin] = useState<string | null>(null);
  const [history, setHistory] = useState<CalculationHistoryItem[]>(() => toolboxStorage.getHistory());
  const [deadlines, setDeadlinesState] = useState<DeadlineReminderItem[]>(() => toolboxStorage.getDeadlines());
  const [checklists, setChecklistsState] = useState<ChecklistInstance[]>(() => toolboxStorage.getChecklists());
  const [scratchpads, setScratchpadsState] = useState<ScratchpadNote[]>(() => toolboxStorage.getScratchpads());
  const [pinnedTools, setPinnedToolsState] = useState<OfflineToolId[]>(() => toolboxStorage.getPinnedTools());
  const [starredLaws, setStarredLawsState] = useState<string[]>(() => toolboxStorage.getStarredLaws());
  const [lawyerProfile, setLawyerProfileState] = useState<LawyerProfile>(() => toolboxStorage.getLawyerProfile());
  const [savedPrompts, setSavedPromptsState] = useState<SavedAiPrompt[]>(() => toolboxStorage.getSavedPrompts());
  const [casePockets, setCasePocketsState] = useState<CasePocket[]>(() => toolboxStorage.getCasePockets());
  const [activeCaseId, setActiveCaseIdState] = useState<string>(() => toolboxStorage.getActiveCaseId());
  const [aiHandoff, setAiHandoff] = useState<AiHandoffPayload | null>(null);

  const [syncPrefs, setSyncPrefs] = useState<CloudSyncPrefs>(() => getCloudSyncPrefs());
  const [sessionSyncPassphrase, setSessionSyncPassphrase] = useState<string>('');
  const [syncState, setSyncState] = useState<CloudSyncStatusState>(() => {
    const meta = getCloudSyncMeta();
    return {
      status: meta.lastSyncedAt ? 'synced' : 'idle',
      lastSyncedAt: meta.lastSyncedAt,
      revision: meta.revision,
      deviceLabel: meta.lastDeviceLabel,
      clientEncrypted: false,
      errorMsg: '',
    };
  });

  const syncBusyRef = useRef(false);
  const pushTimerRef = useRef<number | null>(null);
  const syncPrefsRef = useRef(syncPrefs);
  syncPrefsRef.current = syncPrefs;
  const syncPassRef = useRef(sessionSyncPassphrase);
  syncPassRef.current = sessionSyncPassphrase;
  const syncStatusRef = useRef(syncState.status);
  syncStatusRef.current = syncState.status;
  const licenseRef = useRef(license);
  licenseRef.current = license;

  const ownerKey = license ? `name:${license.holderName}` : '';
  const canCloudSync = Boolean(license && license.rawCode.startsWith('TR1-'));

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Sync active tab / open tool to URL hash so browser reloads restore exact working location
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextHash = buildRouteHash(activeTab, activeToolId);
    if (window.location.hash !== nextHash) {
      const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
      try {
        window.history.replaceState(null, '', nextUrl);
      } catch {
        // ignore history error in restricted WebViews
      }
    }
  }, [activeTab, activeToolId]);

  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseRouteHash();
      setActiveTab(parsed.tab);
      setActiveToolId(parsed.toolId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const refreshAllFromDisk = useCallback(() => {
    setByok(toolboxStorage.getByok());
    setHistory(toolboxStorage.getHistory());
    setDeadlinesState(toolboxStorage.getDeadlines());
    setChecklistsState(toolboxStorage.getChecklists());
    setScratchpadsState(toolboxStorage.getScratchpads());
    setPinnedToolsState(toolboxStorage.getPinnedTools());
    setStarredLawsState(toolboxStorage.getStarredLaws());
    setLawyerProfileState(toolboxStorage.getLawyerProfile());
    setSavedPromptsState(toolboxStorage.getSavedPrompts());
    setCasePocketsState(toolboxStorage.getCasePockets());
    setActiveCaseIdState(toolboxStorage.getActiveCaseId());
  }, []);

  const triggerCloudPush = useCallback(
    async (force = false, silent = false, overridePassphrase?: string): Promise<boolean> => {
      const lic = licenseRef.current;
      const prefs = syncPrefsRef.current;
      if (!lic || !lic.rawCode.startsWith('TR1-')) return false;
      if (!prefs.enabled && !force) return false;
      if (!navigator.onLine) {
        setSyncState((prev) => ({ ...prev, status: 'offline', errorMsg: '当前离线，联网后自动同步' }));
        return false;
      }
      const pass = overridePassphrase !== undefined ? overridePassphrase : syncPassRef.current;
      if (prefs.useE2eePassphrase && !pass.trim()) {
        setSyncState((prev) => ({
          ...prev,
          status: 'locked',
          clientEncrypted: true,
          errorMsg: '已启用端到端同步口令，请先在「我的配置」填入同步口令',
        }));
        return false;
      }
      if (syncBusyRef.current) return false;
      syncBusyRef.current = true;
      setSyncState((prev) => ({ ...prev, status: 'syncing', errorMsg: '' }));

      try {
        const meta = getCloudSyncMeta();
        const curOwner = `name:${lic.holderName}`;
        const baseRevision = meta.ownerKey === curOwner ? meta.revision : 0;
        const snapshot = buildLocalSyncSnapshot(prefs);
        const res = await pushCloudVault({
          licenseRawCode: lic.rawCode,
          snapshot,
          baseRevision,
          force,
          e2eePassphrase: prefs.useE2eePassphrase ? pass : '',
        });

        if (res.conflict) {
          setSyncState((prev) => ({
            ...prev,
            status: 'conflict',
            revision: res.serverRevision || prev.revision,
            lastSyncedAt: res.serverUpdatedAt || prev.lastSyncedAt,
            deviceLabel: res.deviceLabel || prev.deviceLabel,
            clientEncrypted: Boolean(res.clientEncrypted),
            errorMsg: '检测到另一台设备刚刚更新了云端配置，请点击「从云端拉取」或「强制上传覆盖」',
          }));
          if (!silent) showToast('云端存在更新版本，请在同步卡片中选择拉取或覆盖');
          return false;
        }

        const nextRev = res.revision || baseRevision + 1;
        const nextTs = res.updatedAt || snapshot.syncedAt;
        saveCloudSyncMeta({
          ownerKey: curOwner,
          revision: nextRev,
          lastSyncedAt: nextTs,
          localModifiedAt: 0,
          lastDeviceLabel: snapshot.deviceLabel,
        });
        setSyncState({
          status: 'synced',
          lastSyncedAt: nextTs,
          revision: nextRev,
          deviceLabel: snapshot.deviceLabel,
          clientEncrypted: Boolean(prefs.useE2eePassphrase && pass.trim()),
          errorMsg: '',
        });
        if (!silent) showToast('☁️ 本机配置已加密上传至您的激活码云端');
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '云端同步上传失败';
        setSyncState((prev) => ({ ...prev, status: 'error', errorMsg: msg }));
        if (!silent) showToast(msg);
        return false;
      } finally {
        syncBusyRef.current = false;
      }
    },
    [showToast]
  );

  const triggerCloudPull = useCallback(
    async (silent = false, overridePassphrase?: string): Promise<boolean> => {
      const lic = licenseRef.current;
      const prefs = syncPrefsRef.current;
      if (!lic || !lic.rawCode.startsWith('TR1-')) return false;
      if (!navigator.onLine) {
        setSyncState((prev) => ({ ...prev, status: 'offline', errorMsg: '当前离线，联网后自动同步' }));
        return false;
      }
      if (syncBusyRef.current) return false;
      syncBusyRef.current = true;
      setSyncState((prev) => ({ ...prev, status: 'syncing', errorMsg: '' }));

      try {
        const res = await pullCloudVault(lic.rawCode);
        if (res.supported === false) {
          setSyncState((prev) => ({ ...prev, status: 'idle', errorMsg: '' }));
          return false;
        }
        const curOwner = `name:${lic.holderName}`;
        const meta = getCloudSyncMeta();
        const sameOwner = meta.ownerKey === curOwner;

        if (!res.exists || !res.payload) {
          if (silent && prefs.enabled && hasMeaningfulLocalConfig()) {
            syncBusyRef.current = false;
            const pushed = await triggerCloudPush(true, true, overridePassphrase);
            if (pushed) {
              showToast('☁️ 已将您本机已有配置自动同步至激活码云端，换设备登录即自动恢复');
            }
            return pushed;
          }
          setSyncState({
            status: 'idle',
            lastSyncedAt: 0,
            revision: 0,
            deviceLabel: '',
            clientEncrypted: false,
            errorMsg: '',
          });
          if (!silent) showToast('云端尚无备份记录，点击「立即上传本机配置」即可建立云端同步');
          return false;
        }

        const pass = overridePassphrase !== undefined ? overridePassphrase : syncPassRef.current;
        if (res.clientEncrypted && !pass.trim()) {
          setSyncState({
            status: 'locked',
            lastSyncedAt: res.updatedAt || 0,
            revision: res.revision || 0,
            deviceLabel: res.deviceLabel || '',
            clientEncrypted: true,
            errorMsg: '云端配置已开启独立口令端到端加密，请在「我的配置」输入同步口令解锁',
          });
          if (!silent) showToast('请先输入您的端到端同步口令后再拉取');
          return false;
        }

        const snap = await decodeSyncSnapshotFromCloud(Boolean(res.clientEncrypted), res.payload, pass);
        const cloudRev = res.revision || 1;
        const cloudTs = res.updatedAt || snap.syncedAt || Date.now();
        const localRev = sameOwner ? meta.revision : 0;
        const localMod = sameOwner ? meta.localModifiedAt : 0;

        const shouldApplyCloud =
          !silent ||
          !sameOwner ||
          !hasMeaningfulLocalConfig() ||
          (cloudRev > localRev && localMod <= cloudTs);

        if (shouldApplyCloud) {
          const applied = applyCloudSyncSnapshot(snap, prefs);
          refreshAllFromDisk();
          saveCloudSyncMeta({
            ownerKey: curOwner,
            revision: cloudRev,
            lastSyncedAt: cloudTs,
            localModifiedAt: 0,
            lastDeviceLabel: res.deviceLabel || snap.deviceLabel || '',
          });
          setSyncState({
            status: 'synced',
            lastSyncedAt: cloudTs,
            revision: cloudRev,
            deviceLabel: res.deviceLabel || snap.deviceLabel || '',
            clientEncrypted: Boolean(res.clientEncrypted),
            errorMsg: '',
          });
          if (!silent || !sameOwner || cloudRev > localRev) {
            const byokHint =
              applied.appliedByok && applied.providerCount > 0
                ? `（含 ${applied.providerCount} 组大模型配置）`
                : '';
            showToast(`☁️ 已按激活码自动同步云端配置${byokHint}`);
          }
          return true;
        }

        if (localMod > cloudTs && prefs.enabled) {
          syncBusyRef.current = false;
          return await triggerCloudPush(false, true, overridePassphrase);
        }

        setSyncState({
          status: 'synced',
          lastSyncedAt: cloudTs,
          revision: cloudRev,
          deviceLabel: res.deviceLabel || snap.deviceLabel || '',
          clientEncrypted: Boolean(res.clientEncrypted),
          errorMsg: '',
        });
        return true;
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : '拉取云端配置失败';
        const msg =
          rawMsg === 'E2EE_LOCKED'
            ? '云端配置已开启端到端加密，请输入同步口令解锁'
            : rawMsg.includes('解密失败') || rawMsg.includes('口令')
            ? '端到端同步口令不正确，无法解密云端配置'
            : rawMsg;
        setSyncState((prev) => ({
          ...prev,
          status: rawMsg === 'E2EE_LOCKED' ? 'locked' : 'error',
          errorMsg: msg,
        }));
        if (!silent) showToast(msg);
        return false;
      } finally {
        syncBusyRef.current = false;
      }
    },
    [refreshAllFromDisk, showToast, triggerCloudPush]
  );

  const scheduleAutoPush = useCallback(() => {
    const lic = licenseRef.current;
    const prefs = syncPrefsRef.current;
    if (!lic || !lic.rawCode.startsWith('TR1-') || !prefs.enabled) return;
    if (syncStatusRef.current === 'locked') return;
    touchLocalSyncModified(`name:${lic.holderName}`);
    if (pushTimerRef.current !== null) {
      window.clearTimeout(pushTimerRef.current);
    }
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null;
      triggerCloudPush(false, true);
    }, 1500);
  }, [triggerCloudPush]);

  const updateSyncPrefs = useCallback(
    (patch: Partial<CloudSyncPrefs>) => {
      setSyncPrefs((prev) => {
        const next = { ...prev, ...patch };
        saveCloudSyncPrefs(next);
        return next;
      });
    },
    []
  );

  const clearCloudVaultBackup = useCallback(async () => {
    const lic = licenseRef.current;
    if (!lic || !lic.rawCode.startsWith('TR1-')) return;
    await deleteCloudVault(lic.rawCode);
    saveCloudSyncMeta({
      ownerKey: `name:${lic.holderName}`,
      revision: 0,
      lastSyncedAt: 0,
      localModifiedAt: 0,
      lastDeviceLabel: '',
    });
    setSyncState({
      status: 'idle',
      lastSyncedAt: 0,
      revision: 0,
      deviceLabel: '',
      clientEncrypted: false,
      errorMsg: '',
    });
    showToast('已清空您的云端同步副本（本机数据不受影响）');
  }, [showToast]);

  // Auto-sync on activation / app boot / online reconnect / returning to tab
  useEffect(() => {
    if (!canCloudSync || !syncPrefs.enabled) return;
    if (!isOnline) {
      setSyncState((prev) => ({ ...prev, status: 'offline' }));
      return;
    }
    const timer = window.setTimeout(() => {
      triggerCloudPull(true);
    }, 250);

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        triggerCloudPull(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [canCloudSync, ownerKey, isOnline, syncPrefs.enabled, triggerCloudPull]);

  useEffect(() => {
    return () => {
      if (pushTimerRef.current !== null) {
        window.clearTimeout(pushTimerRef.current);
      }
    };
  }, []);

  const updateByok = useCallback(
    (next: ByokSettings) => {
      setByok(next);
      toolboxStorage.saveByok(next);
      scheduleAutoPush();
    },
    [scheduleAutoPush]
  );

  const recordCalculation = useCallback(
    (toolId: OfflineToolId, toolTitle: string, summary: string, detailText: string) => {
      const updated = toolboxStorage.addHistory({
        toolId,
        toolTitle,
        summary,
        detailText,
        ...(activeCaseId ? { caseId: activeCaseId } : {}),
      });
      setHistory(updated);
      scheduleAutoPush();
      showToast(activeCaseId ? '已存入当前案件口袋与离线记录' : '已存入手机离线测算记录');
    },
    [activeCaseId, scheduleAutoPush, showToast]
  );

  const clearHistory = useCallback(() => {
    toolboxStorage.clearHistory();
    setHistory([]);
    scheduleAutoPush();
    showToast('已清空测算记录');
  }, [scheduleAutoPush, showToast]);

  const setDeadlines = useCallback(
    (items: DeadlineReminderItem[]) => {
      setDeadlinesState(items);
      toolboxStorage.saveDeadlines(items);
      scheduleAutoPush();
    },
    [scheduleAutoPush]
  );

  const setChecklists = useCallback(
    (items: ChecklistInstance[]) => {
      setChecklistsState(items);
      toolboxStorage.saveChecklists(items);
      scheduleAutoPush();
    },
    [scheduleAutoPush]
  );

  const setScratchpads = useCallback(
    (notes: ScratchpadNote[]) => {
      setScratchpadsState(notes);
      toolboxStorage.saveScratchpads(notes);
      scheduleAutoPush();
    },
    [scheduleAutoPush]
  );

  const togglePinTool = useCallback(
    (id: OfflineToolId) => {
      setPinnedToolsState((prev) => {
        const exists = prev.includes(id);
        const next = exists ? prev.filter((x) => x !== id) : [...prev, id];
        toolboxStorage.savePinnedTools(next);
        return next;
      });
      scheduleAutoPush();
    },
    [scheduleAutoPush]
  );

  const toggleStarLaw = useCallback(
    (key: string) => {
      setStarredLawsState((prev) => {
        const exists = prev.includes(key);
        const next = exists ? prev.filter((x) => x !== key) : [key, ...prev];
        toolboxStorage.saveStarredLaws(next);
        return next;
      });
      scheduleAutoPush();
    },
    [scheduleAutoPush]
  );

  const updateLawyerProfile = useCallback(
    (profile: LawyerProfile) => {
      toolboxStorage.saveLawyerProfile(profile);
      setLawyerProfileState(toolboxStorage.getLawyerProfile());
      scheduleAutoPush();
      showToast('个人执业与落款档案已保存，并已同步关联至各文书与报价工具');
    },
    [scheduleAutoPush, showToast]
  );

  const addSavedPrompt = useCallback(
    (label: string, content: string, specialistId?: AiSpecialistId) => {
      const cleanContent = content.trim();
      if (!cleanContent) return;
      const cleanLabel = label.trim() || (cleanContent.length > 14 ? `${cleanContent.slice(0, 14)}…` : cleanContent);
      setSavedPromptsState((prev) => {
        const next: SavedAiPrompt[] = [
          {
            id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            label: cleanLabel,
            content: cleanContent,
            ...(specialistId ? { specialistId } : {}),
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 30);
        toolboxStorage.saveSavedPrompts(next);
        return next;
      });
      scheduleAutoPush();
      showToast(`已收藏常用指令「${cleanLabel}」`);
    },
    [scheduleAutoPush, showToast]
  );

  const deleteSavedPrompt = useCallback(
    (id: string) => {
      setSavedPromptsState((prev) => {
        const next = prev.filter((p) => p.id !== id);
        toolboxStorage.saveSavedPrompts(next);
        return next;
      });
      scheduleAutoPush();
    },
    [scheduleAutoPush]
  );

  const setActiveCaseId = useCallback((caseId: string) => {
    setActiveCaseIdState(caseId);
    toolboxStorage.saveActiveCaseId(caseId);
  }, []);

  const addCasePocket = useCallback(
    (input: Omit<CasePocket, 'id' | 'createdAt' | 'updatedAt'>): CasePocket => {
      const now = new Date().toISOString();
      const item: CasePocket = {
        ...input,
        id: `case-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        title: input.title.trim() || '未命名案件',
        createdAt: now,
        updatedAt: now,
      };
      setCasePocketsState((prev) => {
        const next = [item, ...prev].slice(0, 80);
        toolboxStorage.saveCasePockets(next);
        return next;
      });
      setActiveCaseIdState(item.id);
      toolboxStorage.saveActiveCaseId(item.id);
      showToast(`已创建本地案件口袋「${item.title}」并设为当前办理案件`);
      return item;
    },
    [showToast]
  );

  const updateCasePocket = useCallback(
    (id: string, patch: Partial<Omit<CasePocket, 'id' | 'createdAt'>>) => {
      setCasePocketsState((prev) => {
        const next = prev.map((c) =>
          c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c
        );
        toolboxStorage.saveCasePockets(next);
        return next;
      });
    },
    []
  );

  const deleteCasePocket = useCallback(
    (id: string) => {
      setCasePocketsState((prev) => {
        const next = prev.filter((c) => c.id !== id);
        toolboxStorage.saveCasePockets(next);
        return next;
      });
      setActiveCaseIdState((prev) => {
        if (prev === id) {
          toolboxStorage.saveActiveCaseId('');
          return '';
        }
        return prev;
      });
      showToast('已删除该本地案件口袋（原测算记录仍保留在全部记录中）');
    },
    [showToast]
  );

  const recordToolHit = useCallback((toolId: string) => {
    if (!toolId) return;
    toolboxStorage.incrementLocalToolHit(toolId);
    const lic = licenseRef.current;
    if (lic && lic.rawCode.startsWith('TR1-')) {
      pingAnonymousToolHit(toolId, lic.rawCode);
    }
  }, []);

  const navigateTab = useCallback((tab: MainTabId) => {
    setActiveTab(tab);
    if (tab !== 'tools') {
      setActiveToolId(null);
    }
    window.scrollTo(0, 0);
  }, []);

  const openTool = useCallback(
    (toolId: OfflineToolId | null) => {
      if (toolId === null) {
        setActiveToolId(null);
        return;
      }
      recordToolHit(toolId);
      setActiveTab('tools');
      setActiveToolId(toolId);
      window.scrollTo(0, 0);
    },
    [recordToolHit]
  );

  const openLawsSearch = useCallback(
    (
      query = '',
      subView: 'statutes' | 'ima_cloud' | 'checklists' = 'statutes',
      checklistId = ''
    ) => {
      if (subView === 'ima_cloud') recordToolHit('ima-cloud-qa');
      setActiveToolId(null);
      setLawsInitialQuery(query);
      setLawsSubView(subView);
      if (checklistId) setLawsChecklistId(checklistId);
      setActiveTab('laws');
      window.scrollTo(0, 0);
    },
    [recordToolHit]
  );

  const sendToAi = useCallback(
    (specialistId: AiSpecialistId, sourceTitle: string, promptContext: string) => {
      recordToolHit(`ai:${specialistId}`);
      setActiveToolId(null);
      setActiveSpecialistId(specialistId);
      setAiHandoff({
        specialistId,
        sourceTitle,
        promptContext,
        timestamp: Date.now(),
      });
      setActiveTab('ai');
      window.scrollTo(0, 0);
      showToast(`已将「${sourceTitle}」结果载入 AI 智囊舱`);
    },
    [recordToolHit, showToast]
  );

  const clearAiHandoff = useCallback(() => setAiHandoff(null), []);

  return (
    <ToolboxContext.Provider
      value={{
        activeTab,
        activeToolId,
        activeSpecialistId,
        lawsInitialQuery,
        lawsSubView,
        lawsChecklistId,
        isOnline,
        toastMessage,
        byok,
        updateByok,
        sessionUnlockedPin,
        setSessionUnlockedPin,
        syncPrefs,
        updateSyncPrefs,
        syncState,
        sessionSyncPassphrase,
        setSessionSyncPassphrase,
        triggerCloudPush,
        triggerCloudPull,
        clearCloudVaultBackup,
        history,
        recordCalculation,
        clearHistory,
        deadlines,
        setDeadlines,
        checklists,
        setChecklists,
        scratchpads,
        setScratchpads,
        pinnedTools,
        togglePinTool,
        starredLaws,
        toggleStarLaw,
        lawyerProfile,
        updateLawyerProfile,
        savedPrompts,
        addSavedPrompt,
        deleteSavedPrompt,
        casePockets,
        activeCaseId,
        setActiveCaseId,
        addCasePocket,
        updateCasePocket,
        deleteCasePocket,
        recordToolHit,
        aiHandoff,
        clearAiHandoff,
        navigateTab,
        openTool,
        openLawsSearch,
        sendToAi,
        showToast,
        refreshAllFromDisk,
      }}
    >
      {children}
    </ToolboxContext.Provider>
  );
};

export function useToolbox(): ToolboxContextValue {
  const ctx = useContext(ToolboxContext);
  if (!ctx) {
    throw new Error('useToolbox must be used inside ToolboxProvider');
  }
  return ctx;
}
