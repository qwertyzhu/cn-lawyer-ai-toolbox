import React, { useEffect, useMemo, useState } from 'react';
import { Link } from '../../components/ToolboxBridgeLink';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  Copy,
  Info,
  RotateCcw,
  Send,
} from 'lucide-react';
import { trackEvent } from '../../components/ToolboxBridgeLink';
import { copyToClipboard } from '../../lib/clipboard';
import { calculateLaborSeveranceTenure } from '../../lib/legalCalculators';
import { ToolQuickRefSection as ToolSeoKnowledgeSection } from '../../components/ToolQuickRefSection';

type CompensationScenario = 'n' | 'n_plus_1' | '2n' | 'double_wage';

const SCENARIOS: { id: CompensationScenario; title: string; badge: string; desc: string }[] = [
  {
    id: 'n',
    title: '经济补偿金（N）',
    badge: '劳动合同法第46/47条',
    desc: '协商一致解除（单位提出）、经济性裁员、劳动合同期满单位不续签、被迫辞职（欠薪/未缴社保）等',
  },
  {
    id: 'n_plus_1',
    title: '经济补偿金 + 代通知金（N + 1）',
    badge: '劳动合同法第40条',
    desc: '医疗期满、不胜任工作或客观情况重大变化，用人单位未提前 30 日书面通知而直接解除',
  },
  {
    id: '2n',
    title: '违法解除 / 终止赔偿金（2N）',
    badge: '劳动合同法第87条',
    desc: '用人单位无合法理由单方辞退、违反法定解除程序（如未通知工会）或违法辞退“三期”女职工等',
  },
  {
    id: 'double_wage',
    title: '未签书面劳动合同双倍工资差额',
    badge: '劳动合同法第82条',
    desc: '入职满 1 个月后至满 1 年期间未订立书面劳动合同，用人单位须另行支付 1 倍工资差额（最高 11 个月）',
  },
];

const fmtYuan = (n: number) =>
  `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const LABOR_REGION_STORAGE_KEY = 'toolbox_labor_region_config_v1';
const DEFAULT_LABOR_REGION_NAME = '自定义地区（默认参考浙江2026）';
const DEFAULT_LABOR_TRIPLE_CAP = '25611';

function loadSavedLaborRegion(): { regionName: string; tripleCap: string } {
  try {
    const raw = localStorage.getItem(LABOR_REGION_STORAGE_KEY);
    if (!raw) return { regionName: DEFAULT_LABOR_REGION_NAME, tripleCap: DEFAULT_LABOR_TRIPLE_CAP };
    const parsed = JSON.parse(raw);
    return {
      regionName: typeof parsed.regionName === 'string' && parsed.regionName.trim() ? parsed.regionName : DEFAULT_LABOR_REGION_NAME,
      tripleCap: typeof parsed.tripleCap === 'string' && parsed.tripleCap.trim() ? parsed.tripleCap : DEFAULT_LABOR_TRIPLE_CAP,
    };
  } catch {
    return { regionName: DEFAULT_LABOR_REGION_NAME, tripleCap: DEFAULT_LABOR_TRIPLE_CAP };
  }
}

export const LaborCompensationCalculator: React.FC = () => {
  const initialRegion = useMemo(() => loadSavedLaborRegion(), []);
  const [scenario, setScenario] = useState<CompensationScenario>('n');
  const [tenureMode, setTenureMode] = useState<'dates' | 'manual'>('manual');
  const [startDate, setStartDate] = useState('2023-03-01');
  const [endDate, setEndDate] = useState('2026-11-22');
  const [manualYears, setManualYears] = useState('3');
  const [manualMonths, setManualMonths] = useState('4');

  const [avgSalary, setAvgSalary] = useState('12000');
  const [lastMonthSalary, setLastMonthSalary] = useState('12000');
  const [unsignedMonths, setUnsignedMonths] = useState('6');

  // Editable & locally persisted regional 3x social average wage cap (default reference 25,611 元/月)
  const [regionName, setRegionName] = useState(initialRegion.regionName);
  const [tripleCap, setTripleCap] = useState(initialRegion.tripleCap);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        LABOR_REGION_STORAGE_KEY,
        JSON.stringify({ regionName: regionName.trim() || DEFAULT_LABOR_REGION_NAME, tripleCap })
      );
    } catch {
      // ignore storage quota error
    }
  }, [regionName, tripleCap]);

  const tenure = useMemo(() => {
    if (tenureMode === 'dates') {
      const res = calculateLaborSeveranceTenure(startDate, endDate);
      return {
        valid: res.valid,
        hasDateConflict: res.hasDateConflict,
        warningText: res.warningText,
        fullYears: res.fullYears,
        remMonths: res.remMonths,
        remDays: res.remDays,
        nMonths: res.nMonths,
      };
    }

    const y = Math.max(0, Number(manualYears) || 0);
    const m = Math.max(0, Number(manualMonths) || 0);
    const totalMonths = y * 12 + m;
    const fullYears = Math.floor(totalMonths / 12);
    const remMonths = Math.max(0, totalMonths - fullYears * 12);

    let nMonths = 0;
    if (totalMonths <= 0) {
      nMonths = 0;
    } else if (remMonths === 0) {
      nMonths = fullYears;
    } else if (remMonths < 6) {
      nMonths = fullYears + 0.5;
    } else {
      nMonths = fullYears + 1;
    }

    return {
      valid: true,
      hasDateConflict: false,
      warningText: '',
      fullYears,
      remMonths: Number(remMonths.toFixed(1)),
      remDays: 0,
      nMonths,
    };
  }, [tenureMode, startDate, endDate, manualYears, manualMonths]);

  const calc = useMemo(() => {
    const avg = Math.max(0, Number(avgSalary) || 0);
    const lastMonth = Math.max(0, Number(lastMonthSalary) || avg);
    const cap = Math.max(1000, Number(tripleCap) || 25611);

    if (scenario === 'double_wage') {
      const m = Math.min(11, Math.max(0, Number(unsignedMonths) || 0));
      const total = avg * m;
      return {
        total,
        isCapped: false,
        effectiveBase: avg,
        effectiveN: m,
        noticePay: 0,
        steps: [
          `法定规则：用工满 1 个月次日起至满 1 年前一日，未签书面劳动合同每月另付 1 倍工资差额，法定最高 11 个月。`,
          `计算公式：月均应发工资 ${avg.toLocaleString('zh-CN')} 元 × ${m} 个月 = ${total.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元`,
          '仲裁时效提示：未签书面合同二倍工资差额适用 1 年仲裁时效（多数地区按月逐月起算或连续计算，建议尽快核验时效）。',
        ],
      };
    }

    const isCapped = avg > cap;
    const effectiveBase = isCapped ? cap : avg;
    const effectiveN = isCapped ? Math.min(tenure.nMonths, 12) : tenure.nMonths;
    const baseN = effectiveBase * effectiveN;

    let total = baseN;
    let noticePay = 0;
    const steps: string[] = [];

    steps.push(
      `工龄折算（N）：累计工作 ${tenure.fullYears} 年 ${tenure.remMonths} 个月${
        tenure.remDays > 0 ? ` ${tenure.remDays} 天` : ''
      } → 依法折算为 ${tenure.nMonths} 个月${
        isCapped && tenure.nMonths > 12 ? `（触发高薪封顶，支付年限以 12 年封顶 → 实计 12 个月）` : ''
      }`
    );

    if (isCapped) {
      steps.push(
        `高薪三倍封顶触发（《劳动合同法》第47条第2款）：离职前 12 个月税前月均工资 ${avg.toLocaleString('zh-CN')} 元 ＞ 设定的三倍社平基数 ${cap.toLocaleString('zh-CN')} 元，月补偿基数按 ${cap.toLocaleString('zh-CN')} 元封顶。`
      );
    } else {
      steps.push(`月补偿基数：离职前 12 个月应发（税前）月均工资 ${avg.toLocaleString('zh-CN')} 元（未超三倍社平基数，全额计入）。`);
    }

    if (scenario === 'n') {
      total = baseN;
      steps.push(`经济补偿金（N）：${effectiveBase.toLocaleString('zh-CN')} × ${effectiveN} = ${baseN.toFixed(2)} 元`);
    } else if (scenario === 'n_plus_1') {
      noticePay = lastMonth;
      total = baseN + noticePay;
      steps.push(`经济补偿金（N）：${effectiveBase.toLocaleString('zh-CN')} × ${effectiveN} = ${baseN.toFixed(2)} 元`);
      steps.push(`代通知金（+1）：按解除前 1 个月工资标准核计 ${noticePay.toFixed(2)} 元（《劳动合同法实施条例》第20条，不适用 12 年年限封顶）`);
    } else if (scenario === '2n') {
      total = baseN * 2;
      steps.push(`违法解除赔偿金（2N）：经济补偿标准 ${baseN.toFixed(2)} 元 × 2 = ${total.toFixed(2)} 元`);
      steps.push('实务提醒：主张 2N 赔偿金后，通常不再重复支持 N 或代通知金（+1）。');
    }

    return { total, isCapped, effectiveBase, effectiveN, noticePay, steps };
  }, [scenario, avgSalary, lastMonthSalary, tripleCap, unsignedMonths, tenure]);

  const currentScenarioObj = SCENARIOS.find((s) => s.id === scenario) || SCENARIOS[0];

  const activeRegionLabel = regionName.trim() || DEFAULT_LABOR_REGION_NAME;

  const summaryText = [
    `【${activeRegionLabel} · 劳动争议经济补偿测算 · ${currentScenarioObj.title}】`,
    scenario === 'double_wage'
      ? `未签合同计薪月数：${calc.effectiveN} 个月`
      : `折算工龄：${tenure.nMonths} 个月（${tenure.fullYears}年${tenure.remMonths}个月）`,
    `离职前12个月税前月均工资：${Number(avgSalary || 0).toLocaleString('zh-CN')} 元`,
    calc.isCapped ? `高薪三倍封顶基数：${Number(tripleCap || 0).toLocaleString('zh-CN')} 元（已触发封顶）` : '',
    `测算参考总额：${fmtYuan(calc.total)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const copySummary = async () => {
    try {
      await copyToClipboard(`${summaryText}\n计算明细：\n${calc.steps.map((s) => `- ${s}`).join('\n')}`);
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
          <Link
            to="/articles/labor-dispute-consultation-basic-questions"
            className="text-xs font-medium text-[#0E223D] underline decoration-[#B89254]/60 underline-offset-4 hover:text-[#9A773E]"
          >
            阅读配套实务指引：《杭州地区劳动争议 N / N+1 / 2N 指南》 →
          </Link>
        </div>

        {/* Header */}
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9A773E]">
              <Briefcase className="h-3.5 w-3.5 text-[#B89254]" />
              <span>LABOR COMPENSATION · 全国通用 · 地区社平口径可自改并保存本机</span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold text-[#11151C] sm:text-4xl">
              经济补偿金测算器（N / N+1 / 2N）
            </h1>
            <p className="mt-2.5 max-w-2xl text-sm leading-7 text-slate-600">
              在线测算协商解除（N）、代通知金（N+1）、违法解除赔偿金（2N）及未签书面合同双倍工资差额，支持自由修改本省市地区名称与三倍社平封顶基数（修改自动保存当前浏览器）。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setScenario('n');
              setManualYears('3');
              setManualMonths('4');
              setAvgSalary('12000');
              setLastMonthSalary('12000');
              setRegionName(DEFAULT_LABOR_REGION_NAME);
              setTripleCap(DEFAULT_LABOR_TRIPLE_CAP);
            }}
            className="inline-flex flex-none items-center gap-1.5 rounded-[2px] border border-[#D4CEC2] bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:border-[#11151C]"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 恢复默认参考值
          </button>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          {/* Left: Scenario & Inputs */}
          <div className="min-w-0 lg:col-span-7 space-y-6 border border-[#DED8CC] bg-white p-5 sm:p-8">
            <div>
              <p className="text-xs font-bold text-[#11151C]">
                <span className="font-num mr-2 text-[#9A773E]">01</span>选择离职 / 争议情形
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setScenario(s.id)}
                    className={`rounded-[2px] border p-3.5 text-left transition-colors ${
                      scenario === s.id
                        ? 'border-[#11151C] bg-[#11151C] text-[#F6F4EF]'
                        : 'border-[#E4DFD4] bg-[#FAF9F6] text-slate-700 hover:border-[#11151C]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold">{s.title}</p>
                    </div>
                    <p className={`mt-1 text-[10px] font-medium ${scenario === s.id ? 'text-[#D1B27A]' : 'text-[#9A773E]'}`}>
                      {s.badge}
                    </p>
                    <p className={`mt-1.5 text-[11px] leading-4 ${scenario === s.id ? 'text-slate-300' : 'text-slate-500'}`}>
                      {s.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Tenure or Unsigned Months */}
            {scenario === 'double_wage' ? (
              <div className="border-t border-[#EFECE5] pt-5">
                <label className="block text-xs font-bold text-[#11151C]">
                  <span className="font-num mr-2 text-[#9A773E]">02</span>未签书面劳动合同计薪月数（上限 11 个月）
                </label>
                <input
                  type="number"
                  min={0}
                  max={11}
                  step="0.5"
                  value={unsignedMonths}
                  onChange={(e) => setUnsignedMonths(e.target.value)}
                  className="mt-2 w-full max-w-xs rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-4 py-2.5 font-num text-lg font-bold text-[#11151C] outline-none focus:border-[#11151C] focus:bg-white"
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  注：入职首月为 1 个月宽限期，从入职满 1 个月次日起算至满 1 年止，最高计算 11 个月。
                </p>
              </div>
            ) : (
              <div className="border-t border-[#EFECE5] pt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-[#11151C]">
                    <span className="font-num mr-2 text-[#9A773E]">02</span>在本单位累计工作年限
                  </p>
                  <div className="inline-flex border border-[#DED8CC] bg-[#FAF9F6] p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setTenureMode('manual')}
                      className={`px-2.5 py-1 font-medium ${tenureMode === 'manual' ? 'bg-[#11151C] text-[#F6F4EF]' : 'text-slate-600'}`}
                    >
                      按年/月输入
                    </button>
                    <button
                      type="button"
                      onClick={() => setTenureMode('dates')}
                      className={`px-2.5 py-1 font-medium ${tenureMode === 'dates' ? 'bg-[#11151C] text-[#F6F4EF]' : 'text-slate-600'}`}
                    >
                      按入离职日期
                    </button>
                  </div>
                </div>

                {tenureMode === 'manual' ? (
                  <div className="grid grid-cols-2 gap-3 max-w-md">
                    <label className="block">
                      <span className="text-[11px] text-slate-500">整年数</span>
                      <input
                        type="number"
                        min={0}
                        max={45}
                        value={manualYears}
                        onChange={(e) => setManualYears(e.target.value)}
                        className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3.5 py-2.5 font-num text-base font-bold text-[#11151C]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-500">零头月数（0–11）</span>
                      <input
                        type="number"
                        min={0}
                        max={11}
                        step="0.5"
                        value={manualMonths}
                        onChange={(e) => setManualMonths(e.target.value)}
                        className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3.5 py-2.5 font-num text-base font-bold text-[#11151C]"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 max-w-md">
                    <label className="block">
                      <span className="text-[11px] text-slate-500">入职日期</span>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 text-xs"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-500">解除/终止日期</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 text-xs"
                      />
                    </label>
                  </div>
                )}
                {tenure.warningText ? (
                  <p className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-800">
                    {tenure.warningText}
                  </p>
                ) : (
                  <p className="text-[11px] text-[#9A773E]">
                    当前依法折算系数：<strong className="font-num">N = {tenure.nMonths}</strong> 个月（不满6个月按0.5个月，满6个月不满1年按1个月）
                  </p>
                )}
              </div>
            )}

            {/* Salary Inputs */}
            <div className="grid gap-4 border-t border-[#EFECE5] pt-5 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-bold text-[#11151C]">
                  <span className="font-num mr-1.5 text-[#9A773E]">03</span>离职前 12 个月税前月均工资（元）
                </span>
                <input
                  type="number"
                  min={0}
                  step="100"
                  value={avgSalary}
                  onChange={(e) => {
                    setAvgSalary(e.target.value);
                    if (lastMonthSalary === avgSalary) setLastMonthSalary(e.target.value);
                  }}
                  className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3.5 py-2.5 font-num text-base font-bold text-[#11151C]"
                />
                <span className="mt-1 block text-[11px] text-slate-400">含基本工资、奖金、津贴、补贴（应发数，非扣社保税后）</span>
              </label>

              {scenario === 'n_plus_1' ? (
                <label className="block">
                  <span className="text-xs font-bold text-[#11151C]">解除前上一个月工资标准（+1 基数）</span>
                  <input
                    type="number"
                    min={0}
                    step="100"
                    value={lastMonthSalary}
                    onChange={(e) => setLastMonthSalary(e.target.value)}
                    className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3.5 py-2.5 font-num text-base font-bold text-[#11151C]"
                  />
                  <span className="mt-1 block text-[11px] text-slate-400">代通知金按上月工资计，不受三倍社平/12年限制</span>
                </label>
              ) : scenario !== 'double_wage' ? (
                <div className="space-y-3">
                  <label className="block">
                    <span className="flex items-center justify-between text-xs font-bold text-[#11151C]">
                      <span>当地三倍社平工资封顶（元/月）</span>
                      <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                        修改自动保存本机
                      </span>
                    </span>
                    <input
                      type="number"
                      min={1000}
                      step="100"
                      value={tripleCap}
                      onChange={(e) => setTripleCap(e.target.value)}
                      className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3.5 py-2.5 font-num text-base font-bold text-[#11151C]"
                    />
                    <span className="mt-1 block text-[11px] text-slate-400">
                      请按本省市人社部门最新公布的上年度职工月均工资 × 3 填写（默认参考 25,611 元，修改后永久保存在本机浏览器）
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-slate-600">
                      当前地区口径备注（随测算明细一起复制）
                    </span>
                    <input
                      type="text"
                      value={regionName}
                      onChange={(e) => setRegionName(e.target.value)}
                      placeholder="例：北京市 / 上海市 / 深圳市 / 杭州市"
                      className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-[#11151C]"
                    />
                  </label>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right: Results Card */}
          <div className="min-w-0 lg:col-span-5 space-y-5">
            <div className="bg-[#11151C] p-6 text-white">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#D1B27A]">
                    ESTIMATED COMPENSATION · 测算参考总额
                  </p>
                  <p className="mt-2 font-num text-3xl font-bold sm:text-4xl">{fmtYuan(calc.total)}</p>
                  <p className="mt-2 text-xs text-slate-300">{currentScenarioObj.title}</p>
                </div>
                <button
                  type="button"
                  onClick={copySummary}
                  className="inline-flex items-center gap-1 rounded-[2px] border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-[#D1B27A]" />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>

              {scenario === 'n_plus_1' && (
                <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-white/15 pt-4 text-xs">
                  <div className="bg-white/5 p-3">
                    <span className="text-slate-400">经济补偿部分（N）</span>
                    <p className="mt-1 font-num text-base font-bold">{fmtYuan(calc.total - calc.noticePay)}</p>
                  </div>
                  <div className="bg-white/5 p-3">
                    <span className="text-slate-400">代通知金（+1）</span>
                    <p className="mt-1 font-num text-base font-bold text-[#D1B27A]">{fmtYuan(calc.noticePay)}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="border border-[#DED8CC] bg-white p-6 space-y-4">
              <h3 className="font-display text-base font-bold text-[#11151C] border-b border-[#EFECE5] pb-3">
                逐项计算明细与实务提示
              </h3>
              <ul className="space-y-2.5 text-xs leading-6 text-slate-600">
                {calc.steps.map((step, i) => (
                  <li key={i} className="border-l-2 border-[#B89254]/50 pl-3">
                    {step}
                  </li>
                ))}
              </ul>

              <div className="border border-[#EFECE5] bg-[#FAF9F6] p-4 text-xs leading-6 text-slate-600">
                <strong className="text-[#11151C]">免税提示：</strong>
                依据财税政策，个人因解除劳动关系取得的一次性补偿收入，在当地上年职工平均工资 3 倍数额以内的部分，免征个人所得税；超过部分按规定单独计税。
              </div>

              <Link
                to={`/contact?type=${encodeURIComponent('劳动争议')}&sourceTool=${encodeURIComponent(`经济补偿金测算器（${activeRegionLabel}）`)}&note=${encodeURIComponent(`${summaryText}\n希望结合具体解除通知、考勤薪酬及程序合法性由律师进一步评估。`)}`}
                onClick={() => trackEvent('tool_to_contact')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[2px] bg-[#11151C] px-5 py-3 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D]"
              >
                <Send className="h-3.5 w-3.5 text-[#D1B27A]" />
                <span>带入测算结果预约劳动法律师</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>

        <ToolSeoKnowledgeSection routeKey="/tools/labor-compensation" />

        <p className="mx-auto mt-6 flex max-w-4xl items-start justify-center gap-1.5 text-center text-xs leading-6 text-slate-500">
          <Info className="mt-1 h-3.5 w-3.5 flex-none text-[#B89254]" />
          <span>
            本工具本地离线计算，不上传您的薪资与在职信息。年终奖分摊、未休年假工资、加班费基数及高薪三倍封顶口径存在地方司法裁量差异，结果仅供参考，不构成正式法律意见。
          </span>
        </p>
      </div>
    </div>
  );
};
