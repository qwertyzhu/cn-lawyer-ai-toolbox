import React, { useEffect, useState } from 'react';
import {
  Award,
  BookOpen,
  Home,
  Search,
  Settings,
  Sparkles,
  Wifi,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { BrandLogo } from './components/BrandLogo';
import { CommandSearchModal } from './components/CommandSearchModal';
import { InstallPwaSheet } from './components/InstallPwaSheet';
import { PasscodeLockScreen } from './components/PasscodeLockScreen';
import { SITE_CONFIG } from './config/siteConfig';
import { ToolboxProvider, useToolbox } from './context/ToolboxContext';
import {
  clearSavedLicense,
  createOpenModeLicense,
  getSavedLicense,
  saveVerifiedLicense,
  verifyActivationCode,
  type VerifiedLicenseInfo,
} from './lib/licenseEngine';
import { resetLocalUserWorkspaceForAccountSwitch } from './lib/cloudSync';
import { AiHubTab } from './pages/AiHubTab';
import { HomeTab } from './pages/HomeTab';
import { LawsAndChecklistsTab } from './pages/LawsAndChecklistsTab';
import { SettingsTab } from './pages/SettingsTab';
import { ToolsTab } from './pages/ToolsTab';
import type { MainTabId } from './types/toolbox';

const NAV_ITEMS: {
  id: MainTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
}[] = [
  { id: 'home', label: '工作台', icon: Home },
  { id: 'tools', label: '离线工具', icon: Wrench },
  { id: 'ai', label: 'AI 智囊', icon: Sparkles, highlight: true },
  { id: 'laws', label: '法典清单', icon: BookOpen },
  { id: 'settings', label: '我的配置', icon: Settings },
];

const ToolboxShell: React.FC<{
  license: VerifiedLicenseInfo;
  onLicenseChanged: (next: VerifiedLicenseInfo | null) => void;
  justAutoActivatedName?: string | null;
}> = ({ license, onLicenseChanged, justAutoActivatedName }) => {
  const { activeTab, navigateTab, openTool, isOnline, toastMessage, showToast } = useToolbox();
  const [searchOpen, setSearchOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [weChatTipDismissed, setWeChatTipDismissed] = useState(false);
  const isWeChat =
    typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);

  useEffect(() => {
    if (justAutoActivatedName) {
      showToast(`🎉 专属授权已自动激活：欢迎您，${justAutoActivatedName}！`);
    }
  }, [justAutoActivatedName, showToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#F6F4EF] text-[#14181F]">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0E223D] text-[#F6F4EF] border-r border-[#1A3761] z-40">
        <div className="p-5 border-b border-white/10">
          <BrandLogo variant="dark-bg" subtitle={SITE_CONFIG.appName} />
        </div>

        <div className="p-3">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center justify-between rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs text-slate-300"
          >
            <span className="inline-flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-[#D1B27A]" /> 秒搜工具 / 输条号…
            </span>
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[#D1B27A]">⌘K</kbd>
          </button>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  openTool(null);
                  navigateTab(item.id);
                }}
                className={`w-full flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-[#B89254] text-[#11151C] font-bold shadow-sm'
                    : item.highlight
                    ? 'text-[#D1B27A] hover:bg-white/10'
                    : 'text-slate-200 hover:bg-white/10'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* License / Mode Badge in Desktop Sidebar */}
        <div className="p-4 border-t border-white/10 text-xs space-y-2">
          <div className="rounded-lg bg-[#091526] border border-[#D1B27A]/30 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#D1B27A]">
              <Award className="h-3 w-3" />{' '}
              {SITE_CONFIG.authMode === 'license' ? '团队专属授权铭牌' : '开源离线优先工作台'}
            </div>
            <div className="mt-1 font-display text-xs font-bold text-white truncate">
              {license.holderName} · {license.role}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-400">
              {SITE_CONFIG.authMode === 'license'
                ? `${license.serialNo} ｜ ${license.expiresAt ? `至${license.expiresAt}` : '长期有效'}`
                : 'Apache-2.0 · 数据仅存本机'}
            </div>
          </div>

          <div className="flex items-center gap-1.5 font-medium text-slate-300 pt-0.5">
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                <span>网络在线（AI + 离线双就绪）</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-300" />
                <span>断网模式（本地全功能就绪）</span>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        {/* Mobile & Tablet Sticky Header */}
        <header className="lg:hidden sticky top-0 z-40 safe-top-header bg-[#0E223D] text-[#F6F4EF] border-b border-[#1A3761] px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div
              onClick={() => {
                openTool(null);
                navigateTab('home');
              }}
              className="cursor-pointer min-w-0"
            >
              <BrandLogo variant="dark-bg" compact subtitle={SITE_CONFIG.appName} />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="hidden xs:inline-flex items-center gap-1 rounded-full bg-[#B89254]/20 border border-[#D1B27A]/35 px-2 py-0.5 text-[10px] font-semibold text-[#D1B27A] max-w-[110px] truncate">
                <Award className="h-2.5 w-2.5 flex-none" />
                <span className="truncate">{license.holderName}</span>
              </span>

              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isOnline
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-950/80 text-amber-200 border border-amber-400/30'
                }`}
              >
                {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {isOnline ? '在线' : '离线'}
              </span>

              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/10 px-2.5 py-1.5 text-xs font-medium text-[#F6F4EF]"
                aria-label="全局搜索"
              >
                <Search className="h-3.5 w-3.5 text-[#D1B27A]" />
                <span>秒搜</span>
              </button>
            </div>
          </div>
        </header>

        {/* WeChat Built-in Browser Friendly Tip Banner */}
        {isWeChat && !weChatTipDismissed && (
          <div className="bg-amber-50 border-b border-amber-200 px-3.5 py-2 text-[11px] text-amber-950 flex items-center justify-between gap-2">
            <span>
              微信内访问：点右上角 <strong>「···」</strong> →{' '}
              <strong>「在默认浏览器 / Safari 中打开」</strong> 可直接保留激活状态并安装到桌面。
            </span>
            <button
              type="button"
              onClick={() => setWeChatTipDismissed(true)}
              className="flex-none rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-900"
            >
              收起
            </button>
          </div>
        )}

        {/* Active Tab Viewport */}
        <main className="flex-1 safe-pb lg:pb-8">
          {activeTab === 'home' && (
            <HomeTab license={license} onOpenInstallGuide={() => setInstallOpen(true)} />
          )}
          {activeTab === 'tools' && <ToolsTab />}
          {activeTab === 'ai' && <AiHubTab />}
          {activeTab === 'laws' && <LawsAndChecklistsTab />}
          {activeTab === 'settings' && (
            <SettingsTab
              license={license}
              onOpenInstallGuide={() => setInstallOpen(true)}
              onLicenseChanged={onLicenseChanged}
            />
          )}
        </main>

        {/* Mobile Bottom Single-Hand 5-Tab Bar */}
        <nav
          aria-label="底部主导航"
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[#DED8CC] bg-white/95 backdrop-blur-md safe-bottom-nav shadow-[0_-2px_12px_rgba(14,34,61,0.06)]"
        >
          <div className="grid grid-cols-5 h-14 items-center px-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;

              if (item.highlight) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      openTool(null);
                      navigateTab(item.id);
                    }}
                    className="flex flex-col items-center justify-center -mt-3"
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full shadow-md transition-transform active:scale-95 ${
                        active
                          ? 'bg-[#0E223D] text-[#D1B27A] ring-2 ring-[#B89254]'
                          : 'bg-[#B89254] text-[#11151C]'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <span
                      className={`mt-0.5 text-[10px] font-bold ${
                        active ? 'text-[#0E223D]' : 'text-[#7A5922]'
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    openTool(null);
                    navigateTab(item.id);
                  }}
                  className={`flex flex-col items-center justify-center py-1 transition-colors ${
                    active ? 'text-[#0E223D] font-bold' : 'text-slate-500'
                  }`}
                >
                  <Icon className={`h-5 w-5 ${active ? 'text-[#0E223D]' : 'text-slate-400'}`} />
                  <span className="mt-0.5 text-[10px]">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Global Toast */}
      {toastMessage && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] rounded-2xl bg-[#11151C] px-4 py-2 text-center text-xs font-semibold text-[#F6F4EF] shadow-xl border border-[#B89254]/40 break-words">
          {toastMessage}
        </div>
      )}

      <CommandSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <InstallPwaSheet open={installOpen} onClose={() => setInstallOpen(false)} />
    </div>
  );
};

export function App() {
  const isLicenseMode = SITE_CONFIG.authMode === 'license';
  const [license, setLicense] = useState<VerifiedLicenseInfo | null>(() =>
    isLicenseMode ? getSavedLicense() : createOpenModeLicense()
  );
  const [autoActivatedName, setAutoActivatedName] = useState<string | null>(null);
  const [activateUrlError, setActivateUrlError] = useState('');
  const [suspendedReason, setSuspendedReason] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [pendingSwitchLicense, setPendingSwitchLicense] = useState<VerifiedLicenseInfo | null>(null);

  const stripActivateParamFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('activate')) return;
    params.delete('activate');
    const nextSearch = params.toString();
    const cleanUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', cleanUrl);
  };

  const checkCloudAccountStatus = async (lic: VerifiedLicenseInfo | null) => {
    if (!isLicenseMode || !lic || !navigator.onLine) return;
    setCheckingStatus(true);
    try {
      const resp = await fetch('/api/license/status', {
        headers: { 'X-Toolbox-License': lic.rawCode },
        cache: 'no-store',
      });
      const data = await resp.json().catch(() => null);
      if (data && data.active === false) {
        setSuspendedReason(data.reason || data.error || '该授权账号已被管理端暂停使用，请联系管理员');
      } else if (data && data.active === true) {
        setSuspendedReason(null);
      }
    } catch {
      // Offline or static-only deployment: keep offline-first access smoothly
    } finally {
      setCheckingStatus(false);
    }
  };

  // Silently check cloud account enable/disable status on boot (license mode only)
  useEffect(() => {
    if (!isLicenseMode || !license) {
      setSuspendedReason(null);
      return;
    }
    checkCloudAccountStatus(license);
    const onResume = () => {
      if (document.visibilityState === 'visible') {
        checkCloudAccountStatus(license);
      }
    };
    const onOnline = () => checkCloudAccountStatus(license);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [license, isLicenseMode]);

  // Support 1-tap WeChat link activation in team license mode: https://your-domain.com/?activate=TR1-...
  useEffect(() => {
    if (!isLicenseMode) return;
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('activate');
    if (!urlCode) return;

    const isWeChat = /MicroMessenger/i.test(navigator.userAgent);
    verifyActivationCode(urlCode)
      .then((verified) => {
        const existing = getSavedLicense();
        if (existing && existing.holderName && existing.holderName !== verified.holderName) {
          stripActivateParamFromUrl();
          setPendingSwitchLicense(verified);
          return;
        }
        saveVerifiedLicense(verified);
        setLicense(verified);
        setSuspendedReason(null);
        setActivateUrlError('');
        setAutoActivatedName(`${verified.holderName}（${verified.role}）`);
        if (!isWeChat) {
          stripActivateParamFromUrl();
        }
      })
      .catch((err) => {
        setActivateUrlError(
          err instanceof Error
            ? `专属激活链接核验失败：${err.message}`
            : '专属激活链接不完整或已失效，请检查后重试或联系管理员重发'
        );
      });
  }, [isLicenseMode]);

  if (isLicenseMode && !license) {
    return (
      <PasscodeLockScreen
        onUnlocked={(info) => setLicense(info)}
        initialError={activateUrlError}
      />
    );
  }

  const effectiveLicense = license || createOpenModeLicense();

  if (suspendedReason) {
    return (
      <div className="min-h-screen bg-[#0E223D] flex flex-col items-center justify-center px-4 py-8 text-[#F6F4EF]">
        <div className="w-full max-w-md rounded-2xl border border-red-400/40 bg-[#101826]/95 p-6 sm:p-8 shadow-2xl space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-950/80 border border-red-400/40 text-red-300 font-bold text-xl">
            !
          </div>
          <h1 className="font-display text-xl font-bold text-white">账号权限已暂停</h1>
          <p className="text-xs sm:text-sm leading-6 text-slate-300">{suspendedReason}</p>
          <div className="rounded-lg bg-white/5 border border-white/10 p-3 text-xs text-slate-400">
            当前设备绑定：{effectiveLicense.holderName}（{effectiveLicense.role} · {effectiveLicense.serialNo}）
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              disabled={checkingStatus}
              onClick={() => checkCloudAccountStatus(effectiveLicense)}
              className="flex-1 rounded-lg bg-[#B89254] hover:bg-[#C9A364] py-2.5 text-xs font-bold text-[#11151C] disabled:opacity-50"
            >
              {checkingStatus ? '正在核验云端状态…' : '已联系管理员恢复 · 重新核验'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetLocalUserWorkspaceForAccountSwitch();
                clearSavedLicense();
                setSuspendedReason(null);
                setLicense(null);
              }}
              className="flex-1 rounded-lg border border-white/20 bg-white/5 hover:bg-white/10 py-2.5 text-xs font-semibold text-slate-200"
            >
              更换其他授权码
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ToolboxProvider key={effectiveLicense.holderName} license={isLicenseMode ? effectiveLicense : null}>
      <ToolboxShell
        license={effectiveLicense}
        onLicenseChanged={(next) => setLicense(next)}
        justAutoActivatedName={autoActivatedName}
      />

      {isLicenseMode && pendingSwitchLicense && (
        <div className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#D1B27A]/50 bg-white p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-800 font-bold text-lg">
                !
              </div>
              <div>
                <h2 className="font-display text-base sm:text-lg font-bold text-[#0E223D]">
                  检测到您点开了其他成员的激活链接
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  为防止误覆盖本机当前账号，系统已自动拦截该链接，<strong>未更改您当前的登录身份</strong>。
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-[#EAE5DA] bg-[#FAF9F6] p-3.5 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">当前本机已绑定：</span>
                <span className="font-bold text-[#0E223D]">
                  {effectiveLicense.holderName}（{effectiveLicense.role} · {effectiveLicense.serialNo}）
                </span>
              </div>
              <div className="border-t border-[#EAE5DA] pt-2 flex items-center justify-between gap-2">
                <span className="text-slate-500">刚点开的链接属于：</span>
                <span className="font-bold text-amber-800">
                  {pendingSwitchLicense.holderName}（{pendingSwitchLicense.role} · {pendingSwitchLicense.serialNo}）
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingSwitchLicense(null)}
                className="w-full rounded-lg bg-[#0E223D] hover:bg-[#163257] py-2.5 text-xs sm:text-sm font-bold text-[#F6F4EF]"
              >
                保持当前账号（{effectiveLicense.holderName}）不变（推荐）
              </button>
              <button
                type="button"
                onClick={() => {
                  resetLocalUserWorkspaceForAccountSwitch();
                  saveVerifiedLicense(pendingSwitchLicense);
                  setLicense(pendingSwitchLicense);
                  setSuspendedReason(null);
                  setAutoActivatedName(
                    `${pendingSwitchLicense.holderName}（${pendingSwitchLicense.role}）`
                  );
                  setPendingSwitchLicense(null);
                }}
                className="w-full rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 py-2 text-xs font-semibold text-amber-950"
              >
                确认将本机切换为 {pendingSwitchLicense.holderName}（{pendingSwitchLicense.role}）
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolboxProvider>
  );
}

export default App;
