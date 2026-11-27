export type MainTabId = 'home' | 'tools' | 'ai' | 'laws' | 'settings';

export type ToolCategoryCode = 'pleading_lit' | 'civil_exec' | 'labor_injury' | 'privacy_doc';

export type OfflineToolId =
  | 'elements-complaint'
  | 'litigation-fee-calculator'
  | 'lpr-interest-calculator'
  | 'date-calculator'
  | 'labor-compensation'
  | 'injury-compensation'
  | 'evidence-pdf-toolkit'
  | 'local-redactor'
  | 'lawyer-fee-quote'
  | 'preservation-deadline'
  | 'rmb-debt-offset'
  | 'meeting-scratchpad';

export type AiSpecialistId =
  | 'contract-review'
  | 'de-ai-polish'
  | 'timeline-elements'
  | 'cross-exam-questions'
  | 'client-wechat-reply'
  | 'legal-sandbox';

export type AiProtocol = 'openai' | 'anthropic';

export interface AiImageAttachment {
  id: string;
  name: string;
  dataUrl: string; // data:image/jpeg;base64,...
  mimeType: string;
  width: number;
  height: number;
  sizeKb: number;
}

export interface AiProviderConfig {
  id: string;
  presetId: string;
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string; // Stored plain if no PIN, or empty in memory until unlocked if PIN enabled
  apiKeyEncrypted?: string;
  fastModel: string;
  reasoningModel: string;
  visionModel?: string;
  useCorsRelayFallback?: boolean;
  lastTestedAt?: string;
}

export interface ByokSettings {
  activeProviderId: string;
  defaultModelSlot: 'fast' | 'reasoning';
  autoRedactPrompt: boolean;
  pinEnabled: boolean;
  pinVerifier?: string;
  providers: AiProviderConfig[];
}

export interface RedactionMapping {
  placeholder: string;
  original: string;
  category: 'name' | 'company' | 'id_card' | 'credit_code' | 'phone' | 'bank_card' | 'case_no' | 'email' | 'address' | 'custom';
  count: number;
}

export interface RedactionResult {
  redactedText: string;
  mappings: RedactionMapping[];
  totalReplaced: number;
}

export interface CalculationHistoryItem {
  id: string;
  toolId: OfflineToolId;
  toolTitle: string;
  summary: string;
  detailText: string;
  caseId?: string;
  createdAt: string;
}

export interface DeadlineReminderItem {
  id: string;
  caseName: string;
  caseId?: string;
  title: string;
  category: 'preservation' | 'execution' | 'appeal' | 'evidence' | 'arbitration' | 'custom';
  startDate: string;
  dueDate: string;
  warnDate: string;
  notes: string;
  completed: boolean;
  createdAt: string;
}

export interface ChecklistInstance {
  id: string;
  templateId: string;
  caseLabel: string;
  checkedKeys: string[];
  updatedAt: string;
}

export interface ScratchpadNote {
  id: string;
  title: string;
  caseId?: string;
  scene: 'meeting_client' | 'detention_visit' | 'court_trial' | 'phone_consult';
  facts: string;
  disputes: string;
  missingEvidence: string;
  todoItems: string;
  durationSec: number;
  updatedAt: string;
}

export interface LawyerProfile {
  name: string;
  licenseNo: string;
  firmName: string;
  phone: string;
  address: string;
  email: string;
}

export interface SavedAiPrompt {
  id: string;
  label: string;
  content: string;
  specialistId?: AiSpecialistId;
  createdAt: string;
}

export interface CasePocket {
  id: string;
  title: string;
  caseNo?: string;
  court?: string;
  clientName?: string;
  opponentName?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiHandoffPayload {
  specialistId: AiSpecialistId;
  sourceTitle: string;
  promptContext: string;
  timestamp: number;
}
