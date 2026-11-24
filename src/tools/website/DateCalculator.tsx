import React, { useMemo, useState } from 'react';
import { Link } from '../../components/ToolboxBridgeLink';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  Copy,
  Info,
  Scale,
  Send,
} from 'lucide-react';
import { trackEvent } from '../../components/ToolboxBridgeLink';
import {
  CN_HOLIDAY_COVERED_MAX_YEAR,
  CN_HOLIDAY_COVERED_MIN_YEAR,
  isDateOutsideHolidayCoverage,
} from '../../data/legalDataManifest';
import { copyToClipboard } from '../../lib/clipboard';

type ToolTab = 'legal' | 'workdays' | 'shift' | 'age';

type LegalPresetId =
  | 'appeal_judgment'
  | 'appeal_ruling'
  | 'criminal_37'
  | 'jurisdiction_objection'
  | 'evidence_15'
  | 'evidence_30'
  | 'labor_arb_1y'
  | 'exec_2y'
  | 'civil_3y';

interface LegalPreset {
  id: LegalPresetId;
  label: string;
  shortLabel: string;
  category: string;
  rule: string;
  inputLabel: string;
  days?: number;
  years?: number;
  isCriminal37?: boolean;
  contactType: string;
  articleHref?: string;
  articleLabel?: string;
}

const LEGAL_PRESETS: LegalPreset[] = [
  {
    id: 'appeal_judgment',
    label: '民事一审判决上诉期（15日）',
    shortLabel: '判决上诉 15日',
    category: '民事诉讼',
    rule: '《民事诉讼法》第171条：自判决书送达之日起十五日内有权向上一级人民法院提起上诉。期间开始的次日起算，最后一日为法定休假日的顺延至首个工作日。',
    inputLabel: '收到一审判决书日期（送达日）',
    days: 15,
    contactType: '民商事争议',
  },
  {
    id: 'appeal_ruling',
    label: '民事一审裁定上诉期（10日）',
    shortLabel: '裁定上诉 10日',
    category: '民事诉讼',
    rule: '《民事诉讼法》第171条：不服第一审裁定（如管辖权异议裁定、驳回起诉裁定），自裁定书送达之日起十日内有权上诉。',
    inputLabel: '收到一审裁定书日期（送达日）',
    days: 10,
    contactType: '民商事争议',
  },
  {
    id: 'criminal_37',
    label: '刑事拘留「黄金 37 天」（30日+7日）',
    shortLabel: '刑事黄金 37天',
    category: '刑事辩护',
    rule: '《刑事诉讼法》第91条：对流窜作案、多次作案、结伙作案的重大嫌疑分子，公安机关提请审查批准逮捕的时间可延长至30日，人民检察院自接到提请后7日以内作出决定（合计最长37天，系律师会见与争取不批捕/取保的关键窗口）。',
    inputLabel: '刑事拘留执行日期（拘留通知书所载日期）',
    days: 37,
    isCriminal37: true,
    contactType: '刑事辩护',
    articleHref: '/articles/criminal-defense-family-first-consultation',
    articleLabel: '阅读《刑事案件黄金37天实务清单》',
  },
  {
    id: 'jurisdiction_objection',
    label: '民事答辩期 / 管辖权异议期（15日）',
    shortLabel: '答辩/管辖异议 15日',
    category: '民事诉讼',
    rule: '《民事诉讼法》第128条、第130条：被告应当在收到起诉状副本之日起十五日内提出答辩状；对管辖权有异议的，应当在提交答辩状期间提出。',
    inputLabel: '签收起诉状副本日期',
    days: 15,
    contactType: '民商事争议',
  },
  {
    id: 'evidence_15',
    label: '简易程序 / 一般举证期限（15日）',
    shortLabel: '举证期 15日',
    category: '民事诉讼',
    rule: '《民事诉讼证据规定》第51条：第一审普通程序举证期限不得少于十五日（具体仍以法院《举证通知书》载明日期为准）。',
    inputLabel: '收到举证通知书日期',
    days: 15,
    contactType: '民商事争议',
  },
  {
    id: 'evidence_30',
    label: '普通程序举证期限（30日参考）',
    shortLabel: '举证期 30日',
    category: '民事诉讼',
    rule: '常见普通程序举证参考期限为 30 日；如涉案证据复杂确需延期，应在举证期限届满前书面申请延长。',
    inputLabel: '收到举证通知书日期',
    days: 30,
    contactType: '民商事争议',
  },
  {
    id: 'labor_arb_1y',
    label: '劳动争议申请仲裁时效（1年）',
    shortLabel: '劳动仲裁 1年',
    category: '劳动争议',
    rule: '《劳动争议调解仲裁法》第27条：劳动争议申请仲裁的时效期间为一年，自当事人知道或者应当知道其权利被侵害之日起计算（拖欠劳动报酬争议在劳动关系存续期间不受一年限制，终止后一年内提出）。',
    inputLabel: '知道或应当知道权利被侵害之日',
    years: 1,
    contactType: '劳动争议',
    articleHref: '/articles/labor-dispute-consultation-basic-questions',
    articleLabel: '阅读《杭州劳动争议实务指引》',
  },
  {
    id: 'exec_2y',
    label: '申请强制执行期限（2年）',
    shortLabel: '申请执行 2年',
    category: '执行程序',
    rule: '《民事诉讼法》第250条：申请执行的期间为二年，从法律文书规定履行期间的最后一日起计算；未规定履行期间的，从法律文书生效之日起计算。',
    inputLabel: '履行期届满日 / 文书生效日',
    years: 2,
    contactType: '民商事争议',
  },
  {
    id: 'civil_3y',
    label: '普通民事诉讼时效（3年）',
    shortLabel: '民事时效 3年',
    category: '民事诉讼',
    rule: '《民法典》第188条：向人民法院请求保护民事权利的诉讼时效期间为三年，自权利人知道或者应当知道权利受到损害以及义务人之日起计算（涉外货物买卖合同为四年）。',
    inputLabel: '知道或应当知道权利受损及义务人之日',
    years: 3,
    contactType: '民商事争议',
  },
];

// Built-in 2025-2026 Chinese statutory holidays & adjusted weekend workdays
const CN_HOLIDAYS: Record<string, string> = {
  // 2025
  '2025-01-01': '元旦',
  '2025-01-28': '春节（除夕）',
  '2025-01-29': '春节',
  '2025-01-30': '春节',
  '2025-01-31': '春节',
  '2025-02-01': '春节',
  '2025-02-02': '春节',
  '2025-02-03': '春节',
  '2025-02-04': '春节',
  '2025-04-04': '清明节',
  '2025-04-05': '清明节',
  '2025-04-06': '清明节',
  '2025-05-01': '劳动节',
  '2025-05-02': '劳动节',
  '2025-05-03': '劳动节',
  '2025-05-04': '劳动节',
  '2025-05-05': '劳动节',
  '2025-05-31': '端午节',
  '2025-06-01': '端午节',
  '2025-06-02': '端午节',
  '2025-10-01': '国庆/中秋',
  '2025-10-02': '国庆/中秋',
  '2025-10-03': '国庆/中秋',
  '2025-10-04': '国庆/中秋',
  '2025-10-05': '国庆/中秋',
  '2025-10-06': '国庆/中秋',
  '2025-10-07': '国庆/中秋',
  '2025-10-08': '国庆/中秋',
  // 2026
  '2026-01-01': '元旦',
  '2026-01-02': '元旦',
  '2026-01-03': '元旦',
  '2026-02-15': '春节',
  '2026-02-16': '春节（除夕）',
  '2026-02-17': '春节',
  '2026-02-18': '春节',
  '2026-02-19': '春节',
  '2026-02-20': '春节',
  '2026-02-21': '春节',
  '2026-02-22': '春节',
  '2026-02-23': '春节',
  '2026-04-04': '清明节',
  '2026-04-05': '清明节',
  '2026-04-06': '清明节',
  '2026-05-01': '劳动节',
  '2026-05-02': '劳动节',
  '2026-05-03': '劳动节',
  '2026-05-04': '劳动节',
  '2026-05-05': '劳动节',
  '2026-06-19': '端午节',
  '2026-06-20': '端午节',
  '2026-06-21': '端午节',
  '2026-09-25': '中秋节',
  '2026-09-26': '中秋节',
  '2026-09-27': '中秋节',
  '2026-10-01': '国庆节',
  '2026-10-02': '国庆节',
  '2026-10-03': '国庆节',
  '2026-10-04': '国庆节',
  '2026-10-05': '国庆节',
  '2026-10-06': '国庆节',
  '2026-10-07': '国庆节',
};

const CN_ADJUSTED_WORKDAYS = new Set([
  // 2025
  '2025-01-26',
  '2025-02-08',
  '2025-04-27',
  '2025-09-28',
  '2025-10-11',
  // 2026
  '2026-01-04',
  '2026-02-14',
  '2026-02-28',
  '2026-05-09',
  '2026-09-20',
  '2026-10-10',
]);

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function toIsoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

function addDays(d: Date, delta: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
  return out;
}

function addYearsLegal(d: Date, years: number): Date {
  // Civil Code Art. 202: same day in target year; if no matching day (e.g. Feb 29 -> non-leap), last day of month
  const targetYear = d.getFullYear() + years;
  const targetMonth = d.getMonth();
  const maxDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(d.getDate(), maxDay));
}

function isRestDay(d: Date): { rest: boolean; reason: string } {
  const iso = toIsoDate(d);
  if (CN_HOLIDAYS[iso]) return { rest: true, reason: `法定节假日（${CN_HOLIDAYS[iso]}）` };
  if (CN_ADJUSTED_WORKDAYS.has(iso)) return { rest: false, reason: '法定调休工作日' };
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return { rest: true, reason: wd === 6 ? '周六公休日' : '周日公休日' };
  return { rest: false, reason: '正常工作日' };
}

function extendPastRestDays(d: Date): { finalDate: Date; extended: boolean; reasons: string[] } {
  let cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const reasons: string[] = [];
  let guard = 0;
  while (guard < 20) {
    const check = isRestDay(cur);
    if (!check.rest) break;
    reasons.push(`${toIsoDate(cur)} ${check.reason}`);
    cur = addDays(cur, 1);
    guard++;
  }
  return { finalDate: cur, extended: reasons.length > 0, reasons };
}

function formatCnDate(d: Date) {
  return `${toIsoDate(d)}（${WEEKDAYS[d.getDay()]}）`;
}

export const DateCalculator: React.FC = () => {
  const todayIso = useMemo(() => toIsoDate(new Date()), []);
  const [tab, setTab] = useState<ToolTab>('legal');

  // Legal deadline mode
  const [presetId, setPresetId] = useState<LegalPresetId>('appeal_judgment');
  const [triggerDate, setTriggerDate] = useState(todayIso);
  const [copied, setCopied] = useState(false);

  // Workdays & diff mode
  const [startA, setStartA] = useState(todayIso);
  const [endA, setEndA] = useState(() => toIsoDate(addDays(new Date(), 30)));

  // Date shift mode
  const [baseDate, setBaseDate] = useState(todayIso);
  const [offsetDays, setOffsetDays] = useState(15);
  const [direction, setDirection] = useState<'add' | 'sub'>('add');

  // Age mode
  const [birthDate, setBirthDate] = useState('1995-01-01');

  const preset = LEGAL_PRESETS.find((p) => p.id === presetId) || LEGAL_PRESETS[0];

  const legalCalc = useMemo(() => {
    const start = parseIso(triggerDate);
    const countStart = addDays(start, 1); // 开始之次日起算
    const today = parseIso(todayIso);

    if (preset.isCriminal37) {
      // Criminal detention: Day 1 starts from detention day in practice (or next day by CrimProcLaw 105); show exact Day 30 & Day 37 conservatively
      const day30 = addDays(start, 30);
      const day37 = addDays(start, 37);
      const remain30 = Math.round((day30.getTime() - today.getTime()) / 86400000);
      const remain37 = Math.round((day37.getTime() - today.getTime()) / 86400000);
      return {
        start,
        countStart,
        rawEnd: day37,
        finalEnd: day37,
        extended: false,
        reasons: [] as string[],
        remainDays: remain37,
        day30,
        remain30,
      };
    }

    const rawEnd = preset.years ? addYearsLegal(start, preset.years) : addDays(start, preset.days || 15);
    const { finalDate, extended, reasons } = extendPastRestDays(rawEnd);
    const remainDays = Math.round((finalDate.getTime() - today.getTime()) / 86400000);
    return {
      start,
      countStart,
      rawEnd,
      finalEnd: finalDate,
      extended,
      reasons,
      remainDays,
      day30: null as Date | null,
      remain30: 0,
    };
  }, [preset, triggerDate, todayIso]);

  const diffResult = useMemo(() => {
    const d1 = parseIso(startA);
    const d2 = parseIso(endA);
    const signedDays = Math.round((d2.getTime() - d1.getTime()) / 86400000);
    const absDays = Math.abs(signedDays);
    const from = d1 <= d2 ? d1 : d2;
    const to = d1 <= d2 ? d2 : d1;

    let workdays = 0;
    let weekendOrHoliday = 0;
    const holidaysHit: string[] = [];
    const adjustedHit: string[] = [];
    const cur = new Date(from.getTime());
    let guard = 0;
    while (cur <= to && guard < 4000) {
      const iso = toIsoDate(cur);
      const check = isRestDay(cur);
      if (check.rest) {
        weekendOrHoliday++;
        if (CN_HOLIDAYS[iso]) holidaysHit.push(`${iso.slice(5)} ${CN_HOLIDAYS[iso]}`);
      } else {
        workdays++;
        if (CN_ADJUSTED_WORKDAYS.has(iso)) adjustedHit.push(iso);
      }
      cur.setDate(cur.getDate() + 1);
      guard++;
    }

    return {
      signedDays,
      absDays,
      weeks: Math.floor(absDays / 7),
      remDays: absDays % 7,
      workdays,
      weekendOrHoliday,
      holidaysHit: holidaysHit.slice(0, 12),
      adjustedHit,
    };
  }, [startA, endA]);

  const shiftResult = useMemo(() => {
    const d = parseIso(baseDate);
    const delta = direction === 'add' ? offsetDays : -offsetDays;
    const target = addDays(d, delta);
    const restCheck = isRestDay(target);
    const ext = extendPastRestDays(target);
    return { target, restCheck, ext };
  }, [baseDate, offsetDays, direction]);

  const ageResult = useMemo(() => {
    const birth = parseIso(birthDate);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
    const totalDays = Math.max(0, Math.floor((now.getTime() - birth.getTime()) / 86400000));
    return { age: Math.max(0, age), totalDays };
  }, [birthDate]);

  const legalSummaryText = useMemo(() => {
    const lines = [
      `【法律期间速算 · ${preset.label}】`,
      `${preset.inputLabel}：${formatCnDate(legalCalc.start)}`,
      preset.isCriminal37 && legalCalc.day30
        ? `公安最晚提请批捕节点（第30日）：${formatCnDate(legalCalc.day30)}`
        : `理论届满日：${formatCnDate(legalCalc.rawEnd)}`,
      `最终届满日：${formatCnDate(legalCalc.finalEnd)}${legalCalc.extended ? '（遇休假日依法顺延至首个工作日）' : ''}`,
      legalCalc.remainDays >= 0
        ? `距今日剩余：约 ${legalCalc.remainDays} 天`
        : `距今日已超期：${Math.abs(legalCalc.remainDays)} 天`,
    ];
    return lines.join('\n');
  }, [preset, legalCalc]);

  const copyLegalResult = async () => {
    try {
      await copyToClipboard(legalSummaryText);
      trackEvent('copy_summary');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="bg-[#F6F4EF] py-5 sm:py-8">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <div className="hidden">
          <Link to="/tools" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#11151C]">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回实用法律工具
          </Link>
          <span className="text-[11px] font-medium text-slate-500">
            内置 2025–2026 中国法定节假日与调休安排 · 依据《民法典》第203条自动顺延
          </span>
        </div>

        {/* Header */}
        <div className="mt-2">
          <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9A773E]">
            <CalendarDays className="h-3.5 w-3.5 text-[#B89254]" />
            <span>LEGAL DEADLINE CALCULATOR · 法律期间与诉讼时效</span>
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold text-[#11151C] sm:text-4xl">
            法律期间与诉讼时效速算器
          </h1>
          <p className="mt-2.5 max-w-2xl text-sm leading-7 text-slate-600">
            一键测算民事 15 日上诉期、刑事拘留“黄金 37 天”、劳动仲裁 1 年及民事 3 年诉讼时效，自动识别法定节假日与周末调休并顺延届满日；同时保留工作日与日期推算功能。
          </p>
        </div>

        {/* Top Mode Tabs (Clean 2x2 grid on phones, inline strip on tablets/desktop) */}
        <div className="mt-7 grid grid-cols-2 gap-2 border-b border-[#DED8CC] pb-4 sm:flex sm:flex-wrap">
          {(
            [
              ['legal', '法律期间与时效速算', Scale],
              ['workdays', '法定工作日与间隔', CalendarDays],
              ['shift', '日期前后推算', Clock],
              ['age', '周岁与天数计算', CalendarDays],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center justify-center gap-1.5 rounded-[2px] px-3 py-2.5 text-xs font-semibold transition-colors sm:px-4 ${
                tab === id
                  ? 'bg-[#11151C] text-[#F6F4EF]'
                  : 'border border-[#DED8CC] bg-white text-slate-600 hover:border-[#11151C]'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${tab === id ? 'text-[#D1B27A]' : 'text-slate-400'}`} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* TAB 1: LEGAL DEADLINES */}
        {tab === 'legal' && (
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            {/* Preset list */}
            <div className="min-w-0 lg:col-span-5 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                选择高频法律期限模板
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
                {LEGAL_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPresetId(p.id)}
                    className={`rounded-[2px] border px-3.5 py-2.5 text-left transition-colors ${
                      presetId === p.id
                        ? 'border-[#11151C] bg-[#11151C] text-[#F6F4EF]'
                        : 'border-[#DED8CC] bg-white text-slate-700 hover:border-[#11151C]'
                    }`}
                  >
                    <span className={`block text-[10px] font-semibold ${presetId === p.id ? 'text-[#D1B27A]' : 'text-[#9A773E]'}`}>
                      {p.category}
                    </span>
                    <span className="mt-0.5 block text-xs font-bold leading-5 lg:hidden">{p.shortLabel}</span>
                    <span className="mt-0.5 hidden text-xs font-bold leading-5 lg:block">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Right Calculation Panel */}
            <div className="min-w-0 lg:col-span-7 space-y-5">
              <div className="border border-[#DED8CC] bg-white p-6 sm:p-8">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9A773E]">
                  {preset.category}
                </span>
                <h2 className="mt-1 font-display text-xl font-bold text-[#11151C]">{preset.label}</h2>

                <div className="mt-5">
                  <label className="block text-xs font-semibold text-slate-700">{preset.inputLabel}</label>
                  <input
                    type="date"
                    value={triggerDate}
                    onChange={(e) => setTriggerDate(e.target.value)}
                    className="mt-2 w-full max-w-xs rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-4 py-2.5 text-sm font-semibold text-[#11151C] outline-none focus:border-[#11151C] focus:bg-white"
                  />
                </div>

                {/* Primary Result Card */}
                <div className="mt-6 bg-[#11151C] p-6 text-white">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#D1B27A]">
                        {preset.isCriminal37 ? 'GOLDEN 37 DAYS · 关键侦查节点' : 'FINAL DEADLINE · 法定届满日'}
                      </p>
                      <p className="mt-2 font-num text-2xl font-bold sm:text-3xl">
                        {formatCnDate(legalCalc.finalEnd)}
                      </p>
                      <p className="mt-2 text-xs text-slate-300">
                        {legalCalc.remainDays > 0
                          ? `距离今天（${todayIso}）还剩约 ${legalCalc.remainDays} 天`
                          : legalCalc.remainDays === 0
                          ? '今天即为该期限最后一日，请务必高度重视！'
                          : `该期限已于 ${Math.abs(legalCalc.remainDays)} 天前届满（如存在中止/中断或送达异议请尽快核实）`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={copyLegalResult}
                      className="inline-flex items-center gap-1.5 rounded-[2px] border border-white/20 bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-[#D1B27A]" />}
                      <span>{copied ? '已复制' : '复制结果'}</span>
                    </button>
                  </div>

                  {/* Special Dual Milestone for Criminal 37 Days */}
                  {preset.isCriminal37 && legalCalc.day30 && (
                    <div className="mt-5 grid gap-3 border-t border-white/15 pt-4 sm:grid-cols-2">
                      <div className="border border-white/15 bg-white/5 p-3.5">
                        <p className="text-[11px] text-[#D1B27A]">节点一 · 第 30 天（最长提请批捕日）</p>
                        <p className="mt-1 font-num text-base font-bold">{formatCnDate(legalCalc.day30)}</p>
                        <p className="mt-1 text-[11px] text-slate-300">
                          {legalCalc.remain30 >= 0 ? `距今约 ${legalCalc.remain30} 天` : '已过该节点'}
                        </p>
                      </div>
                      <div className="border border-[#B89254]/50 bg-[#B89254]/12 p-3.5">
                        <p className="text-[11px] text-[#D1B27A]">节点二 · 第 37 天（最晚决定批捕日）</p>
                        <p className="mt-1 font-num text-base font-bold">{formatCnDate(legalCalc.finalEnd)}</p>
                        <p className="mt-1 text-[11px] text-slate-200">检察院审查批捕 7 日黄金辩护期</p>
                      </div>
                    </div>
                  )}
                </div>

                {(isDateOutsideHolidayCoverage(toIsoDate(legalCalc.rawEnd)) ||
                  isDateOutsideHolidayCoverage(toIsoDate(legalCalc.finalEnd))) && (
                  <div className="mt-4 rounded-[2px] border border-amber-400 bg-amber-50 p-3.5 text-xs leading-6 text-amber-950 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 flex-none text-amber-700 mt-0.5" />
                    <div>
                      <strong>跨年法定节假日核对提醒：</strong>
                      本次推算的届满日期（{toIsoDate(legalCalc.finalEnd)}）超出本箱内置的{' '}
                      {CN_HOLIDAY_COVERED_MIN_YEAR}–{CN_HOLIDAY_COVERED_MAX_YEAR}{' '}
                      年国务院节假日与调休表覆盖范围，当前仅按常规周六/周日顺延，尚未包含该年度法定长假与调休安排，请务必核对国务院当年正式放假通知后最终确认！
                    </div>
                  </div>
                )}

                {/* Holiday Extension Notice */}
                {!preset.isCriminal37 && (
                  <div className="mt-4 border border-[#E4DFD4] bg-[#FAF9F6] p-4 text-xs leading-6 text-slate-700">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <span className="text-slate-400">期间起算日（次日起算）：</span>
                        <strong className="font-num text-[#11151C]">{formatCnDate(legalCalc.countStart)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">自然历理论届满日：</span>
                        <strong className="font-num text-[#11151C]">{formatCnDate(legalCalc.rawEnd)}</strong>
                      </div>
                    </div>
                    {legalCalc.extended ? (
                      <div className="mt-3 border-t border-[#EAE5DB] pt-2.5 text-[#9A773E]">
                        <strong className="inline-flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" /> 触发《民法典》第203条自动顺延：
                        </strong>
                        <span className="ml-1 text-slate-600">
                          理论届满日遇 {legalCalc.reasons.join('、')}，已自动顺延至首个工作日{' '}
                          <strong className="text-[#11151C]">{formatCnDate(legalCalc.finalEnd)}</strong>。
                        </span>
                      </div>
                    ) : (
                      <p className="mt-2 text-slate-500">理论届满日为正常工作日，无需顺延。</p>
                    )}
                  </div>
                )}

                {/* Statutory Rule Basis */}
                <div className="mt-4 border border-[#EFECE5] bg-white p-4 text-xs leading-6 text-slate-600">
                  <strong className="text-[#11151C]">法律依据：</strong>
                  {preset.rule}
                  {preset.articleHref && (
                    <Link
                      to={preset.articleHref}
                      className="ml-2 font-semibold text-[#0E223D] underline decoration-[#B89254]/60 underline-offset-4 hover:text-[#9A773E]"
                    >
                      {preset.articleLabel} →
                    </Link>
                  )}
                </div>

                {/* Urgent CTA Bridge */}
                <div className="mt-6 flex flex-col gap-3 border-t border-[#EFECE5] pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-500">
                    {legalCalc.remainDays >= 0 && legalCalc.remainDays <= 10
                      ? '当前期限临近届满，建议尽快准备材料并与律师核对送达与立案节点。'
                      : '涉及公告送达、跨境送达或时效中断等情形时，建议由律师结合卷宗核实。'}
                  </p>
                  <Link
                    to={`/contact?type=${encodeURIComponent(preset.contactType)}&sourceTool=${encodeURIComponent('法律期间与诉讼时效速算器')}&note=${encodeURIComponent(`${legalSummaryText}\n希望律师协助核对期限及下一步应对方案。`)}`}
                    onClick={() => trackEvent('tool_to_contact')}
                    className="inline-flex flex-none items-center justify-center gap-2 rounded-[2px] bg-[#11151C] px-5 py-2.5 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D]"
                  >
                    <Send className="h-3.5 w-3.5 text-[#D1B27A]" />
                    <span>带入期限预约律师</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: WORKDAYS & INTERVAL */}
        {tab === 'workdays' && (
          <div className="mt-6 border border-[#DED8CC] bg-white p-6 sm:p-8">
            <h2 className="font-display text-lg font-bold text-[#11151C]">法定工作日与日期间隔计算</h2>
            <p className="mt-1 text-xs text-slate-500">
              精准扣除 2025–2026 中国法定节假日，并将国务院调休补班周末计入工作日（含首尾两天统计工作日）。
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">开始日期</span>
                <input
                  type="date"
                  value={startA}
                  onChange={(e) => setStartA(e.target.value)}
                  className="mt-1.5 block w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-4 py-2.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">结束日期</span>
                <input
                  type="date"
                  value={endA}
                  onChange={(e) => setEndA(e.target.value)}
                  className="mt-1.5 block w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-4 py-2.5 text-sm"
                />
              </label>
            </div>

            {(isDateOutsideHolidayCoverage(startA) || isDateOutsideHolidayCoverage(endA)) && (
              <div className="mt-4 rounded-[2px] border border-amber-400 bg-amber-50 p-3.5 text-xs leading-6 text-amber-950 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-none text-amber-700 mt-0.5" />
                <div>
                  <strong>节假日覆盖范围提醒：</strong>所选区间超出内置 {CN_HOLIDAY_COVERED_MIN_YEAR}–{CN_HOLIDAY_COVERED_MAX_YEAR} 年中国法定节假日与调休表范围，超出年份仅按双休日统计，请人工核对国务院当年放假通知。
                </div>
              </div>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="bg-[#11151C] p-5 text-white">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#D1B27A]">自然日间隔</p>
                <p className="mt-1.5 font-num text-3xl font-bold">{diffResult.absDays} 天</p>
                <p className="mt-1 text-xs text-slate-300">
                  折合 {diffResult.weeks} 周零 {diffResult.remDays} 天
                </p>
              </div>
              <div className="border border-[#DED8CC] bg-[#FAF9F6] p-5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#9A773E]">法定工作日（含调休）</p>
                <p className="mt-1.5 font-num text-3xl font-bold text-[#11151C]">{diffResult.workdays} 天</p>
                <p className="mt-1 text-xs text-slate-500">含周末调休补班 {diffResult.adjustedHit.length} 天</p>
              </div>
              <div className="border border-[#DED8CC] bg-[#FAF9F6] p-5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">公休日与法定节假日</p>
                <p className="mt-1.5 font-num text-3xl font-bold text-[#11151C]">{diffResult.weekendOrHoliday} 天</p>
                <p className="mt-1 text-xs text-slate-500">双休 + 国家法定假日</p>
              </div>
            </div>

            {(diffResult.holidaysHit.length > 0 || diffResult.adjustedHit.length > 0) && (
              <div className="mt-4 border border-[#EFECE5] bg-[#FAF9F6] p-4 text-xs leading-6 text-slate-600">
                {diffResult.holidaysHit.length > 0 && (
                  <p>
                    <strong className="text-[#11151C]">区间内含法定节假日：</strong>
                    {diffResult.holidaysHit.join('、')}
                  </p>
                )}
                {diffResult.adjustedHit.length > 0 && (
                  <p className="mt-1">
                    <strong className="text-[#11151C]">区间内含调休补班日：</strong>
                    {diffResult.adjustedHit.join('、')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DATE SHIFT */}
        {tab === 'shift' && (
          <div className="mt-6 border border-[#DED8CC] bg-white p-6 sm:p-8 space-y-5">
            <h2 className="font-display text-lg font-bold text-[#11151C]">日期前后推算（自动检测休假日顺延）</h2>
            <div className="grid gap-5 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">基准日期</span>
                <input
                  type="date"
                  value={baseDate}
                  onChange={(e) => setBaseDate(e.target.value)}
                  className="mt-1.5 block w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-4 py-2.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">推算方向</span>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'add' | 'sub')}
                  className="mt-1.5 block w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-4 py-2.5 text-sm"
                >
                  <option value="add">往后推算（+）</option>
                  <option value="sub">往前推算（-）</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">天数</span>
                <input
                  type="number"
                  min={0}
                  value={offsetDays}
                  onChange={(e) => setOffsetDays(Math.max(0, Number(e.target.value) || 0))}
                  className="mt-1.5 block w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-4 py-2.5 text-sm font-semibold"
                />
              </label>
            </div>

            <div className="bg-[#11151C] p-6 text-white">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#D1B27A]">推算结果</p>
              <p className="mt-2 font-num text-3xl font-bold">{formatCnDate(shiftResult.target)}</p>
              <p className="mt-2 text-xs text-slate-300">
                当日性质：{shiftResult.restCheck.reason}
                {shiftResult.ext.extended
                  ? ` ｜ 若属法律期间届满日，顺延至首个工作日为 ${formatCnDate(shiftResult.ext.finalDate)}`
                  : ''}
              </p>
            </div>
            {(isDateOutsideHolidayCoverage(toIsoDate(shiftResult.target)) ||
              isDateOutsideHolidayCoverage(toIsoDate(shiftResult.ext.finalDate))) && (
              <div className="rounded-[2px] border border-amber-400 bg-amber-50 p-3.5 text-xs leading-6 text-amber-950 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-none text-amber-700 mt-0.5" />
                <div>
                  <strong>跨年法定节假日提醒：</strong>推算结果超出内置 {CN_HOLIDAY_COVERED_MIN_YEAR}–{CN_HOLIDAY_COVERED_MAX_YEAR} 年节假日与调休表，当前仅按周末判断顺延，请复核当年国务院放假通知。
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: AGE */}
        {tab === 'age' && (
          <div className="mt-6 border border-[#DED8CC] bg-white p-6 sm:p-8 space-y-5">
            <h2 className="font-display text-lg font-bold text-[#11151C]">实足周岁计算</h2>
            <label className="block max-w-xs">
              <span className="text-xs font-semibold text-slate-700">出生日期</span>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="mt-1.5 block w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-4 py-2.5 text-sm"
              />
            </label>
            <div className="bg-[#11151C] p-6 text-white">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#D1B27A]">实足周岁</p>
              <p className="mt-2 font-num text-3xl font-bold">{ageResult.age} 周岁</p>
              <p className="mt-1.5 text-xs text-slate-300">
                累计自然天数：约 {ageResult.totalDays.toLocaleString('zh-CN')} 天（刑事责任年龄、民事行为能力等以次日零时口径核验）
              </p>
            </div>
          </div>
        )}

        <p className="mx-auto mt-6 flex max-w-4xl items-start justify-center gap-1.5 text-center text-xs leading-6 text-slate-500">
          <Info className="mt-1 h-3.5 w-3.5 flex-none text-[#B89254]" />
          <span>
            已内置 2025–2026 年度中国法定节假日与调休安排。涉及跨年或特定法院送达/中止/中断规则时，仍请以国务院办公厅当年正式通知及受理法院书面裁定为准。
          </span>
        </p>
      </div>
    </div>
  );
};
