import type {
  ByokSettings,
  CalculationHistoryItem,
  CasePocket,
  ChecklistInstance,
  DeadlineReminderItem,
  LawyerProfile,
  OfflineToolId,
  SavedAiPrompt,
  ScratchpadNote,
} from '../types/toolbox';
import { AI_PROVIDER_PRESETS } from './aiClient.ts';

const KEYS = {
  BYOK: 'cn_lawyer_box_byok_v1',
  HISTORY: 'cn_lawyer_box_calc_history_v1',
  DEADLINES: 'cn_lawyer_box_deadlines_v1',
  CHECKLISTS: 'cn_lawyer_box_checklists_v1',
  SCRATCHPADS: 'cn_lawyer_box_scratchpads_v1',
  PINNED_TOOLS: 'cn_lawyer_box_pinned_tools_v1',
  STARRED_LAWS: 'cn_lawyer_box_starred_laws_v1',
  LAWYER_PROFILE: 'cn_lawyer_box_lawyer_profile_v1',
  SAVED_PROMPTS: 'cn_lawyer_box_saved_prompts_v1',
  CASE_POCKETS: 'cn_lawyer_box_case_pockets_v1',
  ACTIVE_CASE_ID: 'cn_lawyer_box_active_case_id_v1',
  LOCAL_TOOL_HITS: 'cn_lawyer_box_local_tool_hits_v1',
};

export const EMPTY_LAWYER_PROFILE: LawyerProfile = {
  name: '',
  licenseNo: '',
  firmName: '',
  phone: '',
  address: '',
  email: '',
};

export const DEFAULT_SAVED_AI_PROMPTS: SavedAiPrompt[] = [
  {
    id: 'starter-concise-cite',
    label: '精简 1200 字 + 核验表',
    content: '正文控制在 1200 字以内，保持冷峻克制的法庭文风，文末附核心争议点与待核法条清单',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'starter-judge-view',
    label: '法官审理视角挑漏洞',
    content: '请同时站在承办法官与对方律师的双重视角，指出我方论证最薄弱的 3 处证据或逻辑短板并给补强方案',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'starter-court-submit',
    label: '直接提交版（去套话）',
    content: '直接输出可提交司法机关的正式成稿，删去一切开场客套、时代背景句与情绪化修饰',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or private mode
  }
}

export function getDefaultByokSettings(): ByokSettings {
  const ds = AI_PROVIDER_PRESETS[0];
  return {
    activeProviderId: 'default-deepseek',
    defaultModelSlot: 'fast',
    autoRedactPrompt: true,
    pinEnabled: false,
    providers: [
      {
        id: 'default-deepseek',
        presetId: ds.id,
        name: ds.name,
        protocol: ds.protocol,
        baseUrl: ds.baseUrl,
        apiKey: '',
        fastModel: ds.fastModel,
        reasoningModel: ds.reasoningModel,
        visionModel: ds.visionModel,
      },
    ],
  };
}

export const toolboxStorage = {
  getByok(): ByokSettings {
    const saved = readJson<ByokSettings | null>(KEYS.BYOK, null);
    if (!saved || !Array.isArray(saved.providers) || saved.providers.length === 0) {
      return getDefaultByokSettings();
    }
    // Transparently backfill preset visionModel for existing users upgrading to multimodal version
    const providers = saved.providers.map((p) => {
      if (p.visionModel !== undefined) return p;
      const preset = AI_PROVIDER_PRESETS.find((pr) => pr.id === p.presetId);
      return preset ? { ...p, visionModel: preset.visionModel } : p;
    });
    return { ...saved, providers };
  },
  saveByok(settings: ByokSettings): void {
    writeJson(KEYS.BYOK, settings);
  },

  getHistory(): CalculationHistoryItem[] {
    return readJson<CalculationHistoryItem[]>(KEYS.HISTORY, []);
  },
  addHistory(item: Omit<CalculationHistoryItem, 'id' | 'createdAt'>): CalculationHistoryItem[] {
    const list = toolboxStorage.getHistory();
    const next: CalculationHistoryItem = {
      ...item,
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    const updated = [next, ...list].slice(0, 40);
    writeJson(KEYS.HISTORY, updated);
    return updated;
  },
  clearHistory(): void {
    writeJson(KEYS.HISTORY, []);
  },

  getDeadlines(): DeadlineReminderItem[] {
    return readJson<DeadlineReminderItem[]>(KEYS.DEADLINES, []);
  },
  saveDeadlines(items: DeadlineReminderItem[]): void {
    writeJson(KEYS.DEADLINES, items);
  },

  getChecklists(): ChecklistInstance[] {
    return readJson<ChecklistInstance[]>(KEYS.CHECKLISTS, []);
  },
  saveChecklists(items: ChecklistInstance[]): void {
    writeJson(KEYS.CHECKLISTS, items);
  },

  getScratchpads(): ScratchpadNote[] {
    return readJson<ScratchpadNote[]>(KEYS.SCRATCHPADS, []);
  },
  saveScratchpads(notes: ScratchpadNote[]): void {
    writeJson(KEYS.SCRATCHPADS, notes);
  },

  getPinnedTools(): OfflineToolId[] {
    const validIds = new Set<string>([
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
    ]);
    const defaults: OfflineToolId[] = [
      'elements-complaint',
      'lawyer-fee-quote',
      'litigation-fee-calculator',
      'lpr-interest-calculator',
      'date-calculator',
      'preservation-deadline',
      'local-redactor',
      'evidence-pdf-toolkit',
    ];
    const saved = readJson<string[]>(KEYS.PINNED_TOOLS, defaults);
    const hadRemoved = saved.some((id) => !validIds.has(id));
    const cleaned = saved.filter((id): id is OfflineToolId => validIds.has(id));
    if (hadRemoved && !cleaned.includes('elements-complaint')) {
      cleaned.unshift('elements-complaint');
    }
    if (cleaned.length === 0) return defaults;
    if (hadRemoved) {
      writeJson(KEYS.PINNED_TOOLS, cleaned);
    }
    return cleaned;
  },
  savePinnedTools(ids: OfflineToolId[]): void {
    writeJson(KEYS.PINNED_TOOLS, ids);
  },

  getStarredLaws(): string[] {
    return readJson<string[]>(KEYS.STARRED_LAWS, ['civil:585', 'civil:561', 'civil:577', 'civil:1195']);
  },
  saveStarredLaws(keys: string[]): void {
    writeJson(KEYS.STARRED_LAWS, keys);
  },

  getLawyerProfile(): LawyerProfile {
    const saved = readJson<Partial<LawyerProfile> | null>(KEYS.LAWYER_PROFILE, null);
    if (!saved || typeof saved !== 'object') return { ...EMPTY_LAWYER_PROFILE };
    return {
      name: String(saved.name || ''),
      licenseNo: String(saved.licenseNo || ''),
      firmName: String(saved.firmName || ''),
      phone: String(saved.phone || ''),
      address: String(saved.address || ''),
      email: String(saved.email || ''),
    };
  },
  saveLawyerProfile(profile: LawyerProfile): void {
    const clean: LawyerProfile = {
      name: String(profile.name || '').trim(),
      licenseNo: String(profile.licenseNo || '').trim(),
      firmName: String(profile.firmName || '').trim(),
      phone: String(profile.phone || '').trim(),
      address: String(profile.address || '').trim(),
      email: String(profile.email || '').trim(),
    };
    writeJson(KEYS.LAWYER_PROFILE, clean);
    try {
      const existingRaw = localStorage.getItem('lf-sheet');
      const sheet = existingRaw ? JSON.parse(existingRaw) : {};
      if (sheet && typeof sheet === 'object') {
        if (clean.firmName) sheet.firm = clean.firmName;
        if (clean.name) sheet.author = clean.name;
        if (clean.phone) sheet.phone = clean.phone;
        localStorage.setItem('lf-sheet', JSON.stringify(sheet));
      }
    } catch {
      // ignore iframe storage errors
    }
  },

  getSavedPrompts(): SavedAiPrompt[] {
    const saved = readJson<SavedAiPrompt[] | null>(KEYS.SAVED_PROMPTS, null);
    if (!saved || !Array.isArray(saved)) return [...DEFAULT_SAVED_AI_PROMPTS];
    return saved;
  },
  saveSavedPrompts(prompts: SavedAiPrompt[]): void {
    writeJson(KEYS.SAVED_PROMPTS, prompts.slice(0, 30));
  },

  getCasePockets(): CasePocket[] {
    return readJson<CasePocket[]>(KEYS.CASE_POCKETS, []);
  },
  saveCasePockets(cases: CasePocket[]): void {
    writeJson(KEYS.CASE_POCKETS, cases.slice(0, 80));
  },
  getActiveCaseId(): string {
    try {
      return localStorage.getItem(KEYS.ACTIVE_CASE_ID) || '';
    } catch {
      return '';
    }
  },
  saveActiveCaseId(caseId: string): void {
    try {
      if (caseId) localStorage.setItem(KEYS.ACTIVE_CASE_ID, caseId);
      else localStorage.removeItem(KEYS.ACTIVE_CASE_ID);
    } catch {
      // ignore
    }
  },

  getLocalToolHits(): Record<string, number> {
    return readJson<Record<string, number>>(KEYS.LOCAL_TOOL_HITS, {});
  },
  incrementLocalToolHit(toolId: string): Record<string, number> {
    const cur = toolboxStorage.getLocalToolHits();
    const next = { ...cur, [toolId]: (Number(cur[toolId]) || 0) + 1 };
    writeJson(KEYS.LOCAL_TOOL_HITS, next);
    return next;
  },

  exportFullWorkspaceJson(): string {
    return JSON.stringify(
      {
        app: 'cn-lawyer-ai-toolbox',
        exportedAt: new Date().toISOString(),
        history: toolboxStorage.getHistory(),
        deadlines: toolboxStorage.getDeadlines(),
        checklists: toolboxStorage.getChecklists(),
        scratchpads: toolboxStorage.getScratchpads(),
        pinnedTools: toolboxStorage.getPinnedTools(),
        starredLaws: toolboxStorage.getStarredLaws(),
        lawyerProfile: toolboxStorage.getLawyerProfile(),
        savedPrompts: toolboxStorage.getSavedPrompts(),
        casePockets: toolboxStorage.getCasePockets(),
      },
      null,
      2
    );
  },

  importFullWorkspaceJson(raw: string): void {
    const parsed = JSON.parse(raw);
    if (parsed.app !== 'cn-lawyer-ai-toolbox' && parsed.app !== 'tianran-ai-toolbox') {
      throw new Error('非本工具箱合法备份文件');
    }
    if (Array.isArray(parsed.history)) writeJson(KEYS.HISTORY, parsed.history);
    if (Array.isArray(parsed.deadlines)) writeJson(KEYS.DEADLINES, parsed.deadlines);
    if (Array.isArray(parsed.checklists)) writeJson(KEYS.CHECKLISTS, parsed.checklists);
    if (Array.isArray(parsed.scratchpads)) writeJson(KEYS.SCRATCHPADS, parsed.scratchpads);
    if (Array.isArray(parsed.pinnedTools)) writeJson(KEYS.PINNED_TOOLS, parsed.pinnedTools);
    if (Array.isArray(parsed.starredLaws)) writeJson(KEYS.STARRED_LAWS, parsed.starredLaws);
    if (parsed.lawyerProfile && typeof parsed.lawyerProfile === 'object') {
      toolboxStorage.saveLawyerProfile(parsed.lawyerProfile);
    }
    if (Array.isArray(parsed.savedPrompts)) writeJson(KEYS.SAVED_PROMPTS, parsed.savedPrompts);
    if (Array.isArray(parsed.casePockets)) writeJson(KEYS.CASE_POCKETS, parsed.casePockets);
  },
};
