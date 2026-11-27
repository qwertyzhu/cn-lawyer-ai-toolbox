/**
 * Unified Chinese Legal Calendar & Statutory Period Engine.
 *
 * Covers:
 * - State Council official holidays & adjusted weekend workdays for 2025–2027
 *   (including 国办发明电〔2026〕10号 for 2027).
 * - Strict ISO YYYY-MM-DD validation (never silently falls back to 2026-01-01 on empty/invalid input).
 * - Civil Code Art. 201–203 & Civil Procedure Law Art. 85 period computation:
 *   - Leap-day safe month/year clamping (e.g. 2024-02-29 + 24m -> 2026-02-28, never 2026-03-01).
 *   - Explicit procedure rollover modes:
 *     - 'civil_statutory': rolls over statutory holidays & weekends to the first workday.
 *     - 'preservation_freeze': court asset freeze/seizure expiry does NOT roll over past holidays;
 *       start day counts inclusive (e.g. 2026-03-10 + 12m -> 2027-03-09) and flags holiday overlap.
 *     - 'criminal_detention': Criminal Procedure Law Art. 91 (30d + 7d), no civil holiday rollover.
 * - Full-span workday interval calculation without silent 4,000-day truncation.
 */

import {
  CN_HOLIDAY_COVERED_MAX_YEAR,
  CN_HOLIDAY_COVERED_MIN_YEAR,
  isDateOutsideHolidayCoverage,
} from '../data/legalDataManifest.ts';

export type DeadlineRolloverMode =
  | 'civil_statutory'
  | 'preservation_freeze'
  | 'criminal_detention';

export const CN_HOLIDAYS: Record<string, string> = {
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
  // 2027（国办发明电〔2026〕10号《国务院办公厅关于2027年部分节假日安排的通知》）
  '2027-01-01': '元旦',
  '2027-01-02': '元旦',
  '2027-01-03': '元旦',
  '2027-02-05': '春节（除夕）',
  '2027-02-06': '春节',
  '2027-02-07': '春节',
  '2027-02-08': '春节',
  '2027-02-09': '春节',
  '2027-02-10': '春节',
  '2027-02-11': '春节',
  '2027-02-12': '春节',
  '2027-02-13': '春节',
  '2027-04-03': '清明节',
  '2027-04-04': '清明节',
  '2027-04-05': '清明节',
  '2027-05-01': '劳动节',
  '2027-05-02': '劳动节',
  '2027-05-03': '劳动节',
  '2027-05-04': '劳动节',
  '2027-05-05': '劳动节',
  '2027-06-09': '端午节',
  '2027-09-15': '中秋节',
  '2027-10-01': '国庆节',
  '2027-10-02': '国庆节',
  '2027-10-03': '国庆节',
  '2027-10-04': '国庆节',
  '2027-10-05': '国庆节',
  '2027-10-06': '国庆节',
  '2027-10-07': '国庆节',
};

export const CN_ADJUSTED_WORKDAYS = new Set<string>([
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
  // 2027（国办发明电〔2026〕10号）
  '2027-01-31',
  '2027-02-14',
  '2027-05-08',
  '2027-09-26',
  '2027-10-09',
]);

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export function getTodayChinaYmd(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function isValidIsoYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || '').trim())) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseStrictYmdUtc(ymd: string): Date | null {
  if (!isValidIsoYmd(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatUtcToYmd(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getWeekdayLabelYmd(ymd: string): string {
  const dt = parseStrictYmdUtc(ymd);
  if (!dt) return '';
  return WEEKDAYS[dt.getUTCDay()];
}

export function formatCnYmd(ymd: string): string {
  if (!isValidIsoYmd(ymd)) return '待输入有效日期';
  return `${ymd}（${getWeekdayLabelYmd(ymd)}）`;
}

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const dt = parseStrictYmdUtc(ymd);
  if (!dt) return '';
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return formatUtcToYmd(dt);
}

export function diffDaysYmd(fromYmd: string, toYmd: string): number {
  const a = parseStrictYmdUtc(fromYmd);
  const b = parseStrictYmdUtc(toYmd);
  if (!a || !b) return Number.NaN;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function getDaysInMonthUtc(year: number, monthIndexZero: number): number {
  return new Date(Date.UTC(year, monthIndexZero + 1, 0)).getUTCDate();
}

export function addMonthsLegalYmd(
  startYmd: string,
  months: number,
  inclusiveStartDay = false
): string {
  const dt = parseStrictYmdUtc(startYmd);
  if (!dt) return '';
  const origY = dt.getUTCFullYear();
  const origM = dt.getUTCMonth();
  const origD = dt.getUTCDate();

  const totalMonths = origY * 12 + origM + months;
  const targetY = Math.floor(totalMonths / 12);
  const targetM = ((totalMonths % 12) + 12) % 12;
  const maxD = getDaysInMonthUtc(targetY, targetM);
  const clampedD = Math.min(origD, maxD);

  const out = new Date(Date.UTC(targetY, targetM, clampedD));
  if (inclusiveStartDay && origD <= maxD) {
    out.setUTCDate(out.getUTCDate() - 1);
  }
  return formatUtcToYmd(out);
}

export function isRestDayYmd(ymd: string): { rest: boolean; reason: string } {
  if (!isValidIsoYmd(ymd)) return { rest: false, reason: '未知日期' };
  if (CN_HOLIDAYS[ymd]) return { rest: true, reason: `法定节假日（${CN_HOLIDAYS[ymd]}）` };
  if (CN_ADJUSTED_WORKDAYS.has(ymd)) return { rest: false, reason: '法定调休工作日' };
  const dt = parseStrictYmdUtc(ymd)!;
  const wd = dt.getUTCDay();
  if (wd === 0 || wd === 6) {
    return { rest: true, reason: wd === 6 ? '周六公休日' : '周日公休日' };
  }
  return { rest: false, reason: '正常工作日' };
}

export function extendPastRestDaysYmd(ymd: string): {
  finalYmd: string;
  extended: boolean;
  reasons: string[];
} {
  if (!isValidIsoYmd(ymd)) {
    return { finalYmd: '', extended: false, reasons: [] };
  }
  let cur = ymd;
  const reasons: string[] = [];
  let guard = 0;
  while (guard < 25) {
    const check = isRestDayYmd(cur);
    if (!check.rest) break;
    reasons.push(`${cur} ${check.reason}`);
    cur = addDaysYmd(cur, 1);
    guard++;
  }
  return { finalYmd: cur, extended: reasons.length > 0, reasons };
}

export interface ComputedLegalDeadline {
  valid: true;
  startYmd: string;
  countStartYmd: string;
  rawEndYmd: string;
  finalEndYmd: string;
  warnYmd: string;
  extended: boolean;
  reasons: string[];
  rolloverMode: DeadlineRolloverMode;
  outsideHolidayCoverage: boolean;
  hasDateConflict?: boolean;
  verificationStatus:
    | 'exact'
    | 'manual_override'
    | 'pending_holiday_schedule'
    | 'conflict_invalid';
  holidayWarningText: string;
  day30Ymd?: string;
}

export function computeLegalDeadline(params: {
  startYmd: string;
  months?: number;
  years?: number;
  days?: number;
  rolloverMode: DeadlineRolloverMode;
  warnDaysBefore?: number;
  manualDueYmd?: string;
}): ComputedLegalDeadline | null {
  const {
    startYmd,
    months,
    years,
    days,
    rolloverMode,
    warnDaysBefore = 3,
    manualDueYmd,
  } = params;

  if (!isValidIsoYmd(startYmd)) return null;

  const countStartYmd =
    rolloverMode === 'preservation_freeze' ? startYmd : addDaysYmd(startYmd, 1);

  if (manualDueYmd !== undefined && manualDueYmd.trim() !== '') {
    const cleanManual = manualDueYmd.trim();
    if (!isValidIsoYmd(cleanManual)) return null;
    const warnYmd = addDaysYmd(cleanManual, -warnDaysBefore);
    if (cleanManual < startYmd) {
      return {
        valid: true,
        startYmd,
        countStartYmd,
        rawEndYmd: cleanManual,
        finalEndYmd: cleanManual,
        warnYmd,
        extended: false,
        reasons: [],
        rolloverMode,
        outsideHolidayCoverage: false,
        hasDateConflict: true,
        verificationStatus: 'conflict_invalid',
        holidayWarningText: `日期倒挂冲突：手输文书届满日（${cleanManual}）早于采取措施/送达起算日（${startYmd}），请核对送达回证与裁定书载明日期后再加入看板！`,
      };
    }
    return {
      valid: true,
      startYmd,
      countStartYmd,
      rawEndYmd: cleanManual,
      finalEndYmd: cleanManual,
      warnYmd,
      extended: false,
      reasons: [],
      rolloverMode,
      outsideHolidayCoverage: false,
      hasDateConflict: false,
      verificationStatus: 'manual_override',
      holidayWarningText: '按手动录入的文书载明届满日为准',
    };
  }

  if (rolloverMode === 'criminal_detention') {
    const day30Ymd = addDaysYmd(startYmd, 30);
    const day37Ymd = addDaysYmd(startYmd, 37);
    return {
      valid: true,
      startYmd,
      countStartYmd,
      rawEndYmd: day37Ymd,
      finalEndYmd: day37Ymd,
      warnYmd: addDaysYmd(day30Ymd, -warnDaysBefore),
      extended: false,
      reasons: [],
      rolloverMode,
      outsideHolidayCoverage: false,
      verificationStatus: 'exact',
      holidayWarningText: '',
      day30Ymd,
    };
  }

  const totalMonths = (years ? years * 12 : 0) + (months || 0);
  let rawEndYmd = startYmd;
  if (totalMonths > 0) {
    rawEndYmd = addMonthsLegalYmd(
      startYmd,
      totalMonths,
      rolloverMode === 'preservation_freeze'
    );
  }
  if (days && days > 0) {
    rawEndYmd = addDaysYmd(rawEndYmd, days);
  }

  if (rolloverMode === 'preservation_freeze') {
    const restCheck = isRestDayYmd(rawEndYmd);
    const outside = isDateOutsideHolidayCoverage(rawEndYmd);
    const warnYmd = addDaysYmd(rawEndYmd, -warnDaysBefore);
    let holidayWarningText = '';
    if (restCheck.rest) {
      holidayWarningText = `注意：保全查封/冻结期限届满日（${rawEndYmd}）恰逢${restCheck.reason}，法院系统通常在届满当日自动解封/解冻、不适用民事期间顺延，请务必在节前提前提交续封申请！`;
    } else if (outside) {
      holidayWarningText = `提示：保全届满日（${rawEndYmd}）超出已发布 ${CN_HOLIDAY_COVERED_MIN_YEAR}–${CN_HOLIDAY_COVERED_MAX_YEAR} 年节假日表，法院保全到期不顺延，请提前 30 日提交续封申请。`;
    }
    return {
      valid: true,
      startYmd,
      countStartYmd,
      rawEndYmd,
      finalEndYmd: rawEndYmd,
      warnYmd,
      extended: false,
      reasons: restCheck.rest ? [`${rawEndYmd} ${restCheck.reason}（保全到期不顺延）`] : [],
      rolloverMode,
      outsideHolidayCoverage: outside,
      verificationStatus: 'exact',
      holidayWarningText,
    };
  }

  const ext = extendPastRestDaysYmd(rawEndYmd);
  const outside =
    isDateOutsideHolidayCoverage(rawEndYmd) || isDateOutsideHolidayCoverage(ext.finalYmd);
  const warnYmd = addDaysYmd(ext.finalYmd, -warnDaysBefore);

  return {
    valid: true,
    startYmd,
    countStartYmd,
    rawEndYmd,
    finalEndYmd: ext.finalYmd,
    warnYmd,
    extended: ext.extended,
    reasons: ext.reasons,
    rolloverMode,
    outsideHolidayCoverage: outside,
    verificationStatus: outside ? 'pending_holiday_schedule' : 'exact',
    holidayWarningText: outside
      ? `【待核验提醒】推算届满日（${ext.finalYmd}）超出本工具已收录的 ${CN_HOLIDAY_COVERED_MIN_YEAR}–${CN_HOLIDAY_COVERED_MAX_YEAR} 年国务院放假调休表，当前仅按常规周六/周日推算，登记前请务必核对国务院当年正式放假通知及法院文书！`
      : '',
  };
}

export interface WorkdayIntervalSummary {
  valid: true;
  signedDays: number;
  absDays: number;
  inclusiveTotalDays: number;
  weeks: number;
  remDays: number;
  workdays: number;
  weekendOrHoliday: number;
  holidaysHit: string[];
  adjustedHit: string[];
  outsideHolidayCoverage: boolean;
  exceededMaxRange: boolean;
}

const MAX_WORKDAY_SPAN_DAYS = 73_050;

export function calculateWorkdayInterval(
  startYmd: string,
  endYmd: string
): WorkdayIntervalSummary | null {
  const signedDays = diffDaysYmd(startYmd, endYmd);
  if (!Number.isFinite(signedDays)) return null;

  const absDays = Math.abs(signedDays);
  const inclusiveTotalDays = absDays + 1;
  const fromYmd = signedDays >= 0 ? startYmd : endYmd;
  const toYmd = signedDays >= 0 ? endYmd : startYmd;
  const outside =
    isDateOutsideHolidayCoverage(fromYmd) || isDateOutsideHolidayCoverage(toYmd);

  if (absDays > MAX_WORKDAY_SPAN_DAYS) {
    return {
      valid: true,
      signedDays,
      absDays,
      inclusiveTotalDays,
      weeks: Math.floor(absDays / 7),
      remDays: absDays % 7,
      workdays: 0,
      weekendOrHoliday: 0,
      holidaysHit: [],
      adjustedHit: [],
      outsideHolidayCoverage: true,
      exceededMaxRange: true,
    };
  }

  let workdays = 0;
  let weekendOrHoliday = 0;
  const holidaysHit: string[] = [];
  const adjustedHit: string[] = [];

  const cur = parseStrictYmdUtc(fromYmd)!;
  const endMs = parseStrictYmdUtc(toYmd)!.getTime();

  while (cur.getTime() <= endMs) {
    const iso = formatUtcToYmd(cur);
    if (CN_HOLIDAYS[iso]) {
      weekendOrHoliday++;
      if (holidaysHit.length < 24) {
        holidaysHit.push(`${iso.slice(0, 10)} ${CN_HOLIDAYS[iso]}`);
      }
    } else if (CN_ADJUSTED_WORKDAYS.has(iso)) {
      workdays++;
      if (adjustedHit.length < 24) {
        adjustedHit.push(iso);
      }
    } else {
      const wd = cur.getUTCDay();
      if (wd === 0 || wd === 6) weekendOrHoliday++;
      else workdays++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return {
    valid: true,
    signedDays,
    absDays,
    inclusiveTotalDays,
    weeks: Math.floor(absDays / 7),
    remDays: absDays % 7,
    workdays,
    weekendOrHoliday,
    holidaysHit,
    adjustedHit,
    outsideHolidayCoverage: outside,
    exceededMaxRange: false,
  };
}
