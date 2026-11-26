import React, { useMemo, useState } from 'react';
import { Link, trackEvent } from '../../components/ToolboxBridgeLink';
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
import { checkLprDateCoverage, LEGAL_DATA_MANIFEST } from '../../data/legalDataManifest';
import { copyToClipboard } from '../../lib/clipboard';
import {
  addDaysYmd,
  diffDaysYmd,
  getTodayChinaYmd,
  isValidIsoYmd,
} from '../../lib/legalCalendar';
import {
  evaluatePrivateLendingCap,
  LATEST_LPR,
  lookupLprOn,
  LPR_HISTORY,
  type LprTerm,
} from '../../lib/lprEngine';
import { ToolQuickRefSection as ToolSeoKnowledgeSection } from '../../components/ToolQuickRefSection';

type CalcMode = 'lpr_floating' | 'lpr_fixed' | 'custom_rate' | 'delay_only';

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

function safePositiveDiff(startIso: string, endIso: string): number {
  const d = diffDaysYmd(startIso, endIso);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

const fmtMoney = (n: number) =>
  `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const LprInterestCalculator: React.FC = () => {
  const todayIso = useMemo(() => getTodayChinaYmd(), []);

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

  // Explicit Private Lending 4x LPR Cap Verification (Contract Formation Date Benchmark)
  const [isPrivateLending, setIsPrivateLending] = useState(false);
  const [contractDate, setContractDate] = useState('2024-06-01');
  const [contractDateCustomized, setContractDateCustomized] = useState(false);

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
    const validDates = isValidIsoYmd(startDate) && isValidIsoYmd(endDate);
    const totalDays = validDates ? safePositiveDiff(startDate, endDate) : 0;
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
        const cuts: string[] = [startDate];
        for (const item of LPR_HISTORY) {
          if (item.date > startDate && item.date < endDate) {
            const prevRate = lookupLprOn(addDaysYmd(item.date, -1), term).rate;
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
          const days = safePositiveDiff(segFrom, segTo);
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
            note: `${term === '1y' ? '1年期' : '5年期'} LPR ${snap.rate.toFixed(2)}%（${snap.effectiveDate} 报价）`,
          });
        }
      }
    }

    let delayDays = 0;
    let delayInterest = 0;
    if (mode === 'delay_only') {
      delayDays = totalDays;
      delayInterest = principalYuan * DELAY_DAILY_RATE * delayDays;
    } else if (includeDelay && principalYuan > 0 && isValidIsoYmd(delayStartDate) && isValidIsoYmd(endDate)) {
      delayDays = safePositiveDiff(delayStartDate, endDate);
      delayInterest = principalYuan * DELAY_DAILY_RATE * delayDays;
    }

    const totalInterest = normalInterest + delayInterest;
    const grandTotal = principalYuan + totalInterest;

    const maxTestedRate =
      mode === 'custom_rate'
        ? customRate
        : segments.length > 0
        ? Math.max(...segments.map((s) => s.effectiveRate))
        : isValidIsoYmd(startDate)
        ? Math.max(0, lookupLprOn(startDate, term).rate * multiplier + bps / 100)
        : 0;

    const privateLendingEval = evaluatePrivateLendingCap({
      enabled: isPrivateLending && mode !== 'delay_only',
      contractDateIso: contractDate,
      testedAnnualRate: maxTestedRate,
    });

    const lprCoverage = checkLprDateCoverage(startDate, endDate);

    return {
      validDates,
      totalDays,
      segments,
      normalInterest,
      delayDays,
      delayInterest,
      totalInterest,
      grandTotal,
      privateLendingEval,
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
    isPrivateLending,
    contractDate,
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
      `计息期间：${startDate || '待填'} 至 ${endDate || '待填'}（共 ${calc.totalDays} 天，基准 ${dayBasis} 天/年）`,
      `计息标准：${modeLabel}`,
    ];

    if (calc.privateLendingEval.enabled && calc.privateLendingEval.message) {
      lines.push(`民间借贷上限核验：${calc.privateLendingEval.message}`);
    }

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

    if ((mode === 'lpr_floating' || mode === 'lpr_fixed') && calc.lprCoverage.staleEnd) {
      lines.push(
        `【数据核验提醒】截止日（${endDate}）超出本工具已核验央行 LPR 报价窗口（截至 ${calc.lprCoverage.verifiedThrough}），提交法庭前请复核最新一期央行 LPR 公告。`
      );
    }
    if ((mode === 'lpr_floating' || mode === 'lpr_fixed') && calc.lprCoverage.beforeLprReform) {
      lines.push(
        `【历史分段提醒】起算日（${startDate}）早于 2019-08-20 LPR 改革日，2019-08-19 及之前期间请核对同期同类贷款基准利率分段规则。`
      );
    }

    return lines.join('\n');
  }, [
    mode,
    term,
    multiplier,
    bps,
    customRate,
    principalYuan,
    startDate,
    endDate,
    dayBasis,
    delayStartDate,
    calc,
  ]);

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
              自动按央行历次 LPR 调息日分段拆算逾期付款利息、商事合同上浮利息、民间借贷「合同成立时 4 倍 LPR」上限核验及《民诉法》第 264 条双倍迟延履行债务利息（日万分之 1.75）。
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
              setIsPrivateLending(false);
              setContractDate('2024-06-01');
              setContractDateCustomized(false);
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
              ['custom_rate', '合同约定年利率', '自定义固定年化利率（可选核验民间借贷上限）'],
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
                  onChange={(e) => {
                    const v = e.target.value;
                    setStartDate(v);
                    if (!contractDateCustomized && v) {
                      setContractDate(v);
                    }
                  }}
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
                    ['1.3', '1.3倍（买卖合同违约参考）'],
                    ['1.5', '1.5倍（上浮50%）'],
                    ['4', '4倍（民间借贷参考）'],
                  ].map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => {
                        setMultiplierStr(val);
                        setBpsStr('0');
                        if (val === '4') setIsPrivateLending(true);
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
                  提示：买卖/建设工程等商事违约金不直接适用民间借贷 4 倍上限；如属民间借贷，请勾选下方核验框并填入合同成立日。
                </p>
              </div>
            )}

            {/* Day basis, Private Lending Cap Check & Execution delay overlay */}
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

                {/* Private Lending Cap Opt-in */}
                <label className="flex cursor-pointer items-start gap-2.5 border border-[#E4DFD4] bg-[#FAF9F6] p-3 text-xs">
                  <input
                    type="checkbox"
                    checked={isPrivateLending}
                    onChange={(e) => setIsPrivateLending(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#11151C]"
                  />
                  <span>
                    <strong className="text-[#11151C]">属于民间借贷纠纷（核验合同成立时 4 倍 LPR 上限）</strong>
                    <span className="block text-[11px] text-slate-500">
                      按《民间借贷司法解释》第 25 条，以合同成立时一年期 LPR 四倍核定保护上限
                    </span>
                  </span>
                </label>

                {isPrivateLending && (
                  <label className="block rounded border border-[#E4DFD4] bg-white p-3">
                    <span className="text-[11px] font-bold text-[#0E223D]">
                      借款合同成立日期（用于匹配成立当期 1 年期 LPR 报价）
                    </span>
                    <input
                      type="date"
                      value={contractDate}
                      onChange={(e) => {
                        setContractDate(e.target.value);
                        setContractDateCustomized(true);
                      }}
                      className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 text-xs font-medium"
                    />
                  </label>
                )}

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
                  disabled={!calc.validDates}
                  onClick={copyStatement}
                  className="inline-flex items-center gap-1.5 rounded-[2px] border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-40"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-[#D1B27A]" />}
                  <span>{copied ? '已复制明细表' : '复制诉状用明细表'}</span>
                </button>
              </div>
            </div>

            {calc.privateLendingEval.enabled && (
              <div
                className={`border px-4 py-3 text-xs leading-6 ${
                  calc.privateLendingEval.status === 'within_cap'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                    : 'border-amber-300 bg-amber-50 text-amber-950'
                }`}
              >
                <strong>
                  {calc.privateLendingEval.status === 'within_cap'
                    ? '民间借贷利率上限核验（未超限）：'
                    : calc.privateLendingEval.status === 'exceeds_cap'
                    ? '民间借贷利率上限提醒（超出成立时 4 倍 LPR）：'
                    : '民间借贷利率上限核验（待人工复核）：'}
                </strong>
                {calc.privateLendingEval.message}
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
                          请确保填写有效起止日期、截止日期晚于起算日期且本金大于 0。
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
                  to={`/contact?type=${encodeURIComponent('民商事争议')}&sourceTool=${encodeURIComponent('LPR 逾期利息与迟延履行金计算器')}&note=${encodeURIComponent(`${courtReadyText}\n希望评估起诉或强制执行回款策略。`)}`}
                  onClick={() => trackEvent('tool_to_contact')}
                  className="inline-flex items-center gap-2 rounded-[2px] bg-[#11151C] px-5 py-2.5 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D]"
                >
                  <Send className="h-3.5 w-3.5 text-[#D1B27A]" />
                  <span>带入利息明细转 AI 智囊</span>
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
