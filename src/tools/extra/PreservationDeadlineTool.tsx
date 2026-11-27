import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  CalendarPlus,
  Check,
  CheckCircle2,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react';
import { useToolbox } from '../../context/ToolboxContext';
import { copyToClipboard } from '../../lib/clipboard';
import { downloadIcsFile } from '../../lib/icsGenerator';
import {
  computeLegalDeadline,
  diffDaysYmd,
  formatCnYmd,
  getTodayChinaYmd,
  isValidIsoYmd,
  type DeadlineRolloverMode,
} from '../../lib/legalCalendar';
import type { DeadlineReminderItem } from '../../types/toolbox';

interface PresetRule {
  id: string;
  label: string;
  category: DeadlineReminderItem['category'];
  rolloverMode: DeadlineRolloverMode;
  months?: number;
  days?: number;
  warnDaysBefore: number;
  basis: string;
}

const PRESETS: PresetRule[] = [
  {
    id: 'bank_freeze_1y',
    label: '银行存款账户冻结（最长 1 年 · 提前30日续冻）',
    category: 'preservation',
    rolloverMode: 'preservation_freeze',
    months: 12,
    warnDaysBefore: 30,
    basis:
      '《民诉法解释》第487条：人民法院冻结被执行人的银行存款的期限不得超过一年；保全查封/冻结到期自动解冻、不适用民事期间顺延，应在届满前提前提交续冻申请。',
  },
  {
    id: 'movable_seize_2y',
    label: '动产查封 / 扣押（最长 2 年 · 提前30日续封）',
    category: 'preservation',
    rolloverMode: 'preservation_freeze',
    months: 24,
    warnDaysBefore: 30,
    basis:
      '《民诉法解释》第487条：查封、扣押动产的期限不得超过二年（到期不因节假日顺延，请提前续封）。',
  },
  {
    id: 'real_estate_equity_3y',
    label: '不动产查封 / 股权等财产权冻结（最长 3 年 · 提前30日续封）',
    category: 'preservation',
    rolloverMode: 'preservation_freeze',
    months: 36,
    warnDaysBefore: 30,
    basis:
      '《民诉法解释》第487条：查封不动产、冻结其他财产权的期限不得超过三年（到期不因节假日顺延，请提前续封）。',
  },
  {
    id: 'apply_exec_2y',
    label: '申请强制执行期间（履行期届满起 2 年）',
    category: 'execution',
    rolloverMode: 'civil_statutory',
    months: 24,
    warnDaysBefore: 30,
    basis:
      '《民事诉讼法》第250条、《民法典》第202-203条：申请执行的期间为二年，届满日对应日无该日则以该月最后一日为准，最后一日为法定休假日的顺延至首个工作日。',
  },
  {
    id: 'appraisal_report_obj_5d',
    label: '财产评估报告书面异议期（收到报告起 5 日）',
    category: 'execution',
    rolloverMode: 'civil_statutory',
    days: 5,
    warnDaysBefore: 2,
    basis:
      '《最高人民法院关于人民法院确定财产处置参考价若干问题的规定》（法释〔2018〕15号）第22–24条：当事人、利害关系人收到评估报告后五日内可提出书面异议（逾期不予受理；期间最后一日为法定休假日的顺延至节后首个工作日）。',
  },
  {
    id: 'exec_reconsideration_10d',
    label: '执行异议裁定申请复议期（收到裁定起 10 日）',
    category: 'execution',
    rolloverMode: 'civil_statutory',
    days: 10,
    warnDaysBefore: 3,
    basis:
      '《民事诉讼法》第236条：当事人、利害关系人对执行行为异议裁定不服的，可自裁定送达之日起十日内向上一级人民法院申请复议（注：针对违法执行行为本身的书面异议须在相关执行程序终结前提出，15日系法院审查期而非当事人提出期）。',
  },
  {
    id: 'exec_outsider_suit_15d',
    label: '案外人执行异议之诉起诉期（收到裁定起 15 日）',
    category: 'execution',
    rolloverMode: 'civil_statutory',
    days: 15,
    warnDaysBefore: 3,
    basis:
      '《民事诉讼法》第238条：案外人、当事人对执行标的异议裁定不服，认为原判决、裁定无关的，自裁定送达之日起十五日内向人民法院提起诉讼（遇法定休假日顺延至首个工作日）。',
  },
  {
    id: 'labor_arb_suit_15d',
    label: '劳动仲裁裁决后向法院起诉期（15 日）',
    category: 'arbitration',
    rolloverMode: 'civil_statutory',
    days: 15,
    warnDaysBefore: 3,
    basis:
      '《劳动争议调解仲裁法》第50条、《民诉法》第85条：非终局裁决自收到仲裁裁决书之日起十五日内向人民法院提起诉讼，最后一日为法定休假日的顺延至节后首个工作日。',
  },
];

function daysFromToday(ymd: string): number {
  const diff = diffDaysYmd(getTodayChinaYmd(), ymd);
  return Number.isFinite(diff) ? diff : 0;
}

export const PreservationDeadlineTool: React.FC = () => {
  const { deadlines, setDeadlines, casePockets, activeCaseId, showToast } = useToolbox();
  const activeCase = casePockets.find((c) => c.id === activeCaseId) || null;

  const [caseName, setCaseName] = useState('');
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [startDate, setStartDate] = useState(() => getTodayChinaYmd());
  const [manualDueDate, setManualDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [copiedPreview, setCopiedPreview] = useState(false);

  const activePreset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];

  const preview = useMemo(() => {
    return computeLegalDeadline({
      startYmd: startDate,
      months: activePreset.months,
      days: activePreset.days,
      rolloverMode: activePreset.rolloverMode,
      warnDaysBefore: activePreset.warnDaysBefore,
      manualDueYmd: manualDueDate.trim() || undefined,
    });
  }, [startDate, activePreset, manualDueDate]);

  const buildSummaryNote = () => {
    if (!preview) return '';
    const parts: string[] = [];
    if (notes.trim()) parts.push(notes.trim());
    if (preview.verificationStatus === 'manual_override') {
      parts.push('按文书载明届满日录入');
    } else if (preview.extended) {
      parts.push(`理论届满 ${preview.rawEndYmd} 遇休假日顺延至 ${preview.finalEndYmd}`);
    }
    if (preview.holidayWarningText) {
      parts.push(preview.holidayWarningText);
    }
    if (parts.length === 0) {
      parts.push(activePreset.basis);
    }
    return parts.join(' ｜ ');
  };

  const handleCopyPreview = async () => {
    if (!preview || preview.hasDateConflict) {
      showToast('当前届满日早于起算日，存在日期冲突，请先修正后再复制');
      return;
    }
    const statusTag =
      preview.verificationStatus === 'pending_holiday_schedule'
        ? '【待核验当年国务院放假通知】'
        : preview.verificationStatus === 'manual_override'
        ? '【按文书载明日期】'
        : '';
    const text = [
      `【办案期限核算 · ${activePreset.label}】${statusTag}`,
      caseName.trim() ? `案件名称：${caseName.trim()}` : '',
      `起算日期：${formatCnYmd(preview.startYmd)}`,
      preview.extended ? `自然历理论届满日：${formatCnYmd(preview.rawEndYmd)}` : '',
      `${preview.verificationStatus === 'pending_holiday_schedule' ? '推算届满日（待核验）' : '届满日期'}：${formatCnYmd(preview.finalEndYmd)}`,
      `提前预警日：${formatCnYmd(preview.warnYmd)}`,
      preview.holidayWarningText || '',
      `规则依据：${activePreset.basis}`,
    ]
      .filter(Boolean)
      .join('\n');
    await copyToClipboard(text);
    setCopiedPreview(true);
    setTimeout(() => setCopiedPreview(false), 1800);
    showToast('已复制完整期限核算摘要（含顺延口径与核验提示）');
  };

  const handleAddDeadline = () => {
    if (!preview) {
      showToast('请先填写有效的起算日期');
      return;
    }
    if (preview.hasDateConflict) {
      showToast('手输文书届满日早于起算日，请修正日期冲突后再加入看板');
      return;
    }
    const label = caseName.trim() || activeCase?.title || '未命名案件';
    const statusSuffix =
      preview.verificationStatus === 'pending_holiday_schedule' ? ' [待核验调休]' : '';
    const item: DeadlineReminderItem = {
      id: `dl-${Date.now()}`,
      caseId: activeCaseId || undefined,
      caseName: label,
      title: `${label} · ${activePreset.label.split('（')[0]}${statusSuffix}`,
      category: activePreset.category,
      startDate: preview.startYmd,
      dueDate: preview.finalEndYmd,
      warnDate: preview.warnYmd,
      notes: buildSummaryNote(),
      completed: false,
      createdAt: new Date().toISOString(),
    };
    setDeadlines([item, ...deadlines]);
    setCaseName('');
    setNotes('');
    setManualDueDate('');
    showToast('已加入本机办案期限预警看板');
  };

  const exportSingleIcs = (item: DeadlineReminderItem) => {
    if (!isValidIsoYmd(item.dueDate) || !isValidIsoYmd(item.warnDate)) {
      showToast('该期限记录日期格式无效，无法导出日历');
      return;
    }
    downloadIcsFile(
      [
        {
          title: `${item.title}（续封/预警红线）`,
          dueDate: item.warnDate,
          description: `案件：${item.caseName}\n届满日：${item.dueDate}\n备注与核验说明：${item.notes}`,
          alarmDaysBefore: [3, 1],
        },
        {
          title: `${item.title}（届满日）`,
          dueDate: item.dueDate,
          description: `案件：${item.caseName}\n起始日：${item.startDate}\n备注与核验说明：${item.notes}`,
          alarmDaysBefore: [7, 3, 1],
        },
      ],
      `${item.caseName}_期限提醒.ics`
    );
    showToast('已导出手机系统日历 (.ics)，点击打开即可添加闹钟');
  };

  const exportAllActiveIcs = () => {
    const active = deadlines.filter((d) => !d.completed && isValidIsoYmd(d.dueDate));
    if (active.length === 0) {
      showToast('当前没有待办期限记录');
      return;
    }
    downloadIcsFile(
      active.map((d) => ({
        title: d.title,
        dueDate: d.dueDate,
        description: `提前预警日：${d.warnDate}\n备注与核验说明：${d.notes}`,
        alarmDaysBefore: [30, 7, 3, 1],
      })),
      '律师办案全部期限预警.ics'
    );
    showToast(`已批量导出 ${active.length} 条期限到手机系统日历`);
  };

  return (
    <div className="py-5 sm:py-8 px-4 sm:px-6 mx-auto max-w-6xl">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9A773E]">
        <BellRing className="h-3.5 w-3.5 text-[#B89254]" />
        <span>PRESERVATION & EXECUTION WATCHDOG · 零成本系统日历闹钟</span>
      </div>
      <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-[#11151C]">
        财产保全续封与执行期限预警看板
      </h1>
      <p className="mt-1.5 text-xs sm:text-sm leading-6 text-slate-600">
        严格区分「法院查封冻结到期不顺延、提前30日续封」与「诉讼/仲裁起诉期按 2025–2027 法定节假日自动顺延」，支持录入文书载明日期并一键写入手机系统日历。
      </p>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Form */}
        <div className="lg:col-span-5 rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#11151C] mb-1.5">案件简称 / 被执行人或保全标的</label>
            <input
              type="text"
              value={caseName}
              onChange={(e) => setCaseName(e.target.value)}
              placeholder="如：某公司货款纠纷案 · 冻结被告基本户"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 text-xs sm:text-sm focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#11151C] mb-1.5">保全 / 执行 / 起诉期限类型</label>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2.5 text-xs sm:text-sm font-medium focus:border-[#0E223D] focus:outline-none"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
              实务区分：财产评估报告书面异议期仅 <strong>5 日</strong>（法释〔2018〕15号第22条，逾期不予受理）；《民诉法》第236条执行行为异议须在相关执行终结前提出（15 日为法院审查期），收到异议裁定申请复议为 <strong>10 日</strong>。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#11151C] mb-1.5">
                实际采取措施日 / 送达起算日
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-num text-sm font-semibold focus:border-[#0E223D] focus:bg-white focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                文书载明届满日（选填优先）
              </label>
              <input
                type="date"
                value={manualDueDate}
                onChange={(e) => setManualDueDate(e.target.value)}
                className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-num text-sm focus:border-[#0E223D] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          {!preview ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
              请先选择有效的起算日期（清空或日期格式有误时不会生成届满日或写入日历）。
            </div>
          ) : preview.hasDateConflict ? (
            <div className="rounded-md border border-red-300 bg-red-50 p-3.5 text-xs text-red-900 space-y-1.5">
              <div className="font-bold flex items-center gap-1.5 text-red-800">
                <AlertCircle className="h-4 w-4 flex-none" />
                <span>日期倒挂冲突 · 已拦截加入看板</span>
              </div>
              <p className="leading-5">{preview.holidayWarningText}</p>
            </div>
          ) : (
            <div className="rounded-md bg-[#0E223D] p-3.5 text-[#F6F4EF] space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="grid grid-cols-2 gap-3 flex-1">
                  <div>
                    <div className="text-[10px] text-[#D1B27A] uppercase">建议续封/办理预警日</div>
                    <div className="mt-0.5 font-num text-base font-bold text-amber-300">
                      {preview.warnYmd}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-300 uppercase">
                      {preview.verificationStatus === 'pending_holiday_schedule'
                        ? '推算届满日（待核验调休）'
                        : preview.verificationStatus === 'manual_override'
                        ? '文书载明届满日'
                        : activePreset.rolloverMode === 'preservation_freeze'
                        ? '保全到期日（不顺延）'
                        : '顺延后届满日'}
                    </div>
                    <div className="mt-0.5 font-num text-base font-bold text-white">
                      {preview.finalEndYmd}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyPreview}
                  className="inline-flex items-center gap-1 rounded border border-white/20 bg-white/10 hover:bg-white/20 px-2 py-1 text-[11px] text-white"
                >
                  {copiedPreview ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3 text-[#D1B27A]" />
                  )}
                  {copiedPreview ? '已复制' : '复制'}
                </button>
              </div>

              {preview.extended && (
                <div className="rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-emerald-200">
                  自然历届满日 {preview.rawEndYmd} 遇 {preview.reasons.join('、')}，已依法顺延至首个工作日{' '}
                  <strong>{preview.finalEndYmd}</strong>。
                </div>
              )}

              {preview.holidayWarningText && (
                <div className="rounded border border-amber-400/60 bg-amber-950/60 px-2.5 py-1.5 text-[11px] leading-5 text-amber-200 flex items-start gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 flex-none mt-0.5 text-amber-300" />
                  <span>{preview.holidayWarningText}</span>
                </div>
              )}

              <p className="border-t border-white/15 pt-2 text-[11px] leading-5 text-slate-300">
                {activePreset.basis}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">承办法官电话 / 执行案号备注（可选）</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="如：（2026）浙0105执保88号 · 王法官"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 text-xs"
            />
          </div>

          <button
            type="button"
            disabled={!preview || Boolean(preview.hasDateConflict)}
            onClick={handleAddDeadline}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[#B89254] hover:bg-[#C7A265] py-2.5 text-xs sm:text-sm font-bold text-[#11151C] disabled:opacity-45"
          >
            <Plus className="h-4 w-4" /> 加入本机预警看板（同步在首页置顶提醒）
          </button>
        </div>

        {/* Saved Watchlist */}
        <div className="lg:col-span-7 rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-3">
            <h2 className="font-display text-base font-bold text-[#11151C]">
              我的在办保全与执行期限台账（{deadlines.filter((d) => !d.completed).length} 项待办）
            </h2>
            {deadlines.length > 0 && (
              <button
                type="button"
                onClick={exportAllActiveIcs}
                className="inline-flex items-center gap-1 rounded bg-[#0E223D] px-3 py-1.5 text-xs font-semibold text-[#F6F4EF]"
              >
                <CalendarPlus className="h-3.5 w-3.5 text-[#D1B27A]" /> 全部导出手机日历 (.ics)
              </button>
            )}
          </div>

          {deadlines.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              暂无在办期限记录。添加一笔查封/冻结或起诉期限后，工作台首页将自动为您实时倒计时预警。
            </div>
          ) : (
            <div className="mt-3 space-y-2.5 max-h-[480px] overflow-y-auto">
              {deadlines.map((item) => {
                const remainDays = daysFromToday(item.dueDate);
                const warnRemain = daysFromToday(item.warnDate);
                const urgent = !item.completed && warnRemain <= 7;
                const isLegacyMergedAppraisalPreset =
                  item.title.includes('执行行为异议 / 财产评估报告异议期') ||
                  Boolean(
                    item.notes &&
                      item.notes.includes('收到评估报告或相关执行文书送达之日起 15 日')
                  );

                return (
                  <div
                    key={item.id}
                    className={`rounded-lg border p-3.5 transition-colors ${
                      item.completed
                        ? 'border-slate-200 bg-slate-50 opacity-65'
                        : urgent
                        ? 'border-red-300 bg-red-50/50'
                        : 'border-[#E4DFD4] bg-[#FAF9F6]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-display text-sm font-bold text-[#11151C]">
                            {item.title}
                          </span>
                          {!item.completed && (
                            <span
                              className={`rounded-full px-2 py-0.5 font-num text-[10px] font-bold ${
                                remainDays < 0
                                  ? 'bg-red-600 text-white'
                                  : urgent
                                  ? 'bg-amber-500 text-[#11151C]'
                                  : 'bg-[#0E223D] text-[#D1B27A]'
                              }`}
                            >
                              {remainDays < 0 ? `已超期 ${Math.abs(remainDays)} 天` : `距届满 ${remainDays} 天`}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 font-num text-xs text-slate-600">
                          起算 {item.startDate} → <strong className="text-amber-800">提前预警 {item.warnDate}</strong> → 届满 {item.dueDate}
                        </div>
                        {isLegacyMergedAppraisalPreset && (
                          <div className="mt-1.5 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-5 text-amber-950">
                            <strong>历史预设复核提示：</strong>本条由旧版「15日合并预设」生成。若系<strong>财产评估报告书面异议</strong>，法定期间为收到报告起 <strong>5 日</strong>（法释〔2018〕15号第22条）；系统未自动篡改您已存日期，请人工核对原始收到日并重新登记。
                          </div>
                        )}
                        {item.notes && <p className="mt-1 text-xs text-slate-500">{item.notes}</p>}
                      </div>

                      <div className="flex items-center gap-1.5 flex-none">
                        <button
                          type="button"
                          onClick={() => exportSingleIcs(item)}
                          className="rounded border border-[#D8D1C3] bg-white px-2 py-1 text-[11px] font-semibold text-[#0E223D] hover:border-[#0E223D]"
                          title="写入手机日历闹钟"
                        >
                          写日历
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeadlines(
                              deadlines.map((d) =>
                                d.id === item.id ? { ...d, completed: !d.completed } : d
                              )
                            )
                          }
                          className="rounded border border-[#D8D1C3] bg-white p-1.5 text-emerald-700 hover:bg-emerald-50"
                          title="标记已办结"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeadlines(deadlines.filter((d) => d.id !== item.id))}
                          className="rounded border border-[#D8D1C3] bg-white p-1.5 text-slate-400 hover:text-red-600"
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
