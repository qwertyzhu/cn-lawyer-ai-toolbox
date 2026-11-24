import React, { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Clock,
  Copy,
  Pin,
  ShieldCheck,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import { useToolbox } from '../context/ToolboxContext';
import { OFFLINE_TOOLS_REGISTRY } from '../data/toolRegistry';
import { copyToClipboard } from '../lib/clipboard';
import type { OfflineToolId } from '../types/toolbox';

const DYNAMIC_DATA_BASELINES: Partial<
  Record<OfflineToolId, { label: string; imaQuery: string }>
> = {
  'lpr-interest-calculator': {
    label: '内置央行 LPR 历史表已核验至 2026-11（最新 1 年期 3.00% / 5 年期 3.50%）',
    imaQuery: '贷款市场报价利率 LPR 迟延履行利息',
  },
  'labor-compensation': {
    label: '默认预置 2026 参考社平口径（三倍封顶 25,611 元/月），可在下方自由修改为本省市口径并自动保存本机',
    imaQuery: '经济补偿金 违法解除劳动合同 社会平均工资',
  },
  'injury-compensation': {
    label: '默认预置 2026 参考统计基数（全国 56,502 / 地方参考 81,649），可在下方自定义本省市基数及 5–10 级医疗/就业补助月数并自动保存本机',
    imaQuery: '工伤保险条例 人身损害赔偿 一次性工亡补助金',
  },
  'date-calculator': {
    label: '内置 2025–2026 国务院法定节假日与调休表（2027 年及以后暂按常规周末顺延）',
    imaQuery: '民法典 期间 诉讼时效 节假日顺延',
  },
};

interface ToolProShellProps {
  toolId: OfflineToolId;
  children: React.ReactNode;
}

export const ToolProShell: React.FC<ToolProShellProps> = ({ toolId, children }) => {
  const { openTool, openLawsSearch, pinnedTools, togglePinTool, history, sendToAi, showToast } =
    useToolbox();
  const [showHistory, setShowHistory] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const meta = OFFLINE_TOOLS_REGISTRY.find((t) => t.id === toolId);
  const baselineNotice = DYNAMIC_DATA_BASELINES[toolId];
  const isPinned = pinnedTools.includes(toolId);
  const toolHistory = history.filter((h) => h.toolId === toolId);

  const copyRecord = async (id: string, text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedId(id);
      showToast('已复制测算明细');
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  return (
    <div className="min-h-full bg-[#F6F4EF]">
      {/* Compact Sticky Subbar for Mobile Single-Hand Use */}
      <div className="sticky top-0 z-30 border-b border-[#DED8CC] bg-[#F6F4EF]/95 backdrop-blur-md px-3.5 py-2.5 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => openTool(null)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#D8D1C3] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#11151C] active:scale-[0.98] hover:border-[#0E223D]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#0E223D]" />
            <span>工具库</span>
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {toolId === 'elements-complaint' ? (
              <span
                className="hidden sm:inline-flex items-center gap-1 rounded-full bg-[#0E223D]/8 border border-[#0E223D]/15 px-2.5 py-1 text-[11px] font-medium text-[#0E223D]"
                title="离线手动填表、增删行与生成 Word(.docx) 均在浏览器本地完成；仅当您主动点击 AI 转写或 AI 改表时才向自配模型联网发送脱敏文本"
              >
                <ShieldCheck className="h-3 w-3 text-[#9A7538]" />
                填表导出离线 · AI 辅写需联网
              </span>
            ) : meta?.aiTarget ? (
              <span
                className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-950/8 border border-emerald-900/15 px-2.5 py-1 text-[11px] font-medium text-emerald-900"
                title="核心测算与工具运算在浏览器本地离线完成；点击 AI 复核/联动时将跳转 AI 智囊联网调用个人自配模型"
              >
                <WifiOff className="h-3 w-3 text-emerald-700" />
                测算本地离线 · AI 复核需联网
              </span>
            ) : (
              <span
                className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-950/10 px-2.5 py-1 text-[11px] font-medium text-emerald-900"
                title="全部运算与文件处理均在浏览器本地完成，不上传服务器"
              >
                <WifiOff className="h-3 w-3 text-emerald-700" />
                本地离线运行 · 不上传服务器
              </span>
            )}

            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                showHistory
                  ? 'border-[#0E223D] bg-[#0E223D] text-white'
                  : 'border-[#D8D1C3] bg-white text-slate-700 hover:border-[#0E223D]'
              }`}
            >
              <Clock className="h-3.5 w-3.5 text-[#B89254]" />
              <span>记录</span>
              {toolHistory.length > 0 && (
                <span className="rounded-full bg-[#B89254]/20 px-1.5 text-[10px] font-bold text-[#9A773E]">
                  {toolHistory.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                togglePinTool(toolId);
                showToast(isPinned ? '已从工作台快捷区移除' : '已置顶到工作台首页');
              }}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                isPinned
                  ? 'border-[#B89254] bg-[#F3ECE0] text-[#7A5922]'
                  : 'border-[#D8D1C3] bg-white text-slate-600 hover:border-[#B89254]'
              }`}
              title="置顶到首页金刚区"
            >
              <Pin className="h-3.5 w-3.5" />
              <span className="hidden xs:inline">{isPinned ? '已置顶' : '置顶'}</span>
            </button>
          </div>
        </div>

        {/* Expandable Local History Drawer for this Tool */}
        {showHistory && (
          <div className="mx-auto mt-2.5 max-w-6xl rounded-lg border border-[#DED8CC] bg-white p-3.5 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#EFECE5] pb-2">
              <span className="font-display text-xs font-bold text-[#11151C]">
                「{meta?.shortTitle || '本工具'}」本机保存的测算记录（仅存手机本地）
              </span>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {toolHistory.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-500">
                暂无保存记录。测算完成后点击结果面板下方的「存入本机测算记录」即可随时离线调阅。
              </p>
            ) : (
              <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                {toolHistory.map((item) => (
                  <div
                    key={item.id}
                    className="rounded border border-[#EAE5DA] bg-[#FAF9F6] p-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => copyRecord(item.id, item.detailText)}
                          className="inline-flex items-center gap-1 rounded border border-[#D8D1C3] bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-[#0E223D]"
                        >
                          {copiedId === item.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" /> 已复制
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> 复制全文
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            sendToAi(
                              meta?.aiTarget || 'client-wechat-reply',
                              item.toolTitle,
                              item.detailText
                            )
                          }
                          className="inline-flex items-center gap-1 rounded bg-[#0E223D] px-2 py-0.5 text-[11px] font-medium text-[#F3ECE0]"
                        >
                          <Sparkles className="h-3 w-3 text-[#D1B27A]" /> 送AI
                        </button>
                      </div>
                    </div>
                    <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs leading-5 text-[#14181F]">
                      {item.detailText}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {baselineNotice && (
        <div className="border-b border-[#E5DFD3] bg-[#FBF8F1] px-3.5 py-2 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-[11px] text-[#5A5347]">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700 flex-none" />
              <span>{baselineNotice.label}</span>
            </span>
            <button
              type="button"
              onClick={() => openLawsSearch(baselineNotice.imaQuery, 'ima_cloud')}
              className="inline-flex items-center gap-1 font-semibold text-[#0E223D] hover:text-[#9A773E] underline"
            >
              <BookOpen className="h-3 w-3" /> 去 IMA 核查最新法规/公报 ↗
            </button>
          </div>
        </div>
      )}

      <div>{children}</div>
    </div>
  );
};
