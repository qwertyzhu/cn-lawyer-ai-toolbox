import React, { useMemo, useState } from 'react';
import { Link } from '../../components/ToolboxBridgeLink';
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  Copy,
  Info,
  Percent,
  RotateCcw,
  Send,
} from 'lucide-react';
import { trackEvent } from '../../components/ToolboxBridgeLink';
import { checkLprDateCoverage, LEGAL_DATA_MANIFEST } from '../../data/legalDataManifest';
import { copyToClipboard } from '../../lib/clipboard';
import { ToolQuickRefSection as ToolSeoKnowledgeSection } from '../../components/ToolQuickRefSection';

type CalcMode = 'lpr_floating' | 'lpr_fixed' | 'custom_rate' | 'delay_only';
type LprTerm = '1y' | '5y';

interface LprMilestone {
  date: string; // Effective date YYYY-MM-DD (PBOC / NIFC official publication date)
  r1y: number;  // 1-year LPR %
  r5y: number;  // 5-year+ LPR %
}

// Verified official PBOC / 全国银行间同业拆借中心 LPR rate-change history (2019-08-20 to 2026-11-20)
const LPR_HISTORY: LprMilestone[] = [
  { date: '2019-08-20', r1y: 4.25, r5y: 4.85 },
  { date: '2019-09-20', r1y: 4.20, r5y: 4.85 },
  { date: '2019-11-20', r1y: 4.15, r5y: 4.80 },
  { date: '2020-02-20', r1y: 4.05, r5y: 4.75 },
  { date: '2020-04-20', r1y: 3.85, r5y: 4.65 },
  { date: '2021-12-20', r1y: 3.80, r5y: 4.65 },
  { date: '2022-01-20', r1y: 3.70, r5y: 4.60 },
  { date: '2022-05-20', r1y: 3.70, r5y: 4.45 },
  { date: '2022-08-22', r1y: 3.65, r5y: 4.30 },
  { date: '2023-06-20', r1y: 3.55, r5y: 4.20 },
  { date: '2023-08-21', r1y: 3.45, r5y: 4.20 },
  { date: '2024-02-20', r1y: 3.45, r5y: 3.95 },
  { date: '2024-07-22', r1y: 3.35, r5y: 3.85 },
  { date: '2024-10-21', r1y: 3.10, r5y: 3.60 },
  { date: '2025-05-20', r1y: 3.00, r5y: 3.50 },
];

const LATEST_LPR = LPR_HISTORY[LPR_HISTORY.length - 1];
const DELAY_DAILY_RATE = 0.000175; // 《最高法关于执行程序中计算迟延履行期间的债务利息适用法律若干问题的解释》日万分之1.75

interface InterestSegment {
  from: string;
  to: string;
  days: number;
  baseRate: number;
  effectiveRate: number;
  interest: number;
  note: string;
}

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function diffDays(startIso: string, endIso: string): number {
  const a = parseDate(startIso);
  const b = parseDate(endIso);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function addDaysIso(iso: string, delta: number): string {
  const d = parseDate(iso);
  d.setDate(d.getDate() + delta);
  return toIso(d);
}

function lookupLprOn(dateIso: string, term: LprTerm): { rate: number; effectiveDate: string } {
  let active = LPR_HISTORY[0];
  for (const item of LPR_HISTORY) {
    if (item.date <= dateIso) active = item;
    else break;
  }
  return {
    rate: term === '1y' ? active.r1y : active.r5y,
    effectiveDate: active.date,
  };
}

const fmtMoney = (n: number) =>
  `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const LprInterestCalculator: React.FC = () => {
  const todayIso = useMemo(() => toIso(new Date()), []);

  const [mode, setMode] = useState<CalcMode>('lpr_floating');
  const [unit, setUnit] = useState<'wan' | 'yuan'>('wan');
  const [principalStr, setPrincipalStr] = useState('50');
  const [startDate, setStartDate] = useState('2024-06-01');
  const [endDate, setEndDate] = useState(todayIso);
  const [term, setTerm] = useState<LprTerm>('1y');
  const [multiplierStr, setMultiplierStr] = useState('1');
  const [bpsStr, setBpsStr] = useState('0');
  const [customRateStr, setCustomRateStr] = useState('6');
  const [dayBasis, setDayBasis] = useState<365 | 360>(365);

  // Optional overlay: Execution delay doubled interest (Civil Procedure Law Art. 264)
  const [includeDelay, setIncludeDelay] = useState(false);
  const [delayStartDate, setDelayStartDate] = useState('2025-08-01');
  const [copied, setCopied] = useState(false);

  const rawNum = Math.max(0, Number(principalStr.replace(/,/g, '')) || 0);
  const principalYuan = unit === 'wan' ? rawNum * 10000 : rawNum;
  const multiplier = Math.max(0, Number(multiplierStr) || 1);
  const bps = Number(bpsStr) || 0;
  const customRate = Math.max(0, Number(customRateStr) || 0);

  const calc = useMemo(() => {
    const totalDays = diffDays(startDate, endDate);
    const segments: InterestSegment[] = [];
    let normalInterest = 0;

    if (totalDays > 0 && principalYuan > 0 && mode !== 'delay_only') {
      if (mode === 'custom_rate') {
        const interest = (principalYuan * (customRate / 100) * totalDays) / dayBasis;
        normalInterest = interest;
        segments.push({
          from: startDate,
          to: endDate,
          days: totalDays,
          baseRate: customRate,
          effectiveRate: customRate,
          interest,
          note: `合同约定固定年利率 ${customRate.toFixed(2)}%`,
        });
      } else if (mode === 'lpr_fixed') {
        const snap = lookupLprOn(startDate, term);
        const eff = Math.max(0, snap.rate * multiplier + bps / 100);
        const interest = (principalYuan * (eff / 100) * totalDays) / dayBasis;
        normalInterest = interest;
        segments.push({
          from: startDate,
          to: endDate,
          days: totalDays,
          baseRate: snap.rate,
          effectiveRate: eff,
          interest,
          note: `锁定起算日当期${term === '1y' ? '1年期' : '5年期'}LPR（${snap.effectiveDate} 报价 ${snap.rate.toFixed(2)}%）`,
        });
      } else {
        // Floating LPR split across every official adjustment boundary
        const cuts: string[] = [startDate];
        for (const item of LPR_HISTORY) {
          if (item.date > startDate && item.date < endDate) {
            // Only split if the selected term's rate actually changed at this milestone
            const prevRate = lookupLprOn(addDaysIso(item.date, -1), term).rate;
            const nextRate = term === '1y' ? item.r1y : item.r5y;
            if (prevRate !== nextRate) {
              cuts.push(item.date);
            }
          }
        }
        cuts.push(endDate);

        for (let i = 0; i < cuts.length - 1; i++) {
          const segFrom = cuts[i];
          const segTo = cuts[i + 1];
          const days = diffDays(segFrom, segTo);
          if (days <= 0) continue;
          const snap = lookupLprOn(segFrom, term);
          const eff = Math.max(0, snap.rate * multiplier + bps / 100);
          const interest = (principalYuan * (eff / 100) * days) / dayBasis;
          normalInterest += interest;
          segments.push({
            from: segFrom,
            to: segTo,
            days,
            baseRate: snap.rate,
            effectiveRate: eff,
            interest,
            note: `${term === '1y' ? '1年期' : '5年期'} LPR ${snap.rate.toFixed(2)}%`,
          });
        }
      }
    }

    // Execution doubled delay interest (日万分之1.75)
    let delayDays = 0;
    let delayInterest = 0;
    if (mode === 'delay_only') {
      delayDays = totalDays;
      delayInterest = principalYuan * DELAY_DAILY_RATE * delayDays;
    } else if (includeDelay && principalYuan > 0) {
      delayDays = diffDays(delayStartDate, endDate);
      delayInterest = principalYuan * DELAY_DAILY_RATE * delayDays;
    }

    const totalInterest = normalInterest + delayInterest;
    const grandTotal = principalYuan + totalInterest;
    const fourTimesLatestLpr = Number((LATEST_LPR.r1y * 4).toFixed(2));
    const exceedsPrivateLendingCap =
      (mode === 'custom_rate' && customRate > fourTimesLatestLpr) ||
      (mode !== 'delay_only' && mode !== 'custom_rate' && LATEST_LPR.r1y * multiplier + bps / 100 > fourTimesLatestLpr);

    const lprCoverage = checkLprDateCoverage(startDate, endDate);

    return {
      totalDays,
      segments,
      normalInterest,
      delayDays,
      delayInterest,
      totalInterest,
      grandTotal,
      fourTimesLatestLpr,
      exceedsPrivateLendingCap,
      lprCoverage,
    };
  }, [
    mode,
    principalYuan,
    startDate,
    endDate,
    term,
    multiplier,
    bps,
    customRate,
    dayBasis,
    includeDelay,
    delayStartDate,
  ]);

  const courtReadyText = useMemo(() => {
    const modeLabel =
      mode === 'lpr_floating'
        ? `同期${term === '1y' ? '1年期' : '5年期'}LPR分段浮动 × ${multiplier}倍${bps ? `${bps > 0 ? '+' : ''}${bps}BP` : ''}`
        : mode === 'lpr_fixed'
        ? `起算日${term === '1y' ? '1年期' : '5年期'}LPR固定 × ${multiplier}倍${bps ? `${bps > 0 ? '+' : ''}${bps}BP` : ''}`
        : mode === 'custom_rate'
        ? `合同约定固定年利率 ${customRate.toFixed(2)}%`
        : '执行迟延履行期间加倍部分债务利息（日万分之1.75）';

    const lines = [
      '【逾期付款利息 / 迟延履行金计算明细表】',
      `计息本金：${principalYuan.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元`,
      `计息期间：${startDate} 至 ${endDate}（共 ${calc.totalDays} 天，基准 ${dayBasis} 天/年）`,
      `计息标准：${modeLabel}`,
    ];

    if (calc.segments.length > 0) {
      lines.push('--- 分段明细 ---');
      calc.segments.forEach((s, i) => {
        lines.push(
          `${i + 1}. ${s.from} 至 ${s.to}（${s.days}天）：执行年利率 ${s.effectiveRate.toFixed(3)}%（${s.note}），分段利息 = ${s.interest.toFixed(2)} 元`
        );
      });
      lines.push(`一般逾期利息小计：${calc.normalInterest.toFixed(2)} 元`);
    }

    if (calc.delayDays > 0) {
      const dFrom = mode === 'delay_only' ? startDate : delayStartDate;
      lines.push(
        `加倍部分债务利息（日万分之1.75）：${dFrom} 至 ${endDate}（${calc.delayDays}天）= ${principalYuan.toFixed(2)} × 0.0175% × ${calc.delayDays} = ${calc.delayInterest.toFixed(2)} 元`
      );
    }

    lines.push(`应付利息合计：${calc.totalInterest.toFixed(2)} 元`);
    lines.push(`本息暂计总额：${calc.grandTotal.toFixed(2)} 元`);
    return lines.join('\n');
  }, [mode, term, multiplier, bps, customRate, principalYuan, startDate, endDate, dayBasis, delayStartDate, calc]);

  const copyStatement = async () => {
    try {
      await copyToClipboard(courtReadyText);
      trackEvent('copy_summary');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const feeToolLink = `/tools/litigation-fee-calculator?type=property&amount=${encodeURIComponent(
    (calc.grandTotal / 10000).toFixed(2)
  )}&unit=wan`;

  return (
    <div className="bg-[#F6F4EF] py-5 sm:py-8">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <div className="hidden">
          <Link to="/tools" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#11151C]">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回实用法律工具
          </Link>
          <span className="font-num text-[11px] font-medium text-slate-500">
            已内置央行 2019-08 至 2026-11 完整 LPR 报价表（现行 1 年期 {LATEST_LPR.r1y.toFixed(2)}% / 5 年期 {LATEST_LPR.r5y.toFixed(2)}%）
          </span>
        </div>

        {/* Header */}
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9A773E]">
              <Percent className="h-3.5 w-3.5 text-[#B89254]" />
              <span>LPR & DELAY INTEREST · 民商事诉讼与执行高频工具</span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold text-[#11151C] sm:text-4xl">
              LPR 逾期付款利息与迟延履行金计算器
            </h1>
            <p className="mt-2.5 max-w-2xl text-sm leading-7 text-slate-600">
              自动按央行历次 LPR 调息日分段拆算逾期付款利息、买卖合同 1.3–1.5 倍上浮利息、民间借贷 4 倍保护上限及《民诉法》第 264 条双倍迟延履行债务利息（日万分之 1.75），一键复制明细表附入起诉状。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setMode('lpr_floating');
              setUnit('wan');
              setPrincipalStr('50');
              setStartDate('2024-06-01');
              setEndDate(todayIso);
              setTerm('1y');
              setMultiplierStr('1');
              setBpsStr('0');
              setIncludeDelay(false);
            }}
            className="inline-flex flex-none items-center gap-1.5 rounded-[2px] border border-[#D4CEC2] bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:border-[#11151C]"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 重置参数
          </button>
        </div>

        {/* Mode Selector */}
        <div className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ['lpr_floating', 'LPR 分段浮动计息', '跨调息期自动分段（判决最常用）'],
              ['lpr_fixed', '起算日 LPR 固定', '锁定起算日当期 LPR 不变'],
              ['custom_rate', '合同约定年利率', '自定义固定年化利率并核对 4 倍红线'],
              ['delay_only', '执行加倍迟延履行金', '固定日万分之 1.75（民诉法 264 条）'],
            ] as const
          ).map(([id, title, sub]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`rounded-[2px] border p-3.5 text-left transition-colors ${
                mode === id
                  ? 'border-[#11151C] bg-[#11151C] text-[#F6F4EF]'
                  : 'border-[#DED8CC] bg-white text-[#11151C] hover:border-[#11151C]'
              }`}
            >
              <p className="text-xs font-bold">{title}</p>
              <p className={`mt-1 text-[11px] leading-4 ${mode === id ? 'text-[#D1B27A]' : 'text-slate-400'}`}>{sub}</p>
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          {/* Left Inputs */}
          <div className="min-w-0 lg:col-span-5 space-y-5 border border-[#DED8CC] bg-white p-4 sm:p-6">
            {/* Principal */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-1">
                <label className="text-xs font-bold text-[#11151C]">计息本金</label>
                <span className="font-num text-[11px] text-slate-400">
                  {principalYuan.toLocaleString('zh-CN')} 元
                </span>
              </div>
              <div className="mt-1.5 flex items-stretch gap-2">
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={principalStr}
                  onChange={(e) => setPrincipalStr(e.target.value)}
                  className="min-w-0 w-full flex-1 rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3.5 py-2.5 font-num text-lg font-bold text-[#11151C] outline-none focus:border-[#11151C] focus:bg-white"
                />
                <div className="inline-flex flex-none border border-[#D8D2C6] bg-[#FAF9F6] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      if (unit === 'yuan') {
                        setUnit('wan');
                        setPrincipalStr(rawNum ? String(Number((rawNum / 10000).toFixed(4))) : '');
                      }
                    }}
                    className={`whitespace-nowrap px-3 py-1.5 font-semibold ${unit === 'wan' ? 'bg-[#11151C] text-[#F6F4EF]' : 'text-slate-600'}`}
                  >
                    万元
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (unit === 'wan') {
                        setUnit('yuan');
                        setPrincipalStr(rawNum ? String(Math.round(rawNum * 10000)) : '');
                      }
                    }}
                    className={`whitespace-nowrap px-3 py-1.5 font-semibold ${unit === 'yuan' ? 'bg-[#11151C] text-[#F6F4EF]' : 'text-slate-600'}`}
                  >
                    元
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[10, 50, 100, 300, 500].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setUnit('wan');
                      setPrincipalStr(String(v));
                    }}
                    className="rounded-[2px] border border-[#E4DFD4] bg-[#FAF9F6] px-2.5 py-0.5 text-[11px] text-slate-600 hover:border-[#11151C]"
                  >
                    {v} 万
                  </button>
                ))}
              </div>
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3 border-t border-[#EFECE5] pt-4">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">起算日期</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 text-xs font-medium"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">截止日期</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 text-xs font-medium"
                />
              </label>
            </div>

            {/* LPR Settings */}
            {(mode === 'lpr_floating' || mode === 'lpr_fixed') && (
              <div className="space-y-4 border-t border-[#EFECE5] pt-4">
                <div>
                  <span className="text-xs font-semibold text-slate-700">LPR 品种</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTerm('1y')}
                      className={`rounded-[2px] border py-2 text-xs font-semibold ${
                        term === '1y' ? 'border-[#11151C] bg-[#11151C] text-[#F6F4EF]' : 'border-[#DED8CC] bg-[#FAF9F6] text-slate-600'
                      }`}
                    >
                      1 年期 LPR（现行 {LATEST_LPR.r1y.toFixed(2)}%）
                    </button>
                    <button
                      type="button"
                      onClick={() => setTerm('5y')}
                      className={`rounded-[2px] border py-2 text-xs font-semibold ${
                        term === '5y' ? 'border-[#11151C] bg-[#11151C] text-[#F6F4EF]' : 'border-[#DED8CC] bg-[#FAF9F6] text-slate-600'
                      }`}
                    >
                      5 年期以上（现行 {LATEST_LPR.r5y.toFixed(2)}%）
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-700">LPR 倍数</span>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={multiplierStr}
                      onChange={(e) => setMultiplierStr(e.target.value)}
                      className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num text-sm font-bold"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-700">加减基点（BP，100BP=1%）</span>
                    <input
                      type="number"
                      step="5"
                      value={bpsStr}
                      onChange={(e) => setBpsStr(e.target.value)}
                      className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num text-sm font-bold"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[
                    ['1', '1倍 LPR'],
                    ['1.3', '1.3倍（上浮30%）'],
                    ['1.5', '1.5倍（上浮50%）'],
                    ['4', '4倍（民间借贷上限）'],
                  ].map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => {
                        setMultiplierStr(val);
                        setBpsStr('0');
                      }}
                      className="rounded-[2px] border border-[#E4DFD4] bg-[#FAF9F6] px-2.5 py-1 text-[11px] text-slate-600 hover:border-[#11151C]"
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'custom_rate' && (
              <div className="border-t border-[#EFECE5] pt-4">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">合同约定年利率（%）</span>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={customRateStr}
                    onChange={(e) => setCustomRateStr(e.target.value)}
                    className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3.5 py-2.5 font-num text-lg font-bold"
                  />
                </label>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  参考：现行民间借贷司法保护上限为 4 倍 1 年期 LPR = <strong className="font-num text-[#11151C]">{calc.fourTimesLatestLpr}%</strong>。
                </p>
              </div>
            )}

            {/* Day basis & Execution delay overlay */}
            {mode !== 'delay_only' && (
              <div className="space-y-3 border-t border-[#EFECE5] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-700">日利率换算口径</span>
                  <div className="inline-flex flex-none border border-[#DED8CC] bg-[#FAF9F6] p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setDayBasis(365)}
                      className={`whitespace-nowrap px-2.5 py-1 font-semibold ${dayBasis === 365 ? 'bg-[#11151C] text-[#F6F4EF]' : 'text-slate-600'}`}
                    >
                      按 365 天（司法主流）
                    </button>
                    <button
                      type="button"
                      onClick={() => setDayBasis(360)}
                      className={`whitespace-nowrap px-2.5 py-1 font-semibold ${dayBasis === 360 ? 'bg-[#11151C] text-[#F6F4EF]' : 'text-slate-600'}`}
                    >
                      按 360 天
                    </button>
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-2.5 border border-[#EFECE5] bg-[#FAF9F6] p-3 text-xs">
                  <input
                    type="checkbox"
                    checked={includeDelay}
                    onChange={(e) => setIncludeDelay(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#11151C]"
                  />
                  <span>
                    <strong className="text-[#11151C]">叠加计算执行加倍迟延履行金（日万分之 1.75）</strong>
                    <span className="block text-[11px] text-slate-500">适用于已生效判决/调解书逾期未履行进入强制执行阶段</span>
                  </span>
                </label>

                {includeDelay && (
                  <label className="block">
                    <span className="text-[11px] font-semibold text-slate-600">判决确定履行期届满次日（加倍利息起算日）</span>
                    <input
                      type="date"
                      value={delayStartDate}
                      onChange={(e) => setDelayStartDate(e.target.value)}
                      className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-3 py-2 text-xs"
                    />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Right Results & Segment Table */}
          <div className="min-w-0 lg:col-span-7 space-y-5">
            <div className="bg-[#11151C] p-5 sm:p-6 text-white">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#D1B27A]">
                    INTEREST SUMMARY · 应付利息合计（共 {calc.totalDays} 天）
                  </p>
                  <p className="mt-2 font-num text-3xl font-bold sm:text-4xl">{fmtMoney(calc.totalInterest)}</p>
                  <p className="mt-2 text-xs text-slate-300">
                    本息暂计总额：<strong className="font-num text-[#D1B27A]">{fmtMoney(calc.grandTotal)}</strong>
                    {calc.delayDays > 0 && mode !== 'delay_only'
                      ? `（含一般利息 ${fmtMoney(calc.normalInterest)} + 加倍迟延履行金 ${fmtMoney(calc.delayInterest)}）`
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyStatement}
                  className="inline-flex items-center gap-1.5 rounded-[2px] border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-medium text-white hover:bg-white/20"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-[#D1B27A]" />}
                  <span>{copied ? '已复制明细表' : '复制诉状用明细表'}</span>
                </button>
              </div>
            </div>

            {calc.exceedsPrivateLendingCap && (
              <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-950">
                <strong>民间借贷利率上限提醒：</strong>当前设定年利率高于现行 4 倍 1 年期 LPR（{calc.fourTimesLatestLpr}%）。如属民间借贷纠纷，超出 4 倍部分通常不获司法保护；如属买卖/建设工程等商事违约金，请结合实际损失综合评估。
              </div>
            )}

            {(mode === 'lpr_floating' || mode === 'lpr_fixed') && calc.lprCoverage.staleEnd && (
              <div className="border border-amber-400 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-950">
                <strong>LPR 数据时效核对提醒：</strong>
                所选截止日期（{endDate}）超出本箱内置 LPR 报价核验期（截至{' '}
                {calc.lprCoverage.verifiedThrough}，超出约 {calc.lprCoverage.gapDays} 天）。中国人民银行每月 20 日公布最新一期 LPR，超出核验期部分当前沿用最近已核验报价（1年期 {LATEST_LPR.r1y.toFixed(2)}% / 5年期 {LATEST_LPR.r5y.toFixed(2)}%），提交法庭前请核对央行最新一期公告。
              </div>
            )}

            {(mode === 'lpr_floating' || mode === 'lpr_fixed') && calc.lprCoverage.beforeLprReform && (
              <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-950">
                <strong>LPR 改革前分段提醒：</strong>
                起算日期（{startDate}）早于 2019-08-20（央行 LPR 报价机制启动日）。2019-08-19 及之前的法定逾期利息在实务中通常适用央行同期同类贷款基准利率，建议分段核验或与裁判口径对齐。
              </div>
            )}

            {/* Segment Table */}
            <div className="min-w-0 border border-[#DED8CC] bg-white p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-3">
                <h2 className="font-display text-base font-bold text-[#11151C]">
                  逐段计息明细表（共 {calc.segments.length + (calc.delayDays > 0 ? 1 : 0)} 段）
                </h2>
                <span className="text-[11px] text-slate-400">公式：本金 × 年利率 ÷ {dayBasis} × 天数</span>
              </div>

              <div className="mt-4 max-w-full overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#DED8CC] bg-[#FAF9F6] text-[11px] text-slate-500">
                      <th className="px-3 py-2.5 font-semibold">计息区间</th>
                      <th className="px-3 py-2.5 font-semibold">天数</th>
                      <th className="px-3 py-2.5 font-semibold">基准 / 执行年利率</th>
                      <th className="px-3 py-2.5 text-right font-semibold">分段利息（元）</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFECE5]">
                    {calc.segments.map((s, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2.5 font-num text-[#11151C]">
                          {s.from} ~ {s.to}
                        </td>
                        <td className="px-3 py-2.5 font-num text-slate-600">{s.days} 天</td>
                        <td className="px-3 py-2.5">
                          <span className="font-num font-bold text-[#11151C]">{s.effectiveRate.toFixed(3)}%</span>
                          <span className="ml-1.5 text-[11px] text-slate-400">({s.note})</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-num font-semibold text-[#11151C]">
                          {s.interest.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                    {calc.delayDays > 0 && (
                      <tr className="bg-[#FAF7F0]">
                        <td className="px-3 py-2.5 font-num text-[#11151C]">
                          {mode === 'delay_only' ? startDate : delayStartDate} ~ {endDate}
                        </td>
                        <td className="px-3 py-2.5 font-num text-slate-600">{calc.delayDays} 天</td>
                        <td className="px-3 py-2.5">
                          <span className="font-semibold text-[#9A773E]">日万分之 1.75</span>
                          <span className="ml-1.5 text-[11px] text-slate-500">（加倍部分债务利息）</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-num font-bold text-[#9A773E]">
                          {calc.delayInterest.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    )}
                    {calc.segments.length === 0 && calc.delayDays === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                          请确保截止日期晚于起算日期且本金大于 0。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Action Bridge */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#EFECE5] pt-4">
                <Link
                  to={feeToolLink}
                  className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#D4CEC2] bg-[#FAF9F6] px-3.5 py-2 text-xs font-semibold text-[#11151C] hover:border-[#11151C]"
                >
                  <Calculator className="h-3.5 w-3.5 text-[#9A773E]" />
                  <span>带入本息总额算诉讼费/执行费</span>
                </Link>
                <Link
                  to={`/contact?type=${encodeURIComponent('民商事争议')}&sourceTool=${encodeURIComponent('LPR 逾期利息与迟延履行金计算器')}&note=${encodeURIComponent(`${courtReadyText}\n希望预约民商事/执行律师评估起诉或强制执行回款策略。`)}`}
                  onClick={() => trackEvent('tool_to_contact')}
                  className="inline-flex items-center gap-2 rounded-[2px] bg-[#11151C] px-5 py-2.5 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D]"
                >
                  <Send className="h-3.5 w-3.5 text-[#D1B27A]" />
                  <span>带入利息明细预约律师</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        <ToolSeoKnowledgeSection routeKey="/tools/lpr-interest-calculator" />

        <p className="mx-auto mt-6 flex max-w-4xl items-start justify-center gap-1.5 text-center text-xs leading-6 text-slate-500">
          <Info className="mt-1 h-3.5 w-3.5 flex-none text-[#B89254]" />
          <span>
            本工具完全在本地浏览器离线计算，不上传任何金额与交易日期。已内置央行 2019 年 8 月至 {LEGAL_DATA_MANIFEST.lprHistory.asOf} 历次 LPR 核验报价（数据来源：{LEGAL_DATA_MANIFEST.lprHistory.source}）；具体案件涉及部分清偿抵扣顺序（先息后本/先本后息）或复利约定时，以生效裁判文书及法院执行核定为准。
          </span>
        </p>
      </div>
    </div>
  );
};
