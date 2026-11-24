import React, { useMemo, useState } from 'react';
import { Link, useToolSearchParams as useSearchParams } from '../../components/ToolboxBridgeLink';
import { ArrowLeft, ArrowRight, Calculator, Check, Copy, Info, RotateCcw, Send } from 'lucide-react';
import { trackEvent } from '../../components/ToolboxBridgeLink';
import { copyToClipboard } from '../../lib/clipboard';
import { ToolQuickRefSection as ToolSeoKnowledgeSection } from '../../components/ToolQuickRefSection';

type CaseType =
  | 'property'
  | 'intellectual'
  | 'labor'
  | 'divorce'
  | 'personality'
  | 'execution'
  | 'preservation'
  | 'administrative'
  | 'nonProperty';

const CASE_TYPES: { id: CaseType; label: string; shortLabel: string; hint: string; supportsHalved: boolean }[] = [
  { id: 'property', label: '财产案件（合同/借款/侵权）', shortLabel: '财产案件', hint: '按争议标的额分段累进计算', supportsHalved: true },
  { id: 'intellectual', label: '知识产权案件（版权/商标/专利）', shortLabel: '知识产权', hint: '有争议金额按财产标准，无争议金额每件 500–1,000 元', supportsHalved: true },
  { id: 'labor', label: '劳动争议案件', shortLabel: '劳动争议', hint: '每件交纳 10 元（简易/调解减半 5 元）', supportsHalved: true },
  { id: 'divorce', label: '离婚案件', shortLabel: '离婚案件', hint: '每件 50–300 元，财产超 20 万元部分加收 0.5%', supportsHalved: true },
  { id: 'personality', label: '侵害人格权案件', shortLabel: '人格权案件', hint: '每件 100–500 元，赔偿超 5 万元分段加收', supportsHalved: true },
  { id: 'execution', label: '申请强制执行费', shortLabel: '执行申请费', hint: '按执行金额分段计算，无执行金额每件 50–500 元', supportsHalved: false },
  { id: 'preservation', label: '财产保全申请费', shortLabel: '财产保全费', hint: '按保全金额分段计算，最高不超过 5,000 元', supportsHalved: false },
  { id: 'administrative', label: '行政案件', shortLabel: '行政案件', hint: '商标/专利/海事行政每件 100 元，其他每件 50 元', supportsHalved: true },
  { id: 'nonProperty', label: '其他非财产案件', shortLabel: '其他非财产', hint: '每件交纳 50–100 元', supportsHalved: true },
];

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

function calcProperty(amount: number): { total: number; steps: string[] } {
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
    steps.push(`${tier.label}：${part.toLocaleString('zh-CN')} × ${(tier.rate * 100).toFixed(1)}% = ${fee.toFixed(2)} 元`);
    prev = tier.max;
  }
  return { total, steps };
}

function calcExecution(amount: number): { total: number; steps: string[] } {
  if (amount <= 0) return { total: 50, steps: ['无执行金额或不超过 1 万元：每件 50 – 500 元（按 50 元起计）'] };
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
    steps.push(`${t.label}：${part.toLocaleString('zh-CN')} × ${(t.rate * 100).toFixed(1)}% = ${fee.toFixed(2)} 元`);
  }
  return { total, steps };
}

function calcPreservation(amount: number): { total: number; steps: string[] } {
  if (amount <= 1000) return { total: 30, steps: ['财产数额不超过 1,000 元或不涉及财产数额：30 元'] };
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

const fmtYuan = (n: number) =>
  `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const LitigationFeeCalculator: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialType = (searchParams.get('type') as CaseType) || 'property';
  const validInitialType = CASE_TYPES.some((t) => t.id === initialType) ? initialType : 'property';

  const [caseType, setCaseType] = useState<CaseType>(validInitialType);
  const [unit, setUnit] = useState<'wan' | 'yuan'>(searchParams.get('unit') === 'yuan' ? 'yuan' : 'wan');
  const [amountStr, setAmountStr] = useState(searchParams.get('amount') || '10');
  const [hasAmount, setHasAmount] = useState(true);
  const [halved, setHalved] = useState(false);
  const [adminSpecial, setAdminSpecial] = useState(false);
  const [copied, setCopied] = useState(false);

  const rawNum = Math.max(0, Number(amountStr.replace(/,/g, '')) || 0);
  const amountYuan = unit === 'wan' ? rawNum * 10000 : rawNum;

  const currentTypeObj = CASE_TYPES.find((c) => c.id === caseType) || CASE_TYPES[0];

  const result = useMemo(() => {
    const applyHalf = (v: number) => (halved && currentTypeObj.supportsHalved ? v / 2 : v);

    switch (caseType) {
      case 'property': {
        const { total, steps } = calcProperty(amountYuan);
        const finalFee = applyHalf(total);
        return {
          headline: fmtYuan(finalFee),
          sub: halved ? `全额 ${total.toFixed(2)} 元，简易程序/调解/撤诉减半` : '一审普通程序全额受理费',
          steps,
          fullLifecycle: {
            firstFull: total,
            firstHalf: total / 2,
            preservation: calcPreservation(amountYuan).total,
            appeal: total,
            execution: calcExecution(amountYuan).total,
          },
        };
      }
      case 'intellectual': {
        if (!hasAmount) {
          return {
            headline: halved ? '¥ 250.00 – ¥ 500.00' : '¥ 500.00 – ¥ 1,000.00',
            sub: halved ? '无争议金额知产案件（减半估算）' : '无争议金额或价额，每件交纳 500 至 1,000 元',
            steps: ['未涉及争议金额或价额：依法每件交纳 500 元至 1,000 元', ...(halved ? ['简易程序/调解/撤诉减半：250 – 500 元'] : [])],
            fullLifecycle: null,
          };
        }
        const { total, steps } = calcProperty(amountYuan);
        const finalFee = applyHalf(total);
        return {
          headline: fmtYuan(finalFee),
          sub: halved ? `有争议金额全额 ${total.toFixed(2)} 元，简易/调解/撤诉减半` : '知识产权涉案金额按财产案件标准全额计收',
          steps,
          fullLifecycle: {
            firstFull: total,
            firstHalf: total / 2,
            preservation: calcPreservation(amountYuan).total,
            appeal: total,
            execution: calcExecution(amountYuan).total,
          },
        };
      }
      case 'labor':
        return {
          headline: halved ? '¥ 5.00' : '¥ 10.00',
          sub: halved ? '劳动争议每件 10 元（简易程序/调解/撤诉减半）' : '劳动争议案件每件固定交纳 10 元',
          steps: ['《诉讼费用交纳办法》第十三条第（四）项：劳动争议案件每件交纳 10 元'],
          fullLifecycle: null,
        };
      case 'divorce': {
        const extra = amountYuan > 200000 ? (amountYuan - 200000) * 0.005 : 0;
        const low = applyHalf(50 + extra);
        const high = applyHalf(300 + extra);
        return {
          headline: `${fmtYuan(low)} – ${fmtYuan(high)}`,
          sub: halved ? '含超出 20 万元财产分割部分（已减半）' : '每件 50 – 300 元，财产总额超 20 万元部分加收 0.5%',
          steps: [
            '基础受理费：每件 50 – 300 元',
            amountYuan > 200000
              ? `财产超 20 万元部分：(${amountYuan.toLocaleString('zh-CN')} - 200,000) × 0.5% = ${extra.toFixed(2)} 元`
              : '财产总额未超过 20 万元，不另行加收',
          ],
          fullLifecycle: null,
        };
      }
      case 'personality': {
        let extra = 0;
        const steps = ['基础受理费：每件 100 – 500 元'];
        if (amountYuan > 50000) {
          const p1 = Math.min(amountYuan, 100000) - 50000;
          extra += p1 * 0.01;
          steps.push(`5 万 – 10 万元部分 (1%)：${(p1 * 0.01).toFixed(2)} 元`);
        }
        if (amountYuan > 100000) {
          const p2 = amountYuan - 100000;
          extra += p2 * 0.005;
          steps.push(`超过 10 万元部分 (0.5%)：${(p2 * 0.005).toFixed(2)} 元`);
        }
        return {
          headline: `${fmtYuan(applyHalf(100 + extra))} – ${fmtYuan(applyHalf(500 + extra))}`,
          sub: halved ? '侵害人格权案件（已减半估算）' : '每件 100 – 500 元，损害赔偿超 5 万元部分分段加收',
          steps,
          fullLifecycle: null,
        };
      }
      case 'execution': {
        const { total, steps } = calcExecution(amountYuan);
        return {
          headline: fmtYuan(total),
          sub: '申请执行费（依法由被执行人负担，一般无需申请人预交）',
          steps,
          fullLifecycle: null,
        };
      }
      case 'preservation': {
        const { total, steps } = calcPreservation(amountYuan);
        return {
          headline: fmtYuan(total),
          sub: '财产保全申请费（法定最高封顶 5,000 元，不含保全担保/保函费）',
          steps,
          fullLifecycle: null,
        };
      }
      case 'administrative': {
        const base = adminSpecial ? 100 : 50;
        return {
          headline: fmtYuan(applyHalf(base)),
          sub: adminSpecial ? '商标、专利、海事行政案件每件 100 元' : '其他行政案件每件 50 元',
          steps: [adminSpecial ? '商标、专利、海事行政案件：100 元/件' : '一般行政案件：50 元/件'],
          fullLifecycle: null,
        };
      }
      case 'nonProperty':
        return {
          headline: halved ? '¥ 25.00 – ¥ 50.00' : '¥ 50.00 – ¥ 100.00',
          sub: halved ? '其他非财产案件（已减半）' : '其他非财产案件每件交纳 50 至 100 元',
          steps: ['《诉讼费用交纳办法》第十三条第（二）项第3目：每件交纳 50 元至 100 元'],
          fullLifecycle: null,
        };
    }
  }, [caseType, amountYuan, hasAmount, halved, adminSpecial, currentTypeObj.supportsHalved]);

  const showAmountInput =
    caseType === 'property' ||
    caseType === 'divorce' ||
    caseType === 'personality' ||
    caseType === 'execution' ||
    caseType === 'preservation' ||
    (caseType === 'intellectual' && hasAmount);

  const summaryText = useMemo(() => {
    const lines = [
      `【诉讼费测算 · ${currentTypeObj.label}】`,
      showAmountInput ? `涉案标的额：${amountYuan.toLocaleString('zh-CN')} 元（${(amountYuan / 10000).toFixed(2)} 万元）` : '',
      `当前估算结果：${result.headline}（${result.sub}）`,
    ];
    if (result.fullLifecycle) {
      lines.push(
        `全流程参考：一审全额 ${result.fullLifecycle.firstFull.toFixed(2)} 元｜简易/调解减半 ${result.fullLifecycle.firstHalf.toFixed(2)} 元｜财产保全费 ${result.fullLifecycle.preservation.toFixed(2)} 元｜二审上诉费 ${result.fullLifecycle.appeal.toFixed(2)} 元｜执行申请费 ${result.fullLifecycle.execution.toFixed(2)} 元`
      );
    }
    return lines.filter(Boolean).join('\n');
  }, [currentTypeObj.label, showAmountInput, amountYuan, result]);

  const copyBreakdown = async () => {
    try {
      await copyToClipboard(`${summaryText}\n计算明细：\n${result.steps.map((s) => `- ${s}`).join('\n')}`);
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
            to="/articles/civil-commercial-dispute-pre-assessment"
            className="text-xs font-medium text-[#0E223D] underline decoration-[#B89254]/60 underline-offset-4 hover:text-[#9A773E]"
          >
            阅读配套指引：《民商事合同纠纷诉前评估与保全成本》 →
          </Link>
        </div>

        {/* Header */}
        <div className="mt-2">
          <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9A773E]">
            <Calculator className="h-3.5 w-3.5 text-[#B89254]" />
            <span>LITIGATION FEE CALCULATOR · 依据《诉讼费用交纳办法》</span>
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold text-[#11151C] sm:text-4xl">
            诉讼费与诉讼全成本计算器
          </h1>
          <p className="mt-2.5 max-w-2xl text-sm leading-7 text-slate-600">
            输入标的额即可一单看清一审受理费、简易/调解减半、财产保全费、二审上诉费及执行申请费，附逐档公式明细与一键复制。
          </p>
        </div>

        {/* Mobile Compact Type Pills (wrapped so every case type stays visible without clipped scroll edges) */}
        <div className="mt-6 lg:hidden">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">选择案件类型</p>
          <div className="flex flex-wrap gap-1.5">
            {CASE_TYPES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setCaseType(item.id)}
                className={`rounded-[2px] px-3 py-2 text-xs font-semibold transition-colors ${
                  caseType === item.id
                    ? 'bg-[#11151C] text-[#F6F4EF]'
                    : 'border border-[#DED8CC] bg-white text-slate-700'
                }`}
              >
                {item.shortLabel}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          {/* Desktop Left Type List */}
          <div className="hidden lg:block lg:col-span-4 space-y-1.5">
            {CASE_TYPES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setCaseType(item.id)}
                className={`w-full rounded-[2px] border px-4 py-3 text-left transition-colors ${
                  caseType === item.id
                    ? 'border-[#11151C] bg-[#11151C] text-[#F6F4EF]'
                    : 'border-[#DED8CC] bg-white text-slate-700 hover:border-[#11151C]'
                }`}
              >
                <p className="text-xs font-bold">{item.label}</p>
                <p className={`mt-0.5 text-[11px] ${caseType === item.id ? 'text-[#D1B27A]' : 'text-slate-400'}`}>
                  {item.hint}
                </p>
              </button>
            ))}
          </div>

          {/* Right Calculator & Full Lifecycle Breakdown */}
          <div className="min-w-0 lg:col-span-8 space-y-5">
            <div className="min-w-0 border border-[#DED8CC] bg-white p-4 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-4">
                <h2 className="font-display text-lg font-bold text-[#11151C]">{currentTypeObj.label}</h2>
                <button
                  type="button"
                  onClick={() => {
                    setAmountStr('10');
                    setUnit('wan');
                    setHalved(false);
                    setHasAmount(true);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-[#11151C]"
                >
                  <RotateCcw className="h-3 w-3" /> 重置
                </button>
              </div>

              <div className="mt-5 space-y-5">
                {caseType === 'intellectual' && (
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={hasAmount}
                      onChange={(e) => setHasAmount(e.target.checked)}
                      className="h-4 w-4 accent-[#11151C]"
                    />
                    <span>涉及具体赔偿/争议金额（勾选后按财产案件分段标准计算）</span>
                  </label>
                )}

                {caseType === 'administrative' && (
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={adminSpecial}
                      onChange={(e) => setAdminSpecial(e.target.checked)}
                      className="h-4 w-4 accent-[#11151C]"
                    />
                    <span>属于商标、专利或海事行政案件（每件 100 元）</span>
                  </label>
                )}

                {showAmountInput && (
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <label className="text-xs font-semibold text-slate-700">
                        {caseType === 'execution'
                          ? '申请执行金额'
                          : caseType === 'preservation'
                          ? '申请保全财产数额'
                          : caseType === 'divorce'
                          ? '涉及分割财产总额'
                          : '诉讼标的额 / 诉请赔偿总额'}
                      </label>
                      <span className="font-num text-[11px] text-slate-400">
                        折合人民币：{amountYuan.toLocaleString('zh-CN')} 元
                      </span>
                    </div>
                    <div className="mt-2 flex items-stretch gap-2">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={amountStr}
                        onChange={(e) => setAmountStr(e.target.value)}
                        placeholder="请输入金额"
                        className="min-w-0 w-full flex-1 rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3.5 py-2.5 sm:px-4 sm:py-3 font-num text-lg sm:text-xl font-bold text-[#11151C] outline-none focus:border-[#11151C] focus:bg-white"
                      />
                      <div className="inline-flex flex-none border border-[#D8D2C6] bg-[#FAF9F6] p-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (unit === 'yuan') {
                              setUnit('wan');
                              setAmountStr(rawNum ? String(Number((rawNum / 10000).toFixed(4))) : '');
                            }
                          }}
                          className={`whitespace-nowrap px-3 py-2 text-xs font-semibold transition-colors ${
                            unit === 'wan' ? 'bg-[#11151C] text-[#F6F4EF]' : 'text-slate-600'
                          }`}
                        >
                          万元
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (unit === 'wan') {
                              setUnit('yuan');
                              setAmountStr(rawNum ? String(Math.round(rawNum * 10000)) : '');
                            }
                          }}
                          className={`whitespace-nowrap px-3 py-2 text-xs font-semibold transition-colors ${
                            unit === 'yuan' ? 'bg-[#11151C] text-[#F6F4EF]' : 'text-slate-600'
                          }`}
                        >
                          元
                        </button>
                      </div>
                    </div>

                    {/* Quick Amount Chips */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-400">常用金额：</span>
                      {[5, 10, 30, 50, 100, 500].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => {
                            setUnit('wan');
                            setAmountStr(String(v));
                          }}
                          className="rounded-[2px] border border-[#E4DFD4] bg-[#FAF9F6] px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-[#11151C] hover:text-[#11151C]"
                        >
                          {v} 万元
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Halved Toggle available across ALL eligible case types (including IP!) */}
                {currentTypeObj.supportsHalved && (
                  <label className="flex cursor-pointer items-center gap-2.5 border border-[#EFECE5] bg-[#FAF9F6] px-4 py-3 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={halved}
                      onChange={(e) => setHalved(e.target.checked)}
                      className="h-4 w-4 accent-[#11151C]"
                    />
                    <span>
                      <strong className="text-[#11151C]">适用简易程序 / 调解结案 / 撤诉（减半交纳受理费）</strong>
                    </span>
                  </label>
                )}
              </div>

              {/* Primary Result Banner */}
              <div className="mt-6 bg-[#11151C] p-6 text-white">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#D1B27A]">
                      ESTIMATED COURT FEE · 估算结果
                    </p>
                    <p className="mt-2 font-num text-3xl font-bold tracking-tight sm:text-4xl">{result.headline}</p>
                    <p className="mt-2 text-xs text-slate-300">{result.sub}</p>
                  </div>
                  <button
                    type="button"
                    onClick={copyBreakdown}
                    className="inline-flex items-center gap-1.5 rounded-[2px] border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-medium text-white hover:bg-white/20"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-[#D1B27A]" />}
                    <span>{copied ? '已复制明细' : '复制测算明细'}</span>
                  </button>
                </div>
              </div>

              {/* Full-Lifecycle Litigation Cost Overview Card */}
              {result.fullLifecycle && (
                <div className="mt-5 border border-[#E4DFD4] bg-[#FAF9F6] p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9A773E]">
                    ONE-STOP BUDGET · 同标的额诉讼全流程官费一览
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="border border-[#EAE5DB] bg-white p-3">
                      <p className="text-[11px] text-slate-400">一审普通 / 减半</p>
                      <p className="mt-1 font-num text-sm font-bold text-[#11151C]">
                        {fmtYuan(result.fullLifecycle.firstFull)}
                      </p>
                      <p className="font-num text-[11px] text-[#9A773E]">
                        减半 {fmtYuan(result.fullLifecycle.firstHalf)}
                      </p>
                    </div>
                    <div className="border border-[#EAE5DB] bg-white p-3">
                      <p className="text-[11px] text-slate-400">财产保全费</p>
                      <p className="mt-1 font-num text-sm font-bold text-[#11151C]">
                        {fmtYuan(result.fullLifecycle.preservation)}
                      </p>
                      <p className="text-[10px] text-slate-400">5,000 元封顶</p>
                    </div>
                    <div className="border border-[#EAE5DB] bg-white p-3">
                      <p className="text-[11px] text-slate-400">二审上诉费</p>
                      <p className="mt-1 font-num text-sm font-bold text-[#11151C]">
                        {fmtYuan(result.fullLifecycle.appeal)}
                      </p>
                      <p className="text-[10px] text-slate-400">按上诉标的计</p>
                    </div>
                    <div className="border border-[#EAE5DB] bg-white p-3">
                      <p className="text-[11px] text-slate-400">申请执行费</p>
                      <p className="mt-1 font-num text-sm font-bold text-[#11151C]">
                        {fmtYuan(result.fullLifecycle.execution)}
                      </p>
                      <p className="text-[10px] text-slate-400">被执行人负担</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step-by-step Formula Breakdown */}
              <div className="mt-5 border border-[#EFECE5] bg-[#FAF9F6] p-4 sm:p-5">
                <p className="text-xs font-bold text-[#11151C]">分段计算明细</p>
                <ul className="mt-2.5 space-y-1.5 text-xs leading-6 text-slate-600">
                  {result.steps.map((s, i) => (
                    <li key={i} className="break-words font-mono text-[11.5px]">
                      • {s}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action Bridge */}
              <div className="mt-6 flex flex-col gap-3 border-t border-[#EFECE5] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-1.5 text-xs leading-5 text-slate-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-[#B89254]" />
                  <span>以上为国务院《诉讼费用交纳办法》估算结果，最终以受理法院缴费通知书为准。</span>
                </p>
                <Link
                  to={`/contact?type=${encodeURIComponent(
                    caseType === 'intellectual'
                      ? '著作权与影视版权'
                      : caseType === 'labor'
                      ? '劳动争议'
                      : '民商事争议'
                  )}&sourceTool=${encodeURIComponent('诉讼费与诉讼全成本计算器')}&note=${encodeURIComponent(
                    `${summaryText}\n希望结合案件胜算、保全必要性与回款可行性进一步咨询。`
                  )}`}
                  onClick={() => trackEvent('tool_to_contact')}
                  className="inline-flex flex-none items-center justify-center gap-2 rounded-[2px] bg-[#11151C] px-5 py-2.5 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D]"
                >
                  <Send className="h-3.5 w-3.5 text-[#D1B27A]" />
                  <span>带入测算结果预约评估</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        <ToolSeoKnowledgeSection routeKey="/tools/litigation-fee-calculator" />
      </div>
    </div>
  );
};
