import React, { useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Coins,
  Copy,
  Plus,
  Scale,
  Trash2,
} from 'lucide-react';
import { useToolbox } from '../../context/ToolboxContext';
import { copyToClipboard } from '../../lib/clipboard';
import {
  calculateArt561Offset,
  toLegalRmbUppercase,
  type RepaymentRow,
} from '../../lib/financeUtils';

interface ClaimLine {
  id: string;
  label: string;
  amountStr: string;
}

export const RmbAndDebtOffsetTool: React.FC = () => {
  const { recordCalculation, showToast } = useToolbox();
  const [tab, setTab] = useState<'rmb_sum' | 'art561'>('rmb_sum');
  const [copied, setCopied] = useState(false);

  // Tab 1 state: RMB uppercase + multi-claim summation
  const [singleAmt, setSingleAmt] = useState('128500');
  const [claimLines, setClaimLines] = useState<ClaimLine[]>([
    { id: 'c1', label: '本金 / 侵权赔偿金', amountStr: '100000' },
    { id: 'c2', label: '律师代理费（合理维权开支）', amountStr: '15000' },
    { id: 'c3', label: '公证 / 时间戳取证费', amountStr: '2000' },
  ]);

  // Tab 2 state: Civil Code Art. 561 offset
  const [principalStr, setPrincipalStr] = useState('1000000');
  const [expenseStr, setExpenseStr] = useState('15000');
  const [startDate, setStartDate] = useState('2025-01-01');
  const [settleDate, setSettleDate] = useState(() =>
    new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  );
  const [rateStr, setRateStr] = useState('12.4');
  const [yearBasis, setYearBasis] = useState<365 | 360>(365);
  const [repayments, setRepayments] = useState<RepaymentRow[]>([
    { id: 'r1', date: '2025-06-15', amount: 120000 },
    { id: 'r2', date: '2026-01-20', amount: 250000 },
  ]);

  const singleNum = Number(singleAmt) || 0;
  const singleFormalStr = `${toLegalRmbUppercase(singleNum)}（¥${singleNum.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}元）`;

  const sumClaims = useMemo(() => {
    const total = claimLines.reduce((acc, c) => acc + (Number(c.amountStr) || 0), 0);
    const rounded = Math.round(total * 100) / 100;
    const text = [
      `诉讼请求标的额合计：${toLegalRmbUppercase(rounded)}（¥${rounded.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
      })}元），其中：`,
      ...claimLines.map((c, idx) => {
        const v = Number(c.amountStr) || 0;
        return `${idx + 1}. ${c.label || '款项'}：${toLegalRmbUppercase(v)}（¥${v.toLocaleString('zh-CN', {
          minimumFractionDigits: 2,
        })}元）；`;
      }),
    ].join('\n');
    return { total: rounded, text };
  }, [claimLines]);

  const offsetResult = useMemo(
    () =>
      calculateArt561Offset({
        initialPrincipal: Number(principalStr) || 0,
        initialExpense: Number(expenseStr) || 0,
        startDate,
        annualRatePercent: Number(rateStr) || 0,
        yearBasis,
        repayments,
        settleDate,
      }),
    [principalStr, expenseStr, startDate, rateStr, yearBasis, repayments, settleDate]
  );

  const offsetSummaryText = useMemo(() => {
    const lines = [
      `【依《民法典》第561条债之冲抵核算明细表】`,
      `初始本金：¥${(Number(principalStr) || 0).toLocaleString('zh-CN')} 元｜初始实现债权费用：¥${(Number(expenseStr) || 0).toLocaleString('zh-CN')} 元`,
      `起算日期：${startDate}｜核算截止日：${settleDate}｜约定/法定年利率：${rateStr}%（按年${yearBasis}天计）`,
      `冲抵顺序：先冲抵实现债权的有关费用 → 次冲抵截至各还款日累计利息 → 剩余冲抵主债务本金`,
      `---`,
      ...offsetResult.rows.map(
        (r) =>
          `第${r.index}期（${r.payDate}，计息${r.days}天）：还款 ¥${r.paymentAmount.toLocaleString('zh-CN')} ＝ 冲费用 ¥${r.paidToExpense.toLocaleString('zh-CN')} ＋ 冲利息 ¥${r.paidToInterest.toLocaleString('zh-CN')} ＋ 冲本金 ¥${r.paidToPrincipal.toLocaleString('zh-CN')}（冲抵后尚欠本金 ¥${r.principalAfter.toLocaleString('zh-CN')}）`
      ),
      `---`,
      `截至 ${settleDate} 尚欠总额：¥${offsetResult.totalGrandRemaining.toLocaleString('zh-CN')} 元（${toLegalRmbUppercase(offsetResult.totalGrandRemaining)}）`,
      `其中：尚欠本金 ¥${offsetResult.finalPrincipal.toLocaleString('zh-CN')} 元｜尚欠利息 ¥${offsetResult.finalUnpaidInterest.toLocaleString('zh-CN')} 元｜尚欠费用 ¥${offsetResult.finalUnpaidExpense.toLocaleString('zh-CN')} 元。`,
    ];
    return lines.join('\n');
  }, [principalStr, expenseStr, startDate, settleDate, rateStr, yearBasis, offsetResult]);

  const copyText = async (txt: string) => {
    const ok = await copyToClipboard(txt);
    if (!ok) {
      showToast('复制受限，请长按手动复制');
      return;
    }
    setCopied(true);
    showToast('已复制到剪贴板');
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="py-5 sm:py-8 px-4 sm:px-6 mx-auto max-w-6xl">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9A773E]">
        <Coins className="h-3.5 w-3.5 text-[#B89254]" />
        <span>LEGAL AMOUNT & CIVIL CODE ART.561 OFFSET</span>
      </div>
      <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-[#11151C]">
        法院文书金额大写 & 第 561 条债之冲抵计算器
      </h1>
      <p className="mt-1.5 text-xs sm:text-sm leading-6 text-slate-600">
        消除诉状与和解协议大写金额笔误，并支持多期不规则还款按《民法典》第 561 条「费用 → 利息 → 本金」顺序一键生成法院认可的冲抵核算表。
      </p>

      <div className="mt-5 grid grid-cols-2 rounded-lg border border-[#DED8CC] bg-white p-1">
        <button
          type="button"
          onClick={() => setTab('rmb_sum')}
          className={`rounded-md py-2.5 text-xs sm:text-sm font-semibold transition-colors ${
            tab === 'rmb_sum' ? 'bg-[#0E223D] text-white' : 'text-slate-600'
          }`}
        >
          财务大写 & 诉请多项汇总
        </button>
        <button
          type="button"
          onClick={() => setTab('art561')}
          className={`rounded-md py-2.5 text-xs sm:text-sm font-semibold transition-colors ${
            tab === 'art561' ? 'bg-[#0E223D] text-white' : 'text-slate-600'
          }`}
        >
          《民法典》第561条还款冲抵表
        </button>
      </div>

      {tab === 'rmb_sum' ? (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Instant Single Amount Converter */}
          <div className="lg:col-span-5 rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-4">
            <h2 className="font-display text-base font-bold text-[#11151C]">单笔金额秒转标准文书格式</h2>
            <input
              type="text"
              inputMode="decimal"
              value={singleAmt}
              onChange={(e) => setSingleAmt(e.target.value.replace(/[^\d.-]/g, ''))}
              placeholder="输入小写数字，如 128500.50"
              className="w-full rounded-md border border-[#D8D1C3] bg-[#FAF9F6] px-3.5 py-2.5 font-num text-lg font-bold text-[#11151C] focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
            <div className="rounded-md bg-[#0E223D] p-4 text-[#F6F4EF]">
              <div className="text-[10px] uppercase tracking-wider text-[#D1B27A]">起诉状 / 合同标准表述</div>
              <div className="mt-1.5 font-display text-base sm:text-lg font-bold leading-7 break-words">
                {singleFormalStr}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => copyText(singleFormalStr)}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-[#B89254] py-2 text-xs font-bold text-[#11151C]"
                >
                  <Copy className="h-3.5 w-3.5" /> 复制大写+小写
                </button>
                <button
                  type="button"
                  onClick={() => copyText(toLegalRmbUppercase(singleNum))}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-white/10 py-2 text-xs font-semibold text-white"
                >
                  仅复制大写
                </button>
              </div>
            </div>
          </div>

          {/* Multi-Claim Adder */}
          <div className="lg:col-span-7 rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-[#11151C]">
                诉讼请求多笔款项汇总条（自动生成诉状段）
              </h2>
              <button
                type="button"
                onClick={() =>
                  setClaimLines([
                    ...claimLines,
                    { id: `c-${Date.now()}`, label: '其他合理费用', amountStr: '0' },
                  ])
                }
                className="flex-none whitespace-nowrap inline-flex items-center gap-1 rounded border border-[#0E223D] px-2.5 py-1 text-xs font-semibold text-[#0E223D]"
              >
                <Plus className="h-3.5 w-3.5" /> 加一项
              </button>
            </div>

            <div className="space-y-2">
              {claimLines.map((line) => (
                <div key={line.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={line.label}
                    onChange={(e) =>
                      setClaimLines(
                        claimLines.map((x) => (x.id === line.id ? { ...x, label: e.target.value } : x))
                      )
                    }
                    className="flex-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-2 text-xs"
                    placeholder="款项名称"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.amountStr}
                    onChange={(e) =>
                      setClaimLines(
                        claimLines.map((x) =>
                          x.id === line.id ? { ...x, amountStr: e.target.value.replace(/[^\d.]/g, '') } : x
                        )
                      )
                    }
                    className="w-32 sm:w-40 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-2 font-num text-xs font-bold text-right"
                    placeholder="金额(元)"
                  />
                  {claimLines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setClaimLines(claimLines.filter((x) => x.id !== line.id))}
                      className="p-1.5 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="rounded-md bg-[#FAF9F6] border border-[#E4DFD4] p-3.5">
              <pre className="whitespace-pre-wrap font-sans text-xs leading-6 text-[#14181F]">
                {sumClaims.text}
              </pre>
              <button
                type="button"
                onClick={() => copyText(sumClaims.text)}
                className="mt-3 inline-flex items-center gap-1.5 rounded bg-[#0E223D] px-3.5 py-2 text-xs font-semibold text-white"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                一键复制诉请合计表述
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Tab 2: Art 561 Offset */
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">初始欠款本金（元）</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={principalStr}
                  onChange={(e) => setPrincipalStr(e.target.value.replace(/[^\d.]/g, ''))}
                  className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-num text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">实现债权费用（元）</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={expenseStr}
                  onChange={(e) => setExpenseStr(e.target.value.replace(/[^\d.]/g, ''))}
                  className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-num text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">计息起算日</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-2 font-num text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">核算截止日</label>
                <input
                  type="date"
                  value={settleDate}
                  onChange={(e) => setSettleDate(e.target.value)}
                  className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-2 font-num text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">约定/法定年利率 (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={rateStr}
                  onChange={(e) => setRateStr(e.target.value.replace(/[^\d.]/g, ''))}
                  className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-num text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#11151C] mb-1">计息年基准天数</label>
                <select
                  value={yearBasis}
                  onChange={(e) => setYearBasis(Number(e.target.value) as 365 | 360)}
                  className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-2 text-xs font-semibold"
                >
                  <option value={365}>365 天/年（民事常规）</option>
                  <option value={360}>360 天/年（金融合同约定）</option>
                </select>
              </div>
            </div>

            <div className="pt-2 border-t border-[#EFECE5]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#11151C]">各期实际还款流水</span>
                <button
                  type="button"
                  onClick={() =>
                    setRepayments([
                      ...repayments,
                      { id: `r-${Date.now()}`, date: settleDate, amount: 50000 },
                    ])
                  }
                  className="inline-flex items-center gap-1 rounded bg-[#0E223D] px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  <Plus className="h-3 w-3" /> 添加还款
                </button>
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {repayments.map((rep) => (
                  <div key={rep.id} className="flex items-center gap-2">
                    <input
                      type="date"
                      value={rep.date}
                      onChange={(e) =>
                        setRepayments(
                          repayments.map((x) => (x.id === rep.id ? { ...x, date: e.target.value } : x))
                        )
                      }
                      className="rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2 py-1.5 font-num text-xs"
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(rep.amount)}
                      onChange={(e) =>
                        setRepayments(
                          repayments.map((x) =>
                            x.id === rep.id
                              ? { ...x, amount: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 }
                              : x
                          )
                        )
                      }
                      className="flex-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-1.5 font-num text-xs font-bold text-right"
                      placeholder="还款金额"
                    />
                    <button
                      type="button"
                      onClick={() => setRepayments(repayments.filter((x) => x.id !== rep.id))}
                      className="p-1 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Offset Ledger */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-lg bg-[#0E223D] p-5 text-[#F6F4EF]">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#D1B27A]">
                REMAINING BALANCE · 冲抵后尚欠本息费总额
              </div>
              <div className="mt-1.5 font-num text-3xl font-bold text-white">
                ¥ {offsetResult.totalGrandRemaining.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
              </div>
              <div className="mt-0.5 text-xs text-[#D1B27A]">
                {toLegalRmbUppercase(offsetResult.totalGrandRemaining)}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/15 pt-3 text-xs">
                <div>
                  <div className="text-slate-400">尚欠本金</div>
                  <div className="font-num font-bold mt-0.5">
                    ¥{offsetResult.finalPrincipal.toLocaleString('zh-CN')}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">尚欠利息</div>
                  <div className="font-num font-bold mt-0.5">
                    ¥{offsetResult.finalUnpaidInterest.toLocaleString('zh-CN')}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">已还总额</div>
                  <div className="font-num font-bold text-emerald-300 mt-0.5">
                    ¥{offsetResult.totalPaid.toLocaleString('zh-CN')}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyText(offsetSummaryText)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded bg-[#B89254] py-2.5 text-xs font-bold text-[#11151C]"
                >
                  <Copy className="h-3.5 w-3.5" /> 复制冲抵明细表（贴入诉状附件）
                </button>
                <button
                  type="button"
                  onClick={() =>
                    recordCalculation(
                      'rmb-debt-offset',
                      '第561条还款冲抵核算',
                      `尚欠总额 ¥${offsetResult.totalGrandRemaining.toLocaleString('zh-CN')}`,
                      offsetSummaryText
                    )
                  }
                  className="inline-flex items-center justify-center gap-1.5 rounded bg-white/10 border border-white/20 px-3.5 py-2.5 text-xs font-semibold text-white"
                >
                  <BookmarkPlus className="h-3.5 w-3.5 text-[#D1B27A]" /> 保存记录
                </button>
              </div>
            </div>

            {/* Period Cards */}
            <div className="rounded-lg border border-[#DED8CC] bg-white p-4">
              <div className="flex items-center gap-1.5 font-display text-sm font-bold text-[#11151C] mb-3">
                <Scale className="h-4 w-4 text-[#B89254]" />
                逐期冲抵拆解（依《民法典》第561条：费用 → 利息 → 本金）
              </div>
              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {offsetResult.rows.map((r) => (
                  <div key={r.index} className="rounded border border-[#EAE5DA] bg-[#FAF9F6] p-3 text-xs">
                    <div className="flex justify-between font-bold text-[#11151C]">
                      <span>
                        第 {r.index} 期还款（{r.payDate} · 计息 {r.days} 天）
                      </span>
                      <span className="font-num text-[#0E223D]">
                        还款 ¥{r.paymentAmount.toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 font-num text-[11px] text-slate-600">
                      <span>冲费用：¥{r.paidToExpense.toLocaleString('zh-CN')}</span>
                      <span>冲利息：¥{r.paidToInterest.toLocaleString('zh-CN')}</span>
                      <span>冲本金：¥{r.paidToPrincipal.toLocaleString('zh-CN')}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 font-num">
                      本期冲抵后剩余本金：¥{r.principalAfter.toLocaleString('zh-CN')}｜未结清利息：¥{r.unpaidInterestAfter.toLocaleString('zh-CN')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
