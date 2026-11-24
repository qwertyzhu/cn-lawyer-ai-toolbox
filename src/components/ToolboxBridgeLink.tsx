import React from 'react';
import {
  BadgeDollarSign,
  BookmarkPlus,
  CalendarPlus,
  MessageSquareText,
  Sparkles,
} from 'lucide-react';
import { useToolbox } from '../context/ToolboxContext';
import { downloadIcsFile } from '../lib/icsGenerator';
import type { OfflineToolId } from '../types/toolbox';

const TOOL_QUERY_KEY = 'cn_lawyer_box_internal_tool_query';

export function trackEvent(_eventName?: string): void {
  // Zero external telemetry in Lawyer Internal Toolbox
}

export function useToolSearchParams(): [URLSearchParams, (next: Record<string, string>) => void] {
  const raw = (() => {
    try {
      return sessionStorage.getItem(TOOL_QUERY_KEY) || '';
    } catch {
      return '';
    }
  })();

  const params = new URLSearchParams(raw);
  const setter = (next: Record<string, string>) => {
    try {
      sessionStorage.setItem(TOOL_QUERY_KEY, new URLSearchParams(next).toString());
    } catch {
      // ignore
    }
  };
  return [params, setter];
}

export function setInternalToolQuery(queryStr: string): void {
  try {
    sessionStorage.setItem(TOOL_QUERY_KEY, queryStr);
  } catch {
    // ignore
  }
}

function buildRiskAuditPrompt(toolId: OfflineToolId, sourceTool: string, cleanNote: string): string {
  const specificTips: Partial<Record<OfflineToolId, string>> = {
    'lpr-interest-calculator':
      '重点核验：① 民间借贷是否触及合同成立时一年期 LPR 四倍司法保护上限；② 违约金与逾期付款利息能否同时主张；③ 分段调息起止日与《民诉法》第264条加倍迟延履行金是否重复计算；④ 是否存在诉讼时效中断或已还款先息后本冲抵问题。',
    'labor-compensation':
      '重点核验：① 杭州/浙江口径下年终奖、提成、加班费是否计入离职前 12 个月平均工资基数；② 是否存在高薪三倍社平封顶及 12 年年限限制；③ 是否涉及三期女职工/医疗期/工伤职工禁止解除红线；④ 1 年劳动仲裁时效与举证责任倒置要点。',
    'injury-compensation':
      '重点核验：① 工伤保险基金支付项与用人单位自付项拆分是否准确（是否参保、停工留薪期工资、未参保连带责任）；② 交通事故交强险与商业三者险赔付顺位及非医保用药扣减抗辩；③ 误工费/护理费/被扶养人生活费举证缺口。',
    'date-calculator':
      '重点核验：① 是否存在公告送达、涉外当事人、管辖权异议或诉前调解导致的期间重新起算或扣除；② 节假日顺延仅适用于期限最后一日（中间节假日不顺延）；③ 实务中建议提前多少工作日递交材料防超期。',
    'litigation-fee-calculator':
      '重点核验：① 简易程序/调解/撤诉减半退费条件；② 反诉、追加诉请与财产保全费（最高 5000 元封顶）叠加规则；③ 诉讼费最终承担比例及胜诉退费申请注意事项。',
  };
  const focus =
    specificTips[toolId] ||
    '重点核验程序前置条件、时效红线、举证缺口及对方高频抗辩点。';
  return `以下是我使用离线确定性公式刚测算完成的准确数据（请勿自行改算加减法，只需专注核查法律实务风险与程序盲点）：\n\n【来源工具】${sourceTool}\n【测算明细】\n${cleanNote}\n\n请站在浙江诉讼律师视角进行「AI 实务风控复核」：\n${focus}\n请分点简明输出：1. 潜在程序/实体踩坑预警；2. 对方最可能的抗辩点；3. 下一步必补证据清单。`;
}

function mapSourceTitleToToolId(sourceTitle: string, fallbackToolId?: OfflineToolId): OfflineToolId {
  if (fallbackToolId) return fallbackToolId;
  if (sourceTitle.includes('要素式') || sourceTitle.includes('起诉状')) return 'elements-complaint';
  if (sourceTitle.includes('诉讼费')) return 'litigation-fee-calculator';
  if (sourceTitle.includes('LPR') || sourceTitle.includes('利息')) return 'lpr-interest-calculator';
  if (sourceTitle.includes('期间') || sourceTitle.includes('时效')) return 'date-calculator';
  if (sourceTitle.includes('补偿金') || sourceTitle.includes('劳动')) return 'labor-compensation';
  if (sourceTitle.includes('工伤') || sourceTitle.includes('人身')) return 'injury-compensation';
  return 'litigation-fee-calculator';
}

interface BridgeLinkProps {
  to: string;
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}

export const Link: React.FC<BridgeLinkProps> = ({ to, className, onClick, children }) => {
  const { openTool, recordCalculation, sendToAi, showToast } = useToolbox();

  if (!to) return null;

  // Hide external marketing blog links inside internal lawyer workbench
  if (to.startsWith('/articles/') || to.startsWith('/services/')) {
    return null;
  }

  // Hide redundant inner "/tools" return link because ToolProShell provides sticky top header
  if (to === '/tools') {
    return null;
  }

  // Internal cross-tool jump (e.g. /tools/litigation-fee-calculator?type=intellectual&amount=10)
  if (to.startsWith('/tools/')) {
    const withoutPrefix = to.slice('/tools/'.length);
    const [slug, query = ''] = withoutPrefix.split('?');
    return (
      <button
        type="button"
        className={className}
        onClick={() => {
          onClick?.();
          setInternalToolQuery(query);
          openTool(slug as OfflineToolId);
        }}
      >
        {children}
      </button>
    );
  }

  // Transform website visitor "/contact?..." CTA into Lawyer Internal Pro Actions!
  if (to.startsWith('/contact')) {
    const qIndex = to.indexOf('?');
    const qs = new URLSearchParams(qIndex >= 0 ? to.slice(qIndex + 1) : '');
    const sourceTool = qs.get('sourceTool') || '办案测算工具';
    const rawNote = qs.get('note') || '';
    const cleanNote = rawNote
      .replace(/\n?希望预约律师.*$/s, '')
      .replace(/\n?希望律师协助.*$/s, '')
      .replace(/\n?希望结合具体.*$/s, '')
      .trim();

    const toolId = mapSourceTitleToToolId(sourceTool);
    const firstLine =
      cleanNote
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)[1] || cleanNote.slice(0, 60);

    // Extract due date if this is DateCalculator
    const dateMatches = [...cleanNote.matchAll(/20\d{2}-\d{2}-\d{2}/g)].map((m) => m[0]);
    const extractedDueDate = dateMatches.length > 0 ? dateMatches[dateMatches.length - 1] : null;
    const isDateTool = toolId === 'date-calculator' && Boolean(extractedDueDate);
    const isFeeTool = toolId === 'litigation-fee-calculator';

    return (
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
        <button
          type="button"
          onClick={() => {
            recordCalculation(toolId, sourceTool, firstLine, cleanNote || sourceTool);
          }}
          className="inline-flex items-center justify-center gap-1.5 rounded bg-[#0E223D] hover:bg-[#16325A] border border-[#0E223D] px-3.5 py-2.5 text-xs font-semibold text-[#F6F4EF] shadow-xs transition-colors"
        >
          <BookmarkPlus className="h-3.5 w-3.5 text-[#D1B27A] flex-none" />
          <span className="whitespace-nowrap">存入本机测算记录</span>
        </button>

        <button
          type="button"
          onClick={() => {
            sendToAi(
              'client-wechat-reply',
              sourceTool,
              `以下是我刚用工具箱测算的准确数据，请据此起草一段发给委托人的专业微信沟通说明：\n\n${cleanNote}`
            );
          }}
          className="inline-flex items-center justify-center gap-1.5 rounded bg-[#B89254] hover:bg-[#C7A265] px-3.5 py-2.5 text-xs font-bold text-[#11151C] shadow-xs transition-colors"
        >
          <MessageSquareText className="h-3.5 w-3.5 flex-none" />
          <span className="whitespace-nowrap">送 AI 生成客户微信回复</span>
        </button>

        {isDateTool && extractedDueDate && (
          <button
            type="button"
            onClick={() => {
              downloadIcsFile(
                [
                  {
                    title: `${sourceTool} · 届满日预警`,
                    dueDate: extractedDueDate,
                    description: cleanNote,
                    alarmDaysBefore: [7, 3, 1],
                  },
                ],
                `办案期限_${extractedDueDate}.ics`
              );
              showToast(`已生成 ${extractedDueDate} 手机系统日历闹钟 (.ics)`);
            }}
            className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 rounded bg-[#1A3761] hover:bg-[#23477A] border border-[#D1B27A]/40 px-3.5 py-2.5 text-xs font-semibold text-white transition-colors"
          >
            <CalendarPlus className="h-3.5 w-3.5 text-[#D1B27A] flex-none" />
            <span>写入手机系统日历闹钟（{extractedDueDate} 提前7/3/1天提醒）</span>
          </button>
        )}

        {isFeeTool && (
          <button
            type="button"
            onClick={() => {
              const amtMatch = cleanNote.match(/涉案标的额：([\d,]+)/);
              if (amtMatch) {
                setInternalToolQuery(`amountYuan=${amtMatch[1].replace(/,/g, '')}`);
              }
              openTool('lawyer-fee-quote');
            }}
            className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 rounded bg-[#1A3761] hover:bg-[#24487C] border border-[#D1B27A]/40 px-3.5 py-2.5 text-xs font-semibold text-white transition-colors"
          >
            <BadgeDollarSign className="h-3.5 w-3.5 text-[#D1B27A] flex-none" />
            <span>联动测算律师服务费与风险代理上限 →</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            sendToAi(
              'legal-sandbox',
              `${sourceTool} · AI 实务风控复核`,
              buildRiskAuditPrompt(toolId, sourceTool, cleanNote)
            );
          }}
          className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 rounded bg-[#FAF8F4] hover:bg-[#F3ECE0] border border-[#0E223D]/35 px-3.5 py-2.5 text-xs font-semibold text-[#0E223D] transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5 text-[#B89254] flex-none" />
          <span>AI 实务风控复核（查程序坑、抗辩点与补证盲点）</span>
        </button>
      </div>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  );
};
