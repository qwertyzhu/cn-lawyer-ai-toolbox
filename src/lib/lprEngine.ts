/**
 * Verified PBOC / NIFC LPR History & Private Lending Statutory Cap Engine.
 *
 * Implements:
 * 1.《最高人民法院关于审理民间借贷案件适用法律若干问题的规定》（2020第二次修正，法释〔2020〕17号）第25条、第28条、第31条:
 *    - Contracts formed on/after 2020-08-20: capped at 4x the 1-year LPR at CONTRACT FORMATION DATE.
 *    - Contracts formed BEFORE 2020-08-20 (including 2019-08-20 .. 2020-08-19 transitional period & pre-2019-08-20):
 *      for cases filed on/after 2020-08-20, interest up to 2020-08-19 is capped at 24%/year, while interest from
 *      2020-08-20 onward is capped at 4x the 1-year LPR AT CASE FILING DATE (起诉时一年期LPR四倍).
 *      NEVER silently stamps green 'within_cap' on pre-2020-08-20 contracts without verifying filing-date 4x LPR!
 * 2. Strict pre-2019-08-20 LPR reform guard: NEVER silently substitutes 2019-08-20's 4.25% for periods prior to 2019-08-20.
 * 3.《最高法关于执行程序中计算迟延履行期间的债务利息适用法律若干问题的解释》第1-2条:
 *    supports independent unpaid principal base (`delayBaseYuan`) for doubled execution delay interest (0.0175%/day).
 */

import {
  checkLprDateCoverage,
  LPR_START_DATE,
  LPR_VERIFIED_THROUGH,
} from '../data/legalDataManifest.ts';
import { addDaysYmd, diffDaysYmd, isValidIsoYmd } from './legalCalendar.ts';

export type LprTerm = '1y' | '5y';
export type InterestCalcMode = 'lpr_floating' | 'lpr_fixed' | 'custom_rate' | 'delay_only';

export const DELAY_DAILY_RATE = 0.000175;

export interface LprMilestone {
  date: string; // Effective date YYYY-MM-DD (PBOC / NIFC official publication date)
  r1y: number; // 1-year LPR %
  r5y: number; // 5-year+ LPR %
}

export const LPR_HISTORY: LprMilestone[] = [
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

export const LATEST_LPR = LPR_HISTORY[LPR_HISTORY.length - 1];

export function lookupLprOn(
  dateIso: string,
  term: LprTerm
): { rate: number; effectiveDate: string; beforeReform: boolean } {
  const beforeReform = Boolean(dateIso && dateIso < LPR_START_DATE);
  let active = LPR_HISTORY[0];
  for (const item of LPR_HISTORY) {
    if (item.date <= dateIso) active = item;
    else break;
  }
  return {
    rate: term === '1y' ? active.r1y : active.r5y,
    effectiveDate: active.date,
    beforeReform,
  };
}

export interface PrivateLendingCapEvaluation {
  enabled: boolean;
  status: 'disabled' | 'within_cap' | 'exceeds_cap' | 'needs_manual_review';
  isPre2020Transitional: boolean;
  contractDate: string;
  filingDate: string;
  quoteDate: string;
  baseRate1y: number;
  capRate: number;
  pre2020CapRate?: number;
  testedRate: number;
  transitionalNote: string;
  message: string;
}

export function evaluatePrivateLendingCap(params: {
  enabled: boolean;
  contractDateIso: string;
  filingDateIso?: string;
  testedAnnualRate: number;
}): PrivateLendingCapEvaluation {
  const { enabled, contractDateIso, filingDateIso = '', testedAnnualRate } = params;
  if (!enabled) {
    return {
      enabled: false,
      status: 'disabled',
      isPre2020Transitional: false,
      contractDate: contractDateIso,
      filingDate: filingDateIso,
      quoteDate: '',
      baseRate1y: 0,
      capRate: 0,
      testedRate: testedAnnualRate,
      transitionalNote: '',
      message: '',
    };
  }

  if (!isValidIsoYmd(contractDateIso)) {
    return {
      enabled: true,
      status: 'needs_manual_review',
      isPre2020Transitional: false,
      contractDate: contractDateIso,
      filingDate: filingDateIso,
      quoteDate: '',
      baseRate1y: 0,
      capRate: 0,
      testedRate: testedAnnualRate,
      transitionalNote: '',
      message: '请录入有效的「借款合同成立日期」，系统将依法核验民间借贷司法保护上限。',
    };
  }

  // Contracts formed BEFORE 2020-08-20 (both <2019-08-20 and 2019-08-20..2020-08-19)
  // are governed by Art. 31 transitional split rules for cases filed on/after 2020-08-20!
  if (contractDateIso < '2020-08-20') {
    const pre2020Cap = 24;
    const cleanFiling = filingDateIso.trim();

    if (testedAnnualRate > pre2020Cap + 1e-9 && (!cleanFiling || !isValidIsoYmd(cleanFiling))) {
      return {
        enabled: true,
        status: 'exceeds_cap',
        isPre2020Transitional: true,
        contractDate: contractDateIso,
        filingDate: cleanFiling,
        quoteDate: '',
        baseRate1y: 0,
        capRate: pre2020Cap,
        pre2020CapRate: pre2020Cap,
        testedRate: testedAnnualRate,
        transitionalNote: '合同早于 2020-08-20（适用司法解释第31条新旧衔接规则）',
        message: `合同成立日（${contractDateIso}）早于 2020-08-20：即便在 2020-08-19 前旧司法解释阶段，司法保护上限亦为 24.00%，当前测算年利率（${testedAnnualRate.toFixed(2)}%）已超出上限；且 2020-08-20 起须按「一审起诉时一年期 LPR 四倍」进一步下调分段上限，请补填起诉日期以精确核验。`,
      };
    }

    if (!cleanFiling || !isValidIsoYmd(cleanFiling)) {
      return {
        enabled: true,
        status: 'needs_manual_review',
        isPre2020Transitional: true,
        contractDate: contractDateIso,
        filingDate: cleanFiling,
        quoteDate: '',
        baseRate1y: 0,
        capRate: 0,
        pre2020CapRate: pre2020Cap,
        testedRate: testedAnnualRate,
        transitionalNote: '待补填一审起诉日期（司法解释第31条过渡期分段）',
        message: `合同成立于 ${contractDateIso}（早于 2020-08-20 新规施行日）。依据《民间借贷司法解释》（法释〔2020〕17号）第 31 条，2020-08-20 后新受理的一审案件：借贷发生日至 2020-08-19 段保护上限为 24%/年，而自 2020-08-20 起至清偿日段以「起诉时一年期 LPR 四倍」为上限（不能直接套用合同成立日 4 倍 LPR 放行）。请在左侧补填「一审起诉/受理日期」完成分段核验！`,
      };
    }

    if (cleanFiling < '2020-08-20') {
      const exOld = testedAnnualRate > pre2020Cap + 1e-9;
      return {
        enabled: true,
        status: exOld ? 'exceeds_cap' : 'within_cap',
        isPre2020Transitional: true,
        contractDate: contractDateIso,
        filingDate: cleanFiling,
        quoteDate: '',
        baseRate1y: 0,
        capRate: pre2020Cap,
        pre2020CapRate: pre2020Cap,
        testedRate: testedAnnualRate,
        transitionalNote: '2020-08-20 前已受理旧案（适用原 24%/36% 规则）',
        message: exOld
          ? `案件于 ${cleanFiling}（2020-08-20 前）受理，适用修正前司法解释 24.00% 司法保护上限；当前测算年利率（${testedAnnualRate.toFixed(2)}%）超出 24.00%。`
          : `案件于 ${cleanFiling}（2020-08-20 前）受理，适用修正前司法解释 24.00% 司法保护上限；当前测算年利率（${testedAnnualRate.toFixed(2)}%）未超 24.00%。`,
      };
    }

    const filingCov = checkLprDateCoverage(cleanFiling, cleanFiling, LPR_VERIFIED_THROUGH);
    const filingSnap = lookupLprOn(cleanFiling, '1y');
    const post2020Cap = Number((filingSnap.rate * 4).toFixed(2));

    if (filingCov.staleEnd) {
      return {
        enabled: true,
        status: 'needs_manual_review',
        isPre2020Transitional: true,
        contractDate: contractDateIso,
        filingDate: cleanFiling,
        quoteDate: filingSnap.effectiveDate,
        baseRate1y: filingSnap.rate,
        capRate: post2020Cap,
        pre2020CapRate: pre2020Cap,
        testedRate: testedAnnualRate,
        transitionalNote: '起诉日期超出已核验 LPR 窗口',
        message: `起诉日（${cleanFiling}）超出本箱已核验 LPR 窗口（截至 ${LPR_VERIFIED_THROUGH}），当前参考最近一期报价（${filingSnap.rate.toFixed(2)}% × 4 = ${post2020Cap.toFixed(2)}%），请核对起诉当月央行正式公告。`,
      };
    }

    const exceedsPost = testedAnnualRate > post2020Cap + 1e-9;
    const exceedsPre = testedAnnualRate > pre2020Cap + 1e-9;
    const exceedsAny = exceedsPost || exceedsPre;

    return {
      enabled: true,
      status: exceedsAny ? 'exceeds_cap' : 'within_cap',
      isPre2020Transitional: true,
      contractDate: contractDateIso,
      filingDate: cleanFiling,
      quoteDate: filingSnap.effectiveDate,
      baseRate1y: filingSnap.rate,
      capRate: post2020Cap,
      pre2020CapRate: pre2020Cap,
      testedRate: testedAnnualRate,
      transitionalNote: `《民间借贷司法解释》第31条双段上限：2020-08-19 前 ≤24.00% ｜ 2020-08-20 起 ≤${post2020Cap.toFixed(2)}%（按起诉日 ${cleanFiling} 1年期 LPR ${filingSnap.rate.toFixed(2)}% × 4）`,
      message: exceedsAny
        ? `合同成立于 ${contractDateIso}、一审起诉日 ${cleanFiling}（适用《民间借贷司法解释》第 31 条）：2020-08-19 前保护上限为 24.00%，2020-08-20 起按起诉时 1 年期 LPR ${filingSnap.rate.toFixed(2)}%（${filingSnap.effectiveDate} 报价）四倍核定上限为 ${post2020Cap.toFixed(2)}%。当前测算年利率（${testedAnnualRate.toFixed(2)}%）已超出 ${exceedsPre ? '24.00% 及 ' : ''}2020-08-20 起 ${post2020Cap.toFixed(2)}% 分段上限，2020-08-20 后超出部分不获司法支持！`
        : `合同成立于 ${contractDateIso}、一审起诉日 ${cleanFiling}（适用《民间借贷司法解释》第 31 条）：2020-08-19 前上限 24.00%，2020-08-20 起上限 ${post2020Cap.toFixed(2)}%（起诉时 1 年期 LPR ${filingSnap.rate.toFixed(2)}% × 4）；当前测算年利率（${testedAnnualRate.toFixed(2)}%）在两段上限内均未超标。`,
    };
  }

  const coverage = checkLprDateCoverage(contractDateIso, contractDateIso, LPR_VERIFIED_THROUGH);
  const snap = lookupLprOn(contractDateIso, '1y');
  const capRate = Number((snap.rate * 4).toFixed(2));

  if (coverage.staleEnd) {
    return {
      enabled: true,
      status: 'needs_manual_review',
      isPre2020Transitional: false,
      contractDate: contractDateIso,
      filingDate: filingDateIso,
      quoteDate: snap.effectiveDate,
      baseRate1y: snap.rate,
      capRate,
      testedRate: testedAnnualRate,
      transitionalNote: '',
      message: `合同成立日（${contractDateIso}）超出本箱已核验的央行 LPR 报价窗口（截至 ${LPR_VERIFIED_THROUGH}），当前仅能参考最近一期已核验报价（${snap.rate.toFixed(2)}% × 4 = ${capRate.toFixed(2)}%），提交前请核对合同成立当月 20 日央行正式报价。`,
    };
  }

  const exceeds = testedAnnualRate > capRate + 1e-9;
  const baseDesc = `按借款合同成立日（${contractDateIso}）当期 1 年期 LPR ${snap.rate.toFixed(2)}%（${snap.effectiveDate} 央行公布报价）计算，4 倍司法保护上限为 ${capRate.toFixed(2)}%`;

  return {
    enabled: true,
    status: exceeds ? 'exceeds_cap' : 'within_cap',
    isPre2020Transitional: false,
    contractDate: contractDateIso,
    filingDate: filingDateIso,
    quoteDate: snap.effectiveDate,
    baseRate1y: snap.rate,
    capRate,
    testedRate: testedAnnualRate,
    transitionalNote: '',
    message: exceeds
      ? `${baseDesc}；当前测算年利率（${testedAnnualRate.toFixed(2)}%）高于该上限，民间借贷超出 4 倍部分通常不获司法支持。`
      : `${baseDesc}；当前测算年利率（${testedAnnualRate.toFixed(2)}%）未超出该上限。`,
  };
}

export interface InterestSegment {
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

export interface ComputedInterestSummary {
  validDates: boolean;
  totalDays: number;
  segments: InterestSegment[];
  normalInterest: number;
  delayDays: number;
  delayBaseYuan: number;
  delayBaseIsCustom: boolean;
  delayInterest: number;
  totalInterest: number;
  grandTotal: number;
  requiresPreReformRate: boolean;
  privateLendingEval: PrivateLendingCapEvaluation;
}

export function computeLprAndDelayInterest(params: {
  mode: InterestCalcMode;
  principalYuan: number;
  startDate: string;
  endDate: string;
  term: LprTerm;
  multiplier: number;
  bps: number;
  customRate: number;
  preReformAnnualRate?: number | null;
  dayBasis: 365 | 360;
  isPrivateLending: boolean;
  contractDate: string;
  filingDate?: string;
  includeDelay: boolean;
  delayStartDate: string;
  delayBaseYuan?: number | null;
}): ComputedInterestSummary {
  const {
    mode,
    principalYuan,
    startDate,
    endDate,
    term,
    multiplier,
    bps,
    customRate,
    preReformAnnualRate,
    dayBasis,
    isPrivateLending,
    contractDate,
    filingDate = '',
    includeDelay,
    delayStartDate,
    delayBaseYuan,
  } = params;

  const validDates = isValidIsoYmd(startDate) && isValidIsoYmd(endDate);
  const totalDays = validDates ? safePositiveDiff(startDate, endDate) : 0;
  const segments: InterestSegment[] = [];
  let normalInterest = 0;
  let requiresPreReformRate = false;

  const hasValidPreReformRate =
    preReformAnnualRate !== undefined &&
    preReformAnnualRate !== null &&
    Number.isFinite(preReformAnnualRate) &&
    preReformAnnualRate >= 0;

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
      if (startDate < LPR_START_DATE) {
        if (hasValidPreReformRate) {
          const base = Number(preReformAnnualRate);
          const eff = Math.max(0, base * multiplier + bps / 100);
          const interest = (principalYuan * (eff / 100) * totalDays) / dayBasis;
          normalInterest = interest;
          segments.push({
            from: startDate,
            to: endDate,
            days: totalDays,
            baseRate: base,
            effectiveRate: eff,
            interest,
            note: `2019-08-20 前无 LPR 报价，按录入的央行同期基准利率 ${base.toFixed(2)}% 固定计算`,
          });
        } else {
          requiresPreReformRate = true;
        }
      } else {
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
      }
    } else {
      // mode === 'lpr_floating'
      let lprSegmentStart = startDate;
      if (startDate < LPR_START_DATE) {
        const preEnd = endDate < LPR_START_DATE ? endDate : LPR_START_DATE;
        const preDays = safePositiveDiff(startDate, preEnd);
        if (preDays > 0) {
          if (hasValidPreReformRate) {
            const base = Number(preReformAnnualRate);
            const eff = Math.max(0, base * multiplier + bps / 100);
            const interest = (principalYuan * (eff / 100) * preDays) / dayBasis;
            normalInterest += interest;
            segments.push({
              from: startDate,
              to: preEnd,
              days: preDays,
              baseRate: base,
              effectiveRate: eff,
              interest,
              note: `LPR 改革前分段（按录入基准年利率 ${base.toFixed(2)}%）`,
            });
          } else {
            requiresPreReformRate = true;
          }
        }
        lprSegmentStart = LPR_START_DATE;
      }

      if (endDate > lprSegmentStart && !requiresPreReformRate) {
        const cuts: string[] = [lprSegmentStart];
        for (const item of LPR_HISTORY) {
          if (item.date > lprSegmentStart && item.date < endDate) {
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
  }

  const hasCustomDelayBase =
    delayBaseYuan !== undefined &&
    delayBaseYuan !== null &&
    Number.isFinite(delayBaseYuan) &&
    delayBaseYuan >= 0;
  const effectiveDelayBase = hasCustomDelayBase ? Number(delayBaseYuan) : principalYuan;

  let delayDays = 0;
  let delayInterest = 0;
  if (mode === 'delay_only') {
    delayDays = totalDays;
    delayInterest = effectiveDelayBase * DELAY_DAILY_RATE * delayDays;
  } else if (
    includeDelay &&
    effectiveDelayBase > 0 &&
    isValidIsoYmd(delayStartDate) &&
    isValidIsoYmd(endDate)
  ) {
    delayDays = safePositiveDiff(delayStartDate, endDate);
    delayInterest = effectiveDelayBase * DELAY_DAILY_RATE * delayDays;
  }

  const totalInterest = normalInterest + delayInterest;
  const grandTotal = principalYuan + totalInterest;

  const maxTestedRate =
    mode === 'custom_rate'
      ? customRate
      : segments.length > 0
      ? Math.max(...segments.map((s) => s.effectiveRate))
      : isValidIsoYmd(startDate) && startDate >= LPR_START_DATE
      ? Math.max(0, lookupLprOn(startDate, term).rate * multiplier + bps / 100)
      : 0;

  const privateLendingEval = evaluatePrivateLendingCap({
    enabled: isPrivateLending && mode !== 'delay_only',
    contractDateIso: contractDate,
    filingDateIso: filingDate,
    testedAnnualRate: maxTestedRate,
  });

  return {
    validDates,
    totalDays,
    segments,
    normalInterest,
    delayDays,
    delayBaseYuan: effectiveDelayBase,
    delayBaseIsCustom: hasCustomDelayBase,
    delayInterest,
    totalInterest,
    grandTotal,
    requiresPreReformRate,
    privateLendingEval,
  };
}
