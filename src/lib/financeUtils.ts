/**
 * 1. Court-standard Chinese RMB Uppercase Converter
 * Strictly adheres to PBOC《支付结算办法》附一《正确填写票据和结算凭证的基本规定》
 */
const CN_NUMS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const CN_INT_RADICE = ['', '拾', '佰', '仟'];
const CN_INT_UNITS = ['', '万', '亿', '兆'];

export function toLegalRmbUppercase(amount: number | string): string {
  const num = typeof amount === 'string' ? Number(amount.replace(/,/g, '').trim()) : amount;
  if (!Number.isFinite(num)) return '金额输入无效';
  if (Math.abs(num) >= 1e15) return '超出最大支持位数（千万亿）';

  const isNegative = num < 0;
  const absCents = Math.round(Math.abs(num) * 100);
  if (absCents === 0) return '人民币零元整';

  const integerNum = Math.floor(absCents / 100);
  const jiao = Math.floor((absCents % 100) / 10);
  const fen = absCents % 10;

  let chineseStr = '';
  if (integerNum > 0) {
    const intStr = String(integerNum);
    let zeroCount = 0;
    const intLen = intStr.length;
    for (let i = 0; i < intLen; i++) {
      const n = Number(intStr[i]);
      const p = intLen - i - 1;
      const q = Math.floor(p / 4);
      const m = p % 4;
      if (n === 0) {
        zeroCount++;
      } else {
        if (zeroCount > 0) {
          chineseStr += CN_NUMS[0];
        }
        zeroCount = 0;
        chineseStr += CN_NUMS[n] + CN_INT_RADICE[m];
      }
      if (m === 0 && zeroCount < 4) {
        chineseStr += CN_INT_UNITS[q];
      }
    }
    chineseStr += '元';
  }

  if (jiao === 0 && fen === 0) {
    chineseStr += '整';
  } else {
    if (jiao > 0) {
      chineseStr += CN_NUMS[jiao] + '角';
    } else if (integerNum > 0 && fen > 0) {
      chineseStr += '零';
    }
    if (fen > 0) {
      chineseStr += CN_NUMS[fen] + '分';
    }
  }

  return `人民币${isNegative ? '负' : ''}${chineseStr}`;
}

/**
 * 2. 《民法典》第 561 条债之冲抵计算引擎（先费用 → 后利息 → 再本金）
 */
export interface RepaymentRow {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  expenseAdded?: number; // New realization expense incurred on/before this date
}

export interface OffsetPeriodBreakdown {
  index: number;
  fromDate: string;
  payDate: string;
  days: number;
  principalBefore: number;
  periodInterest: number;
  totalInterestAvailable: number;
  expenseAvailable: number;
  paymentAmount: number;
  paidToExpense: number;
  paidToInterest: number;
  paidToPrincipal: number;
  principalAfter: number;
  unpaidInterestAfter: number;
  unpaidExpenseAfter: number;
}

export interface Art561OffsetResult {
  rows: OffsetPeriodBreakdown[];
  finalPrincipal: number;
  finalUnpaidInterest: number;
  finalUnpaidExpense: number;
  totalGrandRemaining: number;
  totalPaid: number;
}

function diffDaysYmd(a: string, b: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0;
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 0;
  return Math.max(0, Math.round((t2 - t1) / 86400000));
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function calculateArt561Offset(params: {
  initialPrincipal: number;
  initialExpense?: number;
  startDate: string; // Interest accrual start date YYYY-MM-DD
  annualRatePercent: number; // e.g. 3.1 or 12.4
  yearBasis?: 360 | 365;
  repayments: RepaymentRow[];
  settleDate?: string; // Optional final calculation cutoff date
}): Art561OffsetResult {
  const basis = params.yearBasis || 365;
  const dailyRate = params.annualRatePercent / 100 / basis;

  let principal = round2(Math.max(0, params.initialPrincipal));
  let unpaidInterest = 0;
  let unpaidExpense = round2(Math.max(0, params.initialExpense || 0));
  let cursorDate = params.startDate;
  let totalPaid = 0;

  const sorted = [...params.repayments]
    .filter((r) => r.date && r.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const rows: OffsetPeriodBreakdown[] = [];

  sorted.forEach((rep, idx) => {
    const days = diffDaysYmd(cursorDate, rep.date);
    const periodInterest = round2(principal * dailyRate * days);
    const totalInterestAvailable = round2(unpaidInterest + periodInterest);
    const expenseAvailable = round2(unpaidExpense + (rep.expenseAdded || 0));

    let remainingPay = round2(rep.amount);
    totalPaid = round2(totalPaid + remainingPay);

    // Step 1: Offset realization expenses (实现债权的有关费用)
    const paidToExpense = round2(Math.min(remainingPay, expenseAvailable));
    remainingPay = round2(remainingPay - paidToExpense);
    unpaidExpense = round2(expenseAvailable - paidToExpense);

    // Step 2: Offset accrued interest (利息)
    const paidToInterest = round2(Math.min(remainingPay, totalInterestAvailable));
    remainingPay = round2(remainingPay - paidToInterest);
    unpaidInterest = round2(totalInterestAvailable - paidToInterest);

    // Step 3: Offset principal (主债务本金)
    const paidToPrincipal = round2(Math.min(remainingPay, principal));
    const principalBefore = principal;
    principal = round2(principal - paidToPrincipal);

    if (rep.date > cursorDate) {
      cursorDate = rep.date;
    }

    rows.push({
      index: idx + 1,
      fromDate: idx === 0 ? params.startDate : sorted[idx - 1].date,
      payDate: rep.date,
      days,
      principalBefore,
      periodInterest,
      totalInterestAvailable,
      expenseAvailable,
      paymentAmount: round2(rep.amount),
      paidToExpense,
      paidToInterest,
      paidToPrincipal,
      principalAfter: principal,
      unpaidInterestAfter: unpaidInterest,
      unpaidExpenseAfter: unpaidExpense,
    });
  });

  // Accrue remaining interest from last repayment date to settleDate if provided
  if (params.settleDate && params.settleDate > cursorDate && principal > 0) {
    const tailDays = diffDaysYmd(cursorDate, params.settleDate);
    const tailInterest = round2(principal * dailyRate * tailDays);
    unpaidInterest = round2(unpaidInterest + tailInterest);
  }

  return {
    rows,
    finalPrincipal: principal,
    finalUnpaidInterest: unpaidInterest,
    finalUnpaidExpense: unpaidExpense,
    totalGrandRemaining: round2(principal + unpaidInterest + unpaidExpense),
    totalPaid,
  };
}

/**
 * 3. 律师服务费报价测算与《关于进一步规范律师服务收费的意见》（司发通〔2021〕87号）风险代理合规校验
 */
export type LawyerCaseCategory =
  | 'civil_commercial'
  | 'ip_copyright'
  | 'criminal'
  | 'administrative'
  | 'state_compensation'
  | 'marriage_inheritance'
  | 'social_insurance_min_living'
  | 'mass_litigation';

export type FeeBillingMode = 'tiered_standard' | 'flat_piece' | 'semi_risk' | 'pure_risk';

// 司发通〔2021〕87号严格规定：风险代理各标的额分段最高收费比例上限
const RISK_AGENCY_STATUTORY_CAPS = [
  { max: 1_000_000, capRate: 0.18, label: '不超过 100 万元部分（法定上限 18%）' },
  { max: 5_000_000, capRate: 0.15, label: '100 万 – 500 万元部分（法定上限 15%）' },
  { max: 10_000_000, capRate: 0.12, label: '500 万 – 1,000 万元部分（法定上限 12%）' },
  { max: 50_000_000, capRate: 0.09, label: '1,000 万 – 5,000 万元部分（法定上限 9%）' },
  { max: Infinity, capRate: 0.06, label: '超过 5,000 万元部分（法定上限 6%）' },
];

// 浙江民商事/知产市场常用分段参考比例（可调系数）
const ZJ_MARKET_TIERS = [
  { max: 100_000, rate: 0.08, minFlat: 6000, label: '10 万元以下部分（参考 8%，起步 6,000 元）' },
  { max: 500_000, rate: 0.06, label: '10 万 – 50 万元部分（参考 6%）' },
  { max: 1_000_000, rate: 0.05, label: '50 万 – 100 万元部分（参考 5%）' },
  { max: 5_000_000, rate: 0.04, label: '100 万 – 500 万元部分（参考 4%）' },
  { max: 10_000_000, rate: 0.03, label: '500 万 – 1,000 万元部分（参考 3%）' },
  { max: Infinity, rate: 0.02, label: '1,000 万元以上部分（参考 2%）' },
];

export const PROHIBITED_RISK_CATEGORIES: Record<LawyerCaseCategory, string | null> = {
  civil_commercial: null,
  ip_copyright: null,
  criminal: '刑事诉讼案件严禁实行或者变相实行风险代理（司发通〔2021〕87号）',
  administrative: '行政诉讼案件严禁实行或者变相实行风险代理（司发通〔2021〕87号）',
  state_compensation: '国家赔偿案件严禁实行或者变相实行风险代理（司发通〔2021〕87号）',
  mass_litigation: '群体性诉讼案件严禁实行或者变相实行风险代理（司发通〔2021〕87号）',
  marriage_inheritance: '婚姻、继承案件严禁实行风险代理（相关收费管理办法禁止红线）',
  social_insurance_min_living: '请求给予社会保险待遇、最低生活保障待遇、赡养费、抚养费、扶养费、抚恤金、救济金、工伤赔偿或请求支付劳动报酬案件，禁止风险代理',
};

export function calcStatutoryRiskAgencyCap(amount: number): {
  maxAllowedFee: number;
  breakdown: { label: string; sliceAmount: number; maxSliceFee: number }[];
} {
  let prev = 0;
  let totalMax = 0;
  const breakdown: { label: string; sliceAmount: number; maxSliceFee: number }[] = [];

  for (const tier of RISK_AGENCY_STATUTORY_CAPS) {
    if (amount <= prev) break;
    const upper = Math.min(amount, tier.max);
    const slice = round2(upper - prev);
    const fee = round2(slice * tier.capRate);
    totalMax = round2(totalMax + fee);
    breakdown.push({ label: tier.label, sliceAmount: slice, maxSliceFee: fee });
    prev = tier.max;
  }

  return { maxAllowedFee: totalMax, breakdown };
}

export function calcZhejiangReferenceLawyerFee(amount: number, multiplier = 1): number {
  if (amount <= 0) return round2(6000 * multiplier);
  let prev = 0;
  let fee = 0;
  for (const tier of ZJ_MARKET_TIERS) {
    if (amount <= prev) break;
    const upper = Math.min(amount, tier.max);
    const slice = upper - prev;
    if (prev === 0) {
      fee += Math.max(tier.minFlat || 6000, slice * tier.rate);
    } else {
      fee += slice * tier.rate;
    }
    prev = tier.max;
  }
  return round2(fee * multiplier);
}
