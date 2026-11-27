/**
 * Pure, framework-agnostic statutory calculation engines for:
 * 1. Personal injury / motor traffic accident fault ratio & compulsory insurance caps
 *    (distinguishing 0% fault vs empty input, and Road Traffic Safety Law Art. 76 no-fault compulsory limits).
 * 2. Labor Contract Law Art. 47 severance tenure N-month conversion
 *    (calendar anniversary clamping so 2025-01-31 -> 2025-02-01 is 0.5N, never 0N).
 * 3. State Council《诉讼费用交纳办法》property, preservation, appeal, and execution fee tiers
 *    with independent optional sub-amounts for partial appeals / partial preservation / partial execution.
 */

import {
  addMonthsLegalYmd,
  diffDaysYmd,
  isValidIsoYmd,
} from './legalCalendar.ts';

export function parseFaultPercentage(rawInput: string | number, emptyFallback = 100): number {
  if (typeof rawInput === 'number') {
    return Number.isFinite(rawInput) ? Math.max(0, Math.min(100, rawInput)) : emptyFallback;
  }
  const trimmed = String(rawInput ?? '').trim();
  if (trimmed === '') return emptyFallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return emptyFallback;
  return Math.max(0, Math.min(100, parsed));
}

export interface PersonalInjuryRecoverableResult {
  grossTotal: number;
  faultPct: number;
  faultRatio: number;
  compulsoryMode: 'none' | 'liable_cap' | 'no_fault_cap';
  compulsoryPay: number;
  commercialOrPartyPay: number;
  estimatedRecoverable: number;
}

/**
 * CBIRC 2020-09-19 Motor Compulsory Insurance Limits (《机动车交通事故责任强制保险条款》):
 * - Liable (`faultRatio > 0`): medical 18,000 + disability/death 180,000
 * - No-fault (`faultRatio === 0`, motor vehicle involved): medical 1,800 + disability/death 18,000
 * - Non-motor general tort (`hasCompulsoryIns === false`) at `0%` fault: 0.00 across all items!
 */
export function calculatePersonalInjuryRecoverable(params: {
  medicalCategoryTotal: number;
  disabilityCategoryTotal: number;
  faultPctInput: string | number;
  hasCompulsoryIns: boolean;
  applyNoFaultCompulsory?: boolean;
}): PersonalInjuryRecoverableResult {
  const med = Math.max(0, Number(params.medicalCategoryTotal) || 0);
  const dis = Math.max(0, Number(params.disabilityCategoryTotal) || 0);
  const grossTotal = med + dis;
  const faultPct = parseFaultPercentage(params.faultPctInput, 100);
  const faultRatio = faultPct / 100;
  const applyNoFault = params.applyNoFaultCompulsory !== false;

  if (!params.hasCompulsoryIns) {
    const commercialOrPartyPay = grossTotal * faultRatio;
    return {
      grossTotal,
      faultPct,
      faultRatio,
      compulsoryMode: 'none',
      compulsoryPay: 0,
      commercialOrPartyPay,
      estimatedRecoverable: commercialOrPartyPay,
    };
  }

  if (faultRatio === 0) {
    if (!applyNoFault) {
      return {
        grossTotal,
        faultPct: 0,
        faultRatio: 0,
        compulsoryMode: 'none',
        compulsoryPay: 0,
        commercialOrPartyPay: 0,
        estimatedRecoverable: 0,
      };
    }
    const compMed = Math.min(1800, med);
    const compDis = Math.min(18000, dis);
    const compulsoryPay = compMed + compDis;
    return {
      grossTotal,
      faultPct: 0,
      faultRatio: 0,
      compulsoryMode: 'no_fault_cap',
      compulsoryPay,
      commercialOrPartyPay: 0,
      estimatedRecoverable: compulsoryPay,
    };
  }

  const compMed = Math.min(18000, med);
  const compDis = Math.min(180000, dis);
  const compulsoryPay = compMed + compDis;
  const remainder = Math.max(0, grossTotal - compulsoryPay);
  const commercialOrPartyPay = remainder * faultRatio;

  return {
    grossTotal,
    faultPct,
    faultRatio,
    compulsoryMode: 'liable_cap',
    compulsoryPay,
    commercialOrPartyPay,
    estimatedRecoverable: compulsoryPay + commercialOrPartyPay,
  };
}

export interface LaborSeveranceTenureResult {
  valid: boolean;
  hasDateConflict: boolean;
  fullYears: number;
  remMonths: number;
  remDays: number;
  nMonths: number;
  warningText: string;
}

/**
 *《中华人民共和国劳动合同法》第47条：
 * - 每满一年支付一个月工资；
 * - 六个月以上不满一年的，按一年计算；
 * - 不满六个月的，向劳动者支付半个月工资的经济补偿。
 */
export function calculateLaborSeveranceTenure(
  startYmd: string,
  endYmd: string
): LaborSeveranceTenureResult {
  if (!isValidIsoYmd(startYmd) || !isValidIsoYmd(endYmd)) {
    return {
      valid: false,
      hasDateConflict: false,
      fullYears: 0,
      remMonths: 0,
      remDays: 0,
      nMonths: 0,
      warningText: '请选择有效的入职日期与解除/终止日期',
    };
  }

  if (endYmd < startYmd) {
    return {
      valid: false,
      hasDateConflict: true,
      fullYears: 0,
      remMonths: 0,
      remDays: 0,
      nMonths: 0,
      warningText: `日期倒挂：解除/终止日期（${endYmd}）早于入职日期（${startYmd}），请核对日期先后顺序`,
    };
  }

  let fullYears = 0;
  while (fullYears < 80) {
    const nextAnniversary = addMonthsLegalYmd(startYmd, (fullYears + 1) * 12, false);
    if (!nextAnniversary || nextAnniversary > endYmd) break;
    fullYears += 1;
  }

  let remMonths = 0;
  while (remMonths < 11) {
    const nextMonthMark = addMonthsLegalYmd(startYmd, fullYears * 12 + remMonths + 1, false);
    if (!nextMonthMark || nextMonthMark > endYmd) break;
    remMonths += 1;
  }

  const anchorYmd =
    fullYears === 0 && remMonths === 0
      ? startYmd
      : addMonthsLegalYmd(startYmd, fullYears * 12 + remMonths, false);
  const remDays = Math.max(0, diffDaysYmd(anchorYmd, endYmd));

  let nMonths = 0;
  if (fullYears === 0 && remMonths === 0) {
    // Worked >= 1 day (including cross-month end e.g. 2025-01-31 -> 2025-02-01) and < 1 month -> < 6 months -> 0.5N
    nMonths = 0.5;
  } else if (remMonths === 0 && remDays === 0) {
    nMonths = fullYears;
  } else if (remMonths >= 6) {
    nMonths = fullYears + 1;
  } else {
    nMonths = fullYears + 0.5;
  }

  return {
    valid: true,
    hasDateConflict: false,
    fullYears,
    remMonths,
    remDays,
    nMonths,
    warningText: '',
  };
}

const PROPERTY_TIERS = [
  { max: 10000, rate: 0, flat: 50, label: '不超过 1 万元' },
  { max: 100000, rate: 0.025, label: '1 万 – 10 万元部分 (2.5%)' },
  { max: 200000, rate: 0.02, label: '10 万 – 20 万元部分 (2.0%)' },
  { max: 500000, rate: 0.015, label: '20 万 – 50 万元部分 (1.5%)' },
  { max: 1000000, rate: 0.01, label: '50 万 – 100 万元部分 (1.0%)' },
  { max: 2000000, rate: 0.009, label: '100 万 – 200 万元部分 (0.9%)' },
  { max: 5000000, rate: 0.008, label: '200 万 – 500 万元部分 (0.8%)' },
  { max: 10000000, rate: 0.007, label: '500 万 – 1,000 万元部分 (0.7%)' },
  { max: 20000000, rate: 0.006, label: '1,000 万 – 2,000 万元部分 (0.6%)' },
  { max: Infinity, rate: 0.005, label: '超过 2,000 万元部分 (0.5%)' },
];

export function calcPropertyFee(amount: number): { total: number; steps: string[] } {
  if (amount <= 0) return { total: 50, steps: ['标的额不超过 1 万元：固定 50 元'] };
  const steps: string[] = [];
  let total = 50;
  steps.push('0 – 1 万元部分：50.00 元');
  let prev = 10000;
  for (let i = 1; i < PROPERTY_TIERS.length; i++) {
    const tier = PROPERTY_TIERS[i];
    if (amount <= prev) break;
    const part = Math.min(amount, tier.max) - prev;
    const fee = part * tier.rate;
    total += fee;
    steps.push(
      `${tier.label}：${part.toLocaleString('zh-CN')} × ${(tier.rate * 100).toFixed(1)}% = ${fee.toFixed(2)} 元`
    );
    prev = tier.max;
  }
  return { total, steps };
}

export function calcExecutionFee(amount: number): { total: number; steps: string[] } {
  if (amount <= 0) {
    return { total: 50, steps: ['无执行金额或不超过 1 万元：每件 50 – 500 元（按 50 元起计）'] };
  }
  const steps: string[] = [];
  let total = 50;
  steps.push('0 – 1 万元部分：50.00 元');
  const tiers = [
    { min: 10000, max: 500000, rate: 0.015, label: '1 万 – 50 万元部分 (1.5%)' },
    { min: 500000, max: 5000000, rate: 0.01, label: '50 万 – 500 万元部分 (1.0%)' },
    { min: 5000000, max: 10000000, rate: 0.005, label: '500 万 – 1,000 万元部分 (0.5%)' },
    { min: 10000000, max: Infinity, rate: 0.001, label: '超过 1,000 万元部分 (0.1%)' },
  ];
  for (const t of tiers) {
    if (amount <= t.min) break;
    const part = Math.min(amount, t.max) - t.min;
    const fee = part * t.rate;
    total += fee;
    steps.push(
      `${t.label}：${part.toLocaleString('zh-CN')} × ${(t.rate * 100).toFixed(1)}% = ${fee.toFixed(2)} 元`
    );
  }
  return { total, steps };
}

export function calcPreservationFee(amount: number): { total: number; steps: string[] } {
  if (amount <= 1000) {
    return { total: 30, steps: ['财产数额不超过 1,000 元或不涉及财产数额：30 元'] };
  }
  const steps: string[] = ['0 – 1,000 元部分：30.00 元'];
  let total = 30;
  if (amount > 1000) {
    const p1 = Math.min(amount, 100000) - 1000;
    const f1 = p1 * 0.01;
    total += f1;
    steps.push(`1,000 元 – 10 万元部分 (1%)：${f1.toFixed(2)} 元`);
  }
  if (amount > 100000) {
    const p2 = amount - 100000;
    const f2 = p2 * 0.005;
    total += f2;
    steps.push(`超过 10 万元部分 (0.5%)：${f2.toFixed(2)} 元`);
  }
  if (total > 5000) {
    steps.push(`累计 ${total.toFixed(2)} 元，依法定 5,000 元封顶`);
    total = 5000;
  }
  return { total, steps };
}

export interface LitigationLifecycleSummary {
  firstFull: number;
  firstHalf: number;
  preservation: number;
  preservationBase: number;
  preservationIsCustom: boolean;
  appeal: number;
  appealBase: number;
  appealIsCustom: boolean;
  execution: number;
  executionBase: number;
  executionIsCustom: boolean;
}

export function calculateLitigationLifecycleFees(params: {
  claimAmountYuan: number;
  preservationAmountYuan?: number | null;
  appealAmountYuan?: number | null;
  executionAmountYuan?: number | null;
}): LitigationLifecycleSummary {
  const claim = Math.max(0, Number(params.claimAmountYuan) || 0);
  const firstFull = calcPropertyFee(claim).total;
  const firstHalf = firstFull / 2;

  const hasCustomPres =
    params.preservationAmountYuan !== undefined &&
    params.preservationAmountYuan !== null &&
    Number.isFinite(params.preservationAmountYuan) &&
    params.preservationAmountYuan >= 0;
  const preservationBase = hasCustomPres ? Number(params.preservationAmountYuan) : claim;

  const hasCustomAppeal =
    params.appealAmountYuan !== undefined &&
    params.appealAmountYuan !== null &&
    Number.isFinite(params.appealAmountYuan) &&
    params.appealAmountYuan >= 0;
  const appealBase = hasCustomAppeal ? Number(params.appealAmountYuan) : claim;

  const hasCustomExec =
    params.executionAmountYuan !== undefined &&
    params.executionAmountYuan !== null &&
    Number.isFinite(params.executionAmountYuan) &&
    params.executionAmountYuan >= 0;
  const executionBase = hasCustomExec ? Number(params.executionAmountYuan) : claim;

  return {
    firstFull,
    firstHalf,
    preservation: calcPreservationFee(preservationBase).total,
    preservationBase,
    preservationIsCustom: hasCustomPres,
    appeal: calcPropertyFee(appealBase).total,
    appealBase,
    appealIsCustom: hasCustomAppeal,
    execution: calcExecutionFee(executionBase).total,
    executionBase,
    executionIsCustom: hasCustomExec,
  };
}
