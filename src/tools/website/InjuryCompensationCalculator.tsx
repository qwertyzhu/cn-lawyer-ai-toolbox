import React, { useEffect, useMemo, useState } from 'react';
import { Link } from '../../components/ToolboxBridgeLink';
import {
  ArrowLeft,
  ArrowRight,
  Car,
  Check,
  ChevronDown,
  Copy,
  HardHat,
  Info,
  RotateCcw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { trackEvent } from '../../components/ToolboxBridgeLink';
import { copyToClipboard } from '../../lib/clipboard';
import { ToolQuickRefSection as ToolSeoKnowledgeSection } from '../../components/ToolQuickRefSection';

type MainTab = 'work_injury' | 'personal_injury';
type InjuryGrade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 0; // 0 = death

// Default reference baselines (pre-filled with 2026 Zhejiang & NBS reference figures;
// ALL fields — including region name, 5–10 grade medical/employment exit months, and daily meal/nutrition rates —
// can be freely edited for any province/city and are auto-saved in local browser storage.)
const INJURY_REGION_STORAGE_KEY = 'toolbox_injury_region_config_v1';
const DEFAULT_REGION_NAME = '自定义省市（默认参考浙江2026）';

const DEFAULT_STAT_BASELINES = {
  monthlyAvgWage: 8537,        // 当地上年度职工月均工资参考
  urbanDisposable: 81649,      // 当地城镇常住居民人均可支配收入参考
  urbanConsumption: 53223,     // 当地城镇常住居民人均消费支出参考
  nonPrivateYearWage: 141902,  // 当地非私营单位年平均工资参考（丧葬费 ÷2）
  nationalUrbanIncome: 56502,  // 上年度全国城镇居民人均可支配收入（一次性工亡补助金 ×20，全国统一）
  piHospMealPerDay: 100,       // 人身损害住院伙食补助参考标准（元/天）
  piNutritionPerDay: 50,       // 人身损害营养费参考标准（元/天）
};

// 《工伤保险条例》一次性伤残补助金月数（1-10级，全国统一）
const DISABILITY_LUMP_MONTHS: Record<number, number> = {
  1: 27, 2: 25, 3: 23, 4: 21, 5: 18, 6: 16, 7: 13, 8: 11, 9: 9, 10: 7,
};

// 1-4级按月伤残津贴比例（全国统一）
const MONTHLY_ALLOWANCE_RATIO: Record<number, number> = {
  1: 0.9, 2: 0.85, 3: 0.8, 4: 0.75,
};

// 5-10级「一次性工伤医疗补助金」与「一次性伤残就业补助金」月数（全国各省规定不同，支持分项独立修改！）
const EXIT_GRADES = [5, 6, 7, 8, 9, 10] as const;
type ExitMonthsMap = Record<number, number>;

const DEFAULT_MED_EXIT_MONTHS: ExitMonthsMap = {
  5: 30, 6: 25, 7: 10, 8: 7, 9: 4, 10: 2,
};

const DEFAULT_EMP_EXIT_MONTHS: ExitMonthsMap = {
  5: 30, 6: 25, 7: 10, 8: 7, 9: 4, 10: 2,
};

interface SavedInjuryRegionConfig {
  regionName: string;
  monthlyAvgWage: string;
  urbanDisposable: string;
  urbanConsumption: string;
  nonPrivateYearWage: string;
  nationalUrbanIncome: string;
  piHospMealPerDay: string;
  piNutritionPerDay: string;
  medExitMonths: ExitMonthsMap;
  empExitMonths: ExitMonthsMap;
  applyRetireReduction: boolean;
}

function getDefaultInjuryRegionConfig(): SavedInjuryRegionConfig {
  return {
    regionName: DEFAULT_REGION_NAME,
    monthlyAvgWage: String(DEFAULT_STAT_BASELINES.monthlyAvgWage),
    urbanDisposable: String(DEFAULT_STAT_BASELINES.urbanDisposable),
    urbanConsumption: String(DEFAULT_STAT_BASELINES.urbanConsumption),
    nonPrivateYearWage: String(DEFAULT_STAT_BASELINES.nonPrivateYearWage),
    nationalUrbanIncome: String(DEFAULT_STAT_BASELINES.nationalUrbanIncome),
    piHospMealPerDay: String(DEFAULT_STAT_BASELINES.piHospMealPerDay),
    piNutritionPerDay: String(DEFAULT_STAT_BASELINES.piNutritionPerDay),
    medExitMonths: { ...DEFAULT_MED_EXIT_MONTHS },
    empExitMonths: { ...DEFAULT_EMP_EXIT_MONTHS },
    applyRetireReduction: true,
  };
}

function loadSavedInjuryRegionConfig(): SavedInjuryRegionConfig {
  const def = getDefaultInjuryRegionConfig();
  try {
    const raw = localStorage.getItem(INJURY_REGION_STORAGE_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw);
    const mergeMonths = (src: unknown, fallback: ExitMonthsMap): ExitMonthsMap => {
      const out: ExitMonthsMap = { ...fallback };
      if (src && typeof src === 'object') {
        for (const g of EXIT_GRADES) {
          const val = Number((src as Record<string, unknown>)[String(g)]);
          if (Number.isFinite(val) && val >= 0) out[g] = val;
        }
      }
      return out;
    };
    return {
      regionName: typeof p.regionName === 'string' && p.regionName.trim() ? p.regionName : def.regionName,
      monthlyAvgWage: typeof p.monthlyAvgWage === 'string' && p.monthlyAvgWage.trim() ? p.monthlyAvgWage : def.monthlyAvgWage,
      urbanDisposable: typeof p.urbanDisposable === 'string' && p.urbanDisposable.trim() ? p.urbanDisposable : def.urbanDisposable,
      urbanConsumption: typeof p.urbanConsumption === 'string' && p.urbanConsumption.trim() ? p.urbanConsumption : def.urbanConsumption,
      nonPrivateYearWage: typeof p.nonPrivateYearWage === 'string' && p.nonPrivateYearWage.trim() ? p.nonPrivateYearWage : def.nonPrivateYearWage,
      nationalUrbanIncome: typeof p.nationalUrbanIncome === 'string' && p.nationalUrbanIncome.trim() ? p.nationalUrbanIncome : def.nationalUrbanIncome,
      piHospMealPerDay: typeof p.piHospMealPerDay === 'string' && p.piHospMealPerDay.trim() ? p.piHospMealPerDay : def.piHospMealPerDay,
      piNutritionPerDay: typeof p.piNutritionPerDay === 'string' && p.piNutritionPerDay.trim() ? p.piNutritionPerDay : def.piNutritionPerDay,
      medExitMonths: mergeMonths(p.medExitMonths, def.medExitMonths),
      empExitMonths: mergeMonths(p.empExitMonths, def.empExitMonths),
      applyRetireReduction: typeof p.applyRetireReduction === 'boolean' ? p.applyRetireReduction : true,
    };
  } catch {
    return def;
  }
}

// 精神损害抚慰金常见实务参考区间（仅作初始参考，可直接修改，最终由法院酌定）
const MENTAL_DAMAGE_REF: Record<number, number> = {
  0: 50000, 1: 50000, 2: 45000, 3: 40000, 4: 35000, 5: 30000, 6: 25000, 7: 20000, 8: 15000, 9: 10000, 10: 5000,
};

const GRADE_OPTIONS: { value: InjuryGrade; label: string }[] = [
  { value: 10, label: '十级伤残（系数 10%）' },
  { value: 9, label: '九级伤残（系数 20%）' },
  { value: 8, label: '八级伤残（系数 30%）' },
  { value: 7, label: '七级伤残（系数 40%）' },
  { value: 6, label: '六级伤残（系数 50%）' },
  { value: 5, label: '五级伤残（系数 60%）' },
  { value: 4, label: '四级伤残（系数 70%）' },
  { value: 3, label: '三级伤残（系数 80%）' },
  { value: 2, label: '二级伤残（系数 90%）' },
  { value: 1, label: '一级伤残（系数 100%）' },
  { value: 0, label: '因工死亡 / 交通事故死亡' },
];

const fmtYuan = (n: number) =>
  `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const InjuryCompensationCalculator: React.FC = () => {
  const initialCfg = useMemo(() => loadSavedInjuryRegionConfig(), []);
  const [tab, setTab] = useState<MainTab>('work_injury');
  const [showBaselines, setShowBaselines] = useState(false);
  const [copied, setCopied] = useState(false);

  // Editable & locally persisted provincial/city statistical baselines + 5-10 exit month tables
  const [regionName, setRegionName] = useState(initialCfg.regionName);
  const [localMonthlyAvg, setLocalMonthlyAvg] = useState(initialCfg.monthlyAvgWage);
  const [localUrbanInc, setLocalUrbanInc] = useState(initialCfg.urbanDisposable);
  const [localUrbanExp, setLocalUrbanExp] = useState(initialCfg.urbanConsumption);
  const [localNonPrivYear, setLocalNonPrivYear] = useState(initialCfg.nonPrivateYearWage);
  const [natUrbanInc, setNatUrbanInc] = useState(initialCfg.nationalUrbanIncome);
  const [piHospMealPerDay, setPiHospMealPerDay] = useState(initialCfg.piHospMealPerDay);
  const [piNutritionPerDay, setPiNutritionPerDay] = useState(initialCfg.piNutritionPerDay);
  const [medExitMonths, setMedExitMonths] = useState<ExitMonthsMap>(initialCfg.medExitMonths);
  const [empExitMonths, setEmpExitMonths] = useState<ExitMonthsMap>(initialCfg.empExitMonths);
  const [applyRetireReduction, setApplyRetireReduction] = useState<boolean>(initialCfg.applyRetireReduction);

  useEffect(() => {
    try {
      const payload: SavedInjuryRegionConfig = {
        regionName: regionName.trim() || DEFAULT_REGION_NAME,
        monthlyAvgWage: localMonthlyAvg,
        urbanDisposable: localUrbanInc,
        urbanConsumption: localUrbanExp,
        nonPrivateYearWage: localNonPrivYear,
        nationalUrbanIncome: natUrbanInc,
        piHospMealPerDay,
        piNutritionPerDay,
        medExitMonths,
        empExitMonths,
        applyRetireReduction,
      };
      localStorage.setItem(INJURY_REGION_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage quota error
    }
  }, [
    regionName,
    localMonthlyAvg,
    localUrbanInc,
    localUrbanExp,
    localNonPrivYear,
    natUrbanInc,
    piHospMealPerDay,
    piNutritionPerDay,
    medExitMonths,
    empExitMonths,
    applyRetireReduction,
  ]);

  const activeRegionLabel = regionName.trim() || DEFAULT_REGION_NAME;

  // Tab 1: Work Injury state
  const [wiGrade, setWiGrade] = useState<InjuryGrade>(10);
  const [wiSalary, setWiSalary] = useState('8500');
  const [wiInsured, setWiInsured] = useState(true);
  const [wiTerminate, setWiTerminate] = useState(true);
  const [wiYearsToRetire, setWiYearsToRetire] = useState('10');
  const [wiLeaveMonths, setWiLeaveMonths] = useState('3');
  const [wiHospDays, setWiHospDays] = useState('15');
  const [wiMealPerDay, setWiMealPerDay] = useState('30');
  const [wiNurseFee, setWiNurseFee] = useState('3000');

  // Tab 2: Personal Injury / Traffic Accident state
  const [piGrade, setPiGrade] = useState<InjuryGrade>(10);
  const [piAge, setPiAge] = useState('38');
  const [piMedicalFee, setPiMedicalFee] = useState('30000');
  const [piLostDays, setPiLostDays] = useState('90');
  const [piDailyIncome, setPiDailyIncome] = useState('280');
  const [piNurseDays, setPiNurseDays] = useState('30');
  const [piNursePerDay, setPiNursePerDay] = useState('220');
  const [piHospDays, setPiHospDays] = useState('15');
  const [piNutritionDays, setPiNutritionDays] = useState('60');
  const [piMentalFee, setPiMentalFee] = useState('5000');
  const [piDependentAnnualShare, setPiDependentAnnualShare] = useState('0'); // e.g. 0 or computed
  const [piDependentYears, setPiDependentYears] = useState('0');
  const [piFaultPct, setPiFaultPct] = useState('100'); // 对方责任比例 %
  const [piHasCompulsoryIns, setPiHasCompulsoryIns] = useState(true);

  const bAvg = Math.max(1000, Number(localMonthlyAvg) || DEFAULT_STAT_BASELINES.monthlyAvgWage);
  const bUrbanInc = Math.max(10000, Number(localUrbanInc) || DEFAULT_STAT_BASELINES.urbanDisposable);
  const bUrbanExp = Math.max(10000, Number(localUrbanExp) || DEFAULT_STAT_BASELINES.urbanConsumption);
  const bNonPrivYear = Math.max(20000, Number(localNonPrivYear) || DEFAULT_STAT_BASELINES.nonPrivateYearWage);
  const bNatInc = Math.max(10000, Number(natUrbanInc) || DEFAULT_STAT_BASELINES.nationalUrbanIncome);
  const bPiMeal = Math.max(0, Number(piHospMealPerDay) || 0);
  const bPiNutr = Math.max(0, Number(piNutritionPerDay) || 0);

  // --- Tab 1: Customizable Work Injury Calculation ---
  const wiCalc = useMemo(() => {
    const rawSalary = Math.max(0, Number(wiSalary) || 0);
    const minBase = Math.round(bAvg * 0.6);
    const maxBase = Math.round(bAvg * 3);
    const clampedBase = Math.min(maxBase, Math.max(minBase, rawSalary));
    const clampedNote =
      rawSalary < minBase
        ? `低于当地月均工资 60%（${minBase}元），依法按 ${minBase} 元保底`
        : rawSalary > maxBase
        ? `高于当地月均工资 300%（${maxBase}元），依法按 ${maxBase} 元封顶`
        : `在 60%–300% 区间内，按实际月均工资 ${rawSalary} 元计`;

    const fundItems: { name: string; amount: number; formula: string }[] = [];
    const employerItems: { name: string; amount: number; formula: string }[] = [];
    let monthlyPension = 0;

    const hospDays = Math.max(0, Number(wiHospDays) || 0);
    const mealPerDay = Math.max(0, Number(wiMealPerDay) || 0);
    const leaveMonths = Math.max(0, Number(wiLeaveMonths) || 0);
    const nurseFee = Math.max(0, Number(wiNurseFee) || 0);

    if (wiGrade === 0) {
      // Work-related death
      const deathLump = bNatInc * 20;
      const funeral = bAvg * 6;
      fundItems.push({
        name: '一次性工亡补助金',
        amount: deathLump,
        formula: `上年度全国城镇居民人均可支配收入 ${bNatInc.toLocaleString('zh-CN')} × 20 倍（全国统一）`,
      });
      fundItems.push({
        name: '丧葬补助金',
        amount: funeral,
        formula: `当地上年度职工月均工资 ${bAvg.toLocaleString('zh-CN')} × 6 个月`,
      });
    } else {
      const lumpMonths = DISABILITY_LUMP_MONTHS[wiGrade] || 0;
      fundItems.push({
        name: `一次性伤残补助金（${wiGrade}级）`,
        amount: clampedBase * lumpMonths,
        formula: `${clampedBase.toLocaleString('zh-CN')} 元 × ${lumpMonths} 个月（${clampedNote}）`,
      });

      if (hospDays > 0 && mealPerDay > 0) {
        fundItems.push({
          name: '住院伙食补助费',
          amount: hospDays * mealPerDay,
          formula: `${hospDays} 天 × ${mealPerDay} 元/天（按当地工伤标准填写）`,
        });
      }

      if (leaveMonths > 0) {
        employerItems.push({
          name: '停工留薪期工资',
          amount: rawSalary * leaveMonths,
          formula: `原工资福利待遇不变：${rawSalary.toLocaleString('zh-CN')} 元 × ${leaveMonths} 个月`,
        });
      }

      if (nurseFee > 0) {
        employerItems.push({
          name: '停工留薪期护理费',
          amount: nurseFee,
          formula: '生活不能自理的工伤职工在停工留薪期需要护理的，由所在单位负责',
        });
      }

      if (wiGrade >= 1 && wiGrade <= 4) {
        monthlyPension = clampedBase * (MONTHLY_ALLOWANCE_RATIO[wiGrade] || 0.75);
      } else if (wiGrade >= 5 && wiGrade <= 10 && wiTerminate) {
        const medMonths = Math.max(0, Number(medExitMonths[wiGrade]) || 0);
        const empMonths = Math.max(0, Number(empExitMonths[wiGrade]) || 0);
        fundItems.push({
          name: `一次性工伤医疗补助金（${wiGrade}级）`,
          amount: bAvg * medMonths,
          formula: `按本省市配置标准：月均工资 ${bAvg.toLocaleString('zh-CN')} × ${medMonths} 个月`,
        });

        const yrsLeft = Math.max(0, Number(wiYearsToRetire) || 0);
        let retireFactor = 1;
        let retireNote = '按全额计发（未触发距退休递减）';
        if (applyRetireReduction) {
          if (yrsLeft <= 0) {
            retireFactor = 0;
            retireNote = '已达法定退休年龄并办理退休手续，不享受就业补助金';
          } else if (yrsLeft < 5) {
            const reducedYears = Math.ceil(5 - yrsLeft);
            retireFactor = Math.max(0, 1 - reducedYears * 0.2);
            retireNote = `距退休不足 5 年（剩 ${yrsLeft} 年），按每增 1 岁递减 20% 折算系数 ${(retireFactor * 100).toFixed(0)}%`;
          } else {
            retireNote = '距法定退休年龄满 5 年，全额计发';
          }
        }
        employerItems.push({
          name: `一次性伤残就业补助金（${wiGrade}级）`,
          amount: bAvg * empMonths * retireFactor,
          formula: `月均工资 ${bAvg.toLocaleString('zh-CN')} × ${empMonths} 个月 × ${(retireFactor * 100).toFixed(0)}%（${retireNote}）`,
        });
      }
    }

    const fundSubtotal = fundItems.reduce((s, i) => s + i.amount, 0);
    const employerSubtotal = employerItems.reduce((s, i) => s + i.amount, 0);
    const total = fundSubtotal + employerSubtotal;
    const actualEmployerPay = wiInsured ? employerSubtotal : total;
    const actualFundPay = wiInsured ? fundSubtotal : 0;

    return {
      fundItems,
      employerItems,
      fundSubtotal,
      employerSubtotal,
      actualFundPay,
      actualEmployerPay,
      total,
      monthlyPension,
    };
  }, [bAvg, bNatInc, wiGrade, wiSalary, wiInsured, wiTerminate, wiYearsToRetire, wiLeaveMonths, wiHospDays, wiMealPerDay, wiNurseFee, medExitMonths, empExitMonths, applyRetireReduction]);

  // --- Tab 2: Customizable Personal Injury / Traffic Accident Calculation ---
  const piCalc = useMemo(() => {
    const age = Math.max(0, Math.min(110, Number(piAge) || 38));
    let years = 20;
    if (age >= 75) years = 5;
    else if (age > 60) years = Math.max(5, 20 - (age - 60));

    const disabilityCoeff = piGrade === 0 ? 1 : (11 - piGrade) * 0.1;
    const medicalFee = Math.max(0, Number(piMedicalFee) || 0);
    const lostIncome = Math.max(0, Number(piLostDays) || 0) * Math.max(0, Number(piDailyIncome) || 0);
    const nursingFee = Math.max(0, Number(piNurseDays) || 0) * Math.max(0, Number(piNursePerDay) || 0);
    const hospMeal = Math.max(0, Number(piHospDays) || 0) * bPiMeal;
    const nutritionFee = Math.max(0, Number(piNutritionDays) || 0) * bPiNutr;
    const mentalFee = Math.max(0, Number(piMentalFee) || 0);

    const disabilityOrDeathFee = bUrbanInc * years * disabilityCoeff;
    const funeralFee = piGrade === 0 ? bNonPrivYear / 2 : 0;
    const depShare = Math.max(0, Number(piDependentAnnualShare) || 0);
    const depYrs = Math.max(0, Math.min(20, Number(piDependentYears) || 0));
    const dependentFee = depShare > 0 && depYrs > 0 ? bUrbanExp * depYrs * depShare * disabilityCoeff : 0;

    const medicalCategoryTotal = medicalFee + hospMeal + nutritionFee;
    const disabilityCategoryTotal = disabilityOrDeathFee + funeralFee + lostIncome + nursingFee + mentalFee + dependentFee;
    const grossTotal = medicalCategoryTotal + disabilityCategoryTotal;

    const faultRatio = Math.max(0, Math.min(100, Number(piFaultPct) || 100)) / 100;

    // Compulsory motor insurance (交强险有责限额: 医疗18,000 + 伤残死亡180,000)
    let compulsoryPay = 0;
    let commercialOrPartyPay = grossTotal * faultRatio;
    if (piHasCompulsoryIns && faultRatio > 0) {
      const compMed = Math.min(18000, medicalCategoryTotal);
      const compDis = Math.min(180000, disabilityCategoryTotal);
      compulsoryPay = compMed + compDis;
      const remainder = Math.max(0, grossTotal - compulsoryPay);
      commercialOrPartyPay = remainder * faultRatio;
    }
    const estimatedRecoverable = compulsoryPay + commercialOrPartyPay;

    const items: { name: string; amount: number; formula: string }[] = [
      {
        name: piGrade === 0 ? '死亡赔偿金（城乡统一标准）' : `残疾赔偿金（${piGrade}级 · 系数${Math.round(disabilityCoeff * 100)}%）`,
        amount: disabilityOrDeathFee,
        formula: `${bUrbanInc.toLocaleString('zh-CN')} 元/年 × ${years} 年（${age}岁）× ${Math.round(disabilityCoeff * 100)}%`,
      },
      ...(funeralFee > 0
        ? [{ name: '丧葬费', amount: funeralFee, formula: `当地非私营年均工资 ${bNonPrivYear.toLocaleString('zh-CN')} ÷ 2（6个月）` }]
        : []),
      ...(medicalFee > 0 ? [{ name: '医疗费', amount: medicalFee, formula: '按正式医疗票据核算' }] : []),
      ...(lostIncome > 0 ? [{ name: '误工费', amount: lostIncome, formula: `${piLostDays} 天 × ${piDailyIncome} 元/天` }] : []),
      ...(nursingFee > 0 ? [{ name: '护理费', amount: nursingFee, formula: `${piNurseDays} 天 × ${piNursePerDay} 元/天` }] : []),
      ...(hospMeal > 0 ? [{ name: '住院伙食补助费', amount: hospMeal, formula: `${piHospDays} 天 × ${bPiMeal} 元/天（可于上方口径面板修改）` }] : []),
      ...(nutritionFee > 0 ? [{ name: '营养费', amount: nutritionFee, formula: `${piNutritionDays} 天 × ${bPiNutr} 元/天（可于上方口径面板修改，以医嘱/鉴定为准）` }] : []),
      ...(dependentFee > 0
        ? [
            {
              name: '被扶养人生活费',
              amount: dependentFee,
              formula: `${bUrbanExp.toLocaleString('zh-CN')} 元/年 × ${depYrs} 年 × 份额 ${depShare} × 系数 ${Math.round(disabilityCoeff * 100)}%`,
            },
          ]
        : []),
      ...(mentalFee > 0 ? [{ name: '精神损害抚慰金', amount: mentalFee, formula: '结合伤残等级与过错程度由法院酌定' }] : []),
    ];

    return {
      years,
      grossTotal,
      compulsoryPay,
      commercialOrPartyPay,
      estimatedRecoverable,
      items,
    };
  }, [
    bUrbanInc,
    bUrbanExp,
    bNonPrivYear,
    bPiMeal,
    bPiNutr,
    piGrade,
    piAge,
    piMedicalFee,
    piLostDays,
    piDailyIncome,
    piNurseDays,
    piNursePerDay,
    piHospDays,
    piNutritionDays,
    piMentalFee,
    piDependentAnnualShare,
    piDependentYears,
    piFaultPct,
    piHasCompulsoryIns,
  ]);

  const summaryText = useMemo(() => {
    if (tab === 'work_injury') {
      return [
        `【${activeRegionLabel} · 工伤赔偿测算 · ${wiGrade === 0 ? '因工死亡' : `${wiGrade}级伤残`}】`,
        `参保情况：${wiInsured ? '已缴工伤保险' : '未缴工伤保险（依法由用人单位全额承担）'}`,
        `法定测算总额：${fmtYuan(wiCalc.total)}`,
        `其中：工伤保险基金预计支付 ${fmtYuan(wiCalc.actualFundPay)} ｜ 用人单位预计承担 ${fmtYuan(wiCalc.actualEmployerPay)}`,
        ...(wiCalc.monthlyPension > 0 ? [`另享按月伤残津贴：约 ${fmtYuan(wiCalc.monthlyPension)}/月`] : []),
        '--- 分项明细 ---',
        ...[...wiCalc.fundItems, ...wiCalc.employerItems].map((i) => `• ${i.name}：${fmtYuan(i.amount)}（${i.formula}）`),
      ].join('\n');
    }
    return [
      `【${activeRegionLabel} · 人身损害 / 交通事故赔偿测算 · ${piGrade === 0 ? '死亡' : `${piGrade}级伤残`}】`,
      `总损失核定额：${fmtYuan(piCalc.grossTotal)}`,
      `按对方责任 ${piFaultPct}%${piHasCompulsoryIns ? '（含交强险有责限额先行赔付）' : ''} 预计可获赔：${fmtYuan(piCalc.estimatedRecoverable)}`,
      '--- 分项明细 ---',
      ...piCalc.items.map((i) => `• ${i.name}：${fmtYuan(i.amount)}（${i.formula}）`),
    ].join('\n');
  }, [activeRegionLabel, tab, wiGrade, wiInsured, wiCalc, piGrade, piFaultPct, piHasCompulsoryIns, piCalc]);

  const copySummary = async () => {
    try {
      await copyToClipboard(summaryText);
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
        {/* Top Bar */}
        <div className="hidden">
          <Link to="/tools" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#11151C]">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回实用法律工具
          </Link>
          <span className="font-num text-[11px] font-medium text-slate-500">
            内置浙江 2026 年度统计基准（全口径月均 {bAvg.toLocaleString('zh-CN')} 元 · 城镇可支配收入 {bUrbanInc.toLocaleString('zh-CN')} 元）
          </span>
        </div>

        {/* Header */}
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9A773E]">
              <HardHat className="h-3.5 w-3.5 text-[#B89254]" />
              <span>NATIONWIDE CUSTOMIZABLE · 工伤与人身损害赔偿测算</span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold text-[#11151C] sm:text-4xl">
              工伤与人身损害赔偿计算器（可自定省市标准）
            </h1>
            <p className="mt-2.5 max-w-3xl text-sm leading-7 text-slate-600">
              整合《工伤保险条例》与人身损害城乡统一赔偿标准，清晰拆分<strong>工伤保险基金支付 vs 企业自付部分</strong>；支持按全国各省市自由编辑统计基数及 5–10 级医疗/就业补助月数，修改后自动保存本机浏览器。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const def = getDefaultInjuryRegionConfig();
              setRegionName(def.regionName);
              setLocalMonthlyAvg(def.monthlyAvgWage);
              setLocalUrbanInc(def.urbanDisposable);
              setLocalUrbanExp(def.urbanConsumption);
              setLocalNonPrivYear(def.nonPrivateYearWage);
              setNatUrbanInc(def.nationalUrbanIncome);
              setPiHospMealPerDay(def.piHospMealPerDay);
              setPiNutritionPerDay(def.piNutritionPerDay);
              setMedExitMonths(def.medExitMonths);
              setEmpExitMonths(def.empExitMonths);
              setApplyRetireReduction(def.applyRetireReduction);
            }}
            className="inline-flex flex-none items-center gap-1.5 rounded-[2px] border border-[#D4CEC2] bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:border-[#11151C]"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 恢复默认参考基准
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="mt-7 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setTab('work_injury')}
            className={`rounded-[2px] border p-4 text-left transition-colors ${
              tab === 'work_injury'
                ? 'border-[#11151C] bg-[#11151C] text-[#F6F4EF]'
                : 'border-[#DED8CC] bg-white text-[#11151C] hover:border-[#11151C]'
            }`}
          >
            <div className="flex items-center gap-2">
              <HardHat className={`h-4 w-4 ${tab === 'work_injury' ? 'text-[#D1B27A]' : 'text-[#9A773E]'}`} />
              <span className="text-sm font-bold">工伤赔偿计算器（可自定各省社平与补助月数）</span>
            </div>
            <p className={`mt-1 text-xs ${tab === 'work_injury' ? 'text-slate-300' : 'text-slate-500'}`}>
              清晰拆分社保基金支付与用人单位承担额，支持 1–10 级、因工死亡及各省差异化的 5–10 级医疗/就业补助月数
            </p>
          </button>
          <button
            type="button"
            onClick={() => setTab('personal_injury')}
            className={`rounded-[2px] border p-4 text-left transition-colors ${
              tab === 'personal_injury'
                ? 'border-[#11151C] bg-[#11151C] text-[#F6F4EF]'
                : 'border-[#DED8CC] bg-white text-[#11151C] hover:border-[#11151C]'
            }`}
          >
            <div className="flex items-center gap-2">
              <Car className={`h-4 w-4 ${tab === 'personal_injury' ? 'text-[#D1B27A]' : 'text-[#9A773E]'}`} />
              <span className="text-sm font-bold">交通事故与一般人身损害赔偿（城乡统一标准）</span>
            </div>
            <p className={`mt-1 text-xs ${tab === 'personal_injury' ? 'text-slate-300' : 'text-slate-500'}`}>
              自动按年龄折算伤残/死亡年限，内置交强险 18 万伤残 + 1.8 万医疗先行赔付及责比拆分
            </p>
          </button>
        </div>

        {/* Collapsible Nationwide Regional Statistical Baselines & Exit-Months Editor */}
        <div className="mt-4 border border-[#CBB994] bg-white shadow-2xs">
          <button
            type="button"
            onClick={() => setShowBaselines((v) => !v)}
            className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left text-xs font-semibold text-[#11151C] hover:bg-[#FAF8F2]"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span>自定义本省市口径参数（社平工资 / 人均可支配收入 / 5–10 级医疗与就业补助月数）</span>
              <span className="rounded bg-[#F5F0E4] px-2 py-0.5 text-[10.5px] font-bold text-[#7A5922]">
                当前：{activeRegionLabel}
              </span>
              <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                修改自动保存本机
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 text-[#9A773E] transition-transform ${showBaselines ? 'rotate-180' : ''}`} />
          </button>
          {showBaselines && (
            <div className="space-y-4 border-t border-[#EFECE5] bg-[#FAF9F6] p-4 sm:p-5 text-xs">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block sm:col-span-2">
                  <span className="text-[11px] font-bold text-[#0E223D]">当前省市 / 口径名称（显示在测算明细中）</span>
                  <input
                    type="text"
                    value={regionName}
                    onChange={(e) => setRegionName(e.target.value)}
                    placeholder="例：北京市 2026 口径 / 广东省深圳市 / 江苏省"
                    className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2.5 py-1.5 font-semibold text-[#11151C]"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-600">当地上年度职工月均工资(元)</span>
                  <input type="number" value={localMonthlyAvg} onChange={(e) => setLocalMonthlyAvg(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2.5 py-1.5 font-num font-bold" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-600">全国城镇可支配收入(工亡×20)</span>
                  <input type="number" value={natUrbanInc} onChange={(e) => setNatUrbanInc(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2.5 py-1.5 font-num font-bold" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-600">当地城镇可支配收入(人损/年)</span>
                  <input type="number" value={localUrbanInc} onChange={(e) => setLocalUrbanInc(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2.5 py-1.5 font-num font-bold" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-600">当地城镇消费支出(被扶养/年)</span>
                  <input type="number" value={localUrbanExp} onChange={(e) => setLocalUrbanExp(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2.5 py-1.5 font-num font-bold" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-600">当地非私营年均工资(丧葬÷2)</span>
                  <input type="number" value={localNonPrivYear} onChange={(e) => setLocalNonPrivYear(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2.5 py-1.5 font-num font-bold" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] text-slate-600">人损伙食(元/天)</span>
                    <input type="number" min={0} value={piHospMealPerDay} onChange={(e) => setPiHospMealPerDay(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2 py-1.5 font-num font-bold" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-slate-600">人损营养(元/天)</span>
                    <input type="number" min={0} value={piNutritionPerDay} onChange={(e) => setPiNutritionPerDay(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2 py-1.5 font-num font-bold" />
                  </label>
                </div>
              </div>

              {/* Separate 5-10 Grade Medical & Employment Exit Months Table */}
              <div className="border-t border-[#E5DFD2] pt-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11.5px] font-bold text-[#0E223D]">
                    本省 5–10 级工伤解除关系「双一次性补助金」月数（按当地工伤保险条例自行填写，医疗与就业支持分别设置）：
                  </span>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={applyRetireReduction}
                      onChange={(e) => setApplyRetireReduction(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[#0E223D]"
                    />
                    <span>距法定退休年龄不足 5 年按每岁递减 20% 折算就业补助金</span>
                  </label>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[540px] border-collapse border border-[#DFD9CC] bg-white text-center text-[11px]">
                    <thead>
                      <tr className="bg-[#F4EFE4] text-[#0E223D]">
                        <th className="border border-[#DFD9CC] px-2.5 py-1.5 text-left font-bold">补助项目（单位：月）</th>
                        {EXIT_GRADES.map((g) => (
                          <th key={g} className="border border-[#DFD9CC] px-2 py-1.5 font-bold">{g}级</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border border-[#DFD9CC] px-2.5 py-1.5 text-left font-semibold text-slate-700">
                          一次性工伤医疗补助金（基金）
                        </td>
                        {EXIT_GRADES.map((g) => (
                          <td key={g} className="border border-[#DFD9CC] p-1">
                            <input
                              type="number"
                              min={0}
                              max={60}
                              step="0.5"
                              value={medExitMonths[g]}
                              onChange={(e) =>
                                setMedExitMonths((prev) => ({ ...prev, [g]: Math.max(0, Number(e.target.value) || 0) }))
                              }
                              className="w-14 rounded border border-[#D8D2C6] bg-[#FAF9F6] px-1.5 py-1 text-center font-num font-bold"
                            />
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="border border-[#DFD9CC] px-2.5 py-1.5 text-left font-semibold text-slate-700">
                          一次性伤残就业补助金（单位）
                        </td>
                        {EXIT_GRADES.map((g) => (
                          <td key={g} className="border border-[#DFD9CC] p-1">
                            <input
                              type="number"
                              min={0}
                              max={80}
                              step="0.5"
                              value={empExitMonths[g]}
                              onChange={(e) =>
                                setEmpExitMonths((prev) => ({ ...prev, [g]: Math.max(0, Number(e.target.value) || 0) }))
                              }
                              className="w-14 rounded border border-[#D8D2C6] bg-[#FAF9F6] px-1.5 py-1 text-center font-num font-bold"
                            />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* TAB 1: WORK INJURY */}
        {tab === 'work_injury' && (
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-5 space-y-4 border border-[#DED8CC] bg-white p-5 sm:p-6 text-xs">
              <label className="block">
                <span className="font-bold text-[#11151C]">劳动能力鉴定伤残等级</span>
                <select
                  value={wiGrade}
                  onChange={(e) => setWiGrade(Number(e.target.value) as InjuryGrade)}
                  className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2.5 text-xs font-semibold text-[#11151C]"
                >
                  {GRADE_OPTIONS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>

              {wiGrade !== 0 && (
                <>
                  <label className="block">
                    <span className="font-bold text-[#11151C]">工伤前 12 个月税前月均工资（元）</span>
                    <input
                      type="number"
                      min={0}
                      value={wiSalary}
                      onChange={(e) => setWiSalary(e.target.value)}
                      className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num text-base font-bold text-[#11151C]"
                    />
                    <span className="mt-1 block text-[11px] text-slate-400">
                      本人工资自动按当地月均工资 60%–300%（{Math.round(bAvg * 0.6)}–{Math.round(bAvg * 3)}元）保底封顶
                    </span>
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="font-semibold text-slate-700">停工留薪期（月）</span>
                      <input type="number" min={0} max={24} step="0.5" value={wiLeaveMonths} onChange={(e) => setWiLeaveMonths(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                    </label>
                    <label className="block">
                      <span className="font-semibold text-slate-700">住院天数（天）</span>
                      <input type="number" min={0} value={wiHospDays} onChange={(e) => setWiHospDays(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="font-semibold text-slate-700">住院伙食标准（元/天）</span>
                      <input type="number" min={0} value={wiMealPerDay} onChange={(e) => setWiMealPerDay(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                    </label>
                    <label className="block">
                      <span className="font-semibold text-slate-700">停工留薪期护理费（元）</span>
                      <input type="number" min={0} value={wiNurseFee} onChange={(e) => setWiNurseFee(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                    </label>
                  </div>
                </>
              )}

              <div className="space-y-2.5 border-t border-[#EFECE5] pt-4">
                <label className="flex cursor-pointer items-center gap-2 font-semibold text-[#11151C]">
                  <input type="checkbox" checked={wiInsured} onChange={(e) => setWiInsured(e.target.checked)} className="h-4 w-4 accent-[#11151C]" />
                  <span>用人单位已依法缴纳工伤保险（取消勾选将合并计入企业自付）</span>
                </label>

                {wiGrade >= 5 && wiGrade <= 10 && (
                  <>
                    <label className="flex cursor-pointer items-center gap-2 font-semibold text-[#11151C]">
                      <input type="checkbox" checked={wiTerminate} onChange={(e) => setWiTerminate(e.target.checked)} className="h-4 w-4 accent-[#11151C]" />
                      <span>解除或终止劳动关系（按上方配置的本省月数计发“双一次性补助金”）</span>
                    </label>
                    {wiTerminate && (
                      <label className="block pl-6">
                        <span className="text-[11px] text-slate-500">距法定退休年龄剩余年数（不足 5 年就业补助金逐年递减 20%）</span>
                        <input type="number" min={0} max={45} value={wiYearsToRetire} onChange={(e) => setWiYearsToRetire(e.target.value)} className="mt-1 w-32 rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-1.5 font-num font-bold" />
                      </label>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="min-w-0 lg:col-span-7 space-y-5">
              <div className="bg-[#11151C] p-6 text-white">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#D1B27A]">
                      WORK INJURY TOTAL · 法定工伤一次性待遇合计
                    </p>
                    <p className="mt-2 font-num text-3xl font-bold sm:text-4xl">{fmtYuan(wiCalc.total)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={copySummary}
                    className="inline-flex items-center gap-1.5 rounded-[2px] border border-white/20 bg-white/10 px-3.5 py-2 text-xs text-white hover:bg-white/20"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-[#D1B27A]" />}
                    <span>{copied ? '已复制明细' : '复制测算明细'}</span>
                  </button>
                </div>

                {/* Fund vs Employer Split */}
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/15 pt-4 text-xs">
                  <div className="bg-white/5 p-3.5">
                    <p className="text-slate-400">工伤保险基金预计支付</p>
                    <p className="mt-1 font-num text-lg font-bold text-emerald-300">{fmtYuan(wiCalc.actualFundPay)}</p>
                  </div>
                  <div className="bg-white/5 p-3.5">
                    <p className="text-slate-400">用人单位预计承担</p>
                    <p className="mt-1 font-num text-lg font-bold text-[#D1B27A]">{fmtYuan(wiCalc.actualEmployerPay)}</p>
                  </div>
                </div>
                {wiCalc.monthlyPension > 0 && (
                  <p className="mt-3 text-xs text-[#D1B27A]">
                    另：1–4 级伤残保留劳动关系退出工作岗位，按月由基金支付伤残津贴约 <strong className="font-num">{fmtYuan(wiCalc.monthlyPension)}/月</strong>。
                  </p>
                )}
              </div>

              {!wiInsured && (
                <div className="flex items-start gap-2 border border-rose-200 bg-rose-50 p-4 text-xs leading-6 text-rose-800">
                  <ShieldAlert className="mt-0.5 h-4 w-4 flex-none" />
                  <span>
                    <strong>未参保风控提示（《工伤保险条例》第62条）：</strong>应当参加工伤保险而未参加的用人单位职工发生工伤的，由该用人单位按照法定工伤保险待遇项目和标准全额支付费用。
                  </span>
                </div>
              )}

              <div className="border border-[#DED8CC] bg-white p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-[#11151C] border-b border-[#EFECE5] pb-3">
                  分项明细（不含合规医疗费实报实销）
                </h2>
                <div className="space-y-3 text-xs">
                  {[...wiCalc.fundItems.map((i) => ({ ...i, payer: wiInsured ? '社保基金' : '单位兜底' })), ...wiCalc.employerItems.map((i) => ({ ...i, payer: '用人单位' }))].map((row, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-3 border-b border-[#F2EFE8] pb-2.5 last:border-0 last:pb-0">
                      <div>
                        <p className="font-bold text-[#11151C] flex flex-wrap items-center gap-1.5">
                          <span>{row.name}</span>
                          <span className="inline-block flex-none whitespace-nowrap border border-[#DED8CC] bg-[#FAF9F6] px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                            {row.payer}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">{row.formula}</p>
                      </div>
                      <span className="font-num flex-none font-bold text-[#11151C]">{fmtYuan(row.amount)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end border-t border-[#EFECE5] pt-4">
                  <Link
                    to={`/contact?type=${encodeURIComponent('劳动争议')}&sourceTool=${encodeURIComponent(`工伤与人身损害赔偿计算器（${activeRegionLabel}）`)}&note=${encodeURIComponent(`${summaryText}\n希望预约律师核对工伤认定、鉴定及待遇主张方案。`)}`}
                    onClick={() => trackEvent('tool_to_contact')}
                    className="inline-flex items-center gap-2 rounded-[2px] bg-[#11151C] px-5 py-2.5 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D]"
                  >
                    <Send className="h-3.5 w-3.5 text-[#D1B27A]" />
                    <span>带入测算结果预约劳动法律师</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PERSONAL INJURY / TRAFFIC ACCIDENT */}
        {tab === 'personal_injury' && (
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-5 space-y-4 border border-[#DED8CC] bg-white p-5 sm:p-6 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <label className="block col-span-2">
                  <span className="font-bold text-[#11151C]">伤残等级 / 情形</span>
                  <select
                    value={piGrade}
                    onChange={(e) => {
                      const next = Number(e.target.value) as InjuryGrade;
                      setPiGrade(next);
                      setPiMentalFee(String(MENTAL_DAMAGE_REF[next] ?? 5000));
                    }}
                    className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2.5 text-xs font-semibold"
                  >
                    {GRADE_OPTIONS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">受害人年龄（岁）</span>
                  <input type="number" min={0} max={105} value={piAge} onChange={(e) => setPiAge(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">医疗费总额（元）</span>
                  <input type="number" min={0} value={piMedicalFee} onChange={(e) => setPiMedicalFee(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">误工天数（天）</span>
                  <input type="number" min={0} value={piLostDays} onChange={(e) => setPiLostDays(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">日均收入（元/天）</span>
                  <input type="number" min={0} value={piDailyIncome} onChange={(e) => setPiDailyIncome(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">护理天数（天）</span>
                  <input type="number" min={0} value={piNurseDays} onChange={(e) => setPiNurseDays(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">护理标准（元/天）</span>
                  <input type="number" min={0} value={piNursePerDay} onChange={(e) => setPiNursePerDay(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">住院天数（伙食 {bPiMeal}/天）</span>
                  <input type="number" min={0} value={piHospDays} onChange={(e) => setPiHospDays(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">营养期天数（{bPiNutr}/天）</span>
                  <input type="number" min={0} value={piNutritionDays} onChange={(e) => setPiNutritionDays(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">精神损害抚慰金（参考）</span>
                  <input type="number" min={0} value={piMentalFee} onChange={(e) => setPiMentalFee(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">对方责任比例（%）</span>
                  <input type="number" min={0} max={100} value={piFaultPct} onChange={(e) => setPiFaultPct(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">被扶养人承担份额(如0.5)</span>
                  <input type="number" min={0} max={1} step="0.1" value={piDependentAnnualShare} onChange={(e) => setPiDependentAnnualShare(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">被扶养年限(0表示无)</span>
                  <input type="number" min={0} max={20} value={piDependentYears} onChange={(e) => setPiDependentYears(e.target.value)} className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 font-num font-bold" />
                </label>
              </div>

              <label className="flex cursor-pointer items-center gap-2 border-t border-[#EFECE5] pt-3 font-semibold text-[#11151C]">
                <input type="checkbox" checked={piHasCompulsoryIns} onChange={(e) => setPiHasCompulsoryIns(e.target.checked)} className="h-4 w-4 accent-[#11151C]" />
                <span>机动车事故（适用交强险有责限额 18 万伤残 + 1.8 万医疗先行赔付）</span>
              </label>
            </div>

            <div className="min-w-0 lg:col-span-7 space-y-5">
              <div className="bg-[#11151C] p-6 text-white">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#D1B27A]">
                      ESTIMATED RECOVERABLE · 预计可主张赔偿总额
                    </p>
                    <p className="mt-2 font-num text-3xl font-bold sm:text-4xl">{fmtYuan(piCalc.estimatedRecoverable)}</p>
                    <p className="mt-2 text-xs text-slate-300">
                      核定总损失：{fmtYuan(piCalc.grossTotal)}
                      {piHasCompulsoryIns
                        ? `（交强险先行 ${fmtYuan(piCalc.compulsoryPay)} + 超出部分按 ${piFaultPct}% 责比 ${fmtYuan(piCalc.commercialOrPartyPay)}）`
                        : `（按 ${piFaultPct}% 责任比例核算）`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={copySummary}
                    className="inline-flex items-center gap-1.5 rounded-[2px] border border-white/20 bg-white/10 px-3.5 py-2 text-xs text-white hover:bg-white/20"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-[#D1B27A]" />}
                    <span>{copied ? '已复制明细' : '复制测算明细'}</span>
                  </button>
                </div>
              </div>

              <div className="border border-[#DED8CC] bg-white p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-[#11151C] border-b border-[#EFECE5] pb-3">
                  城乡统一标准分项明细（{activeRegionLabel} · 不含后续治疗费/交通费/鉴定费）
                </h2>
                <div className="space-y-3 text-xs">
                  {piCalc.items.map((row, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-3 border-b border-[#F2EFE8] pb-2.5 last:border-0 last:pb-0">
                      <div>
                        <p className="font-bold text-[#11151C]">{row.name}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">{row.formula}</p>
                      </div>
                      <span className="font-num flex-none font-bold text-[#11151C]">{fmtYuan(row.amount)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end border-t border-[#EFECE5] pt-4">
                  <Link
                    to={`/contact?type=${encodeURIComponent('民商事争议')}&sourceTool=${encodeURIComponent(`工伤与人身损害赔偿计算器（${activeRegionLabel}）`)}&note=${encodeURIComponent(`${summaryText}\n希望预约律师进一步核对伤残鉴定与索赔方案。`)}`}
                    onClick={() => trackEvent('tool_to_contact')}
                    className="inline-flex items-center gap-2 rounded-[2px] bg-[#11151C] px-5 py-2.5 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D]"
                  >
                    <Send className="h-3.5 w-3.5 text-[#D1B27A]" />
                    <span>带入明细预约律师复核</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        <ToolSeoKnowledgeSection routeKey="/tools/injury-compensation" />

        <p className="mx-auto mt-6 flex max-w-4xl items-start justify-center gap-1.5 text-center text-xs leading-6 text-slate-500">
          <Info className="mt-1 h-3.5 w-3.5 flex-none text-[#B89254]" />
          <span>
            本工具在本地浏览器离线运行，不上传任何伤情或薪资信息。多处伤残叠加系数、商业险医保外用药免责条款及各地法院具体裁量尺度存在个案差异，测算结果仅供参考，不构成正式法律意见。
          </span>
        </p>
      </div>
    </div>
  );
};
