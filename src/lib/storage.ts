import type {
  ByokSettings,
  CalculationHistoryItem,
  ChecklistInstance,
  DeadlineReminderItem,
  OfflineToolId,
  ScratchpadNote,
} from '../types/toolbox';
import { AI_PROVIDER_PRESETS } from './aiClient';

const KEYS = {
  BYOK: 'cn_lawyer_box_byok_v1',
  HISTORY: 'cn_lawyer_box_calc_history_v1',
  DEADLINES: 'cn_lawyer_box_deadlines_v1',
  CHECKLISTS: 'cn_lawyer_box_checklists_v1',
  SCRATCHPADS: 'cn_lawyer_box_scratchpads_v1',
  PINNED_TOOLS: 'cn_lawyer_box_pinned_tools_v1',
  STARRED_LAWS: 'cn_lawyer_box_starred_laws_v1',
};

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
  },
};
