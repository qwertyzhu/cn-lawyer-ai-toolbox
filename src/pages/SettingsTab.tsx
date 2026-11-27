import React, { useEffect, useRef, useState } from 'react';
import {
  Award,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
} from 'lucide-react';
import { SITE_CONFIG } from '../config/siteConfig';
import { useToolbox } from '../context/ToolboxContext';
import { AI_SPECIALISTS_REGISTRY, OFFLINE_TOOLS_REGISTRY } from '../data/toolRegistry';
import {
  AI_PROVIDER_PRESETS,
  fetchAvailableModels,
  isOpenCodeEndpoint,
  suggestModelSlots,
  testProviderConnectivity,
} from '../lib/aiClient';
import { copyToClipboard } from '../lib/clipboard';
import {
  decryptWithPassphrase,
  encryptWithPassphrase,
  exportEncryptedSyncCode,
  importEncryptedSyncCode,
} from '../lib/cryptoVault';
import {
  buildSignedAdminHeaders,
  clearEncryptedAdminMasterVault,
  clearSavedLicense,
  formatWeChatInvitationCard,
  getSavedAdminMasterToken,
  hasEncryptedAdminMasterVault,
  isFirmAdminRole,
  saveAdminMasterToken,
  saveEncryptedAdminMasterVault,
  signActivationCodeWithMasterToken,
  unlockEncryptedAdminMasterVault,
  type LawyerRoleLabel,
  type VerifiedLicenseInfo,
} from '../lib/licenseEngine';
import { resetLocalUserWorkspaceForAccountSwitch } from '../lib/cloudSync';
import { toolboxStorage, type WorkspaceBackupPreview } from '../lib/storage';
import type { AiProviderConfig, LawyerProfile } from '../types/toolbox';

interface TelemetrySummary {
  updatedAt: string;
  totalHits: number;
  last30Total: number;
  totals: Record<string, number>;
  last30Days: Record<string, number>;
}

const TELEMETRY_LABELS: Record<string, string> = {
  ...Object.fromEntries(OFFLINE_TOOLS_REGISTRY.map((t) => [t.id, `离线工具 · ${t.shortTitle}`])),
  ...Object.fromEntries(AI_SPECIALISTS_REGISTRY.map((s) => [`ai:${s.id}`, `AI 专席 · ${s.shortTitle}`])),
  'ima-cloud-qa': '法典与案例 · IMA 知识库问答',
};

interface SettingsTabProps {
  license: VerifiedLicenseInfo;
  onOpenInstallGuide: () => void;
  onLicenseChanged: (next: VerifiedLicenseInfo | null) => void;
}

interface CloudLawyerAccount {
  key: string;
  serialNo: string;
  holderName: string;
  role: string;
  status: 'active' | 'disabled';
  expiresAt: string;
  issuedAt: string;
  activatedAt?: string;
  lastSeenAt: string;
  activationCode?: string;
  updatedAt: string;
  note: string;
}

function computeNextSerialNumber(accounts: CloudLawyerAccount[]): number {
  let maxSeq = 0;
  for (const a of accounts) {
    const m = String(a.serialNo || '').match(/^(?:TR|LAW)-\d{4}-(\d{1,4})$/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return maxSeq + 1;
}

function isAccountActivated(acct: CloudLawyerAccount): boolean {
  if (acct.activatedAt !== undefined) return Boolean(acct.activatedAt);
  return Boolean(acct.lastSeenAt);
}

const ROLE_OPTIONS: LawyerRoleLabel[] = [
  '主任',
  '副主任 / 合伙人',
  '合伙人',
  '专职律师',
  '律师助理',
  '实习律师',
  '行政与顾问',
];

export const SettingsTab: React.FC<SettingsTabProps> = ({
  license,
  onOpenInstallGuide,
  onLicenseChanged,
}) => {
  const {
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
    lawyerProfile,
    updateLawyerProfile,
    refreshAllFromDisk,
    showToast,
  } = useToolbox();

  const [profileDraft, setProfileDraft] = useState<LawyerProfile>(lawyerProfile);
  useEffect(() => {
    setProfileDraft(lawyerProfile);
  }, [lawyerProfile]);

  const [e2eePassInput, setE2eePassInput] = useState(sessionSyncPassphrase);
  const [showE2eePanel, setShowE2eePanel] = useState(false);

  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModelsMap, setFetchedModelsMap] = useState<Record<string, string[]>>({});
  const [modelsFetchResult, setModelsFetchResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [showBeginnerGuide, setShowBeginnerGuide] = useState(false);

  // PIN Vault
  const [newPin, setNewPin] = useState('');
  const [lockedNewKeyInput, setLockedNewKeyInput] = useState('');
  const [lockedKeyPinInput, setLockedKeyPinInput] = useState('');
  const [showSwitchAccountConfirm, setShowSwitchAccountConfirm] = useState(false);

  // Cross-device encrypted sync
  const [syncPassword, setSyncPassword] = useState('');
  const [generatedSyncCode, setGeneratedSyncCode] = useState('');
  const [importSyncCodeStr, setImportSyncCodeStr] = useState('');

  // Admin Mobile License Issuer & Real-Time Account Console (Visible ONLY for 主任 / 主任律师)
  const [showIssuerDrawer, setShowIssuerDrawer] = useState(false);
  const [adminSubTab, setAdminSubTab] = useState<'accounts' | 'telemetry' | 'issuer'>('accounts');
  const [telemetryStats, setTelemetryStats] = useState<TelemetrySummary | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [telemetryRange, setTelemetryRange] = useState<'30d' | 'all'>('30d');
  const [masterToken, setMasterToken] = useState<string>(() => getSavedAdminMasterToken());
  const [hasMasterVault, setHasMasterVault] = useState<boolean>(() => hasEncryptedAdminMasterVault());
  const [masterVaultPass, setMasterVaultPass] = useState('');
  const [batchNamesInput, setBatchNamesInput] = useState('');
  const [issueRole, setIssueRole] = useState<LawyerRoleLabel>('专职律师');
  const [issueExpiryMode, setIssueExpiryMode] = useState<'forever' | '1y' | '180d' | 'custom'>('forever');
  const [issueCustomDate, setIssueCustomDate] = useState('');
  const [serialStart, setSerialStart] = useState('1');
  const [issuedCards, setIssuedCards] = useState<{ holder: string; code: string; cardText: string }[]>([]);

  const [cloudAccounts, setCloudAccounts] = useState<CloudLawyerAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState<'all' | 'activated' | 'pending' | 'disabled'>('all');
  const [revealedCodeKey, setRevealedCodeKey] = useState<string | null>(null);
  const [busyCodeKey, setBusyCodeKey] = useState<string | null>(null);
  const [newAcctName, setNewAcctName] = useState('');
  const [newAcctSerial, setNewAcctSerial] = useState('');
  const [newAcctRole, setNewAcctRole] = useState<LawyerRoleLabel>('专职律师');

  const backupFileRef = useRef<HTMLInputElement>(null);
  const [pendingBackupImport, setPendingBackupImport] = useState<{
    raw: string;
    fileName: string;
    preview: WorkspaceBackupPreview;
  } | null>(null);
  const [hasImportRollback, setHasImportRollback] = useState<boolean>(() =>
    toolboxStorage.hasImportRollback()
  );

  const activeProvider =
    byok.providers.find((p) => p.id === byok.activeProviderId) || byok.providers[0];
  const matchedPreset = AI_PROVIDER_PRESETS.find((p) => p.id === activeProvider?.presetId);

  const patchActiveProvider = (patch: Partial<AiProviderConfig>) => {
    const resetsVerification =
      ('apiKey' in patch || 'apiKeyEncrypted' in patch || 'baseUrl' in patch || 'protocol' in patch) &&
      !('lastTestedAt' in patch);
    const mergedPatch: Partial<AiProviderConfig> = resetsVerification
      ? { ...patch, lastTestedAt: undefined }
      : patch;
    const nextProviders = byok.providers.map((p) =>
      p.id === activeProvider.id ? { ...p, ...mergedPatch } : p
    );
    updateByok({ ...byok, providers: nextProviders });
    if (!('lastTestedAt' in patch)) {
      setTestResult(null);
    }
  };

  const addProviderFromPreset = (presetId: string) => {
    const preset = AI_PROVIDER_PRESETS.find((p) => p.id === presetId) || AI_PROVIDER_PRESETS[0];
    const created: AiProviderConfig = {
      id: `prov-${Date.now()}`,
      presetId: preset.id,
      name: preset.name,
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      apiKey: '',
      fastModel: preset.fastModel,
      reasoningModel: preset.reasoningModel,
      visionModel: preset.visionModel,
    };
    updateByok({
      ...byok,
      activeProviderId: created.id,
      providers: [...byok.providers, created],
    });
    showToast(`已新增「${preset.name}」配置槽`);
  };

  const handleFetchModels = async (overwriteSlots = false) => {
    setFetchingModels(true);
    setModelsFetchResult(null);
    try {
      let keyToUse = activeProvider.apiKey.trim();
      if (!keyToUse && activeProvider.apiKeyEncrypted) {
        if (!sessionUnlockedPin) {
          throw new Error('当前密钥受 PIN 加密保护，请先在「AI 智囊」解锁 PIN 或下方解除 PIN 锁后再拉取');
        }
        keyToUse = await decryptWithPassphrase(activeProvider.apiKeyEncrypted, sessionUnlockedPin);
      }
      const models = await fetchAvailableModels({ ...activeProvider, apiKey: keyToUse });
      setFetchedModelsMap((prev) => ({ ...prev, [activeProvider.id]: models }));
      setModelSearch('');
      const rec = suggestModelSlots(models);
      const patch: Partial<AiProviderConfig> = {};
      if (overwriteSlots || !activeProvider.fastModel.trim()) {
        if (rec.fastModel) patch.fastModel = rec.fastModel;
      }
      if (overwriteSlots || !activeProvider.reasoningModel.trim()) {
        if (rec.reasoningModel) patch.reasoningModel = rec.reasoningModel;
      }
      if (overwriteSlots || !(activeProvider.visionModel || '').trim()) {
        if (rec.visionModel) patch.visionModel = rec.visionModel;
      }
      if (Object.keys(patch).length > 0) {
        patchActiveProvider(patch);
      }
      setModelsFetchResult({
        ok: true,
        msg: `已成功拉取 ${models.length} 个可用模型，可在下方三项直接下拉选用（仍支持随时手填）`,
      });
    } catch (err) {
      setModelsFetchResult({
        ok: false,
        msg: err instanceof Error ? err.message : '拉取模型列表失败（可继续手动输入模型名）',
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      let keyToTest = activeProvider.apiKey.trim();
      if (!keyToTest && activeProvider.apiKeyEncrypted) {
        if (!sessionUnlockedPin) {
          throw new Error('当前密钥受 PIN 加密保护，请先在「AI 智囊」解锁 PIN 或下方解除 PIN 锁后再测速');
        }
        keyToTest = await decryptWithPassphrase(activeProvider.apiKeyEncrypted, sessionUnlockedPin);
      }
      const msg = await testProviderConnectivity({ ...activeProvider, apiKey: keyToTest });
      patchActiveProvider({ lastTestedAt: new Date().toISOString() });
      setTestResult({ ok: true, msg });
    } catch (err) {
      patchActiveProvider({ lastTestedAt: undefined });
      setTestResult({
        ok: false,
        msg: err instanceof Error ? err.message : '连接测试失败',
      });
    } finally {
      setTesting(false);
    }
  };

  const enablePinEncryption = async () => {
    const pin = newPin.trim();
    if (pin.length < 4) {
      showToast('请输入至少 4 位本地保护 PIN 码');
      return;
    }
    try {
      const encryptedProviders = await Promise.all(
        byok.providers.map(async (p) => {
          if (p.apiKey.trim()) {
            const enc = await encryptWithPassphrase(p.apiKey.trim(), pin);
            return { ...p, apiKey: '', apiKeyEncrypted: enc };
          }
          return p;
        })
      );
      updateByok({
        ...byok,
        pinEnabled: true,
        providers: encryptedProviders,
      });
      setSessionUnlockedPin(pin);
      setNewPin('');
      showToast('已启用本地 PIN 加密锁（PBKDF2 + AES-256-GCM 密文存储）');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加密失败');
    }
  };

  const replaceActiveKeyUnderPin = async () => {
    const cleanKey = lockedNewKeyInput.trim();
    if (!cleanKey) {
      showToast('请先输入要更换的新 API Key');
      return;
    }
    const pin = (sessionUnlockedPin || lockedKeyPinInput).trim();
    if (pin.length < 4) {
      showToast('请输入当前本地保护 PIN 码以加密保存新密钥');
      return;
    }
    try {
      const sampleEnc = byok.providers.find((p) => p.apiKeyEncrypted)?.apiKeyEncrypted;
      if (sampleEnc) {
        await decryptWithPassphrase(sampleEnc, pin);
      }
      const enc = await encryptWithPassphrase(cleanKey, pin);
      patchActiveProvider({ apiKey: '', apiKeyEncrypted: enc });
      setSessionUnlockedPin(pin);
      setLockedNewKeyInput('');
      setLockedKeyPinInput('');
      showToast('新 API Key 已通过 AES-256-GCM 加密封存（零明文落盘）');
    } catch {
      showToast('PIN 码不正确，无法覆盖加密密钥');
    }
  };

  const disablePinEncryption = async () => {
    const pin = newPin.trim();
    if (!pin) {
      showToast('请先在输入框填入原 PIN 码以解密还原');
      return;
    }
    try {
      const plainProviders = await Promise.all(
        byok.providers.map(async (p) => {
          if (p.apiKeyEncrypted) {
            const dec = await decryptWithPassphrase(p.apiKeyEncrypted, pin);
            return { ...p, apiKey: dec, apiKeyEncrypted: undefined };
          }
          return p;
        })
      );
      updateByok({
        ...byok,
        pinEnabled: false,
        providers: plainProviders,
      });
      setSessionUnlockedPin(null);
      setNewPin('');
      showToast('已关闭 PIN 锁并恢复直连免输模式');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '原 PIN 码错误');
    }
  };

  const handleGenerateSyncCode = async () => {
    if (syncPassword.trim().length < 4) {
      showToast('请设置至少 4 位临时迁移口令');
      return;
    }
    try {
      const code = await exportEncryptedSyncCode(JSON.stringify(byok), syncPassword.trim());
      setGeneratedSyncCode(code);
      await copyToClipboard(code);
      showToast('已生成并复制加密迁移码，可在电脑浏览器粘贴导入');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '生成失败');
    }
  };

  const handleImportSyncCode = async () => {
    if (!importSyncCodeStr.trim() || !syncPassword.trim()) {
      showToast('请填写迁移口令与加密迁移码');
      return;
    }
    try {
      const jsonStr = await importEncryptedSyncCode(importSyncCodeStr.trim(), syncPassword.trim());
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed.providers)) {
        updateByok(parsed);
        setImportSyncCodeStr('');
        showToast('跨设备大模型密钥配置同步成功！');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入解密失败');
    }
  };

  const handleExportWorkspace = () => {
    const json = toolboxStorage.exportFullWorkspaceJson();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `律师AI工具箱本地办案备份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportWorkspace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const preview = toolboxStorage.previewWorkspaceImport(txt);
      setPendingBackupImport({ raw: txt, fileName: file.name, preview });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '备份文件无法识别');
    } finally {
      e.target.value = '';
    }
  };

  const confirmWorkspaceImport = (mode: 'merge' | 'overwrite') => {
    if (!pendingBackupImport) return;
    try {
      toolboxStorage.importFullWorkspaceJson(pendingBackupImport.raw, { mode });
      setHasImportRollback(toolboxStorage.hasImportRollback());
      setPendingBackupImport(null);
      refreshAllFromDisk();
      showToast(
        mode === 'merge'
          ? '已合并恢复备份（本机新增期限、速记与文书草稿已保留）'
          : '已全量覆盖恢复本机数据（原数据已存回滚快照）'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : '备份恢复失败');
    }
  };

  const handleRestoreImportRollback = () => {
    try {
      toolboxStorage.restoreImportRollback();
      refreshAllFromDisk();
      showToast('已回滚至上次导入前的本机快照');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '回滚失败');
    }
  };

  const handleBatchSignCodes = async () => {
    const names = batchNamesInput
      .split(/[\n,，、;；]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) {
      showToast('请输入至少一位律师姓名');
      return;
    }

    let expiresAt = '';
    const now = new Date();
    if (issueExpiryMode === '1y') {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() + 1);
      expiresAt = d.toISOString().slice(0, 10);
    } else if (issueExpiryMode === '180d') {
      const d = new Date(now);
      d.setDate(d.getDate() + 180);
      expiresAt = d.toISOString().slice(0, 10);
    } else if (issueExpiryMode === 'custom') {
      expiresAt = issueCustomDate;
    }

    try {
      const origin = window.location.origin;

      const startSeq = Math.max(1, Number(serialStart) || 1);
      const year = new Date().getFullYear();
      const out: { holder: string; code: string; cardText: string }[] = [];
      const upsertBatch: {
        holderName: string;
        role: string;
        serialNo: string;
        expiresAt: string;
        issuedAt: string;
        activationCode: string;
        status: 'active';
      }[] = [];

      for (let i = 0; i < names.length; i++) {
        const parts = names[i].split(/[:：]/);
        const holderName = parts[0].trim();
        const resolvedRole = (parts[1] || issueRole).trim();
        if (!holderName) continue;
        const serialNo = `LAW-${year}-${String(startSeq + i).padStart(3, '0')}`;
        const { code, info } = await signActivationCodeWithMasterToken(masterToken, {
          holderName,
          role: resolvedRole,
          serialNo,
          expiresAt,
        });
        out.push({
          holder: `${info.holderName}（${info.role} · ${serialNo}）`,
          code,
          cardText: formatWeChatInvitationCard(info, origin),
        });
        upsertBatch.push({
          holderName,
          role: resolvedRole,
          serialNo,
          expiresAt,
          issuedAt: info.issuedAt,
          activationCode: code,
          status: 'active',
        });
      }

      saveAdminMasterToken(masterToken);
      setIssuedCards(out);
      setSerialStart(String(startSeq + names.length));
      // Silently register newly issued accounts & archive their codes into cloud account control table if online
      if (navigator.onLine && upsertBatch.length > 0) {
        try {
          const payloadStr = JSON.stringify({ accounts: upsertBatch });
          const headers = await buildSignedAdminHeaders(
            masterToken,
            license.rawCode,
            'POST',
            '/api/admin/accounts/upsert',
            payloadStr
          );
          const resp = await fetch('/api/admin/accounts/upsert', {
            method: 'POST',
            headers,
            body: payloadStr,
          });
          const data = await resp.json().catch(() => null);
          if (data?.ok && Array.isArray(data.accounts)) {
            setCloudAccounts(data.accounts);
          }
        } catch {
          // Offline signing still succeeded cleanly
        }
      }
      showToast(`已成功离线签发 ${out.length} 枚专属激活码！`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '签发失败，请核对主任签发主密钥');
    }
  };

  const getAdminOrigin = () => window.location.origin;

  const fetchCloudAccounts = async () => {
    setAccountsError(null);
    if (!masterToken.trim()) {
      setAccountsError('请先在上方填入您的主任主密钥（TR-MASTER-...），再加载云端账户列表');
      return;
    }
    setAccountsLoading(true);
    try {
      const headers = await buildSignedAdminHeaders(
        masterToken,
        license.rawCode,
        'GET',
        '/api/admin/accounts',
        ''
      );
      const resp = await fetch('/api/admin/accounts', { headers, cache: 'no-store' });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || '加载云端账户列表失败');
      saveAdminMasterToken(masterToken);
      const list: CloudLawyerAccount[] = data.accounts || [];
      setCloudAccounts(list);
      const nextSeq = computeNextSerialNumber(list);
      setSerialStart((prev) => (prev === '1' && nextSeq > 1 ? String(nextSeq) : prev));
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : '连接管理端失败');
    } finally {
      setAccountsLoading(false);
    }
  };

  const fetchAdminTelemetry = async () => {
    setTelemetryError(null);
    if (!masterToken.trim()) {
      setTelemetryError('请先在上方填入主任主密钥（TR-MASTER-...），再加载团队工具热度统计');
      return;
    }
    setTelemetryLoading(true);
    try {
      const headers = await buildSignedAdminHeaders(
        masterToken,
        license.rawCode,
        'GET',
        '/api/admin/telemetry',
        ''
      );
      const resp = await fetch('/api/admin/telemetry', { headers, cache: 'no-store' });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || '加载工具热度统计失败');
      saveAdminMasterToken(masterToken);
      setTelemetryStats({
        updatedAt: data.updatedAt || '',
        totalHits: Number(data.totalHits) || 0,
        last30Total: Number(data.last30Total) || 0,
        totals: data.totals || {},
        last30Days: data.last30Days || {},
      });
    } catch (err) {
      setTelemetryError(err instanceof Error ? err.message : '加载工具热度统计失败');
    } finally {
      setTelemetryLoading(false);
    }
  };

  const ensureAccountCode = async (acct: CloudLawyerAccount): Promise<string> => {
    if (acct.activationCode && acct.activationCode.startsWith('TR1-')) {
      return acct.activationCode;
    }
    if (!masterToken.trim()) {
      throw new Error('请先在上方填入主任主密钥（TR-MASTER-...）以查看或生成激活凭证');
    }
    const year = new Date().getFullYear();
    const resolvedSerial =
      acct.serialNo || `LAW-${year}-${String(computeNextSerialNumber(cloudAccounts)).padStart(3, '0')}`;
    const { code, info } = await signActivationCodeWithMasterToken(masterToken, {
      holderName: acct.holderName,
      role: acct.role,
      serialNo: resolvedSerial,
      expiresAt: acct.expiresAt || '',
      issuedAt: acct.issuedAt || undefined,
    });
    try {
      const payloadStr = JSON.stringify({
        holderName: acct.holderName,
        serialNo: resolvedSerial,
        role: acct.role,
        expiresAt: acct.expiresAt || '',
        issuedAt: info.issuedAt,
        activationCode: code,
        status: acct.status,
      });
      const headers = await buildSignedAdminHeaders(
        masterToken,
        license.rawCode,
        'POST',
        '/api/admin/accounts/upsert',
        payloadStr
      );
      await fetch('/api/admin/accounts/upsert', { method: 'POST', headers, body: payloadStr });
    } catch {
      // Keep local code even if archive write fails
    }
    setCloudAccounts((prev) =>
      prev.map((a) =>
        a.key === acct.key
          ? { ...a, serialNo: resolvedSerial, issuedAt: info.issuedAt, activationCode: code }
          : a
      )
    );
    return code;
  };

  const handleCopyAccountLink = async (acct: CloudLawyerAccount) => {
    setBusyCodeKey(acct.key);
    setAccountsError(null);
    try {
      const code = await ensureAccountCode(acct);
      const quickUrl = `${getAdminOrigin()}/?activate=${encodeURIComponent(code)}`;
      await copyToClipboard(quickUrl);
      showToast(`已复制「${acct.holderName}」一键免输激活链接，可直接粘贴发微信`);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : '生成或复制链接失败');
    } finally {
      setBusyCodeKey(null);
    }
  };

  const handleToggleRevealCode = async (acct: CloudLawyerAccount) => {
    if (revealedCodeKey === acct.key) {
      setRevealedCodeKey(null);
      return;
    }
    setBusyCodeKey(acct.key);
    setAccountsError(null);
    try {
      await ensureAccountCode(acct);
      setRevealedCodeKey(acct.key);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : '获取激活密钥失败');
    } finally {
      setBusyCodeKey(null);
    }
  };

  const handleDeleteCloudAccount = async (acct: CloudLawyerAccount) => {
    if (!window.confirm(`确定从后台账号表中移除「${acct.holderName}（${acct.serialNo || acct.role}）」吗？`)) {
      return;
    }
    setDeletingKey(acct.key);
    setAccountsError(null);
    try {
      const payloadStr = JSON.stringify({ key: acct.key });
      const headers = await buildSignedAdminHeaders(
        masterToken,
        license.rawCode,
        'POST',
        '/api/admin/accounts/delete',
        payloadStr
      );
      const resp = await fetch('/api/admin/accounts/delete', {
        method: 'POST',
        headers,
        body: payloadStr,
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || '删除失败');
      setCloudAccounts((prev) => prev.filter((a) => a.key !== acct.key));
      if (revealedCodeKey === acct.key) setRevealedCodeKey(null);
      showToast(`已移除「${acct.holderName}」记录`);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingKey(null);
    }
  };

  const handleToggleAccount = async (acct: CloudLawyerAccount) => {
    const nextStatus = acct.status === 'active' ? 'disabled' : 'active';
    setTogglingKey(acct.key);
    setAccountsError(null);
    try {
      const payloadStr = JSON.stringify({ key: acct.key, status: nextStatus });
      const headers = await buildSignedAdminHeaders(
        masterToken,
        license.rawCode,
        'POST',
        '/api/admin/accounts/toggle',
        payloadStr
      );
      const resp = await fetch('/api/admin/accounts/toggle', {
        method: 'POST',
        headers,
        body: payloadStr,
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || '状态切换失败');
      setCloudAccounts((prev) =>
        prev.map((a) => (a.key === acct.key ? { ...a, ...data.account } : a))
      );
      showToast(
        nextStatus === 'disabled'
          ? `已停用「${acct.holderName}」账号（联网后即时锁定）`
          : `已恢复启用「${acct.holderName}」账号`
      );
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setTogglingKey(null);
    }
  };

  const handleAddCloudAccount = async () => {
    const cleanName = newAcctName.trim();
    const year = new Date().getFullYear();
    const cleanSerial =
      newAcctSerial.trim() ||
      `LAW-${year}-${String(computeNextSerialNumber(cloudAccounts)).padStart(3, '0')}`;
    if (!cleanName) {
      showToast('请输入律师姓名');
      return;
    }
    setAccountsError(null);
    try {
      const { code, info } = await signActivationCodeWithMasterToken(masterToken, {
        holderName: cleanName,
        role: newAcctRole,
        serialNo: cleanSerial,
      });
      const payloadStr = JSON.stringify({
        holderName: cleanName,
        serialNo: cleanSerial,
        role: newAcctRole,
        issuedAt: info.issuedAt,
        activationCode: code,
        status: 'active',
      });
      const headers = await buildSignedAdminHeaders(
        masterToken,
        license.rawCode,
        'POST',
        '/api/admin/accounts/upsert',
        payloadStr
      );
      const resp = await fetch('/api/admin/accounts/upsert', {
        method: 'POST',
        headers,
        body: payloadStr,
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || '添加失败');
      setNewAcctName('');
      setNewAcctSerial('');
      await fetchCloudAccounts();
      showToast(`已登记「${cleanName}（${cleanSerial}）」并生成专属激活凭证，可在列表中一键复制链接`);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : '添加账户失败');
    }
  };

  return (
    <div className="py-5 sm:py-8 px-4 sm:px-6 mx-auto max-w-5xl space-y-6">
      {/* Prestigious Exclusive Digital Nameplate Card */}
      <section className="rounded-xl bg-gradient-to-br from-[#0E223D] via-[#111927] to-[#091322] p-5 sm:p-6 text-[#F6F4EF] border border-[#D1B27A]/40 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#D1B27A]">
              <Award className="h-3.5 w-3.5" />
              {SITE_CONFIG.authMode === 'license'
                ? `${SITE_CONFIG.firmName || SITE_CONFIG.appName} · 专属数字办案授权铭牌`
                : 'CN LAWYER AI TOOLBOX · APACHE-2.0 开源工作台'}
            </div>
            <h2 className="mt-2 font-display text-xl sm:text-2xl font-bold text-white">
              {license.holderName}
              <span className="ml-2.5 inline-block rounded bg-[#B89254]/20 border border-[#D1B27A]/40 px-2.5 py-0.5 text-xs font-semibold text-[#D1B27A] align-middle">
                {license.role}
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenInstallGuide}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#B89254] px-3 py-1.5 text-xs font-bold text-[#11151C]"
            >
              <Smartphone className="h-3.5 w-3.5" /> 安装到手机桌面
            </button>
            {SITE_CONFIG.authMode === 'license' && (
              <button
                type="button"
                onClick={() => setShowSwitchAccountConfirm((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/5 hover:bg-white/15 px-2.5 py-1.5 text-xs text-slate-300"
                title="更换激活码或退出本机授权"
              >
                <LogOut className="h-3.5 w-3.5" /> 切换授权码
              </button>
            )}
          </div>
        </div>

        {SITE_CONFIG.authMode === 'license' && showSwitchAccountConfirm && (
          <div className="mt-4 rounded-lg border border-amber-300/80 bg-amber-950/70 p-3.5 text-xs text-amber-100 space-y-2.5">
            <div className="font-bold text-amber-200">
              ⚠ 切换授权码前请注意保存本机独有数据
            </div>
            <p className="leading-5 text-amber-100/90">
              为防止共用设备串号泄密，切换授权码将清空本机浏览器中的<strong>会见速记、计算历史、轻案件口袋、要素式单案与批量草稿</strong>以及未同步的 API Key（这些数据默认不上云，清空后无法从云端找回）。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportWorkspace}
                className="inline-flex items-center gap-1 rounded bg-[#B89254] px-3 py-1.5 font-bold text-[#11151C]"
              >
                <Download className="h-3.5 w-3.5" /> 先导出本机备份 (.json)
              </button>
              <button
                type="button"
                onClick={() => setShowSwitchAccountConfirm(false)}
                className="rounded border border-white/25 bg-white/10 px-3 py-1.5 font-semibold text-white"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  resetLocalUserWorkspaceForAccountSwitch();
                  clearSavedLicense();
                  onLicenseChanged(null);
                }}
                className="rounded bg-red-600 hover:bg-red-700 px-3 py-1.5 font-bold text-white"
              >
                确认清空本机并切换授权码
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-white/12 pt-3.5 text-xs">
          <div>
            <div className="text-[10px] text-slate-400">
              {SITE_CONFIG.authMode === 'license' ? '授权序列编号' : '运行模式'}
            </div>
            <div className="mt-0.5 font-mono font-bold text-white">{license.serialNo}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">
              {SITE_CONFIG.authMode === 'license' ? '授权有效期限' : '数据隐私模式'}
            </div>
            <div className="mt-0.5 font-semibold text-emerald-300">
              {SITE_CONFIG.authMode === 'license'
                ? license.expiresAt
                  ? `有效至 ${license.expiresAt}`
                  : '长期有效'
                : '100% 本地隔离存储'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">签发日期</div>
            <div className="mt-0.5 font-mono text-slate-200">{license.issuedAt || '官方签发'}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">ECDSA 数字防伪指纹</div>
            <div className="mt-0.5 font-mono text-[#D1B27A]">{license.fingerprint}</div>
          </div>
        </div>
      </section>

      {/* Section 0.5: Unified Personal Lawyer Profile & Signature Defaults */}
      <section className="rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-6 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-3">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-[#B89254]" />
            <h2 className="font-display text-base sm:text-lg font-bold text-[#11151C]">
              个人执业与落款档案（填一次，全工具联动带入）
            </h2>
          </div>
          <span className="rounded-full bg-[#F5F0E4] px-2.5 py-0.5 text-[10.5px] font-semibold text-[#7A5922]">
            默认留空 · 仅存本机/激活码加密同步
          </span>
        </div>
        <p className="text-xs leading-5 text-slate-600">
          填写后仅保存在您个人本机（团队激活码模式下支持加密跨端同步），自动联动至：<strong>「要素式起诉状/答辩状」委托诉讼代理人一键带入</strong>、<strong>您本地自传的 Word 配套模板套打</strong>、<strong>律师费报价单落款</strong>及 <strong>AI 导出 Word 副标题</strong>。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="block font-bold text-[#11151C] mb-1">律师姓名</label>
            <input
              type="text"
              value={profileDraft.name}
              onChange={(e) => setProfileDraft((p) => ({ ...p, name: e.target.value }))}
              placeholder="例：张某某"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-bold text-[#11151C] mb-1">律师执业证号</label>
            <input
              type="text"
              value={profileDraft.licenseNo}
              onChange={(e) => setProfileDraft((p) => ({ ...p, licenseNo: e.target.value }))}
              placeholder="17 位执业证号（选填）"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-mono focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-bold text-[#11151C] mb-1">所在律师事务所</label>
            <input
              type="text"
              value={profileDraft.firmName}
              onChange={(e) => setProfileDraft((p) => ({ ...p, firmName: e.target.value }))}
              placeholder="例：某某律师事务所"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-bold text-[#11151C] mb-1">办公联系电话</label>
            <input
              type="text"
              value={profileDraft.phone}
              onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))}
              placeholder="手机或办公座机"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-mono focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-bold text-[#11151C] mb-1">常用送达 / 办公地址</label>
            <input
              type="text"
              value={profileDraft.address}
              onChange={(e) => setProfileDraft((p) => ({ ...p, address: e.target.value }))}
              placeholder="用于自传模板 {{律所地址}} 自动填入"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-bold text-[#11151C] mb-1">电子送达邮箱（选填）</label>
            <input
              type="email"
              value={profileDraft.email}
              onChange={(e) => setProfileDraft((p) => ({ ...p, email: e.target.value }))}
              placeholder="name@lawfirm.com"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-mono focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-slate-500">
            {lawyerProfile.name
              ? `当前已生效档案：${lawyerProfile.name}${lawyerProfile.firmName ? ` · ${lawyerProfile.firmName}` : ''}`
              : '提示：留空时所有文书自动保持标准下划线空位，绝不预填他人信息。'}
          </span>
          <button
            type="button"
            onClick={() => updateLawyerProfile(profileDraft)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0E223D] hover:bg-[#17345C] px-4 py-2 text-xs font-bold text-[#F6F4EF]"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-[#D1B27A]" /> 保存执业档案
          </button>
        </div>
      </section>

      {/* Section 1: BYOK Model & API Key Configuration */}
      <section className="rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[#B89254]" />
            <h2 className="font-display text-base sm:text-lg font-bold text-[#11151C]">
              个人第三方大模型 API 密钥配置（BYOK）
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowBeginnerGuide((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full bg-[#F3ECE0] px-3 py-1 text-xs font-semibold text-[#7A5922]"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {showBeginnerGuide ? '收起新手申领教程' : '新手 2 分钟获取 API Key 教程'}
          </button>
        </div>

        {showBeginnerGuide && (
          <div className="rounded-md bg-[#FAF9F6] border border-[#E4DFD4] p-4 text-xs space-y-2 leading-6 text-slate-700">
            <div className="font-bold text-[#0E223D]">
              为什么采用「律师各自填入个人 API Key」模式？
            </div>
            <p>
              1. <strong>零公摊成本、按量计费极省</strong>：以 DeepSeek 官方为例，充值 10 元可审查上百份合同或润色数百篇文书；硅基流动等平台新注册常赠免费体验额度。
              <br />
              2. <strong>执业保密隔离</strong>：您的密钥与对话由您手机浏览器直接发往大模型厂商，不经过律所数据库，其他律师与管理员均不可见。
            </p>
            <div className="pt-1 font-bold text-[#0E223D]">三步开通流程（以 DeepSeek 为例）：</div>
            <ol className="list-decimal pl-4 space-y-1">
              <li>点击下方「前往官方控制台获取密钥」链接，使用微信或手机号登录；</li>
              <li>点击菜单「API Keys」→「创建 API Key」，复制以 <code className="bg-white px-1">sk-</code> 开头的密钥串；</li>
              <li>回到本页粘贴到「API Key 密钥」框内，点击「测试连通性」显示绿色成功即可！</li>
            </ol>
          </div>
        )}

        {/* Provider Selector & Preset Adder */}
        <div className="flex flex-wrap items-center gap-2">
          {byok.providers.map((prov) => (
            <button
              key={prov.id}
              type="button"
              onClick={() => {
                updateByok({ ...byok, activeProviderId: prov.id });
                setTestResult(null);
                setModelsFetchResult(null);
                setModelSearch('');
              }}
              className={`max-w-full truncate rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                prov.id === activeProvider.id
                  ? 'border-[#0E223D] bg-[#0E223D] text-white'
                  : 'border-[#DED8CC] bg-[#FAF9F6] text-slate-700'
              }`}
            >
              {prov.name.split('（')[0]}
            </button>
          ))}

          <select
            value=""
            onChange={(e) => {
              if (e.target.value) addProviderFromPreset(e.target.value);
            }}
            className="rounded-md border border-dashed border-[#B89254] bg-[#FAF9F6] px-2.5 py-1.5 text-xs font-semibold text-[#7A5922]"
          >
            <option value="">+ 新增其他厂商预设…</option>
            {AI_PROVIDER_PRESETS.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.name}
              </option>
            ))}
          </select>
        </div>

        {/* Active Provider Fields */}
        {activeProvider && (
          <div className="space-y-3.5 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#FAF9F6] px-3 py-2 text-xs text-slate-600">
              <span>{matchedPreset?.guide || '请填写兼容 OpenAI 或 Anthropic 协议的接口参数。'}</span>
              {matchedPreset?.applyUrl && (
                <a
                  href={matchedPreset.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-[#0E223D] underline"
                >
                  前往官方控制台获取密钥 <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">配置显示名称</label>
                <input
                  type="text"
                  value={activeProvider.name}
                  onChange={(e) => patchActiveProvider({ name: e.target.value })}
                  className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 text-xs font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">接口协议类型</label>
                <select
                  value={activeProvider.protocol}
                  onChange={(e) =>
                    patchActiveProvider({ protocol: e.target.value as 'openai' | 'anthropic' })
                  }
                  className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 text-xs font-medium"
                >
                  <option value="openai">OpenAI 兼容协议 (/v1/chat/completions)</option>
                  <option value="anthropic">Anthropic Claude 协议 (/v1/messages)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#11151C] mb-1">接口地址 Base URL</label>
              <input
                type="url"
                value={activeProvider.baseUrl}
                onChange={(e) => patchActiveProvider({ baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#11151C] mb-1">
                个人 API Key 密钥（
                {SITE_CONFIG.authMode === 'license' && syncPrefs.enabled && syncPrefs.syncByok
                  ? syncPrefs.useE2eePassphrase
                    ? '已勾选跨端同步 · 端到端口令加密上传'
                    : '已勾选跨端同步 · 经自建服务端静态加密'
                  : '仅保存在本机浏览器 · 不上传任何服务器'}
                ）
              </label>
              {byok.pinEnabled ? (
                <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50/70 p-3 text-xs text-emerald-950">
                  <div className="font-semibold">
                    🔒 已启用本地 PIN 加密锁：
                    {activeProvider.apiKeyEncrypted
                      ? '当前服务商密钥已 AES-256-GCM 密文封存（不存明文）。'
                      : '当前服务商尚未填入密钥，请在下方加密写入：'}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={lockedNewKeyInput}
                      onChange={(e) => setLockedNewKeyInput(e.target.value)}
                      placeholder="粘贴要设置或更换的新 API Key（sk-...）"
                      className="flex-1 min-w-[200px] rounded border border-emerald-300 bg-white px-3 py-1.5 font-mono text-xs text-[#11151C]"
                    />
                    {!sessionUnlockedPin && (
                      <input
                        type="password"
                        inputMode="numeric"
                        value={lockedKeyPinInput}
                        onChange={(e) => setLockedKeyPinInput(e.target.value)}
                        placeholder="输入当前保护 PIN 码"
                        className="w-40 rounded border border-emerald-300 bg-white px-2.5 py-1.5 text-xs text-[#11151C]"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="rounded border border-emerald-300 bg-white px-2.5 py-1.5 text-slate-600"
                      title={showKey ? '隐藏输入' : '查看输入'}
                    >
                      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={replaceActiveKeyUnderPin}
                      className="rounded bg-[#0E223D] px-3.5 py-1.5 font-bold text-white"
                    >
                      加密保存新密钥
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 relative flex items-center">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={activeProvider.apiKey}
                    onChange={(e) =>
                      patchActiveProvider({ apiKey: e.target.value, apiKeyEncrypted: undefined })
                    }
                    placeholder="粘贴 sk-... 开头的密钥"
                    className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] pl-3 pr-10 py-2 font-mono text-xs focus:border-[#0E223D] focus:bg-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2.5 text-slate-400 hover:text-slate-700"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              )}
            </div>

            {(() => {
              const allFetched = fetchedModelsMap[activeProvider.id] || [];
              const filteredFetched = modelSearch.trim()
                ? allFetched.filter((m) =>
                    m.toLowerCase().includes(modelSearch.trim().toLowerCase())
                  )
                : allFetched;
              const recSlots = suggestModelSlots(allFetched);

              return (
                <>
                  {/* Auto-Fetch Models Toolbar & Filter */}
                  <div className="rounded-md border border-[#E4DFD4] bg-[#FAF9F6] p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-bold text-[#0E223D]">
                        自动拉取该接口可用模型（填入 Base URL 与 API Key 后点击即可）
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleFetchModels(false)}
                          disabled={
                            fetchingModels ||
                            !activeProvider.baseUrl.trim() ||
                            (!activeProvider.apiKey.trim() && !activeProvider.apiKeyEncrypted)
                          }
                          className="inline-flex items-center gap-1 rounded bg-[#B89254] hover:bg-[#C7A265] px-3 py-1.5 text-[11px] font-bold text-[#11151C] disabled:opacity-45"
                        >
                          {fetchingModels ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          {fetchingModels ? '正在拉取模型…' : '自动拉取模型列表'}
                        </button>
                        {allFetched.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              patchActiveProvider({
                                fastModel: recSlots.fastModel || activeProvider.fastModel,
                                reasoningModel: recSlots.reasoningModel || activeProvider.reasoningModel,
                                visionModel: recSlots.visionModel || activeProvider.visionModel,
                              });
                              showToast('已按拉取结果一键智能填入极速 / 推理 / 视觉推荐模型');
                            }}
                            className="rounded border border-[#D8D1C3] bg-white hover:border-[#0E223D] px-2.5 py-1.5 text-[11px] font-semibold text-[#0E223D]"
                          >
                            一键智能填入推荐
                          </button>
                        )}
                      </div>
                    </div>

                    {modelsFetchResult && (
                      <div
                        className={`rounded px-2.5 py-1.5 text-[11px] ${
                          modelsFetchResult.ok
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-50 text-amber-900 border border-amber-200'
                        }`}
                      >
                        {modelsFetchResult.msg}
                      </div>
                    )}

                    {allFetched.length > 10 && (
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder={`快速筛选已拉取的 ${allFetched.length} 个模型（如输入 deepseek、claude、gpt、qwen、glm）…`}
                        className="w-full rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5 text-xs"
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-bold text-[#11151C] mb-1">
                        ⚡ 日常极速模型标识（用于去AI味/微信回复）
                      </label>
                      <input
                        type="text"
                        value={activeProvider.fastModel}
                        onChange={(e) => patchActiveProvider({ fastModel: e.target.value })}
                        placeholder="如 deepseek-chat 或 qwen-plus"
                        className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-mono text-xs"
                      />
                      {allFetched.length > 0 && (
                        <select
                          value={allFetched.includes(activeProvider.fastModel) ? activeProvider.fastModel : ''}
                          onChange={(e) => {
                            if (e.target.value) patchActiveProvider({ fastModel: e.target.value });
                          }}
                          className="mt-1.5 w-full rounded border border-[#D1B27A]/70 bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#0E223D]"
                        >
                          <option value="">
                            ▾ 从已拉取的 {filteredFetched.length} 个模型中点选极速模型…
                          </option>
                          {filteredFetched.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#11151C] mb-1">
                        🧠 深度推理模型标识（用于审合同/拆解要件）
                      </label>
                      <input
                        type="text"
                        value={activeProvider.reasoningModel}
                        onChange={(e) => patchActiveProvider({ reasoningModel: e.target.value })}
                        placeholder="如 deepseek-reasoner 或 qwq-plus"
                        className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-mono text-xs"
                      />
                      {allFetched.length > 0 && (
                        <select
                          value={
                            allFetched.includes(activeProvider.reasoningModel)
                              ? activeProvider.reasoningModel
                              : ''
                          }
                          onChange={(e) => {
                            if (e.target.value) patchActiveProvider({ reasoningModel: e.target.value });
                          }}
                          className="mt-1.5 w-full rounded border border-[#D1B27A]/70 bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#0E223D]"
                        >
                          <option value="">
                            ▾ 从已拉取的 {filteredFetched.length} 个模型中点选推理模型…
                          </option>
                          {filteredFetched.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#11151C] mb-1">
                      👁️ 视觉识图模型标识（在 AI 智囊上传截图 / 拍照时自动启用，选填）
                    </label>
                    <input
                      type="text"
                      value={activeProvider.visionModel ?? ''}
                      onChange={(e) => patchActiveProvider({ visionModel: e.target.value })}
                      placeholder="如 qwen-vl-max-latest、Qwen/Qwen2.5-VL-72B-Instruct、glm-4v-plus-0111（DeepSeek 官方暂仅支持纯文本，可留空）"
                      className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-mono text-xs"
                    />
                    {allFetched.length > 0 && (
                      <select
                        value={
                          allFetched.includes(activeProvider.visionModel || '')
                            ? activeProvider.visionModel || ''
                            : ''
                        }
                        onChange={(e) => {
                          if (e.target.value) patchActiveProvider({ visionModel: e.target.value });
                        }}
                        className="mt-1.5 w-full rounded border border-[#D1B27A]/70 bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#0E223D]"
                      >
                        <option value="">
                          ▾ 从已拉取的 {filteredFetched.length} 个模型中点选视觉识图模型（选填）…
                        </option>
                        {filteredFetched.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    )}
                    <p className="mt-1 text-[11px] text-slate-500">
                      纯文字问答仍走上方极速/深度模型；当您上传合同照片、聊天记录或裁判文书截图时，系统会自动切换至本视觉模型。
                    </p>
                  </div>
                </>
              );
            })()}

            {isOpenCodeEndpoint(activeProvider.baseUrl, activeProvider.presetId) &&
              !activeProvider.useCorsRelayFallback && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-5 text-amber-950">
                  <strong>自定义网关提示：</strong>系统已自动为该接口附带所需的会话路由头；如该网关暂不放行浏览器跨域预检，请在自建 Node 后端并开启{' '}
                  <code className="rounded bg-amber-100 px-1 font-mono text-[10px]">
                    ENABLE_AI_RELAY=1
                  </code>{' '}
                  时手动勾选下方<strong>「启用无状态透明跨域转发兜底」</strong>（纯静态体验站无中转后端）。
                </div>
              )}

            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={Boolean(activeProvider.useCorsRelayFallback)}
                onChange={(e) => patchActiveProvider({ useCorsRelayFallback: e.target.checked })}
                className="rounded accent-[#0E223D]"
              />
              启用无状态透明跨域转发兜底（仅当自定义中转站不支持浏览器跨域直连时勾选，零日志不落盘）
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || (!activeProvider.apiKey && !activeProvider.apiKeyEncrypted)}
                className="inline-flex items-center gap-1.5 rounded bg-[#0E223D] px-4 py-2 text-xs font-bold text-white disabled:opacity-45"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-[#D1B27A]" />
                )}
                测试连通性
              </button>

              {byok.providers.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const remain = byok.providers.filter((p) => p.id !== activeProvider.id);
                    updateByok({
                      ...byok,
                      activeProviderId: remain[0].id,
                      providers: remain,
                    });
                  }}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" /> 删除此服务商槽位
                </button>
              )}
            </div>

            {testResult && (
              <div
                className={`rounded p-3 text-xs flex items-center gap-2 ${
                  testResult.ok
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border border-red-200 text-red-900'
                }`}
              >
                <CheckCircle2 className="h-4 w-4 flex-none" />
                <span>{testResult.msg}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 1b: Activation-Code Automatic Cross-Device Cloud Sync (Team License Mode Only) */}
      {SITE_CONFIG.authMode === 'license' && (
        <section className="rounded-lg border border-[#D1B27A]/70 bg-gradient-to-br from-white to-[#FAF8F2] p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-3">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-[#B89254]" />
              <h2 className="font-display text-base sm:text-lg font-bold text-[#11151C]">
                激活码跨端自动同步（激活码即账号）
              </h2>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                syncState.status === 'synced'
                  ? 'bg-emerald-100 text-emerald-800'
                  : syncState.status === 'syncing'
                  ? 'bg-sky-100 text-sky-800'
                  : syncState.status === 'locked' || syncState.status === 'conflict'
                  ? 'bg-amber-100 text-amber-900'
                  : syncState.status === 'error'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {syncState.status === 'syncing' && <Loader2 className="h-3 w-3 animate-spin" />}
              {syncState.status === 'synced'
                ? `● 已同步${syncState.lastSyncedAt ? ` · ${new Date(syncState.lastSyncedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}`
                : syncState.status === 'syncing'
                ? '同步中…'
                : syncState.status === 'locked'
                ? '🔒 需输入同步口令解锁'
                : syncState.status === 'conflict'
                ? '⚠ 检测到多端版本冲突'
                : syncState.status === 'offline'
                ? '离线暂存本地'
                : syncState.status === 'error'
                ? '同步异常'
                : syncPrefs.enabled
                ? '○ 待首次同步'
                : '已暂停云同步'}
            </span>
          </div>

          <p className="text-xs leading-5 text-slate-600">
            在任意一台电脑或手机配好大模型密钥与常用偏好后，系统按您的专属激活码（<strong>{license.holderName} · {license.serialNo}</strong>）自动以 <code className="bg-white px-1">AES-256-GCM</code> 密文同步至自建服务器独立空间；换其他浏览器或手机微信打开您的专属链接即可<strong>自动恢复配置，免重新填写</strong>（团队成员之间物理隔离、互不可见；证据 PDF 与原件绝不上传）。
          </p>

          {syncState.errorMsg && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              {syncState.errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
            <label className="flex items-start gap-2 rounded-md border border-[#E4DFD4] bg-white p-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={syncPrefs.enabled}
                onChange={(e) => updateSyncPrefs({ enabled: e.target.checked })}
                className="mt-0.5 rounded accent-[#0E223D]"
              />
              <span>
                <strong className="block text-[#11151C]">开启跨端自动同步</strong>
                <span className="text-[11px] text-slate-500">登录自动拉取、修改 1.5 秒自动上传</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-[#E4DFD4] bg-white p-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={syncPrefs.syncByok}
                onChange={(e) => updateSyncPrefs({ syncByok: e.target.checked })}
                className="mt-0.5 rounded accent-[#0E223D]"
              />
              <span>
                <strong className="block text-[#11151C]">同步大模型 API 配置（默认关）</strong>
                <span className="text-[11px] text-slate-500">默认仅留本机；勾选后同步接口与密钥</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-[#E4DFD4] bg-white p-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={syncPrefs.syncWorkspace}
                onChange={(e) => updateSyncPrefs({ syncWorkspace: e.target.checked })}
                className="mt-0.5 rounded accent-[#0E223D]"
              />
              <span>
                <strong className="block text-[#11151C]">同步常规工作台偏好</strong>
                <span className="text-[11px] text-slate-500">置顶工具、收藏法条、常用指令与落款名片</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-amber-300/80 bg-amber-50/50 p-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={syncPrefs.syncSensitiveNotes}
                onChange={(e) => updateSyncPrefs({ syncSensitiveNotes: e.target.checked })}
                className="mt-0.5 rounded accent-[#0E223D]"
              />
              <span>
                <strong className="block text-amber-950">同步会见速记与测算记录（默认关闭）</strong>
                <span className="text-[11px] text-amber-900/90">含客户案情，默认仅存本机；如需跨端请搭配下方独立口令</span>
              </span>
            </label>
          </div>

          <div className="rounded-md border border-[#E4DFD4] bg-[#FAF8F3] px-3 py-2 text-[11px] leading-5 text-slate-600">
            <strong className="text-[#0E223D]">加密边界透明说明：</strong>
            默认同步采用<strong>服务端 AES-256-GCM 静态加密</strong>（换设备免输口令即可恢复，但服务器管理员在技术上具备解密能力）；如需<strong>服务端零知识端到端加密</strong>，请展开下方设置独立同步口令，密文在离开浏览器前即完成加密。
          </div>

          {/* Optional Zero-Knowledge Client E2EE Sync Passphrase */}
          <div className="rounded-md border border-[#E4DFD4] bg-white p-3 space-y-2">
            <button
              type="button"
              onClick={() => setShowE2eePanel((v) => !v)}
              className="flex w-full items-center justify-between text-left text-xs font-bold text-[#0E223D]"
            >
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-[#B89254]" />
                高级隐私：独立同步口令（可选真·零知识端到端加密）
                {(syncPrefs.useE2eePassphrase || syncState.clientEncrypted) && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">
                    已启用
                  </span>
                )}
              </span>
              {showE2eePanel || syncState.status === 'locked' ? (
                <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              )}
            </button>

            {(showE2eePanel || syncState.status === 'locked') && (
              <div className="space-y-2 pt-1 border-t border-[#EFECE5] text-xs">
                <p className="text-[11px] leading-5 text-slate-600">
                  默认无需设置口令（换设备点激活链接即可无感恢复）。如果您希望<strong>连自建服务器管理员也完全无法解密您的配置</strong>，可设置一段独立口令，数据在离开浏览器前即完成端到端加密；换新设备时输入一次口令即可解锁同步。
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="password"
                    value={e2eePassInput}
                    onChange={(e) => setE2eePassInput(e.target.value)}
                    placeholder="输入至少 4 位独立同步口令"
                    className="flex-1 min-w-[180px] rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-1.5 text-xs"
                  />
                  {syncState.status === 'locked' ? (
                    <button
                      type="button"
                      onClick={async () => {
                        const p = e2eePassInput.trim();
                        if (p.length < 4) {
                          showToast('请输入至少 4 位同步口令');
                          return;
                        }
                        setSessionSyncPassphrase(p);
                        updateSyncPrefs({ useE2eePassphrase: true });
                        await triggerCloudPull(false, p);
                      }}
                      className="rounded bg-[#0E223D] px-3 py-1.5 text-xs font-bold text-white"
                    >
                      解锁并拉取云端配置
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          const p = e2eePassInput.trim();
                          if (p.length < 4) {
                            showToast('请设置至少 4 位独立同步口令');
                            return;
                          }
                          setSessionSyncPassphrase(p);
                          updateSyncPrefs({ useE2eePassphrase: true });
                          await triggerCloudPush(true, false, p);
                        }}
                        className="rounded bg-[#0E223D] px-3 py-1.5 text-xs font-bold text-white"
                      >
                        启用口令加密并上传
                      </button>
                      {syncPrefs.useE2eePassphrase && (
                        <button
                          type="button"
                          onClick={async () => {
                            setSessionSyncPassphrase('');
                            setE2eePassInput('');
                            updateSyncPrefs({ useE2eePassphrase: false });
                            await triggerCloudPush(true, false, '');
                          }}
                          className="rounded border border-[#D8D1C3] bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                        >
                          关闭口令（切回免口令同步）
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={syncState.status === 'syncing'}
                onClick={() => triggerCloudPush(syncState.status === 'conflict', false)}
                className="inline-flex items-center gap-1.5 rounded bg-[#0E223D] px-3.5 py-2 text-xs font-bold text-white disabled:opacity-45"
              >
                <Upload className="h-3.5 w-3.5 text-[#D1B27A]" />
                {syncState.status === 'conflict' ? '强制以本机覆盖云端' : '立即上传本机配置'}
              </button>
              <button
                type="button"
                disabled={syncState.status === 'syncing'}
                onClick={() => triggerCloudPull(false)}
                className="inline-flex items-center gap-1.5 rounded border border-[#D1B27A] bg-[#FAF6EC] hover:bg-[#F3ECE0] px-3.5 py-2 text-xs font-bold text-[#7A5922] disabled:opacity-45"
              >
                <Download className="h-3.5 w-3.5" />
                立即从云端拉取
              </button>
              {syncState.revision > 0 && (
                <span className="text-[11px] text-slate-500">
                  版本 v{syncState.revision}
                  {syncState.deviceLabel ? ` · 来源：${syncState.deviceLabel}` : ''}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('确定清空云端同步副本吗？（不影响本机当前配置，仅删除服务器上的加密备份）')) {
                  return;
                }
                try {
                  await clearCloudVaultBackup();
                } catch (err) {
                  showToast(err instanceof Error ? err.message : '清空失败');
                }
              }}
              className="text-[11px] text-slate-400 hover:text-red-600"
            >
              清空云端副本
            </button>
          </div>
        </section>
      )}

      {/* Section 2: Web Crypto PIN Vault & Phone <-> PC Encrypted Sync */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#B89254]" />
            <h3 className="font-display text-sm font-bold text-[#11151C]">
              本机 API Key 本地 PIN 加密锁（可选）
            </h3>
          </div>
          <p className="text-xs leading-5 text-slate-600">
            利用浏览器标准 Web Crypto (PBKDF2 + AES-256-GCM) 将您的 API Key 加密后存储，防止共用或临时借出设备时密钥明文泄露（建议设置 6 位以上口令）。
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder={byok.pinEnabled ? '输入原 PIN 码解除加密' : '设置 4–8 位数字 PIN'}
              className="flex-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 text-xs"
            />
            {!byok.pinEnabled ? (
              <button
                type="button"
                onClick={enablePinEncryption}
                className="rounded bg-[#0E223D] px-3.5 py-2 text-xs font-semibold text-white"
              >
                加密封存
              </button>
            ) : (
              <button
                type="button"
                onClick={disablePinEncryption}
                className="rounded border border-red-300 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-800"
              >
                解除PIN锁
              </button>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-[#B89254]" />
            <h3 className="font-display text-sm font-bold text-[#11151C]">
              手机 ↔ 电脑免重输加密迁移码
            </h3>
          </div>
          <p className="text-xs leading-5 text-slate-600">
            在手机配好 Key 后生成一段端到端加密串发给自己微信文件传输助手，电脑端粘贴即可一秒同步配置。
          </p>
          <input
            type="password"
            value={syncPassword}
            onChange={(e) => setSyncPassword(e.target.value)}
            placeholder="设置临时解密口令（至少4位）"
            className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-1.5 text-xs"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleGenerateSyncCode}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-[#0E223D] py-2 text-xs font-semibold text-white"
            >
              <Copy className="h-3.5 w-3.5 text-[#D1B27A]" /> 生成并复制迁移码
            </button>
          </div>
          {generatedSyncCode && (
            <input
              readOnly
              value={generatedSyncCode}
              className="w-full rounded bg-[#FAF9F6] border border-[#E4DFD4] px-2 py-1 font-mono text-[10px] text-slate-500"
            />
          )}
          <div className="flex gap-2 pt-1 border-t border-[#EFECE5]">
            <input
              type="text"
              value={importSyncCodeStr}
              onChange={(e) => setImportSyncCodeStr(e.target.value)}
              placeholder="在此粘贴另一台设备生成的 TRSYNC1:... 迁移码"
              className="flex-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-1.5 font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleImportSyncCode}
              className="rounded bg-[#B89254] px-3 py-1.5 text-xs font-bold text-[#11151C]"
            >
              导入
            </button>
          </div>
        </section>
      </div>

      {/* Section 3: Local Data Backup */}
      <section className="rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3">
        <h3 className="font-display text-sm font-bold text-[#11151C]">
          本机办案数据备份与恢复（测算记录 / 保全预警 / 会见速记 / 文书草稿）
        </h3>
        <p className="text-[11px] leading-5 text-slate-500">
          说明：导出的 <code className="rounded bg-[#FAF9F6] px-1 font-mono">.json</code> 为明文备份（含案件名、期限预警、会见速记与要素式文书草稿，不含 API Key），请妥善保存在个人加密盘，勿发往公共群聊。
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportWorkspace}
            className="inline-flex items-center gap-1.5 rounded border border-[#0E223D] bg-[#FAF9F6] px-3.5 py-2 text-xs font-semibold text-[#0E223D]"
          >
            <Download className="h-3.5 w-3.5" /> 导出本机办案数据备份 (.json)
          </button>

          <input
            ref={backupFileRef}
            type="file"
            accept=".json"
            onChange={handleImportWorkspace}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => backupFileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded border border-[#D8D1C3] bg-white px-3.5 py-2 text-xs font-medium text-slate-700"
          >
            <Upload className="h-3.5 w-3.5" /> 从备份文件恢复
          </button>

          {hasImportRollback && (
            <button
              type="button"
              onClick={handleRestoreImportRollback}
              className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              title="撤回最近一次备份导入，恢复导入前的本机状态"
            >
              回滚上次恢复
            </button>
          )}

          <button
            type="button"
            onClick={async () => {
              showToast('正在拉取最新版本并刷新本应用离线缓存…');
              try {
                const scopeUrl = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
                const scopeSlug = scopeUrl.pathname.replace(/[^a-zA-Z0-9_-]/g, '_');
                const myPrefix = `cn-lawyer-ai-toolbox${scopeSlug}::`;
                if ('serviceWorker' in navigator) {
                  const reg = await navigator.serviceWorker.getRegistration(scopeUrl.href);
                  if (reg && reg.scope === scopeUrl.href) {
                    await reg.unregister();
                  }
                }
                if ('caches' in window) {
                  const keys = await caches.keys();
                  await Promise.all(
                    keys
                      .filter((k) => k.startsWith(myPrefix) || k.startsWith('cn-lawyer-ai-toolbox-v1-'))
                      .map((k) => caches.delete(k))
                  );
                }
              } catch {
                // ignore
              }
              window.location.reload();
            }}
            className="inline-flex items-center gap-1.5 rounded border border-[#B89254] bg-[#F3ECE0] px-3.5 py-2 text-xs font-bold text-[#7A5922]"
            title="仅清理本工具箱作用域下的旧离线缓存并拉取最新功能（不影响同域名其他站点，也不会清除您的激活码、API Key 与测算记录）"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 检查更新 / 刷新离线缓存
          </button>
        </div>

        {pendingBackupImport && (
          <div className="rounded-md border border-[#D1B27A] bg-[#FAF6EC] p-3.5 space-y-2.5 text-xs text-[#11151C]">
            <div className="font-bold text-[#0E223D]">
              备份恢复预览：{pendingBackupImport.fileName}
              {pendingBackupImport.preview.exportedAt
                ? `（导出时间：${pendingBackupImport.preview.exportedAt.slice(0, 19).replace('T', ' ')}）`
                : ''}
            </div>
            <p className="text-[11px] leading-5 text-slate-700">
              备份内含：期限预警 <strong>{pendingBackupImport.preview.incomingCounts.deadlines}</strong> 条 · 清单{' '}
              <strong>{pendingBackupImport.preview.incomingCounts.checklists}</strong> 份 · 会见速记{' '}
              <strong>{pendingBackupImport.preview.incomingCounts.scratchpads}</strong> 篇 · 测算历史{' '}
              <strong>{pendingBackupImport.preview.incomingCounts.history}</strong> 条 · 案袋{' '}
              <strong>{pendingBackupImport.preview.incomingCounts.casePockets}</strong> 个 · 要素式草稿{' '}
              <strong>{pendingBackupImport.preview.incomingCounts.spcDrafts}</strong> 份。
              {(pendingBackupImport.preview.keptLocalDeadlines > 0 ||
                pendingBackupImport.preview.keptLocalScratchpads > 0) && (
                <span className="ml-1 font-semibold text-emerald-800">
                  采用「合并恢复」将自动保留本机新增的 {pendingBackupImport.preview.keptLocalDeadlines} 条期限与{' '}
                  {pendingBackupImport.preview.keptLocalScratchpads} 篇速记，避免旧备份冲掉新办案记录。
                </span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => confirmWorkspaceImport('merge')}
                className="rounded bg-[#0E223D] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#16345B]"
              >
                合并恢复（推荐 · 保留本机新增项）
              </button>
              <button
                type="button"
                onClick={() => confirmWorkspaceImport('overwrite')}
                className="rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-50"
              >
                全量覆盖本机（先自动存回滚快照）
              </button>
              <button
                type="button"
                onClick={() => setPendingBackupImport(null)}
                className="rounded border border-[#D8D1C3] bg-white px-3 py-1.5 text-xs text-slate-600"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Section 4: Collapsible Mobile Admin Account Control & License Issuer (Visible ONLY in license mode for admin) */}
      {SITE_CONFIG.authMode === 'license' && isFirmAdminRole(license.role) && (
      <section className="rounded-lg border border-[#DED8CC] bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => {
            const nextOpen = !showIssuerDrawer;
            setShowIssuerDrawer(nextOpen);
            if (nextOpen && masterToken.trim() && cloudAccounts.length === 0) {
              setTimeout(() => fetchCloudAccounts(), 50);
            }
          }}
          className="flex w-full items-center justify-between px-4 py-3.5 sm:px-5 text-left hover:bg-[#FAF9F6]"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#B89254]" />
            <span className="font-display text-xs sm:text-sm font-bold text-[#11151C]">
              律所管理端 · 律师账户启停与激活码签发台（仅主任可见）
            </span>
          </div>
          {showIssuerDrawer ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {showIssuerDrawer && (
          <div className="border-t border-[#EFECE5] p-4 sm:p-5 space-y-4 bg-[#FAF9F6]">
            <p className="text-xs leading-5 text-slate-600">
              安全红线：服务端与前端均<strong>绝不明文持久化</strong>您的签发私钥。<code className="bg-white px-1">TR-MASTER-...</code> 仅保存在当前页面内存中（关闭或刷新即清）；如需下次免重粘贴，可使用下方「口令加密封存」（PBKDF2 + AES-256-GCM）。
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#11151C]">
                主任管理主密钥（TR-MASTER-... · 仅驻留内存，绝不明文落盘）
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={masterToken}
                  onChange={(e) => {
                    setMasterToken(e.target.value);
                    saveAdminMasterToken(e.target.value);
                  }}
                  placeholder="粘贴 ops/.keys/ 或电脑发码器中的 TR-MASTER-... 私钥"
                  className="flex-1 min-w-0 rounded border border-[#D8D1C3] bg-white px-3 py-2 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={fetchCloudAccounts}
                  disabled={accountsLoading || !masterToken.trim()}
                  className="flex-none inline-flex items-center gap-1 rounded bg-[#0E223D] px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
                >
                  <RefreshCw className={`h-3.5 w-3.5 text-[#D1B27A] ${accountsLoading ? 'animate-spin' : ''}`} />
                  同步账户
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#E4DFD4] bg-white p-2.5 text-xs">
                <input
                  type="password"
                  value={masterVaultPass}
                  onChange={(e) => setMasterVaultPass(e.target.value)}
                  placeholder={hasMasterVault ? '输入 6 位以上口令解锁已封存主密钥' : '可选：设 6 位以上口令加密封存到本机'}
                  className="flex-1 min-w-[180px] rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-1.5 text-xs"
                />
                {hasMasterVault && !masterToken.trim() && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const plain = await unlockEncryptedAdminMasterVault(masterVaultPass);
                        setMasterToken(plain);
                        setMasterVaultPass('');
                        showToast('已从本机 AES-GCM 保险箱解锁主密钥至当前内存会话');
                      } catch (err) {
                        showToast(err instanceof Error ? err.message : '口令不正确');
                      }
                    }}
                    className="rounded bg-[#0E223D] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    口令解锁
                  </button>
                )}
                {masterToken.trim().startsWith('TR-MASTER-') && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await saveEncryptedAdminMasterVault(masterToken, masterVaultPass);
                        setHasMasterVault(true);
                        setMasterVaultPass('');
                        showToast('已用 PBKDF2 + AES-256-GCM 加密封存主密钥');
                      } catch (err) {
                        showToast(err instanceof Error ? err.message : '封存失败');
                      }
                    }}
                    className="rounded border border-[#0E223D] bg-[#FAF9F6] px-3 py-1.5 text-xs font-semibold text-[#0E223D]"
                  >
                    加密封存本机
                  </button>
                )}
                {hasMasterVault && (
                  <button
                    type="button"
                    onClick={() => {
                      clearEncryptedAdminMasterVault();
                      setHasMasterVault(false);
                      setMasterToken('');
                      showToast('已清除本机加密主密钥封存');
                    }}
                    className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700"
                  >
                    清除封存
                  </button>
                )}
              </div>
            </div>

            {/* Admin Sub-Tabs: Live Account Enable/Disable vs Anonymous Tool Heat vs License Batch Issuer */}
            <div className="grid grid-cols-1 sm:grid-cols-3 rounded-lg border border-[#DED8CC] bg-white p-1 gap-1">
              <button
                type="button"
                onClick={() => setAdminSubTab('accounts')}
                className={`rounded-md py-2 text-xs font-bold transition-colors ${
                  adminSubTab === 'accounts'
                    ? 'bg-[#0E223D] text-[#F6F4EF]'
                    : 'text-slate-600 hover:text-[#11151C]'
                }`}
              >
                账户实时启停（{cloudAccounts.length || '点同步'}）
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminSubTab('telemetry');
                  if (masterToken.trim() && !telemetryStats) {
                    setTimeout(() => fetchAdminTelemetry(), 40);
                  }
                }}
                className={`inline-flex items-center justify-center gap-1 rounded-md py-2 text-xs font-bold transition-colors ${
                  adminSubTab === 'telemetry'
                    ? 'bg-[#0E223D] text-[#F6F4EF]'
                    : 'text-slate-600 hover:text-[#11151C]'
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5 text-[#D1B27A]" />
                工具热度看板（匿名）
              </button>
              <button
                type="button"
                onClick={() => setAdminSubTab('issuer')}
                className={`rounded-md py-2 text-xs font-bold transition-colors ${
                  adminSubTab === 'issuer'
                    ? 'bg-[#0E223D] text-[#F6F4EF]'
                    : 'text-slate-600 hover:text-[#11151C]'
                }`}
              >
                实名激活码批量签发
              </button>
            </div>

            {adminSubTab === 'accounts' ? (
              <div className="space-y-3">
                {accountsError && (
                  <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                    {accountsError}
                  </div>
                )}

                {/* Quick Add Account Row */}
                <div className="rounded-lg border border-[#E4DFD4] bg-white p-3 space-y-2">
                  <div className="text-[11px] font-bold text-[#0E223D]">
                    新增 / 登记律师账户（任何已发码律师首次联网打开也会自动出现在下方列表）
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      value={newAcctName}
                      onChange={(e) => setNewAcctName(e.target.value)}
                      placeholder="律师姓名（如：张律师）"
                      className="rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="text"
                      value={newAcctSerial}
                      onChange={(e) => setNewAcctSerial(e.target.value)}
                      placeholder="授权编号（可选，如 LAW-2026-015）"
                      className="rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-1.5 font-mono text-xs"
                    />
                    <select
                      value={newAcctRole}
                      onChange={(e) => setNewAcctRole(e.target.value as LawyerRoleLabel)}
                      className="rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2 py-1.5 text-xs"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!masterToken.trim()}
                      onClick={handleAddCloudAccount}
                      className="rounded bg-[#B89254] hover:bg-[#C7A265] px-3 py-1.5 text-xs font-bold text-[#11151C] disabled:opacity-45"
                    >
                      + 登记到账户表
                    </button>
                  </div>
                </div>

                {/* Live Account List with 3-State Status, Filter Bar, Key Viewer & 1-Click Enable/Disable */}
                {cloudAccounts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#D8D1C3] bg-white py-8 px-4 text-center text-xs text-slate-500 space-y-2">
                    <p>粘贴您的主任主密钥并点击上方「同步账户」，即可管理全所律师账号的激活状态、随时查看/复制个人激活链接，并一键实时停用或恢复。</p>
                    <p className="text-[11px] text-slate-400">
                      停用后，该律师联网打开工具箱或调用服务端接口将在 1 秒内立即拦截生效；重新点击「恢复启用」即可秒恢复。
                    </p>
                  </div>
                ) : (
                  (() => {
                    const activatedCount = cloudAccounts.filter(
                      (a) => a.status === 'active' && isAccountActivated(a)
                    ).length;
                    const pendingCount = cloudAccounts.filter(
                      (a) => a.status === 'active' && !isAccountActivated(a)
                    ).length;
                    const disabledCount = cloudAccounts.filter((a) => a.status === 'disabled').length;

                    const visibleAccounts = cloudAccounts.filter((a) => {
                      if (accountFilter === 'activated') return a.status === 'active' && isAccountActivated(a);
                      if (accountFilter === 'pending') return a.status === 'active' && !isAccountActivated(a);
                      if (accountFilter === 'disabled') return a.status === 'disabled';
                      return true;
                    });

                    const origin = getAdminOrigin();

                    return (
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <button
                            type="button"
                            onClick={() => setAccountFilter('all')}
                            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                              accountFilter === 'all'
                                ? 'border-[#0E223D] bg-[#0E223D] text-white'
                                : 'border-[#DED8CC] bg-white text-[#11151C] hover:border-[#B89254]'
                            }`}
                          >
                            <div className="text-[10px] opacity-75">全部账号</div>
                            <div className="font-mono text-sm font-bold">{cloudAccounts.length} 席</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAccountFilter('activated')}
                            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                              accountFilter === 'activated'
                                ? 'border-emerald-700 bg-emerald-700 text-white'
                                : 'border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:border-emerald-400'
                            }`}
                          >
                            <div className="text-[10px] opacity-80">● 已激活使用</div>
                            <div className="font-mono text-sm font-bold">{activatedCount} 人</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAccountFilter('pending')}
                            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                              accountFilter === 'pending'
                                ? 'border-amber-600 bg-amber-600 text-white'
                                : 'border-amber-200 bg-amber-50/70 text-amber-900 hover:border-amber-400'
                            }`}
                          >
                            <div className="text-[10px] opacity-80">○ 待点击激活</div>
                            <div className="font-mono text-sm font-bold">{pendingCount} 人</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAccountFilter('disabled')}
                            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                              accountFilter === 'disabled'
                                ? 'border-red-700 bg-red-700 text-white'
                                : 'border-red-200 bg-red-50/70 text-red-900 hover:border-red-400'
                            }`}
                          >
                            <div className="text-[10px] opacity-80">✕ 已停用</div>
                            <div className="font-mono text-sm font-bold">{disabledCount} 人</div>
                          </button>
                        </div>

                        <div className="divide-y divide-[#EFECE5] rounded-lg border border-[#DED8CC] bg-white overflow-hidden">
                          {visibleAccounts.length === 0 ? (
                            <div className="py-8 text-center text-xs text-slate-400">
                              当前筛选分类下暂无账号记录
                            </div>
                          ) : (
                            visibleAccounts.map((acct) => {
                              const isSelf = Boolean(acct.holderName === license.holderName);
                              const isActive = acct.status === 'active';
                              const activated = isAccountActivated(acct);
                              const isRevealed = revealedCodeKey === acct.key;
                              const isBusyCode = busyCodeKey === acct.key;
                              const storedCode = acct.activationCode || '';
                              const quickUrl = storedCode
                                ? `${origin}/?activate=${encodeURIComponent(storedCode)}`
                                : '';

                              return (
                                <div
                                  key={acct.key}
                                  className={`px-3.5 py-3 text-xs ${
                                    !isActive
                                      ? 'bg-red-50/40'
                                      : activated
                                      ? 'bg-white'
                                      : 'bg-amber-50/20'
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-display font-bold text-[#11151C]">
                                          {acct.holderName}
                                        </span>
                                        <span className="rounded bg-[#F3ECE0] px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5922]">
                                          {acct.role}
                                        </span>
                                        {!isActive ? (
                                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                                            ● 已停用
                                          </span>
                                        ) : activated ? (
                                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                            ● 已激活
                                          </span>
                                        ) : (
                                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                            ○ 待激活
                                          </span>
                                        )}
                                        {isSelf && (
                                          <span className="text-[10px] text-slate-400">（当前本机主任）</span>
                                        )}
                                        {acct.note && (
                                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                            {acct.note}
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                                        <span className="font-mono">
                                          编号：{acct.serialNo || '待分配'}
                                        </span>
                                        {activated ? (
                                          <>
                                            {acct.activatedAt && (
                                              <span>
                                                首次激活：{new Date(acct.activatedAt).toLocaleString('zh-CN', { hour12: false })}
                                              </span>
                                            )}
                                            {acct.lastSeenAt && (
                                              <span>
                                                最近活跃：{new Date(acct.lastSeenAt).toLocaleString('zh-CN', { hour12: false })}
                                              </span>
                                            )}
                                          </>
                                        ) : (
                                          <span className="text-amber-700/80">
                                            尚未点击激活链接（律师首次点开并联网后自动点亮）
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1.5 flex-none">
                                      <button
                                        type="button"
                                        disabled={isBusyCode}
                                        onClick={() => handleCopyAccountLink(acct)}
                                        className="inline-flex items-center gap-1 rounded-md border border-[#D1B27A] bg-[#FAF6EC] hover:bg-[#F3ECE0] px-2.5 py-1.5 text-[11px] font-bold text-[#7A5922] disabled:opacity-45"
                                        title="一键复制该律师专属免输激活链接"
                                      >
                                        <Link2 className="h-3 w-3" />
                                        复制链接
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isBusyCode}
                                        onClick={() => handleToggleRevealCode(acct)}
                                        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-45 ${
                                          isRevealed
                                            ? 'border-[#0E223D] bg-[#0E223D] text-white'
                                            : 'border-[#D8D1C3] bg-white text-[#11151C] hover:border-[#0E223D]'
                                        }`}
                                      >
                                        {isRevealed ? (
                                          <>
                                            <EyeOff className="h-3 w-3" /> 收起密钥
                                          </>
                                        ) : (
                                          <>
                                            <Eye className="h-3 w-3" /> 查看密钥
                                          </>
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isSelf || togglingKey === acct.key}
                                        onClick={() => handleToggleAccount(acct)}
                                        className={`rounded-md px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-40 ${
                                          isActive
                                            ? 'border border-red-300 bg-white text-red-700 hover:bg-red-50'
                                            : 'bg-emerald-700 text-white hover:bg-emerald-800'
                                        }`}
                                      >
                                        {togglingKey === acct.key
                                          ? '处理中…'
                                          : isActive
                                          ? '关闭账户'
                                          : '恢复启用'}
                                      </button>
                                      {!isSelf && (
                                        <button
                                          type="button"
                                          disabled={deletingKey === acct.key}
                                          onClick={() => handleDeleteCloudAccount(acct)}
                                          className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-red-300 hover:text-red-600 disabled:opacity-40"
                                          title="从账号表移除"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {isRevealed && storedCode && (
                                    <div className="mt-3 rounded-lg border border-[#DED8CC] bg-[#FAF9F6] p-3 space-y-2.5">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="text-[11px] font-bold text-[#0E223D]">
                                          「{acct.holderName}」专属激活凭证（仅主任私密可见）
                                        </span>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              await copyToClipboard(storedCode);
                                              showToast(`已复制「${acct.holderName}」的激活密钥`);
                                            }}
                                            className="inline-flex items-center gap-1 rounded border border-[#D8D1C3] bg-white px-2 py-1 text-[11px] font-semibold text-[#11151C] hover:border-[#0E223D]"
                                          >
                                            <Copy className="h-3 w-3" /> 复制密钥
                                          </button>
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              const card = formatWeChatInvitationCard(
                                                {
                                                  rawCode: storedCode,
                                                  holderName: acct.holderName,
                                                  role: acct.role,
                                                  serialNo: acct.serialNo || 'LAW-VIP',
                                                  issuedAt: acct.issuedAt || new Date().toISOString().slice(0, 10),
                                                  expiresAt: acct.expiresAt || null,
                                                  keyId: 'v1',
                                                  fingerprint: '',
                                                  activatedAt: acct.activatedAt || '',
                                                },
                                                origin
                                              );
                                              await copyToClipboard(card);
                                              showToast(`已复制「${acct.holderName}」完整微信授权函`);
                                            }}
                                            className="inline-flex items-center gap-1 rounded bg-[#B89254] px-2.5 py-1 text-[11px] font-bold text-[#11151C]"
                                          >
                                            <Share2 className="h-3 w-3" /> 复制微信发放函
                                          </button>
                                        </div>
                                      </div>

                                      <div className="space-y-1.5">
                                        <div>
                                          <div className="text-[10px] font-semibold text-slate-500 mb-0.5">
                                            一键免输激活链接：
                                          </div>
                                          <div className="rounded border border-[#EAE5DA] bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#0E223D] break-all select-all">
                                            {quickUrl}
                                          </div>
                                        </div>
                                        <div>
                                          <div className="text-[10px] font-semibold text-slate-500 mb-0.5">
                                            专属激活密钥（TR1-...）：
                                          </div>
                                          <div className="rounded border border-[#EAE5DA] bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-700 break-all select-all">
                                            {storedCode}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            ) : adminSubTab === 'telemetry' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E4DFD4] bg-white p-3">
                  <div className="text-xs text-slate-600">
                    <span className="font-bold text-[#0E223D]">隐私边界承诺：</span>
                    仅匿名累计各工具模块打开次数，<strong>绝不记录</strong>任何律师姓名、IP、案情、搜索词或对话文本（开放模式零上报）。
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="inline-flex rounded border border-[#D8D1C3] bg-[#FAF9F6] p-0.5 text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setTelemetryRange('30d')}
                        className={`rounded px-2 py-0.5 ${
                          telemetryRange === '30d' ? 'bg-[#0E223D] text-white' : 'text-slate-600'
                        }`}
                      >
                        近 30 天
                      </button>
                      <button
                        type="button"
                        onClick={() => setTelemetryRange('all')}
                        className={`rounded px-2 py-0.5 ${
                          telemetryRange === 'all' ? 'bg-[#0E223D] text-white' : 'text-slate-600'
                        }`}
                      >
                        历史累计
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={telemetryLoading || !masterToken.trim()}
                      onClick={fetchAdminTelemetry}
                      className="inline-flex items-center gap-1 rounded bg-[#0E223D] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-45"
                    >
                      <RefreshCw className={`h-3 w-3 text-[#D1B27A] ${telemetryLoading ? 'animate-spin' : ''}`} />
                      刷新热度
                    </button>
                  </div>
                </div>

                {telemetryError && (
                  <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                    {telemetryError}
                  </div>
                )}

                {!telemetryStats ? (
                  <div className="rounded-lg border border-dashed border-[#D8D1C3] bg-white py-8 px-4 text-center text-xs text-slate-500">
                    点击右上角「刷新热度」即可查看团队高频工具与 AI 专席的匿名使用排行。
                  </div>
                ) : (() => {
                  const sourceMap = telemetryRange === '30d' ? telemetryStats.last30Days : telemetryStats.totals;
                  const rows = Object.entries(sourceMap)
                    .filter(([, cnt]) => cnt > 0)
                    .sort((a, b) => b[1] - a[1]);
                  const maxVal = rows.length > 0 ? rows[0][1] : 1;
                  const sumVal = telemetryRange === '30d' ? telemetryStats.last30Total : telemetryStats.totalHits;

                  return (
                    <div className="rounded-lg border border-[#DED8CC] bg-white p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-[#EFECE5] pb-2">
                        <span className="font-bold text-[#0E223D]">
                          {telemetryRange === '30d' ? '近 30 天匿名打开总计' : '历史累计匿名打开总计'}：
                          <span className="font-num text-sm text-[#9A7538] ml-1">{sumVal} 次</span>
                        </span>
                        {telemetryStats.updatedAt && (
                          <span className="text-[11px] text-slate-400">
                            最近更新：{new Date(telemetryStats.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                          </span>
                        )}
                      </div>

                      {rows.length === 0 ? (
                        <div className="py-6 text-center text-xs text-slate-400">
                          当前周期暂无使用记录，成员联网使用各工具后将自动匿名累计。
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {rows.map(([id, cnt], idx) => {
                            const pct = Math.max(6, Math.round((cnt / maxVal) * 100));
                            return (
                              <div key={id} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-medium text-[#11151C]">
                                    <span className="font-num text-[#9A7538] mr-1.5">{idx + 1}.</span>
                                    {TELEMETRY_LABELS[id] || id}
                                  </span>
                                  <span className="font-num font-bold text-[#0E223D]">{cnt} 次</span>
                                </div>
                                <div className="h-2 w-full rounded-full bg-[#F3EFE6] overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-[#0E223D] to-[#B89254]"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-4">

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">职级身份标签</label>
                <select
                  value={issueRole}
                  onChange={(e) => setIssueRole(e.target.value as LawyerRoleLabel)}
                  className="w-full rounded border border-[#D8D1C3] bg-white px-2.5 py-2 text-xs font-medium"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">授权有效期</label>
                <select
                  value={issueExpiryMode}
                  onChange={(e) =>
                    setIssueExpiryMode(e.target.value as 'forever' | '1y' | '180d' | 'custom')
                  }
                  className="w-full rounded border border-[#D8D1C3] bg-white px-2.5 py-2 text-xs font-medium"
                >
                  <option value="forever">长期有效（正式本所律师）</option>
                  <option value="1y">1 年有效期（年度授权）</option>
                  <option value="180d">180 天有效期（实习/短期协作）</option>
                  <option value="custom">指定截止日期</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">
                  {issueExpiryMode === 'custom' ? '指定到期日' : '起始流水序号'}
                </label>
                {issueExpiryMode === 'custom' ? (
                  <input
                    type="date"
                    value={issueCustomDate}
                    onChange={(e) => setIssueCustomDate(e.target.value)}
                    className="w-full rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5 text-xs"
                  />
                ) : (
                  <input
                    type="number"
                    min={1}
                    value={serialStart}
                    onChange={(e) => setSerialStart(e.target.value)}
                    className="w-full rounded border border-[#D8D1C3] bg-white px-2.5 py-2 font-mono text-xs"
                  />
                )}
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label className="text-xs font-bold text-[#11151C]">
                  被授权律师姓名（每行或顿号分隔；支持写「姓名:职级」自动分职级签发）
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (cloudAccounts.length === 0) {
                      showToast('请先点击上方「同步账户」拉取本所已登记成员名单，或直接在下方输入');
                      return;
                    }
                    setBatchNamesInput(
                      cloudAccounts.map((m) => `${m.holderName}:${m.role}`).join('\n')
                    );
                    showToast(`已从服务端账户表载入 ${cloudAccounts.length} 位已登记成员`);
                  }}
                  className="rounded border border-[#B89254] bg-[#F3ECE0] px-2.5 py-0.5 text-[11px] font-bold text-[#7A5922] hover:bg-[#EAE0CE]"
                >
                  从已同步账户载入名单
                </button>
              </div>
              <textarea
                rows={4}
                value={batchNamesInput}
                onChange={(e) => setBatchNamesInput(e.target.value)}
                placeholder="例如：张示范:主任、李示例:合伙人、王示例:专职律师、赵示例:律师助理"
                className="w-full rounded border border-[#D8D1C3] bg-white p-2.5 text-xs leading-5"
              />
            </div>

            <button
              type="button"
              onClick={handleBatchSignCodes}
              disabled={!masterToken.trim() || !batchNamesInput.trim()}
              className="w-full rounded-md bg-[#0E223D] py-2.5 text-xs sm:text-sm font-bold text-[#F6F4EF] disabled:opacity-45"
            >
              立即签发团队专属激活码（带一键激活链接）
            </button>

            {issuedCards.length > 0 && (
              <div className="space-y-2.5 pt-2">
                {issuedCards.map((item) => (
                  <div
                    key={item.code}
                    className="rounded-lg border border-[#D8D1C3] bg-white p-3 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#0E223D]">{item.holder}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await copyToClipboard(item.cardText);
                          showToast(`已复制「${item.holder}」微信发放卡片`);
                        }}
                        className="inline-flex items-center gap-1 rounded bg-[#B89254] px-2.5 py-1 text-[11px] font-bold text-[#11151C]"
                      >
                        <Copy className="h-3 w-3" /> 复制微信授权函
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap rounded bg-[#FAF9F6] p-2 font-sans text-[11px] leading-5 text-slate-600 overflow-x-auto">
                      {item.cardText}
                    </pre>
                  </div>
                ))}
              </div>
            )}
              </div>
            )}
          </div>
        )}
      </section>
      )}
    </div>
  );
};
