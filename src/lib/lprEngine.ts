/**
 * Verified PBOC / NIFC LPR History & Private Lending Statutory Cap Engine.
 *
 * Implements《最高人民法院关于审理民间借贷案件适用法律若干问题的规定》（2020修正）第25条、第28条、第31条:
 * - Private lending judicial cap compares against 4x the 1-year LPR at CONTRACT FORMATION DATE
 *   (合同成立时一年期贷款市场报价利率四倍), NOT the latest LPR!
 * - Only evaluates private lending cap when explicitly enabled for private lending disputes.
 */

import {
  checkLprDateCoverage,
  LPR_START_DATE,
  LPR_VERIFIED_THROUGH,
} from '../data/legalDataManifest.ts';
import { isValidIsoYmd } from './legalCalendar.ts';

export type LprTerm = '1y' | '5y';

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

export function lookupLprOn(dateIso: string, term: LprTerm): { rate: number; effectiveDate: string } {
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

export interface PrivateLendingCapEvaluation {
  enabled: boolean;
  status: 'disabled' | 'within_cap' | 'exceeds_cap' | 'needs_manual_review';
  contractDate: string;
  quoteDate: string;
  baseRate1y: number;
  capRate: number;
  testedRate: number;
  transitionalNote: string;
  message: string;
}

export function evaluatePrivateLendingCap(params: {
  enabled: boolean;
  contractDateIso: string;
  testedAnnualRate: number;
}): PrivateLendingCapEvaluation {
  const { enabled, contractDateIso, testedAnnualRate } = params;
  if (!enabled) {
    return {
      enabled: false,
      status: 'disabled',
      contractDate: contractDateIso,
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
      contractDate: contractDateIso,
      quoteDate: '',
      baseRate1y: 0,
      capRate: 0,
      testedRate: testedAnnualRate,
      transitionalNote: '',
      message: '请录入有效的「借款合同成立日期」，系统将按合同成立时当期 1 年期 LPR 的 4 倍核验民间借贷司法保护上限。',
    };
  }

  if (contractDateIso < LPR_START_DATE) {
    return {
      enabled: true,
      status: 'needs_manual_review',
      contractDate: contractDateIso,
      quoteDate: '',
      baseRate1y: 0,
      capRate: 0,
      testedRate: testedAnnualRate,
      transitionalNote: '早于 2019-08-20 LPR 报价改革启动日',
      message: `合同成立日（${contractDateIso}）早于 ${LPR_START_DATE}（央行 LPR 改革启动日）。依据《民间借贷司法解释》第 31 条过渡规则，2020-08-20 后新受理的一审案件，借贷行为发生在 2019-08-20 之前的，2020-08-19 前利息参照原司法解释（24%/36% 区间）分段核定，2020-08-20 起按起诉时一年期 LPR 四倍核定上限，请结合立案受理日人工分段复核。`,
    };
  }

  const coverage = checkLprDateCoverage(contractDateIso, contractDateIso, LPR_VERIFIED_THROUGH);
  const snap = lookupLprOn(contractDateIso, '1y');
  const capRate = Number((snap.rate * 4).toFixed(2));
  const transitionalNote =
    contractDateIso < '2020-08-20'
      ? '注：合同成立于 2019-08-20 至 2020-08-19 过渡期内，新收一审案件对 2020-08-20 前后分段标准及起诉时 4 倍 LPR 适用请结合《民间借贷司法解释》第 31 条复核。'
      : '';

  if (coverage.staleEnd) {
    return {
      enabled: true,
      status: 'needs_manual_review',
      contractDate: contractDateIso,
      quoteDate: snap.effectiveDate,
      baseRate1y: snap.rate,
      capRate,
      testedRate: testedAnnualRate,
      transitionalNote,
      message: `合同成立日（${contractDateIso}）超出本箱已核验的央行 LPR 报价窗口（截至 ${LPR_VERIFIED_THROUGH}），当前仅能参考最近一期已核验报价（${snap.rate.toFixed(2)}% × 4 = ${capRate.toFixed(2)}%），提交前请核对合同成立当月 20 日央行正式报价。`,
    };
  }

  const exceeds = testedAnnualRate > capRate + 1e-9;
  const baseDesc = `按借款合同成立日（${contractDateIso}）当期 1 年期 LPR ${snap.rate.toFixed(2)}%（${snap.effectiveDate} 央行公布报价）计算，4 倍司法保护上限为 ${capRate.toFixed(2)}%`;

  return {
    enabled: true,
    status: exceeds ? 'exceeds_cap' : 'within_cap',
    contractDate: contractDateIso,
    quoteDate: snap.effectiveDate,
    baseRate1y: snap.rate,
    capRate,
    testedRate: testedAnnualRate,
    transitionalNote,
    message: exceeds
      ? `${baseDesc}；当前测算年利率（${testedAnnualRate.toFixed(2)}%）高于该上限，民间借贷超出 4 倍部分通常不获司法支持。${transitionalNote ? ` ${transitionalNote}` : ''}`
      : `${baseDesc}；当前测算年利率（${testedAnnualRate.toFixed(2)}%）未超出该上限。${transitionalNote ? ` ${transitionalNote}` : ''}`,
  };
}
