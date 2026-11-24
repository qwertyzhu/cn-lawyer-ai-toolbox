import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type {
  AiHandoffPayload,
  AiSpecialistId,
  ByokSettings,
  CalculationHistoryItem,
  ChecklistInstance,
  DeadlineReminderItem,
  MainTabId,
  OfflineToolId,
  ScratchpadNote,
} from '../types/toolbox';
import { toolboxStorage } from '../lib/storage';

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

export const ToolboxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<MainTabId>('home');
  const [activeToolId, setActiveToolId] = useState<OfflineToolId | null>(null);
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
  const [aiHandoff, setAiHandoff] = useState<AiHandoffPayload | null>(null);

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

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const updateByok = useCallback((next: ByokSettings) => {
    setByok(next);
    toolboxStorage.saveByok(next);
  }, []);

  const recordCalculation = useCallback(
    (toolId: OfflineToolId, toolTitle: string, summary: string, detailText: string) => {
      const updated = toolboxStorage.addHistory({ toolId, toolTitle, summary, detailText });
      setHistory(updated);
      showToast('已存入手机离线测算记录');
    },
    [showToast]
  );

  const clearHistory = useCallback(() => {
    toolboxStorage.clearHistory();
    setHistory([]);
    showToast('已清空测算记录');
  }, [showToast]);

  const setDeadlines = useCallback((items: DeadlineReminderItem[]) => {
    setDeadlinesState(items);
    toolboxStorage.saveDeadlines(items);
  }, []);

  const setChecklists = useCallback((items: ChecklistInstance[]) => {
    setChecklistsState(items);
    toolboxStorage.saveChecklists(items);
  }, []);

  const setScratchpads = useCallback((notes: ScratchpadNote[]) => {
    setScratchpadsState(notes);
    toolboxStorage.saveScratchpads(notes);
  }, []);

  const togglePinTool = useCallback((id: OfflineToolId) => {
    setPinnedToolsState((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((x) => x !== id) : [...prev, id];
      toolboxStorage.savePinnedTools(next);
      return next;
    });
  }, []);

  const toggleStarLaw = useCallback((key: string) => {
    setStarredLawsState((prev) => {
      const exists = prev.includes(key);
      const next = exists ? prev.filter((x) => x !== key) : [key, ...prev];
      toolboxStorage.saveStarredLaws(next);
      return next;
    });
  }, []);

  const navigateTab = useCallback((tab: MainTabId) => {
    setActiveTab(tab);
    if (tab !== 'tools') {
      setActiveToolId(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openTool = useCallback((toolId: OfflineToolId | null) => {
    if (toolId === null) {
      setActiveToolId(null);
      return;
    }
    setActiveTab('tools');
    setActiveToolId(toolId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openLawsSearch = useCallback(
    (
      query = '',
      subView: 'statutes' | 'ima_cloud' | 'checklists' = 'statutes',
      checklistId = ''
    ) => {
      setActiveToolId(null);
      setLawsInitialQuery(query);
      setLawsSubView(subView);
      if (checklistId) setLawsChecklistId(checklistId);
      setActiveTab('laws');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    []
  );

  const sendToAi = useCallback(
    (specialistId: AiSpecialistId, sourceTitle: string, promptContext: string) => {
      setActiveToolId(null);
      setActiveSpecialistId(specialistId);
      setAiHandoff({
        specialistId,
        sourceTitle,
        promptContext,
        timestamp: Date.now(),
      });
      setActiveTab('ai');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(`已将「${sourceTitle}」结果载入 AI 智囊舱`);
    },
    [showToast]
  );

  const clearAiHandoff = useCallback(() => setAiHandoff(null), []);

  const refreshAllFromDisk = useCallback(() => {
    setByok(toolboxStorage.getByok());
    setHistory(toolboxStorage.getHistory());
    setDeadlinesState(toolboxStorage.getDeadlines());
    setChecklistsState(toolboxStorage.getChecklists());
    setScratchpadsState(toolboxStorage.getScratchpads());
    setPinnedToolsState(toolboxStorage.getPinnedTools());
    setStarredLawsState(toolboxStorage.getStarredLaws());
  }, []);

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
