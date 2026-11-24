import React, { useRef, useState } from 'react';
import {
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { SITE_CONFIG } from '../config/siteConfig';
import { useToolbox } from '../context/ToolboxContext';
import { AI_PROVIDER_PRESETS, testProviderConnectivity } from '../lib/aiClient';
import { copyToClipboard } from '../lib/clipboard';
import {
  decryptWithPassphrase,
  encryptWithPassphrase,
  exportEncryptedSyncCode,
  importEncryptedSyncCode,
} from '../lib/cryptoVault';
import {
  buildSignedAdminHeaders,
  clearSavedLicense,
  formatWeChatInvitationCard,
  getSavedAdminMasterToken,
  isFirmAdminRole,
  saveAdminMasterToken,
  signActivationCodeWithMasterToken,
  type LawyerRoleLabel,
  type VerifiedLicenseInfo,
} from '../lib/licenseEngine';
import { TIANRAN_OFFICIAL_ROSTER } from '../data/firmRoster';
import { toolboxStorage } from '../lib/storage';
import type { AiProviderConfig } from '../types/toolbox';

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
  lastSeenAt: string;
  updatedAt: string;
  note: string;
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
  const { byok, updateByok, sessionUnlockedPin, setSessionUnlockedPin, refreshAllFromDisk, showToast } = useToolbox();

  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showBeginnerGuide, setShowBeginnerGuide] = useState(false);

  // PIN Vault
  const [newPin, setNewPin] = useState('');

  // Cross-device encrypted sync
  const [syncPassword, setSyncPassword] = useState('');
  const [generatedSyncCode, setGeneratedSyncCode] = useState('');
  const [importSyncCodeStr, setImportSyncCodeStr] = useState('');

  // Admin Mobile License Issuer & Real-Time Account Console (Visible ONLY for 主任 / 主任律师)
  const [showIssuerDrawer, setShowIssuerDrawer] = useState(false);
  const [adminSubTab, setAdminSubTab] = useState<'accounts' | 'issuer'>('accounts');
  const [masterToken, setMasterToken] = useState<string>(() => getSavedAdminMasterToken());
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
  const [newAcctName, setNewAcctName] = useState('');
  const [newAcctSerial, setNewAcctSerial] = useState('');
  const [newAcctRole, setNewAcctRole] = useState<LawyerRoleLabel>('专职律师');

  const backupFileRef = useRef<HTMLInputElement>(null);

  const activeProvider =
    byok.providers.find((p) => p.id === byok.activeProviderId) || byok.providers[0];
  const matchedPreset = AI_PROVIDER_PRESETS.find((p) => p.id === activeProvider?.presetId);

  const patchActiveProvider = (patch: Partial<AiProviderConfig>) => {
    const nextProviders = byok.providers.map((p) =>
      p.id === activeProvider.id ? { ...p, ...patch } : p
    );
    updateByok({ ...byok, providers: nextProviders });
    setTestResult(null);
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
      setTestResult({ ok: true, msg });
    } catch (err) {
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
      showToast('已启用 Web Crypto AES-GCM 硬件级加密存储 API Key');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加密失败');
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
      toolboxStorage.importFullWorkspaceJson(txt);
      refreshAllFromDisk();
      showToast('本机测算历史、期限看板与速记数据恢复成功');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '备份文件无法识别');
    } finally {
      e.target.value = '';
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

      for (let i = 0; i < names.length; i++) {
        const parts = names[i].split(/[:：]/);
        const holderName = parts[0].trim();
        const resolvedRole = (parts[1] || issueRole).trim();
        if (!holderName) continue;
        const serialNo = `TR-${year}-${String(startSeq + i).padStart(3, '0')}`;
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
      }

      saveAdminMasterToken(masterToken);
      setIssuedCards(out);
      setSerialStart(String(startSeq + names.length));
      // Silently register newly issued accounts into cloud account control table if online
      if (navigator.onLine && out.length > 0) {
        try {
          const payloadStr = JSON.stringify({
            accounts: names
              .map((raw, idx) => {
                const parts = raw.split(/[:：]/);
                const holderName = parts[0].trim();
                const resolvedRole = (parts[1] || issueRole).trim();
                if (!holderName) return null;
                return {
                  holderName,
                  role: resolvedRole,
                  serialNo: `TR-${year}-${String(startSeq + idx).padStart(3, '0')}`,
                  expiresAt,
                  status: 'active',
                };
              })
              .filter(Boolean),
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
      setCloudAccounts(data.accounts || []);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : '连接管理端失败');
    } finally {
      setAccountsLoading(false);
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
    const cleanSerial = newAcctSerial.trim();
    if (!cleanName && !cleanSerial) {
      showToast('请输入律师姓名或授权编号');
      return;
    }
    setAccountsError(null);
    try {
      const payloadStr = JSON.stringify({
        holderName: cleanName || cleanSerial,
        serialNo: cleanSerial,
        role: newAcctRole,
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
      showToast(`已将「${cleanName || cleanSerial}」加入云端账户列表`);
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
                onClick={() => {
                  clearSavedLicense();
                  try {
                    localStorage.removeItem('lf-sheet-author-manual');
                  } catch {
                    // ignore
                  }
                  onLicenseChanged(null);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/5 hover:bg-white/15 px-2.5 py-1.5 text-xs text-slate-300"
                title="更换激活码或退出本机授权"
              >
                <LogOut className="h-3.5 w-3.5" /> 切换授权码
              </button>
            )}
          </div>
        </div>

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
              onClick={() => updateByok({ ...byok, activeProviderId: prov.id })}
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
                个人 API Key 密钥（仅保存在本机浏览器）
              </label>
              {byok.pinEnabled && activeProvider.apiKeyEncrypted && !activeProvider.apiKey ? (
                <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  🔒 当前密钥已通过 AES-GCM 加密封存。如需更换密钥，请先在下方关闭 PIN 锁或直接输入新密钥覆盖：
                </div>
              ) : null}
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
              <p className="mt-1 text-[11px] text-slate-500">
                纯文字问答仍走上方极速/深度模型；当您上传合同照片、聊天记录或裁判文书截图时，系统会自动切换至本视觉模型。
              </p>
            </div>

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

      {/* Section 2: Web Crypto PIN Vault & Phone <-> PC Encrypted Sync */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#B89254]" />
            <h3 className="font-display text-sm font-bold text-[#11151C]">
              本机 API Key 硬件级 PIN 加密锁（可选）
            </h3>
          </div>
          <p className="text-xs leading-5 text-slate-600">
            利用手机芯片级 Web Crypto (PBKDF2 + AES-GCM 256位) 将您的 API Key 加密后存储，防止借出手机时密钥被查看。
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
          本机办案数据备份与恢复（测算记录 / 保全预警 / 会见速记）
        </h3>
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

          <button
            type="button"
            onClick={async () => {
              showToast('正在拉取最新版本并刷新离线缓存…');
              try {
                if ('serviceWorker' in navigator) {
                  const regs = await navigator.serviceWorker.getRegistrations();
                  await Promise.all(regs.map((r) => r.unregister()));
                }
                if ('caches' in window) {
                  const keys = await caches.keys();
                  await Promise.all(keys.map((k) => caches.delete(k)));
                }
              } catch {
                // ignore
              }
              window.location.reload();
            }}
            className="inline-flex items-center gap-1.5 rounded border border-[#B89254] bg-[#F3ECE0] px-3.5 py-2 text-xs font-bold text-[#7A5922]"
            title="清理旧离线缓存并拉取最新功能（不会清除您的激活码、API Key 与测算记录）"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 检查更新 / 刷新离线缓存
          </button>
        </div>
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
              说明：服务端与前端均不保存您的签发私钥。首次在您本人设备粘贴 <code className="bg-white px-1">TR-MASTER-...</code> 主密钥后（仅存本机本地），即可在下方<strong>一键实时启用 / 关闭任一律师账号</strong>，并随时离线批量签发新激活码。
            </p>

            <div>
              <label className="block text-xs font-bold text-[#11151C] mb-1">
                主任管理主密钥（TR-MASTER-... · 本地签名不出设备）
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={masterToken}
                  onChange={(e) => setMasterToken(e.target.value)}
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
            </div>

            {/* Admin Sub-Tabs: Live Account Enable/Disable vs License Batch Issuer */}
            <div className="grid grid-cols-2 rounded-lg border border-[#DED8CC] bg-white p-1 gap-1">
              <button
                type="button"
                onClick={() => setAdminSubTab('accounts')}
                className={`rounded-md py-2 text-xs font-bold transition-colors ${
                  adminSubTab === 'accounts'
                    ? 'bg-[#0E223D] text-[#F6F4EF]'
                    : 'text-slate-600 hover:text-[#11151C]'
                }`}
              >
                账户实时启用 / 关闭（{cloudAccounts.length || '点同步'}）
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

                {/* Live Account List with 1-Click Enable/Disable */}
                {cloudAccounts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#D8D1C3] bg-white py-8 px-4 text-center text-xs text-slate-500 space-y-2">
                    <p>粘贴您的主任主密钥并点击上方「同步账户」，即可管理全所已登记与已上线律师账号的实时启停状态。</p>
                    <p className="text-[11px] text-slate-400">
                      停用后，该律师联网打开工具箱或检索 IMA 云库、调用 AI 转发接口将在 1 秒内立即拦截生效；重新点击「恢复启用」即可秒恢复。
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#EFECE5] rounded-lg border border-[#DED8CC] bg-white overflow-hidden">
                    {cloudAccounts.map((acct) => {
                      const isSelf = Boolean(
                        acct.holderName === license.holderName ||
                          (license.serialNo && acct.serialNo === license.serialNo)
                      );
                      const isActive = acct.status === 'active';
                      return (
                        <div
                          key={acct.key}
                          className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-3 text-xs ${
                            isActive ? 'bg-white' : 'bg-red-50/40'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-display font-bold text-[#11151C]">
                                {acct.holderName}
                              </span>
                              <span className="rounded bg-[#F3ECE0] px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5922]">
                                {acct.role}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  isActive
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-red-100 text-red-700'
                                }`}
                              >
                                {isActive ? '● 启用中' : '● 已停用'}
                              </span>
                              {isSelf && (
                                <span className="text-[10px] text-slate-400">（当前本机主任）</span>
                              )}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                              <span className="font-mono">
                                编号：{acct.serialNo || '按姓名管控（待首次激活）'}
                              </span>
                              {acct.lastSeenAt && (
                                <span>
                                  最近在线：{new Date(acct.lastSeenAt).toLocaleString('zh-CN', { hour12: false })}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 flex-none">
                            <button
                              type="button"
                              disabled={isSelf || togglingKey === acct.key}
                              onClick={() => handleToggleAccount(acct)}
                              className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 ${
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
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
                    setBatchNamesInput(
                      TIANRAN_OFFICIAL_ROSTER.map((m) => `${m.name}:${m.role}`).join('\n')
                    );
                    showToast(`已填入示例律所 ${TIANRAN_OFFICIAL_ROSTER.length} 位成员（请按本所实际名单修改）`);
                  }}
                  className="rounded border border-[#B89254] bg-[#F3ECE0] px-2.5 py-0.5 text-[11px] font-bold text-[#7A5922] hover:bg-[#EAE0CE]"
                >
                  一键填入官网全所 13 人名录
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
