import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useToolbox } from '../../context/ToolboxContext';
import { copyToClipboard } from '../../lib/clipboard';
import type { ScratchpadNote } from '../../types/toolbox';

const SCENES: { id: ScratchpadNote['scene']; label: string }[] = [
  { id: 'meeting_client', label: '客户当面咨询' },
  { id: 'detention_visit', label: '看守所会见' },
  { id: 'court_trial', label: '法庭庭审记录' },
  { id: 'phone_consult', label: '电话沟通速记' },
];

function createBlankNote(): ScratchpadNote {
  return {
    id: `note-${Date.now()}`,
    title: `办案速记 ${new Date().toLocaleDateString('zh-CN')}`,
    scene: 'meeting_client',
    facts: '',
    disputes: '',
    missingEvidence: '',
    todoItems: '',
    durationSec: 0,
    updatedAt: new Date().toISOString(),
  };
}

function formatSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export const MeetingScratchpadTool: React.FC = () => {
  const { scratchpads, setScratchpads, sendToAi, showToast } = useToolbox();

  const [activeId, setActiveId] = useState<string>(() => {
    if (scratchpads.length > 0) return scratchpads[0].id;
    return '';
  });
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  // Initialize one note if empty
  useEffect(() => {
    if (scratchpads.length === 0) {
      const first = createBlankNote();
      setScratchpads([first]);
      setActiveId(first.id);
    } else if (!scratchpads.some((n) => n.id === activeId)) {
      setActiveId(scratchpads[0].id);
    }
  }, [scratchpads, activeId, setScratchpads]);

  const current = scratchpads.find((n) => n.id === activeId) || scratchpads[0];

  const updateCurrent = (patch: Partial<ScratchpadNote>) => {
    if (!current) return;
    const next = scratchpads.map((n) =>
      n.id === current.id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n
    );
    setScratchpads(next);
  };

  const scratchpadsRef = useRef(scratchpads);
  scratchpadsRef.current = scratchpads;
  const activeIdRef = useRef(current?.id || '');
  activeIdRef.current = current?.id || '';

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const cid = activeIdRef.current;
      if (!cid) return;
      setScratchpads(
        scratchpadsRef.current.map((n) =>
          n.id === cid ? { ...n, durationSec: (n.durationSec || 0) + 1 } : n
        )
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, setScratchpads]);

  if (!current) return null;

  const sceneLabel = SCENES.find((s) => s.id === current.scene)?.label || '办案速记';

  const buildMarkdown = () => {
    return [
      `# ${current.title}`,
      `- 场景：${sceneLabel}`,
      `- 记录时长：${formatSec(current.durationSec || 0)}`,
      `- 更新时间：${new Date(current.updatedAt).toLocaleString('zh-CN', { hour12: false })}`,
      ``,
      `## 一、核心事实与关键时间点`,
      current.facts || '（暂未填写）',
      ``,
      `## 二、客户核心诉求 / 庭审争议焦点`,
      current.disputes || '（暂未填写）',
      ``,
      `## 三、缺失证据与待调证线索`,
      current.missingEvidence || '（暂未填写）',
      ``,
      `## 四、律师下一步待办承诺`,
      current.todoItems || '（暂未填写）',
    ].join('\n');
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(buildMarkdown());
    if (!ok) {
      showToast('复制受限，请导出 .md 文件');
      return;
    }
    setCopied(true);
    showToast('已复制完整结构化速记');
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadMd = () => {
    const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${current.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="py-5 sm:py-8 px-4 sm:px-6 mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9A773E]">
            <NotebookPen className="h-3.5 w-3.5 text-[#B89254]" />
            <span>OFFLINE AUTO-SAVE SCRATCHPAD · 每字实时防丢存盘</span>
          </div>
          <h1 className="mt-1.5 font-display text-2xl sm:text-3xl font-bold text-[#11151C]">
            会见 / 庭审 / 客户咨询结构化速记板
          </h1>
        </div>

        {/* Built-in Billable / Visit Timer */}
        <div className="flex items-center gap-2 rounded-lg bg-[#0E223D] px-3.5 py-2 text-[#F6F4EF]">
          <span className="font-num text-sm font-bold tracking-wider text-[#D1B27A]">
            {formatSec(current.durationSec || 0)}
          </span>
          <button
            type="button"
            onClick={() => setRunning((v) => !v)}
            className="inline-flex items-center gap-1 rounded bg-[#B89254] px-2.5 py-1 text-xs font-bold text-[#11151C]"
          >
            {running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {running ? '暂停计时' : '计工时'}
          </button>
        </div>
      </div>

      {/* Note Selector Strip */}
      <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <button
          type="button"
          onClick={() => {
            const created = createBlankNote();
            setScratchpads([created, ...scratchpads]);
            setActiveId(created.id);
            setRunning(false);
          }}
          className="flex-none inline-flex items-center gap-1 rounded-md border border-[#0E223D] bg-[#0E223D] px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5 text-[#D1B27A]" /> 新建速记
        </button>

        {scratchpads.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => {
              setActiveId(n.id);
              setRunning(false);
            }}
            className={`flex-none rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              n.id === current.id
                ? 'border-[#B89254] bg-[#F3ECE0] font-bold text-[#11151C]'
                : 'border-[#DED8CC] bg-white text-slate-600'
            }`}
          >
            {n.title}
          </button>
        ))}
      </div>

      {/* Editor Card */}
      <div className="mt-4 rounded-lg border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={current.title}
            onChange={(e) => updateCurrent({ title: e.target.value })}
            placeholder="输入案件/当事人标题…"
            className="flex-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 font-display text-sm font-bold text-[#11151C] focus:border-[#0E223D] focus:bg-white focus:outline-none"
          />
          <div className="flex gap-1.5 flex-wrap">
            {SCENES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => updateCurrent({ scene: s.id })}
                className={`rounded border px-2.5 py-1.5 text-xs font-medium ${
                  current.scene === s.id
                    ? 'border-[#0E223D] bg-[#0E223D] text-white'
                    : 'border-[#DED8CC] bg-[#FAF9F6] text-slate-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#0E223D] mb-1">
              1. 核心事实与关键时间节点（支持手机语音输入）
            </label>
            <textarea
              rows={5}
              value={current.facts}
              onChange={(e) => updateCurrent({ facts: e.target.value })}
              placeholder="按发生先后随手记录关键人物、时间、转账、签约或涉案经过…"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] p-2.5 text-xs sm:text-sm leading-6 focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#0E223D] mb-1">
              2. 当事人核心诉求 / 庭审争议焦点
            </label>
            <textarea
              rows={5}
              value={current.disputes}
              onChange={(e) => updateCurrent({ disputes: e.target.value })}
              placeholder="客户最底线诉求是什么？对方或法庭归纳的核心分歧点在哪里？"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] p-2.5 text-xs sm:text-sm leading-6 focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-amber-800 mb-1">
              3. 待客户补交证据 / 需律师申请调证线索
            </label>
            <textarea
              rows={4}
              value={current.missingEvidence}
              onChange={(e) => updateCurrent({ missingEvidence: e.target.value })}
              placeholder="如：缺原始微信转账电子回单、缺上一手授权书原件、需申请调查令查银行流水…"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] p-2.5 text-xs sm:text-sm leading-6 focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-emerald-900 mb-1">
              4. 律师下一步待办事项与期限节点
            </label>
            <textarea
              rows={4}
              value={current.todoItems}
              onChange={(e) => updateCurrent({ todoItems: e.target.value })}
              placeholder="如：周五前发正式法律检索意见；3日内提交管辖权异议状…"
              className="w-full rounded border border-[#D8D1C3] bg-[#FAF9F6] p-2.5 text-xs sm:text-sm leading-6 focus:border-[#0E223D] focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EFECE5] pt-3.5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded bg-[#0E223D] px-3.5 py-2 text-xs font-semibold text-white"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              复制 Markdown 纪要
            </button>
            <button
              type="button"
              onClick={handleDownloadMd}
              className="inline-flex items-center gap-1.5 rounded border border-[#D8D1C3] bg-white px-3 py-2 text-xs font-medium text-slate-700"
            >
              <Download className="h-3.5 w-3.5" /> 导出 .md
            </button>
            <button
              type="button"
              onClick={() =>
                sendToAi(
                  'client-wechat-reply',
                  current.title,
                  `以下是我刚完成的《${sceneLabel}》现场速记，请帮我整理成一段发给委托人的专业咨询总结与补证提醒：\n\n${buildMarkdown()}`
                )
              }
              className="inline-flex items-center gap-1.5 rounded bg-[#B89254] px-3.5 py-2 text-xs font-bold text-[#11151C]"
            >
              <Sparkles className="h-3.5 w-3.5" /> 送 AI 生成客户总结回复
            </button>
            <button
              type="button"
              onClick={() =>
                sendToAi('timeline-elements', current.title, buildMarkdown())
              }
              className="inline-flex items-center gap-1.5 rounded border border-[#0E223D]/30 bg-[#F6F4EF] px-3 py-2 text-xs font-semibold text-[#0E223D]"
            >
              送 AI 提炼大事记与要件
            </button>
          </div>

          {scratchpads.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const remain = scratchpads.filter((x) => x.id !== current.id);
                setScratchpads(remain);
                setActiveId(remain[0].id);
              }}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除本篇
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
