import React, { useMemo, useState } from 'react';
import { Link, trackEvent } from '../../components/ToolboxBridgeLink';
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
import {
  CN_HOLIDAY_COVERED_MAX_YEAR,
  CN_HOLIDAY_COVERED_MIN_YEAR,
  isDateOutsideHolidayCoverage,
} from '../../data/legalDataManifest';
import { copyToClipboard } from '../../lib/clipboard';
import {
  addDaysYmd,
  calculateWorkdayInterval,
  computeLegalDeadline,
  diffDaysYmd,
  extendPastRestDaysYmd,
  formatCnYmd,
  getTodayChinaYmd,
  isRestDayYmd,
  isValidIsoYmd,
  parseStrictYmdUtc,
  type DeadlineRolloverMode,
} from '../../lib/legalCalendar';

type ToolTab = 'legal' | 'workdays' | 'shift' | 'age';

type LegalPresetId =
  | 'appeal_judgment'
  | 'appeal_ruling'
  | 'labor_arb_suit_15'
  | 'criminal_37'
  | 'jurisdiction_objection'
  | 'evidence_summary_15'
  | 'evidence_ordinary_min15'
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
  rolloverMode: DeadlineRolloverMode;
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
    rolloverMode: 'civil_statutory',
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
    rolloverMode: 'civil_statutory',
    days: 10,
    contactType: '民商事争议',
  },
  {
    id: 'labor_arb_suit_15',
    label: '劳动仲裁裁决后起诉期（15日）',
    shortLabel: '仲裁后起诉 15日',
    category: '劳动争议',
    rule: '《劳动争议调解仲裁法》第50条、《民事诉讼法》第85条：非终局裁决当事人自收到仲裁裁决书之日起十五日内可向人民法院提起诉讼；最后一日遇法定休假日的顺延至首个工作日。',
    inputLabel: '收到劳动仲裁裁决书日期（送达日）',
    rolloverMode: 'civil_statutory',
    days: 15,
    contactType: '劳动争议',
  },
  {
    id: 'criminal_37',
    label: '刑事拘留「黄金 37 天」（30日+7日）',
    shortLabel: '刑事黄金 37天',
    category: '刑事辩护',
    rule: '《刑事诉讼法》第91条：对流窜作案、多次作案、结伙作案的重大嫌疑分子，公安机关提请审查批准逮捕的时间可延长至30日，人民检察院自接到提请后7日以内作出决定（刑事强制措施期限不套用民事休假日顺延规则）。',
    inputLabel: '刑事拘留执行日期（拘留通知书所载日期）',
    rolloverMode: 'criminal_detention',
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
    rolloverMode: 'civil_statutory',
    days: 15,
    contactType: '民商事争议',
  },
  {
    id: 'evidence_summary_15',
    label: '简易程序举证期限（上限15日 · 按15日测算）',
    shortLabel: '简易举证 ≤15日',
    category: '民事诉讼',
    rule: '《最高法关于民事诉讼证据的若干规定》第51条第2款：适用简易程序审理的案件，人民法院指定的举证期限不得超过十五日（小额诉讼一般不超过七日；具体以法院《举证通知书》载明日期为准）。',
    inputLabel: '收到举证通知书日期',
    rolloverMode: 'civil_statutory',
    days: 15,
    contactType: '民商事争议',
  },
  {
    id: 'evidence_ordinary_min15',
    label: '普通程序最低举证期限（下限15日 · 按15日测算）',
    shortLabel: '普通举证 ≥15日',
    category: '民事诉讼',
    rule: '《最高法关于民事诉讼证据的若干规定》第51条第1款：人民法院指定第一审普通程序案件的举证期限不得少于十五日（具体以《举证通知书》指定天数或下方录入的文书载明日期为准）。',
    inputLabel: '收到举证通知书日期',
    rolloverMode: 'civil_statutory',
    days: 15,
    contactType: '民商事争议',
  },
  {
    id: 'evidence_30',
    label: '普通程序常见指定举证期（30日参考）',
    shortLabel: '普通举证 30日',
    category: '民事诉讼',
    rule: '实务常见一审普通程序指定举证期为 30 日；如涉案证据复杂确需延期，应在举证期限届满前书面申请延长。',
    inputLabel: '收到举证通知书日期',
    rolloverMode: 'civil_statutory',
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
    rolloverMode: 'civil_statutory',
    years: 1,
    contactType: '劳动争议',
    articleHref: '/articles/labor-dispute-consultation-basic-questions',
    articleLabel: '阅读《劳动争议实务指引》',
  },
  {
    id: 'exec_2y',
    label: '申请强制执行期限（2年）',
    shortLabel: '申请执行 2年',
    category: '执行程序',
    rule: '《民事诉讼法》第250条、《民法典》第202条：申请执行的期间为二年，从法律文书规定履行期间的最后一日起计算；无对应日则以该月最后一日为届满日。',
    inputLabel: '履行期届满日 / 文书生效日',
    rolloverMode: 'civil_statutory',
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
    rolloverMode: 'civil_statutory',
    years: 3,
    contactType: '民商事争议',
  },
];

export const DateCalculator: React.FC = () => {
  const todayIso = useMemo(() => getTodayChinaYmd(), []);
  const [tab, setTab] = useState<ToolTab>('legal');

  // Legal deadline mode
  const [presetId, setPresetId] = useState<LegalPresetId>('appeal_judgment');
  const [triggerDate, setTriggerDate] = useState(todayIso);
  const [manualDueDate, setManualDueDate] = useState('');
  const [copied, setCopied] = useState(false);

  // Workdays & diff mode
  const [startA, setStartA] = useState(todayIso);
  const [endA, setEndA] = useState(() => addDaysYmd(todayIso, 30));

  // Date shift mode
  const [baseDate, setBaseDate] = useState(todayIso);
  const [offsetDays, setOffsetDays] = useState(15);
  const [direction, setDirection] = useState<'add' | 'sub'>('add');

  // Age mode
  const [birthDate, setBirthDate] = useState('1995-01-01');

  const preset = LEGAL_PRESETS.find((p) => p.id === presetId) || LEGAL_PRESETS[0];

  const legalCalc = useMemo(() => {
    const computed = computeLegalDeadline({
      startYmd: triggerDate,
      days: preset.days,
      years: preset.years,
      rolloverMode: preset.rolloverMode,
      manualDueYmd: manualDueDate.trim() || undefined,
    });
    if (!computed) return null;
    const remainDays = diffDaysYmd(todayIso, computed.finalEndYmd);
    const remain30 = computed.day30Ymd ? diffDaysYmd(todayIso, computed.day30Ymd) : 0;
    return {
      ...computed,
      remainDays,
      remain30,
    };
  }, [preset, triggerDate, manualDueDate, todayIso]);

  const diffResult = useMemo(() => {
    return calculateWorkdayInterval(startA, endA);
  }, [startA, endA]);

  const shiftResult = useMemo(() => {
    if (!isValidIsoYmd(baseDate)) return null;
    const delta = direction === 'add' ? offsetDays : -offsetDays;
    const targetYmd = addDaysYmd(baseDate, delta);
    const restCheck = isRestDayYmd(targetYmd);
    const ext = extendPastRestDaysYmd(targetYmd);
    const outside =
      isDateOutsideHolidayCoverage(targetYmd) || isDateOutsideHolidayCoverage(ext.finalYmd);
    return { targetYmd, restCheck, ext, outside };
  }, [baseDate, offsetDays, direction]);

  const ageResult = useMemo(() => {
    const birth = parseStrictYmdUtc(birthDate);
    const now = parseStrictYmdUtc(todayIso);
    if (!birth || !now) return null;
    let age = now.getUTCFullYear() - birth.getUTCFullYear();
    const m = now.getUTCMonth() - birth.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
    const totalDays = Math.max(0, Math.round((now.getTime() - birth.getTime()) / 86400000));
    return { age: Math.max(0, age), totalDays };
  }, [birthDate, todayIso]);

  const legalSummaryText = useMemo(() => {
    if (!legalCalc) return '';
    const statusBadge =
      legalCalc.verificationStatus === 'pending_holiday_schedule'
        ? '【待核验当年国务院放假安排】'
        : legalCalc.verificationStatus === 'manual_override'
        ? '【按文书载明届满日】'
        : '';
    const finalLabel =
      legalCalc.verificationStatus === 'pending_holiday_schedule'
        ? '理论顺延日（待核验调休）'
        : legalCalc.verificationStatus === 'manual_override'
        ? '文书载明届满日'
        : preset.isCriminal37
        ? '第37日最晚批捕节点'
        : '顺延后届满日';

    const lines = [
      `【法律期间速算 · ${preset.label}】${statusBadge}`,
      `${preset.inputLabel}：${formatCnYmd(legalCalc.startYmd)}`,
      preset.isCriminal37 && legalCalc.day30Ymd
        ? `公安最晚提请批捕节点（第30日）：${formatCnYmd(legalCalc.day30Ymd)}`
        : legalCalc.verificationStatus !== 'manual_override'
        ? `自然历理论届满日：${formatCnYmd(legalCalc.rawEndYmd)}`
        : '',
      `${finalLabel}：${formatCnYmd(legalCalc.finalEndYmd)}${
        legalCalc.extended ? '（遇休假日依法顺延至首个工作日）' : ''
      }`,
      legalCalc.remainDays >= 0
        ? `距今日（${todayIso}）剩余：约 ${legalCalc.remainDays} 天`
        : `距今日（${todayIso}）已超期：${Math.abs(legalCalc.remainDays)} 天`,
      legalCalc.holidayWarningText || '',
    ].filter(Boolean);
    return lines.join('\n');
  }, [preset, legalCalc, todayIso]);

  const copyLegalResult = async () => {
    if (!legalCalc || !legalSummaryText) return;
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
        <div className="hidden">
          <Link to="/tools" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#11151C]">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回实用法律工具
          </Link>
          <span className="text-[11px] font-medium text-slate-500">
            内置 {CN_HOLIDAY_COVERED_MIN_YEAR}–{CN_HOLIDAY_COVERED_MAX_YEAR} 中国法定节假日与调休安排 · 依据《民法典》第202-203条推算
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
            一键测算民事 15 日上诉期、劳动仲裁后起诉期、简易/普通程序举证期、刑事拘留“黄金 37 天”及诉讼时效，已内置 {CN_HOLIDAY_COVERED_MIN_YEAR}–{CN_HOLIDAY_COVERED_MAX_YEAR} 年国务院放假调休安排。
          </p>
        </div>

        {/* Top Mode Tabs */}
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

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">{preset.inputLabel}</label>
                    <input
                      type="date"
                      value={triggerDate}
                      onChange={(e) => setTriggerDate(e.target.value)}
                      className="mt-2 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-4 py-2.5 text-sm font-semibold text-[#11151C] outline-none focus:border-[#11151C] focus:bg-white"
                    />
                  </div>
                  {!preset.isCriminal37 && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600">
                        文书载明具体届满日（选填优先）
                      </label>
                      <input
                        type="date"
                        value={manualDueDate}
                        onChange={(e) => setManualDueDate(e.target.value)}
                        className="mt-2 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-4 py-2.5 text-sm text-[#11151C] outline-none focus:border-[#11151C] focus:bg-white"
                      />
                    </div>
                  )}
                </div>

                {/* Primary Result Card */}
                {!legalCalc ? (
                  <div className="mt-6 rounded-[2px] border border-amber-300 bg-amber-50 p-6 text-xs leading-6 text-amber-950">
                    <strong className="block text-sm font-bold text-amber-950">
                      请先输入有效的起算日期（当前未计算）
                    </strong>
                    <span className="mt-1 block">
                      日期为空或格式不完整时，系统不会生成届满日、倒计时或可复制结论，避免误登记办案期限。
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="mt-6 bg-[#11151C] p-6 text-white">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#D1B27A]">
                            {preset.isCriminal37
                              ? 'GOLDEN 37 DAYS · 关键侦查节点'
                              : legalCalc.verificationStatus === 'pending_holiday_schedule'
                              ? 'PENDING VERIFICATION · 理论顺延日（待核验当年调休）'
                              : legalCalc.verificationStatus === 'manual_override'
                              ? 'DOCUMENT DATE · 按文书载明届满日'
                              : 'VERIFIED DEADLINE · 顺延后届满日'}
                          </p>
                          <p className="mt-2 font-num text-2xl font-bold sm:text-3xl">
                            {formatCnYmd(legalCalc.finalEndYmd)}
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

                      {preset.isCriminal37 && legalCalc.day30Ymd && (
                        <div className="mt-5 grid gap-3 border-t border-white/15 pt-4 sm:grid-cols-2">
                          <div className="border border-white/15 bg-white/5 p-3.5">
                            <p className="text-[11px] text-[#D1B27A]">节点一 · 第 30 天（最长提请批捕日）</p>
                            <p className="mt-1 font-num text-base font-bold">{formatCnYmd(legalCalc.day30Ymd)}</p>
                            <p className="mt-1 text-[11px] text-slate-300">
                              {legalCalc.remain30 >= 0 ? `距今约 ${legalCalc.remain30} 天` : '已过该节点'}
                            </p>
                          </div>
                          <div className="border border-[#B89254]/50 bg-[#B89254]/12 p-3.5">
                            <p className="text-[11px] text-[#D1B27A]">节点二 · 第 37 天（最晚决定批捕日）</p>
                            <p className="mt-1 font-num text-base font-bold">{formatCnYmd(legalCalc.finalEndYmd)}</p>
                            <p className="mt-1 text-[11px] text-slate-200">检察院审查批捕 7 日黄金辩护期</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {legalCalc.holidayWarningText && (
                      <div className="mt-4 rounded-[2px] border border-amber-400 bg-amber-50 p-3.5 text-xs leading-6 text-amber-950 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 flex-none text-amber-700 mt-0.5" />
                        <div>{legalCalc.holidayWarningText}</div>
                      </div>
                    )}

                    {!preset.isCriminal37 && legalCalc.verificationStatus !== 'manual_override' && (
                      <div className="mt-4 border border-[#E4DFD4] bg-[#FAF9F6] p-4 text-xs leading-6 text-slate-700">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <span className="text-slate-400">期间起算日（次日起算）：</span>
                            <strong className="font-num text-[#11151C]">{formatCnYmd(legalCalc.countStartYmd)}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400">自然历理论届满日：</span>
                            <strong className="font-num text-[#11151C]">{formatCnYmd(legalCalc.rawEndYmd)}</strong>
                          </div>
                        </div>
                        {legalCalc.extended ? (
                          <div className="mt-3 border-t border-[#EAE5DB] pt-2.5 text-[#9A773E]">
                            <strong className="inline-flex items-center gap-1">
                              <AlertCircle className="h-3.5 w-3.5" /> 触发《民法典》第203条 /《民诉法》第85条顺延：
                            </strong>
                            <span className="ml-1 text-slate-600">
                              理论届满日遇 {legalCalc.reasons.join('、')}，已顺延至首个工作日{' '}
                              <strong className="text-[#11151C]">{formatCnYmd(legalCalc.finalEndYmd)}</strong>。
                            </span>
                          </div>
                        ) : (
                          <p className="mt-2 text-slate-500">理论届满日为工作日，无需顺延。</p>
                        )}
                      </div>
                    )}
                  </>
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

                {legalCalc && (
                  <div className="mt-6 flex flex-col gap-3 border-t border-[#EFECE5] pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-slate-500">
                      {legalCalc.remainDays >= 0 && legalCalc.remainDays <= 10
                        ? '当前期限临近届满，建议尽快准备材料并核对送达回证与立案节点。'
                        : '涉及公告送达、跨境送达或时效中断等情形时，请结合卷宗证据核实。'}
                    </p>
                    <Link
                      to={`/contact?type=${encodeURIComponent(preset.contactType)}&sourceTool=${encodeURIComponent('法律期间与诉讼时效速算器')}&note=${encodeURIComponent(`${legalSummaryText}\n希望协助核对期限及下一步应对方案。`)}`}
                      onClick={() => trackEvent('tool_to_contact')}
                      className="inline-flex flex-none items-center justify-center gap-2 rounded-[2px] bg-[#11151C] px-5 py-2.5 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D]"
                    >
                      <Send className="h-3.5 w-3.5 text-[#D1B27A]" />
                      <span>转至 AI 智囊深度核验</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: WORKDAYS & INTERVAL */}
        {tab === 'workdays' && (
          <div className="mt-6 border border-[#DED8CC] bg-white p-6 sm:p-8">
            <h2 className="font-display text-lg font-bold text-[#11151C]">法定工作日与日期间隔计算</h2>
            <p className="mt-1 text-xs text-slate-500">
              精准扣除 {CN_HOLIDAY_COVERED_MIN_YEAR}–{CN_HOLIDAY_COVERED_MAX_YEAR} 中国法定节假日，并将国务院调休补班周末计入工作日（按含首尾两天的完整区间逐日核算，无 4,000 天截断）。
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

            {!diffResult ? (
              <div className="mt-5 rounded-[2px] border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
                请填写完整的开始日期与结束日期。
              </div>
            ) : diffResult.exceededMaxRange ? (
              <div className="mt-5 rounded-[2px] border border-amber-400 bg-amber-50 p-4 text-xs text-amber-950">
                所选日期跨度超过 200 年上限，请缩小起止年份范围后再计算。
              </div>
            ) : (
              <>
                {diffResult.outsideHolidayCoverage && (
                  <div className="mt-4 rounded-[2px] border border-amber-400 bg-amber-50 p-3.5 text-xs leading-6 text-amber-950 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 flex-none text-amber-700 mt-0.5" />
                    <div>
                      <strong>节假日覆盖范围提醒（待核验）：</strong>所选区间包含超出内置 {CN_HOLIDAY_COVERED_MIN_YEAR}–{CN_HOLIDAY_COVERED_MAX_YEAR} 年国务院放假调休表的年份；未覆盖年份按常规双休日统计，请人工核对当年放假通知。
                    </div>
                  </div>
                )}

                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <div className="bg-[#11151C] p-5 text-white">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#D1B27A]">自然日间隔（不含首日）</p>
                    <p className="mt-1.5 font-num text-3xl font-bold">{diffResult.absDays} 天</p>
                    <p className="mt-1 text-xs text-slate-300">
                      折合 {diffResult.weeks} 周零 {diffResult.remDays} 天 · 含首尾共 {diffResult.inclusiveTotalDays} 天
                    </p>
                  </div>
                  <div className="border border-[#DED8CC] bg-[#FAF9F6] p-5">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#9A773E]">区间工作日（含首尾）</p>
                    <p className="mt-1.5 font-num text-3xl font-bold text-[#11151C]">{diffResult.workdays} 天</p>
                    <p className="mt-1 text-xs text-slate-500">含周末调休补班 {diffResult.adjustedHit.length} 天</p>
                  </div>
                  <div className="border border-[#DED8CC] bg-[#FAF9F6] p-5">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">公休日与法定节假日（含首尾）</p>
                    <p className="mt-1.5 font-num text-3xl font-bold text-[#11151C]">{diffResult.weekendOrHoliday} 天</p>
                    <p className="mt-1 text-xs text-slate-500">
                      工作日 + 公休节假 = {diffResult.workdays + diffResult.weekendOrHoliday} 天
                    </p>
                  </div>
                </div>

                {(diffResult.holidaysHit.length > 0 || diffResult.adjustedHit.length > 0) && (
                  <div className="mt-4 border border-[#EFECE5] bg-[#FAF9F6] p-4 text-xs leading-6 text-slate-600">
                    {diffResult.holidaysHit.length > 0 && (
                      <p>
                        <strong className="text-[#11151C]">区间内命中法定节假日：</strong>
                        {diffResult.holidaysHit.join('、')}
                      </p>
                    )}
                    {diffResult.adjustedHit.length > 0 && (
                      <p className="mt-1">
                        <strong className="text-[#11151C]">区间内命中调休补班日：</strong>
                        {diffResult.adjustedHit.join('、')}
                      </p>
                    )}
                  </div>
                )}
              </>
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

            {!shiftResult ? (
              <div className="rounded-[2px] border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
                请先选择有效的基准日期。
              </div>
            ) : (
              <>
                <div className="bg-[#11151C] p-6 text-white">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#D1B27A]">推算结果</p>
                  <p className="mt-2 font-num text-3xl font-bold">{formatCnYmd(shiftResult.targetYmd)}</p>
                  <p className="mt-2 text-xs text-slate-300">
                    当日性质：{shiftResult.restCheck.reason}
                    {shiftResult.ext.extended
                      ? ` ｜ 若属民事诉讼/仲裁法定期间届满日，顺延至首个工作日为 ${formatCnYmd(shiftResult.ext.finalYmd)}`
                      : ''}
                  </p>
                </div>
                {shiftResult.outside && (
                  <div className="rounded-[2px] border border-amber-400 bg-amber-50 p-3.5 text-xs leading-6 text-amber-950 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 flex-none text-amber-700 mt-0.5" />
                    <div>
                      <strong>跨年法定节假日提醒（待核验）：</strong>推算结果超出内置 {CN_HOLIDAY_COVERED_MIN_YEAR}–{CN_HOLIDAY_COVERED_MAX_YEAR} 年节假日与调休表，当前仅按周末判断顺延，请复核当年国务院放假通知。
                    </div>
                  </div>
                )}
              </>
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
            {!ageResult ? (
              <div className="rounded-[2px] border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
                请先输入有效的出生日期。
              </div>
            ) : (
              <div className="bg-[#11151C] p-6 text-white">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#D1B27A]">实足周岁</p>
                <p className="mt-2 font-num text-3xl font-bold">{ageResult.age} 周岁</p>
                <p className="mt-1.5 text-xs text-slate-300">
                  累计自然天数：约 {ageResult.totalDays.toLocaleString('zh-CN')} 天（刑事责任年龄、民事行为能力等以次日零时口径核验）
                </p>
              </div>
            )}
          </div>
        )}

        <p className="mx-auto mt-6 flex max-w-4xl items-start justify-center gap-1.5 text-center text-xs leading-6 text-slate-500">
          <Info className="mt-1 h-3.5 w-3.5 flex-none text-[#B89254]" />
          <span>
            已内置 {CN_HOLIDAY_COVERED_MIN_YEAR}–{CN_HOLIDAY_COVERED_MAX_YEAR} 年度中国法定节假日与调休安排。涉及跨年或特定法院送达/中止/中断规则时，仍请以国务院办公厅当年正式通知及受理法院书面文书为准。
          </span>
        </p>
      </div>
    </div>
  );
};
