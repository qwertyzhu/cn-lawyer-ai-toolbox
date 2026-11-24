/**
 * Centralized legal & financial reference dataset provenance manifest (L-1).
 * Tracks exact source, effective/verified date, and next review date for every built-in dataset
 * so calculators can explicitly warn lawyers whenever inputs exceed verified coverage windows.
 */

export interface LegalDatasetMeta {
  id: string;
  name: string;
  asOf: string; // YYYY-MM-DD (data content effective/verified date, distinct from build date)
  source: string;
  nextReviewDate: string; // YYYY-MM-DD
  notes?: string;
}

export const AI_LEGAL_DISCLAIMER =
  '以下内容由 AI 生成，引用的法条和案例须经承办律师核对原文后方可使用。';

export const CN_HOLIDAY_COVERED_MIN_YEAR = 2025;
export const CN_HOLIDAY_COVERED_MAX_YEAR = 2026;
export const LPR_VERIFIED_THROUGH = '2026-11-20';
export const LPR_START_DATE = '2019-08-20';
export const LPR_STALE_THRESHOLD_DAYS = 35;

export const LEGAL_DATA_MANIFEST: Record<string, LegalDatasetMeta> = {
  lprHistory: {
    id: 'lpr-history',
    name: '央行 LPR 贷款市场报价利率表',
    asOf: LPR_VERIFIED_THROUGH,
    source: '中国人民银行 / 全国银行间同业拆借中心（每月 20 日公布）',
    nextReviewDate: '2026-12-20',
    notes: '最近一次调息为 2025-05-20（1年期 3.00% / 5年期以上 3.50%），已核验至 2026-11-20 报价无变动。',
  },
  cnHolidays: {
    id: 'cn-holidays',
    name: '中国法定节假日与国务院调休安排表',
    asOf: '2026-12-31',
    source: '国务院办公厅年度部分节假日安排通知',
    nextReviewDate: '2026-12-01',
    notes: `内置覆盖 ${CN_HOLIDAY_COVERED_MIN_YEAR}–${CN_HOLIDAY_COVERED_MAX_YEAR} 年度；跨出该年度范围将触发显著提示。`,
  },
  lawsOffline: {
    id: 'laws-offline',
    name: '离线核心法典与司法解释语料库',
    asOf: '2026-11-24',
    source: '国家法律法规数据库 / 最高人民法院司法解释公开文本',
    nextReviewDate: '2027-01-01',
  },
  litigationFees: {
    id: 'litigation-fees',
    name: '法院诉讼费、保全费与执行费阶梯标准',
    asOf: '2007-04-01',
    source: '国务院《诉讼费用交纳办法》（国务院令第 481 号）',
    nextReviewDate: '2027-01-01',
  },
  laborInjuryDefaults: {
    id: 'labor-injury-defaults',
    name: '劳动争议三倍社平封顶与工伤/人损参考基数',
    asOf: '2026-06-30',
    source: '省级人社/统计部门公开统计公报（支持全国各省市自由编辑覆盖）',
    nextReviewDate: '2027-07-01',
  },
};

function parseYmdUtcMs(iso: string): number {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isDateOutsideHolidayCoverage(isoDate: string): boolean {
  const m = String(isoDate || '').match(/^(\d{4})-/);
  if (!m) return false;
  const year = Number(m[1]);
  return year < CN_HOLIDAY_COVERED_MIN_YEAR || year > CN_HOLIDAY_COVERED_MAX_YEAR;
}

export function checkLprDateCoverage(
  startDateIso: string,
  endDateIso: string,
  verifiedThroughIso = LPR_VERIFIED_THROUGH,
  thresholdDays = LPR_STALE_THRESHOLD_DAYS
): {
  staleEnd: boolean;
  gapDays: number;
  beforeLprReform: boolean;
  verifiedThrough: string;
} {
  const endMs = parseYmdUtcMs(endDateIso);
  const verifiedMs = parseYmdUtcMs(verifiedThroughIso);
  const startMs = parseYmdUtcMs(startDateIso);
  const lprStartMs = parseYmdUtcMs(LPR_START_DATE);

  const gapDays =
    Number.isFinite(endMs) && Number.isFinite(verifiedMs)
      ? Math.round((endMs - verifiedMs) / 86400000)
      : 0;

  return {
    staleEnd: gapDays > thresholdDays,
    gapDays,
    beforeLprReform: Number.isFinite(startMs) && Number.isFinite(lprStartMs) && startMs < lprStartMs,
    verifiedThrough: verifiedThroughIso,
  };
}

export function isDatasetOverdue(datasetId: string, todayIso?: string): boolean {
  const meta = LEGAL_DATA_MANIFEST[datasetId];
  if (!meta) return false;
  const today = todayIso || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  return today > meta.nextReviewDate;
}
