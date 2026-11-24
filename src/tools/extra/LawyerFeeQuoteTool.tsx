import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BadgeDollarSign, ExternalLink, Printer, ShieldCheck } from 'lucide-react';
import { useToolSearchParams } from '../../components/ToolboxBridgeLink';
import { useToolbox } from '../../context/ToolboxContext';

type WorkbenchView = 'calc' | 'cmp' | 'info' | 'sheet';

interface WorkbenchMessage {
  type?: string;
  height?: number;
  view?: WorkbenchView;
  sheetMode?: 'quote' | 'calc';
  summary?: string;
  detailText?: string;
  sourceTitle?: string;
  promptContext?: string;
  message?: string;
}

export const LawyerFeeQuoteTool: React.FC = () => {
  const { recordCalculation, sendToAi, showToast } = useToolbox();
  const [searchParams, setSearchParams] = useToolSearchParams();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [iframeHeight, setIframeHeight] = useState<number>(860);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeView, setActiveView] = useState<WorkbenchView>('calc');
  const [sheetMode, setSheetMode] = useState<'quote' | 'calc'>('quote');

  const [bridgedAmountYuan] = useState<number | null>(() => {
    const raw = searchParams.get('amountYuan');
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : null;
  });

  useEffect(() => {
    if (bridgedAmountYuan) {
      setSearchParams({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgedAmountYuan]);

  const sendInitToIframe = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: 'tr-fee-init',
        amountYuan: bridgedAmountYuan,
      },
      window.location.origin
    );
  }, [bridgedAmountYuan]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<WorkbenchMessage>) => {
      if (event.origin !== window.location.origin) return;
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'tr-fee-ready':
          setIsLoaded(true);
          sendInitToIframe();
          break;
        case 'tr-fee-height':
          if (typeof msg.height === 'number' && msg.height >= 420 && msg.height < 20000) {
            setIframeHeight(Math.ceil(msg.height));
          }
          break;
        case 'tr-fee-view':
          if (msg.view) setActiveView(msg.view);
          if (msg.sheetMode) setSheetMode(msg.sheetMode);
          break;
        case 'tr-fee-scroll-top':
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'tr-fee-scroll-to':
          if (typeof msg.height === 'number' && iframeRef.current) {
            const iframeTop = iframeRef.current.getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: Math.max(0, iframeTop + msg.height - 84), behavior: 'smooth' });
          }
          break;
        case 'tr-fee-save-history':
          if (msg.detailText) {
            recordCalculation(
              'lawyer-fee-quote',
              '律师费与报价单（31省）',
              msg.summary || '律师费标准与报价方案',
              msg.detailText
            );
          }
          break;
        case 'tr-fee-send-ai':
          if (msg.promptContext) {
            sendToAi(
              'client-wechat-reply',
              msg.sourceTitle || '律师费客户报价单',
              msg.promptContext
            );
          }
          break;
        case 'tr-fee-toast':
          if (msg.message) showToast(msg.message);
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [recordCalculation, sendInitToIframe, sendToAi, showToast]);

  useEffect(() => {
    if (isLoaded) {
      sendInitToIframe();
    }
  }, [isLoaded, sendInitToIframe]);

  const standaloneUrl = useMemo(() => {
    const qs = new URLSearchParams({ standalone: '1' });
    if (bridgedAmountYuan) qs.set('amountYuan', String(bridgedAmountYuan));
    if (activeView === 'sheet') {
      qs.set('view', 'sheet');
      qs.set('sheetMode', sheetMode);
    } else if (activeView !== 'calc') {
      qs.set('view', activeView);
    }
    return `/tool-assets/lawyer-fee-workbench.html?${qs.toString()}`;
  }, [bridgedAmountYuan, activeView, sheetMode]);

  const iframeSrc = useMemo(() => {
    const qs = new URLSearchParams({ embed: '1' });
    if (bridgedAmountYuan) qs.set('amountYuan', String(bridgedAmountYuan));
    return `/tool-assets/lawyer-fee-workbench.html?${qs.toString()}`;
  }, [bridgedAmountYuan]);

  const handleTriggerPrint = () => {
    if (activeView === 'sheet' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'tr-fee-print' }, window.location.origin);
      return;
    }
    window.open(standaloneUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="mx-auto max-w-5xl pt-4 sm:pt-6 pb-4">
      {/* Compact Tianran Header Banner */}
      <div className="px-3.5 sm:px-6">
        <div className="rounded-xl border border-[#DED8CC] bg-white px-4 py-3.5 sm:px-5 sm:py-4 shadow-[0_1px_2px_rgba(14,34,61,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9A773E]">
                <BadgeDollarSign className="h-3.5 w-3.5 text-[#B89254] flex-none" />
                <span>全国 31 省核验标准 · 自定义律所落款 · 司发通〔2021〕87号红线</span>
              </div>
              <h1 className="mt-1 font-display text-xl sm:text-2xl font-bold text-[#11151C]">
                律师费标准与客户报价单工作台
              </h1>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                支持全国 31 省及本所分段/计件/计时/风险跳档/知产批量维权测算，一键生成可现场点字修改的 A4 客户报价单、合理开支工时测算单及微信报价文案。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 flex-none">
              {activeView === 'sheet' && (
                <button
                  type="button"
                  onClick={handleTriggerPrint}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#16325A] px-3 py-1.5 text-xs font-semibold text-[#F6F4EF] transition-colors"
                >
                  <Printer className="h-3.5 w-3.5 text-[#D1B27A]" />
                  <span>打印 / 存 PDF</span>
                </button>
              )}
              <a
                href={standaloneUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8D1C3] bg-[#FAF9F6] hover:border-[#0E223D] px-3 py-1.5 text-xs font-semibold text-[#14181F] transition-colors"
                title="在新标签页全屏打开（方便桌面浏览器直接导出 A4 PDF）"
              >
                <ExternalLink className="h-3.5 w-3.5 text-[#9A773E]" />
                <span>独立全屏页</span>
              </a>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#F0ECE3] pt-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 flex-none" />
              落款完全自定义：默认不含个人姓名与电话，生成报价单后可自由编辑或关闭落款（仅存本机）
            </span>
            {bridgedAmountYuan && (
              <span className="rounded bg-[#F3ECE0] px-2 py-0.5 font-medium text-[#7A5922]">
                已联动带入标的额：¥{bridgedAmountYuan.toLocaleString('zh-CN')} 元
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Seamless Auto-Sizing Embedded 31-Province Workbench */}
      <div className="relative mt-1 w-full">
        {!isLoaded && (
          <div className="mx-3.5 sm:mx-6 my-3 rounded-xl border border-[#DED8CC] bg-white p-6 text-center text-xs text-slate-500">
            正在离线加载全国 31 省律师收费标准与报价单引擎…
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title="律师费标准与客户报价单工作台"
          onLoad={() => {
            setIsLoaded(true);
            sendInitToIframe();
          }}
          style={{
            width: '100%',
            height: `${iframeHeight}px`,
            border: 0,
            display: 'block',
            background: '#F6F4EF',
          }}
          scrolling="no"
        />
      </div>
    </div>
  );
};
