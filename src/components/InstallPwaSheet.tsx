import React, { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallPwaSheetProps {
  open: boolean;
  onClose: () => void;
}

export const InstallPwaSheet: React.FC<InstallPwaSheetProps> = ({ open, onClose }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!open) return null;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isWeChat = /MicroMessenger/i.test(ua);
  const isIOS = /iPad|iPhone|iPod/i.test(ua);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[#DED8CC] bg-white p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-[#0E223D] p-2 text-[#D1B27A]">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-[#11151C]">
                新手 3 步速通 &amp; 安装到手机桌面
              </h3>
              <p className="text-xs text-slate-500">全所随身办案单兵舱 · 离线秒开、个人数据互不串号</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Concise 3-Step Lawyer Onboarding Guide */}
        <div className="rounded-lg border border-[#EAE5DA] bg-[#FAF9F6] p-3 text-xs leading-5 text-slate-700 space-y-1.5">
          <div className="font-bold text-[#0E223D]">📌 律师同事 1 分钟上手三件事：</div>
          <div>
            <strong>① 12 项离线工具直接用</strong>：要素式起诉状（支持上传传统 Word 一键转表）、诉讼费、LPR 利息、律师费报价单（底部自定义个人落款）及 50MB 证据 PDF 拆分均在手机本地运行，零费用、零上传。
          </div>
          <div>
            <strong>② 查法条与 4.48 万份案例库</strong>：顶部搜索条输条号秒查 4,111 条离线法典；进「法典清单 → IMA 案例法规库」可手机直读 PDF 正文、带出处 AI 问答，或一键直达腾讯 IMA 官方免费语义问答。
          </div>
          <div>
            <strong>③ 按需填个人 API Key</strong>：在底部「我的配置」填入个人 DeepSeek / 阿里云百炼 / Kimi 等密钥，仅存在自己设备本地（绝不与他人混用），即可解锁全部 AI 合同审校、要素诉状转写与 Word 导出。
          </div>
        </div>

        {isWeChat && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
            <strong>当前正在微信内置浏览器中打开：</strong>
            <br />
            请先点击微信右上角 <strong>「···」</strong> → 选择 <strong>「在默认浏览器中打开」</strong>（苹果为 Safari，安卓为系统浏览器），然后再添加到主屏幕即可享受永久离线图标！
          </div>
        )}

        {deferredPrompt ? (
          <button
            type="button"
            onClick={async () => {
              await deferredPrompt.prompt();
              setDeferredPrompt(null);
              onClose();
            }}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0E223D] py-3 text-sm font-bold text-white"
          >
            <Download className="h-4 w-4 text-[#D1B27A]" /> 立即一键安装到桌面
          </button>
        ) : (
          <div className="space-y-3 text-xs leading-6 text-slate-700">
            <div
              className={`rounded-lg border p-3 ${
                isIOS ? 'border-[#0E223D] bg-[#FAF9F6]' : 'border-[#EAE5DA] bg-white'
              }`}
            >
              <div className="font-bold text-[#0E223D] flex items-center gap-1.5">
                <Share className="h-3.5 w-3.5 text-[#B89254]" /> 苹果 iPhone / iPad（Safari 浏览器）
              </div>
              <p className="mt-1">
                1. 点击 Safari 底部正中央的 <strong>「分享按钮」</strong>（向上箭头图标）；
                <br />
                2. 向上滑动菜单，点击 <strong>「添加到主屏幕」</strong> → 右上角点击「添加」即完成。
              </p>
            </div>

            <div
              className={`rounded-lg border p-3 ${
                !isIOS ? 'border-[#0E223D] bg-[#FAF9F6]' : 'border-[#EAE5DA] bg-white'
              }`}
            >
              <div className="font-bold text-[#0E223D]">安卓手机（华为 / 小米 / vivo / OPPO / Edge）</div>
              <p className="mt-1">
                点击浏览器底部或右上角菜单 <strong>「≡ / ⋮」</strong> → 选择 <strong>「添加至桌面 / 安装应用」</strong> 即可生成独立桌面图标。
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg border border-[#DED8CC] py-2 text-xs font-semibold text-slate-600"
        >
          我知道了
        </button>
      </div>
    </div>
  );
};
