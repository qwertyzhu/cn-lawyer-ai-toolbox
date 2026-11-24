import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Award,
  CheckCircle2,
  ClipboardPaste,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import {
  saveVerifiedLicense,
  verifyActivationCode,
  type VerifiedLicenseInfo,
} from '../lib/licenseEngine';
import { BrandLogo } from './BrandLogo';
import { SITE_CONFIG } from '../config/siteConfig';

interface PasscodeLockScreenProps {
  onUnlocked: (license: VerifiedLicenseInfo) => void;
  initialError?: string;
}

export const PasscodeLockScreen: React.FC<PasscodeLockScreenProps> = ({
  onUnlocked,
  initialError = '',
}) => {
  const [rawInput, setRawInput] = useState('');
  const [error, setError] = useState(initialError);
  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);
  const [busy, setBusy] = useState(false);
  const [verifiedPreview, setVerifiedPreview] = useState<VerifiedLicenseInfo | null>(null);
  const isWeChat =
    typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);

  const handlePasteClipboard = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) {
        setRawInput(txt);
        setError('');
      }
    } catch {
      // Clipboard read permission denied on some browsers; user can long-press paste
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const info = await verifyActivationCode(rawInput);
      saveVerifiedLicense(info);
      setVerifiedPreview(info);
      window.setTimeout(() => {
        onUnlocked(info);
      }, 650);
    } catch (err) {
      setError(err instanceof Error ? err.message : '激活码校验未通过');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0E223D] flex flex-col justify-between px-4 sm:px-6 py-8 text-[#F6F4EF]">
      <div className="mx-auto w-full max-w-md pt-2">
        <BrandLogo variant="dark-bg" subtitle={SITE_CONFIG.firmName || SITE_CONFIG.appName} />
      </div>

      <div className="mx-auto w-full max-w-md rounded-2xl border border-[#D1B27A]/35 bg-[#101826]/95 p-6 sm:p-8 shadow-2xl">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[#B89254]/15 border border-[#B89254]/40 px-3 py-1 text-[11px] font-semibold text-[#D1B27A]">
          <Award className="h-3.5 w-3.5" />
          团队执业律师实名专属授权系统
        </div>

        <h1 className="mt-4 font-display text-2xl sm:text-3xl font-bold tracking-wide text-white">
          {SITE_CONFIG.appName}
        </h1>
        <p className="mt-2 text-xs sm:text-sm leading-6 text-slate-300">
          当前站点已开启团队实名门禁模式。请粘贴管理员为您签发的实名专属激活码完成设备绑定（首次激活后本机离线永久免输）。
        </p>

        {isWeChat && (
          <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-950/50 p-2.5 text-[11px] leading-5 text-amber-200">
            检测到正在微信内打开：建议点右上角 <strong>「···」</strong> → 选择{' '}
            <strong>「在默认浏览器 / Safari 中打开」</strong> 再激活并添加到手机桌面，后续可断网秒开。
          </div>
        )}

        {verifiedPreview ? (
          <div className="mt-6 rounded-xl border border-emerald-400/50 bg-emerald-950/60 p-4 text-center space-y-1.5">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
            <div className="font-display text-base font-bold text-white">
              专属数字签名核验通过！
            </div>
            <div className="text-xs text-emerald-200">
              欢迎您，{verifiedPreview.holderName}（{verifiedPreview.role} · {verifiedPreview.serialNo}）
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#D1B27A]">
                  实名专属激活码（TR1-...）
                </label>
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2 py-0.5 text-[11px] font-medium text-[#D1B27A]"
                >
                  <ClipboardPaste className="h-3 w-3" /> 一键粘贴剪贴板
                </button>
              </div>
              <textarea
                rows={3}
                autoFocus
                value={rawInput}
                onChange={(e) => {
                  setRawInput(e.target.value);
                  setError('');
                }}
                placeholder="可直接粘贴 TR1-... 激活码，或将微信收到的整段《专属办案工具箱授权函》直接粘贴于此…"
                className="w-full rounded-lg border border-white/20 bg-[#091220] p-3 font-mono text-xs leading-5 text-white placeholder:font-sans placeholder:text-slate-500 focus:border-[#D1B27A] focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-400/40 bg-red-950/60 p-2.5 text-xs leading-5 text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !rawInput.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#B89254] hover:bg-[#C9A364] py-3 text-sm font-bold text-[#11151C] transition-colors disabled:opacity-45"
            >
              {busy ? '正在离线核验数字签名…' : '核验激活码并启用专属工作台'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        )}

        <div className="mt-6 grid grid-cols-2 gap-2 border-t border-white/10 pt-4 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[#D1B27A]" />
            <span>ECDSA 公钥离线防伪</span>
          </div>
          <div className="flex items-center gap-1.5">
            <WifiOff className="h-3.5 w-3.5 text-emerald-400" />
            <span>断网全量本地可用</span>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md text-center text-[11px] text-slate-400">
        © {new Date().getFullYear()} {SITE_CONFIG.firmName || SITE_CONFIG.appName} · Apache-2.0 Open Source
      </div>
    </div>
  );
};
