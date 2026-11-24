import React, { useMemo, useState } from 'react';
import {
  BellRing,
  CalendarPlus,
  CheckCircle2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useToolbox } from '../../context/ToolboxContext';
import { downloadIcsFile } from '../../lib/icsGenerator';
import type { DeadlineReminderItem } from '../../types/toolbox';

interface PresetRule {
  id: string;
  label: string;
  category: DeadlineReminderItem['category'];
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
    months: 12,
    warnDaysBefore: 30,
    basis: '《民诉法解释》第487条：人民法院冻结被执行人的银行存款的期限不得超过一年；申请延长期限的，应在期限届满前提出（实务建议提前30日提交续冻申请）。',
  },
  {
    id: 'movable_seize_2y',
    label: '动产查封 / 扣押（最长 2 年 · 提前30日续封）',
    category: 'preservation',
    months: 24,
    warnDaysBefore: 30,
    basis: '《民诉法解释》第487条：查封、扣押动产的期限不得超过二年。',
  },
  {
    id: 'real_estate_equity_3y',
    label: '不动产查封 / 股权等财产权冻结（最长 3 年 · 提前30日续封）',
    category: 'preservation',
    months: 36,
    warnDaysBefore: 30,
    basis: '《民诉法解释》第487条：查封不动产、冻结其他财产权的期限不得超过三年。',
  },
  {
    id: 'apply_exec_2y',
    label: '申请强制执行期间（履行期届满起 2 年）',
    category: 'execution',
    months: 24,
    warnDaysBefore: 30,
    basis: '《民事诉讼法》第250条：申请执行的期间为二年，从法律文书规定履行期间的最后一日起计算。',
  },
  {
    id: 'exec_objection_15d',
    label: '执行行为异议 / 财产评估报告异议期（15 日）',
    category: 'execution',
    days: 15,
    warnDaysBefore: 3,
    basis: '收到评估报告后或相关文书送达之日起 15 日内提出书面异议。',
  },
  {
    id: 'labor_arb_suit_15d',
    label: '劳动仲裁裁决后向法院起诉期（15 日）',
    category: 'arbitration',
    days: 15,
    warnDaysBefore: 3,
    basis: '《劳动争议调解仲裁法》第50条：自收到仲裁裁决书之日起十五日内向人民法院提起诉讼。',
  },
];

function getTodayChinaYmd(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function isValidYmd(ymd: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd);
}

function addPeriodYmd(startYmd: string, months?: number, days?: number, inclusiveDay = false): string {
  const safe = isValidYmd(startYmd) ? startYmd : getTodayChinaYmd();
  const [y, m, d] = safe.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (months) {
    dt.setUTCMonth(dt.getUTCMonth() + months);
    // Judicial practice for 1/2/3 year freeze: start day counts (e.g. 2026-03-10 -> 2027-03-09)
    // Civil Code Art.202 statutory periods (e.g. 2y apply execution) expire on corresponding day.
    if (inclusiveDay) {
      dt.setUTCDate(dt.getUTCDate() - 1);
    }
  }
  if (days) {
    dt.setUTCDate(dt.getUTCDate() + days);
  }
  return dt.toISOString().slice(0, 10);
}

function subtractDaysYmd(dueYmd: string, daysBefore: number): string {
  const safe = isValidYmd(dueYmd) ? dueYmd : getTodayChinaYmd();
  const [y, m, d] = safe.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - daysBefore));
  return dt.toISOString().slice(0, 10);
}

function daysFromToday(ymd: string): number {
  if (!isValidYmd(ymd)) return 0;
  const todayStr = getTodayChinaYmd();
  const [y1, m1, d1] = todayStr.split('-').map(Number);
  const [y2, m2, d2] = ymd.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export const PreservationDeadlineTool: React.FC = () => {
  const { deadlines, setDeadlines, showToast } = useToolbox();

  const [caseName, setCaseName] = useState('');
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [startDate, setStartDate] = useState(() => getTodayChinaYmd());
  const [notes, setNotes] = useState('');

  const activePreset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];

  const preview = useMemo(() => {
    const dueDate = addPeriodYmd(
      startDate,
      activePreset.months,
      activePreset.days,
      activePreset.category === 'preservation'
    );
    const warnDate = subtractDaysYmd(dueDate, activePreset.warnDaysBefore);
    return { dueDate, warnDate };
  }, [startDate, activePreset]);

  const handleAddDeadline = () => {
    const label = caseName.trim() || '未命名案件';
    const item: DeadlineReminderItem = {
      id: `dl-${Date.now()}`,
      caseName: label,
      title: `${label} · ${activePreset.label.split('（')[0]}`,
      category: activePreset.category,
      startDate,
      dueDate: preview.dueDate,
      warnDate: preview.warnDate,
      notes: notes.trim() || activePreset.basis,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    setDeadlines([item, ...deadlines]);
    setCaseName('');
    setNotes('');
    showToast('已加入本机办案期限预警看板');
  };

  const exportSingleIcs = (item: DeadlineReminderItem) => {
    downloadIcsFile(
      [
        {
          title: `${item.title}（续封/预警红线）`,
          dueDate: item.warnDate,
          description: `案件：${item.caseName}\n正式届满日：${item.dueDate}\n备注：${item.notes}`,
          alarmDaysBefore: [3, 1],
        },
        {
          title: `${item.title}（正式届满日）`,
          dueDate: item.dueDate,
          description: `案件：${item.caseName}\n起始日：${item.startDate}\n备注：${item.notes}`,
          alarmDaysBefore: [7, 3, 1],
        },
      ],
      `${item.caseName}_期限提醒.ics`
    );
    showToast('已导出手机系统日历 (.ics)，点击打开即可添加闹钟');
  };

  const exportAllActiveIcs = () => {
    const active = deadlines.filter((d) => !d.completed);
    if (active.length === 0) {
      showToast('当前没有待办期限记录');
      return;
    }
    downloadIcsFile(
      active.map((d) => ({
        title: d.title,
        dueDate: d.dueDate,
        description: `提前预警日：${d.warnDate}\n${d.notes}`,
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
        严防银行冻结逾期脱保执业风险：精准推算账户 1 年、动产 2 年、不动产/股权 3 年届满日与提前 30 日续封红线，一键写入 iPhone / 安卓系统日历闹钟。
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
            <label className="block text-xs font-bold text-[#11151C] mb-1.5">保全 / 执行期限类型</label>
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
          </div>

          <div>
            <label className="block text-xs font-bold text-[#11151C] mb-1.5">实际采取措施日 / 文书送达起算日</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-num text-sm font-semibold focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>

          <div className="rounded-md bg-[#0E223D] p-3.5 text-[#F6F4EF]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-[#D1B27A] uppercase">建议续封/办理预警日</div>
                <div className="mt-0.5 font-num text-base font-bold text-amber-300">{preview.warnDate}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-300 uppercase">法定最终届满日</div>
                <div className="mt-0.5 font-num text-base font-bold text-white">{preview.dueDate}</div>
              </div>
            </div>
            <p className="mt-2.5 border-t border-white/15 pt-2 text-[11px] leading-5 text-slate-300">
              {activePreset.basis}
            </p>
          </div>

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
            onClick={handleAddDeadline}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[#B89254] hover:bg-[#C7A265] py-2.5 text-xs sm:text-sm font-bold text-[#11151C]"
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
              暂无在办期限记录。添加一笔查封/冻结或执行日期后，工作台首页将自动为您实时倒计时预警。
            </div>
          ) : (
            <div className="mt-3 space-y-2.5 max-h-[480px] overflow-y-auto">
              {deadlines.map((item) => {
                const remainDays = daysFromToday(item.dueDate);
                const warnRemain = daysFromToday(item.warnDate);
                const urgent = !item.completed && warnRemain <= 7;

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
                          起算 {item.startDate} → <strong className="text-amber-800">续封预警 {item.warnDate}</strong> → 届满 {item.dueDate}
                        </div>
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
