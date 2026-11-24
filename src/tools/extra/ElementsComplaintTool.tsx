import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderOutput,
  ImagePlus,
  KeyRound,
  Loader2,
  Lock,
  Paintbrush,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  Wand2,
  X,
} from 'lucide-react';
import { ImageRedactModal } from '../../components/ImageRedactModal';
import { useToolbox } from '../../context/ToolboxContext';
import { resolveVisionModel, streamAiCompletion } from '../../lib/aiClient';
import { copyToClipboard } from '../../lib/clipboard';
import {
  COMPANION_DOCS_CATALOG,
  downloadCompanionDocx,
  extractCompanionContextFromSpcDraft,
  type CompanionDocKind,
} from '../../lib/companionDocsBuilder';
import { decryptWithPassphrase } from '../../lib/cryptoVault';
import { downloadOfficialSpcDocx } from '../../lib/docxBuilder';
import { extractLocalDocumentText } from '../../lib/docxReader';
import { compressImageFileToAttachment } from '../../lib/imageUtils';
import { redactLegalText, restoreRedactedText } from '../../lib/redactor';
import {
  applyPartyQuickFillToCellText,
  buildOfficialSpcPlainText,
  buildResolvedSpcDocument,
  createEmptyPartyQuickFill,
  createInitialSpcDraft,
  getTodayChinaDateCn,
  loadOfficialSpcCorpus,
  parseCheckboxTokens,
  POPULAR_TEMPLATE_NAMES,
  setAllMediationBenefitChoices,
  SPC_DOC_ROLE_LABELS,
  SPC_DOMAINS,
  toggleCheckboxAtIndex,
  type OfficialSpcDraftState,
  type OfficialSpcRow,
  type OfficialSpcTemplate,
  type PartyQuickFillData,
  type ResolvedSpcDocument,
  type SpcDocRole,
  type SpcDomainId,
  type SpcRoleTag,
  type SpcTemplateCorpus,
} from '../../lib/spcOfficialTemplates';
import type { AiImageAttachment, RedactionMapping } from '../../types/toolbox';

const DRAFT_STORAGE_KEY = 'spc2025_elements_doc_draft_v2';

const ORG_TYPE_OPTIONS = [
  '有限责任公司',
  '股份有限公司',
  '上市公司',
  '其他企业法人',
  '事业单位',
  '社会团体',
  '基金会',
  '社会服务机构',
  '机关法人',
  '农村集体经济组织法人',
  '城镇农村的合作经济组织法人',
  '基层群众性自治组织法人',
  '个人独资企业',
  '合伙企业',
  '不具有法人资格的专业服务机构',
];

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const sliced = JSON.parse(cleaned.slice(start, end + 1));
      if (sliced && typeof sliced === 'object' && !Array.isArray(sliced)) {
        return sliced as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function restoreDeepStrings<T>(value: T, mappings: RedactionMapping[]): T {
  if (!mappings.length) return value;
  if (typeof value === 'string') {
    return restoreRedactedText(value, mappings) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => restoreDeepStrings(item, mappings)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = restoreDeepStrings(v, mappings);
    }
    return out as T;
  }
  return value;
}

function loadSavedSpcDraft(corpus: SpcTemplateCorpus): OfficialSpcDraftState {
  const defaultTpl =
    corpus.templates.find((t) => t.displayName === '买卖合同纠纷民事起诉状') || corpus.templates[0];
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OfficialSpcDraftState>;
      if (parsed && parsed.templateId) {
        const matched = corpus.templates.find((t) => t.id === parsed.templateId);
        if (matched) {
          const base = createInitialSpcDraft(matched);
          return {
            ...base,
            ...parsed,
            rowValues: { ...base.rowValues, ...(parsed.rowValues || {}) },
            gridValues: { ...base.gridValues, ...(parsed.gridValues || {}) },
            extraRows: Array.isArray(parsed.extraRows) ? parsed.extraRows : [],
            attachmentRows: { ...base.attachmentRows, ...(parsed.attachmentRows || {}) },
          };
        }
      }
    }
  } catch {
    // ignore corrupt draft
  }
  return createInitialSpcDraft(defaultTpl);
}

function buildPrintableHtml(doc: ResolvedSpcDocument): string {
  const has4Col = doc.rows.some((r) => r.kind === 'grid' && (r.cells?.length || 0) === 4);
  const has3Col = doc.rows.some((r) => r.kind === 'grid' && (r.cells?.length || 0) === 3);
  const totalCols = has4Col && has3Col ? 6 : has4Col ? 5 : has3Col ? 3 : 2;
  const twoSpans: [number, number] =
    totalCols === 6 ? [2, 4] : totalCols === 5 ? [2, 3] : totalCols === 3 ? [1, 2] : [1, 1];
  const fourSpans: [number, number, number, number] =
    totalCols === 6 ? [1, 2, 2, 1] : [1, 2, 1, 1];
  const threeSpans: [number, number, number] = totalCols === 6 ? [2, 2, 2] : [1, 1, 1];

  const colgroupHtml =
    totalCols === 6
      ? '<colgroup><col style="width:16%"/><col style="width:11.2%"/><col style="width:22.8%"/><col style="width:10.1%"/><col style="width:5.9%"/><col style="width:34%"/></colgroup>'
      : totalCols === 5
      ? '<colgroup><col style="width:16%"/><col style="width:11.2%"/><col style="width:22.8%"/><col style="width:16%"/><col style="width:34%"/></colgroup>'
      : totalCols === 3
      ? '<colgroup><col style="width:27.2%"/><col style="width:33%"/><col style="width:39.8%"/></colgroup>'
      : '<colgroup><col style="width:27.2%"/><col style="width:72.8%"/></colgroup>';

  const trs: string[] = [];
  for (let i = 0; i < doc.rows.length; i++) {
    const r = doc.rows[i];
    if (r.kind === 'notice') {
      const noticeHtml = (r.value || '')
        .split('\n')
        .map((line) => {
          const t = line.trim();
          if (t.startsWith('★') && t.endsWith('★')) return `<div class="star">${escapeHtml(t)}</div>`;
          if (t === '说明：' || t === '说明:') return `<div class="notice-hd">${escapeHtml(t)}</div>`;
          return `<div>${escapeHtml(line)}</div>`;
        })
        .join('');
      trs.push(`<tr><td colspan="${totalCols}" class="notice">${noticeHtml}</td></tr>`);
    } else if (r.kind === 'section') {
      const lines = (r.value || '').split('\n').filter((x) => x.trim());
      const secHtml = lines
        .map((l, idx) =>
          idx === 0 ? `<div class="sec-main">${escapeHtml(l)}</div>` : `<div class="sec-sub">${escapeHtml(l)}</div>`
        )
        .join('');
      trs.push(`<tr><td colspan="${totalCols}" class="sec">${secHtml}</td></tr>`);
    } else if (r.kind === 'guide' || r.kind === 'full_input') {
      trs.push(
        `<tr><td colspan="${totalCols}" class="${r.kind === 'guide' ? 'guide' : 'val'}">${escapeHtml(r.value || '').replace(/\n/g, '<br/>')}</td></tr>`
      );
    } else if (r.kind === 'grid' && r.cells && r.cells.length === 4) {
      trs.push(
        `<tr>` +
          `<td colspan="${fourSpans[0]}" class="lbl">${escapeHtml(r.cells[0])}</td>` +
          `<td colspan="${fourSpans[1]}" class="val">${escapeHtml(r.cells[1]).replace(/\n/g, '<br/>')}</td>` +
          `<td colspan="${fourSpans[2]}" class="lbl">${escapeHtml(r.cells[2])}</td>` +
          `<td colspan="${fourSpans[3]}" class="val">${escapeHtml(r.cells[3]).replace(/\n/g, '<br/>')}</td>` +
          `</tr>`
      );
    } else if (r.kind === 'grid' && r.cells && r.cells.length === 3) {
      let rowSpan = 1;
      if (!r.vMergeContinue) {
        let j = i + 1;
        while (j < doc.rows.length && doc.rows[j].vMergeContinue) {
          rowSpan++;
          j++;
        }
      }
      const col0 = r.vMergeContinue
        ? ''
        : `<td colspan="${threeSpans[0]}"${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''} class="lbl">${escapeHtml(r.cells[0]).replace(/\n/g, '<br/>')}</td>`;
      trs.push(
        `<tr>${col0}` +
          `<td colspan="${threeSpans[1]}" class="val">${escapeHtml(r.cells[1]).replace(/\n/g, '<br/>')}</td>` +
          `<td colspan="${threeSpans[2]}" class="val">${escapeHtml(r.cells[2]).replace(/\n/g, '<br/>')}</td>` +
          `</tr>`
      );
    } else {
      trs.push(
        `<tr>` +
          `<td colspan="${twoSpans[0]}" class="lbl">${escapeHtml(r.label || '').replace(/\n/g, '<br/>')}</td>` +
          `<td colspan="${twoSpans[1]}" class="val">${escapeHtml(r.value || '').replace(/\n/g, '<br/>')}</td>` +
          `</tr>`
      );
    }
  }

  const attachmentsHtml = (doc.attachments || [])
    .map((att) => {
      const cols = Math.max(1, att.columns.length);
      const ths = att.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
      const body = att.rows
        .map((row) => {
          if (row.length === 1 && cols > 1) {
            return `<tr><td colspan="${cols}" class="att-grp">${escapeHtml(row[0])}</td></tr>`;
          }
          const tds = Array.from({ length: cols }, (_, ci) => `<td>${escapeHtml(row[ci] || '').replace(/\n/g, '<br/>')}</td>`).join('');
          return `<tr>${tds}</tr>`;
        })
        .join('');
      const footers = att.footerLines.map((fl) => `<div class="sign-line">${escapeHtml(fl)}</div>`).join('');
      return `
        <div class="page-break"></div>
        <div class="att-label">${escapeHtml(att.label)}</div>
        <div class="att-title">${escapeHtml(att.title)}</div>
        ${att.subtitle ? `<div class="att-sub">${escapeHtml(att.subtitle)}</div>` : ''}
        <table class="att-tbl"><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table>
        <div class="sign">${footers}</div>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(doc.displayName)}</title>
<style>
  @page { size: A4; margin: 20mm 20mm 20mm 24mm; }
  body { font-family: "FangSong", "STFangsong", "仿宋", "SimSun", "Songti SC", serif; color: #000; margin: 0; padding: 20px; background: #fff; font-size: 14px; line-height: 1.65; }
  h1 { text-align: center; font-family: "SimSun", "Songti SC", serif; font-size: 28px; font-weight: 700; margin: 0 0 6px; letter-spacing: 3px; }
  .sub { text-align: center; font-family: "SimSun", "Songti SC", serif; font-size: 19px; font-weight: 700; margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  td, th { border: 1px solid #000; padding: 6px 8px; vertical-align: middle; word-break: break-word; }
  td.notice { font-size: 13px; line-height: 1.6; vertical-align: top; }
  .notice-hd { font-family: "SimSun", "Songti SC", serif; font-weight: 700; margin-bottom: 2px; }
  .star { text-align: center; font-family: "SimSun", "Songti SC", serif; font-weight: 700; margin: 6px 0 3px; }
  td.sec { text-align: center; padding: 7px 8px; }
  .sec-main { font-family: "SimSun", "Songti SC", serif; font-weight: 700; font-size: 15px; }
  .sec-sub { font-size: 12.5px; margin-top: 2px; }
  td.guide { min-height: 46px; vertical-align: top; }
  td.lbl { text-align: center; font-family: "SimSun", "Songti SC", serif; }
  td.val { text-align: left; }
  .sign { margin-top: 24px; text-align: right; font-family: "SimSun", "Songti SC", serif; font-size: 15px; line-height: 2; }
  .page-break { page-break-before: always; margin-top: 32px; }
  .att-label { font-family: "SimHei", "Heiti SC", sans-serif; font-weight: 700; font-size: 15px; margin-bottom: 4px; }
  .att-title { text-align: center; font-family: "SimSun", "Songti SC", serif; font-weight: 700; font-size: 19px; margin-bottom: 8px; }
  .att-sub { text-align: center; font-size: 13px; margin-bottom: 8px; }
  table.att-tbl th { font-family: "SimSun", "Songti SC", serif; font-weight: 700; text-align: center; font-size: 13px; }
  table.att-tbl td { font-size: 13px; }
  td.att-grp { font-family: "SimSun", "Songti SC", serif; font-weight: 700; }
  .no-print { text-align: right; margin-bottom: 12px; }
  .no-print button { padding: 7px 16px; background: #0E223D; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-size: 13px; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">打印 / 另存为 PDF</button></div>
  <h1>${escapeHtml(doc.docTitle)}</h1>
  ${doc.docSubtitle ? `<div class="sub">${escapeHtml(doc.docSubtitle)}</div>` : ''}
  <table>${colgroupHtml}<tbody>${trs.join('')}</tbody></table>
  <div class="sign">
    <div>${escapeHtml(doc.signerLine)}${escapeHtml(doc.signerName) || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</div>
    <div>${escapeHtml(doc.dateLine)}${escapeHtml(doc.signDate) || '&nbsp;&nbsp;&nbsp;&nbsp;年&nbsp;&nbsp;&nbsp;&nbsp;月&nbsp;&nbsp;&nbsp;&nbsp;日'}</div>
  </div>
  ${doc.footnotes?.length ? `<div style="margin-top:16px;font-size:12.5px;line-height:1.6;">${doc.footnotes.map((f) => `<div>${escapeHtml(f)}</div>`).join('')}</div>` : ''}
  ${attachmentsHtml}
</body>
</html>`;
}

// Inline Party Quick-Fill Mini-Panel
const PartyQuickFillPanel: React.FC<{
  roleTag: SpcRoleTag;
  templateText: string;
  onApply: (filledText: string) => void;
}> = ({ roleTag, templateText, onApply }) => {
  const [data, setData] = useState<PartyQuickFillData>(createEmptyPartyQuickFill);
  const isAgent = roleTag === 'agent';
  const isPerson = roleTag === 'plaintiff_person' || roleTag === 'defendant_person' || roleTag === 'third_person';
  const hasBankFields = templateText.includes('银行账号');

  const patch = (p: Partial<PartyQuickFillData>) => setData((prev) => ({ ...prev, ...p }));

  return (
    <div className="rounded-lg border border-[#D1B27A]/60 bg-[#FBF8F1] p-3 space-y-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-[#0E223D] inline-flex items-center gap-1">
          <Wand2 className="h-3.5 w-3.5 text-[#B89254]" />
          快速结构化填入（自动按最高法官方原表行距与勾选项填好）
        </span>
      </div>

      {isAgent ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2 flex gap-2">
            {[
              { v: true, label: '有委托诉讼代理人' },
              { v: false, label: '无委托诉讼代理人' },
            ].map((opt) => (
              <button
                key={String(opt.v)}
                type="button"
                onClick={() => patch({ agentHas: opt.v })}
                className={`rounded border px-2.5 py-1 font-semibold ${
                  data.agentHas === opt.v
                    ? 'border-[#0E223D] bg-[#0E223D] text-white'
                    : 'border-[#D8D1C3] bg-white text-slate-600'
                }`}
              >
                {data.agentHas === opt.v ? '☑ ' : '☐ '}
                {opt.label}
              </button>
            ))}
          </div>
          {data.agentHas && (
            <>
              <input
                type="text"
                value={data.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="代理律师姓名"
                className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
              />
              <input
                type="text"
                value={data.workUnit}
                onChange={(e) => patch({ workUnit: e.target.value })}
                placeholder="律师事务所名称"
                className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
              />
              <input
                type="text"
                value={data.jobTitle}
                onChange={(e) => patch({ jobTitle: e.target.value })}
                placeholder="职务（如：律师）"
                className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
              />
              <input
                type="text"
                value={data.phone}
                onChange={(e) => patch({ phone: e.target.value })}
                placeholder="联系电话"
                className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
              />
              <div className="sm:col-span-2 flex gap-2">
                {(['特别授权', '一般授权'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => patch({ agentAuthority: a })}
                    className={`rounded border px-2.5 py-1 font-semibold ${
                      data.agentAuthority === a
                        ? 'border-[#0E223D] bg-[#0E223D] text-white'
                        : 'border-[#D8D1C3] bg-white text-slate-600'
                    }`}
                  >
                    {data.agentAuthority === a ? '☑ ' : '☐ '}
                    {a}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : isPerson ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={data.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="姓名 *"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <div className="flex gap-1.5 items-center">
            {(['男', '女'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => patch({ gender: g })}
                className={`flex-1 rounded border py-1.5 font-semibold ${
                  data.gender === g
                    ? 'border-[#0E223D] bg-[#0E223D] text-white'
                    : 'border-[#D8D1C3] bg-white text-slate-600'
                }`}
              >
                {data.gender === g ? '☑ ' : '☐ '}
                {g}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={data.birthDate}
            onChange={(e) => patch({ birthDate: e.target.value })}
            placeholder="出生日期（如 1988-05-12）"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.ethnicity}
            onChange={(e) => patch({ ethnicity: e.target.value })}
            placeholder="民族（如：汉族）"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.workUnit}
            onChange={(e) => patch({ workUnit: e.target.value })}
            placeholder="工作单位"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.phone}
            onChange={(e) => patch({ phone: e.target.value })}
            placeholder="联系电话"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.domicile}
            onChange={(e) => patch({ domicile: e.target.value })}
            placeholder="住所地（户籍所在地）"
            className="sm:col-span-2 rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.residence}
            onChange={(e) => patch({ residence: e.target.value })}
            placeholder="经常居住地"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.idType}
            onChange={(e) => patch({ idType: e.target.value })}
            placeholder="证件类型（居民身份证）"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.idNumber}
            onChange={(e) => patch({ idNumber: e.target.value })}
            placeholder="公民身份号码 / 证件号码"
            className="sm:col-span-2 rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5 font-mono"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={data.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="法人 / 组织全称 *"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.creditCode}
            onChange={(e) => patch({ creditCode: e.target.value })}
            placeholder="统一社会信用代码（18位）"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5 font-mono"
          />
          <input
            type="text"
            value={data.domicile}
            onChange={(e) => patch({ domicile: e.target.value })}
            placeholder="住所地（主要办事机构所在地）"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.regAddress}
            onChange={(e) => patch({ regAddress: e.target.value })}
            placeholder="注册地 / 登记地（留空可同住所地）"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <input
            type="text"
            value={data.legalRep}
            onChange={(e) => patch({ legalRep: e.target.value })}
            placeholder="法定代表人 / 负责人姓名"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              value={data.repTitle}
              onChange={(e) => patch({ repTitle: e.target.value })}
              placeholder="职务（法定代表人）"
              className="rounded border border-[#D8D1C3] bg-white px-2 py-1.5"
            />
            <input
              type="text"
              value={data.phone}
              onChange={(e) => patch({ phone: e.target.value })}
              placeholder="联系电话"
              className="rounded border border-[#D8D1C3] bg-white px-2 py-1.5"
            />
          </div>
          {hasBankFields && (
            <>
              <input
                type="text"
                value={data.bankAccount || ''}
                onChange={(e) => patch({ bankAccount: e.target.value })}
                placeholder="收款银行账号（执行案款）"
                className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5 font-mono"
              />
              <input
                type="text"
                value={data.bankName || ''}
                onChange={(e) => patch({ bankName: e.target.value })}
                placeholder="开户行名称"
                className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
              />
            </>
          )}
          <select
            value={data.orgType}
            onChange={(e) => patch({ orgType: e.target.value })}
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
          >
            {ORG_TYPE_OPTIONS.map((ot) => (
              <option key={ot} value={ot}>
                组织类型：{ot}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600">所有制：</span>
            {(['民营', '国有', '其他'] as const).map((nat) => (
              <button
                key={nat}
                type="button"
                onClick={() => patch({ ownershipNature: nat })}
                className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                  data.ownershipNature === nat
                    ? 'border-[#0E223D] bg-[#0E223D] text-white'
                    : 'border-[#D8D1C3] bg-white text-slate-600'
                }`}
              >
                {nat}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onApply(applyPartyQuickFillToCellText(templateText, roleTag, data))}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#0E223D] hover:bg-[#163257] px-3 py-1.5 text-xs font-bold text-white"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-[#D1B27A]" /> 写入当前官方表格栏
        </button>
      </div>
    </div>
  );
};

export const ElementsComplaintTool: React.FC = () => {
  const {
    isOnline,
    byok,
    sessionUnlockedPin,
    setSessionUnlockedPin,
    recordCalculation,
    lawyerProfile,
    sendToAi,
    navigateTab,
    showToast,
  } = useToolbox();

  const [corpus, setCorpus] = useState<SpcTemplateCorpus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<OfficialSpcDraftState | null>(null);

  const [activeMode, setActiveMode] = useState<'ai' | 'form' | 'preview'>('form');
  const [domainFilter, setDomainFilter] = useState<'popular' | SpcDomainId>('popular');
  const [roleFilter, setRoleFilter] = useState<'all' | SpcDocRole>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNoticeBox, setShowNoticeBox] = useState(false);
  const [openQuickFillRowId, setOpenQuickFillRowId] = useState<string | null>(null);

  // Companion 5-doc filing bundle state
  const [showCompanionPanel, setShowCompanionPanel] = useState(false);
  const [companionCourt, setCompanionCourt] = useState('');
  const [companionAuthScope, setCompanionAuthScope] = useState<'special' | 'general'>('special');
  const [companionPreserveAmt, setCompanionPreserveAmt] = useState('');
  const [companionInvestigateOrg, setCompanionInvestigateOrg] = useState('');

  // AI Convert state
  const [sourceText, setSourceText] = useState('');
  const [sourceImages, setSourceImages] = useState<AiImageAttachment[]>([]);
  const [autoRedact, setAutoRedact] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extractLog, setExtractLog] = useState('');
  const [extractError, setExtractError] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [redactingImg, setRedactingImg] = useState<AiImageAttachment | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  // Load official 113-template corpus offline-first
  useEffect(() => {
    let alive = true;
    loadOfficialSpcCorpus()
      .then((data) => {
        if (!alive) return;
        setCorpus(data);
        setDraft(loadSavedSpcDraft(data));
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(err instanceof Error ? err.message : '加载最高法官方示范文本库失败');
      });
    return () => {
      alive = false;
    };
  }, []);

  // Auto-persist local draft
  useEffect(() => {
    if (!draft) return;
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // ignore quota error
    }
  }, [draft]);

  const tpl: OfficialSpcTemplate | null = useMemo(() => {
    if (!corpus || !draft) return null;
    return corpus.templates.find((t) => t.id === draft.templateId) || corpus.templates[0] || null;
  }, [corpus, draft]);

  const domainCounts = useMemo(() => {
    const map: Record<string, number> = { popular: POPULAR_TEMPLATE_NAMES.length };
    if (!corpus) return map;
    for (const t of corpus.templates) {
      map[t.domainId] = (map[t.domainId] || 0) + 1;
    }
    return map;
  }, [corpus]);

  const filteredTemplates = useMemo(() => {
    if (!corpus) return [];
    const q = searchQuery.trim().toLowerCase();
    let list = corpus.templates;
    if (q) {
      list = list.filter(
        (t) =>
          t.displayName.toLowerCase().includes(q) ||
          t.causeName.toLowerCase().includes(q) ||
          t.domainName.toLowerCase().includes(q) ||
          t.docTitle.toLowerCase().includes(q)
      );
    } else if (domainFilter === 'popular') {
      list = POPULAR_TEMPLATE_NAMES.map((name) =>
        corpus.templates.find((t) => t.displayName === name)
      ).filter((x): x is OfficialSpcTemplate => Boolean(x));
    } else {
      list = list.filter((t) => t.domainId === domainFilter);
    }
    if (roleFilter !== 'all') {
      list = list.filter((t) => t.docRole === roleFilter);
    }
    return list;
  }, [corpus, domainFilter, roleFilter, searchQuery]);

  const resolvedDoc = useMemo(() => {
    if (!tpl || !draft) return null;
    return buildResolvedSpcDocument(tpl, draft);
  }, [tpl, draft]);

  // Group official rows under their verbatim official section headings for structured Form editing
  const groupedSections = useMemo(() => {
    if (!tpl) return { noticeRow: null as OfficialSpcRow | null, groups: [] as { title: string; subtitle?: string; rows: OfficialSpcRow[] }[] };
    let noticeRow: OfficialSpcRow | null = null;
    const groups: { title: string; subtitle?: string; rows: OfficialSpcRow[] }[] = [];
    let currentGroup: { title: string; subtitle?: string; rows: OfficialSpcRow[] } | null = null;

    for (const r of tpl.rows) {
      if (r.kind === 'notice') {
        noticeRow = r;
        continue;
      }
      if (r.kind === 'section') {
        const lines = (r.templateText || '').split('\n').filter((x) => x.trim());
        currentGroup = {
          title: lines[0] || '要素内容',
          subtitle: lines.slice(1).join(' '),
          rows: [],
        };
        groups.push(currentGroup);
        continue;
      }
      if (!currentGroup) {
        currentGroup = { title: '基本案件信息', rows: [] };
        groups.push(currentGroup);
      }
      currentGroup.rows.push(r);
    }
    return { noticeRow, groups };
  }, [tpl]);

  const activeProvider =
    byok.providers.find((p) => p.id === byok.activeProviderId) || byok.providers[0];
  const hasApiKey = Boolean(activeProvider?.apiKey || activeProvider?.apiKeyEncrypted);
  const needsPinUnlock = Boolean(
    byok.pinEnabled && activeProvider?.apiKeyEncrypted && !sessionUnlockedPin
  );

  const handleSelectTemplate = (nextTpl: OfficialSpcTemplate) => {
    if (tpl && nextTpl.id === tpl.id) return;
    setDraft(createInitialSpcDraft(nextTpl));
    setOpenQuickFillRowId(null);
    showToast(`已切换最高法官方模板：${nextTpl.displayName}`);
  };

  const updateRowValue = (rowId: string, nextVal: string) => {
    setDraft((prev) =>
      prev ? { ...prev, rowValues: { ...prev.rowValues, [rowId]: nextVal } } : prev
    );
  };

  const updateGridCell = (rowId: string, colIdx: number, nextVal: string, fallbackCells: string[]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const cur = prev.gridValues[rowId] ? [...prev.gridValues[rowId]] : [...fallbackCells];
      cur[colIdx] = nextVal;
      return { ...prev, gridValues: { ...prev.gridValues, [rowId]: cur } };
    });
  };

  const handleDuplicatePartyRow = (sourceRow: OfficialSpcRow) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const count = prev.extraRows.filter((e) => e.sourceRowId === sourceRow.id).length;
      return {
        ...prev,
        extraRows: [
          ...prev.extraRows,
          {
            uid: `extra_${sourceRow.id}_${Date.now()}`,
            sourceRowId: sourceRow.id,
            label: `${sourceRow.label || ''}`.replace(/^(原告|被告|第三人|答辩人|自诉人|申请执行人|被执行人|申请人|被申请人|委托诉讼代理人)/, `$1${count + 2}`),
            value: sourceRow.templateText || '',
          },
        ],
      };
    });
    showToast(`已按《说明》第 4 条复制新增一栏「${(sourceRow.label || '').replace(/\n/g, '')}」`);
  };

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await extractLocalDocumentText(file);
      if (!txt) {
        showToast('未从该文件中提取到文本内容');
      } else {
        setSourceText((prev) => (prev.trim() ? `${prev.trim()}\n\n${txt}` : txt));
        showToast(`已本地读取《${file.name}》（${txt.length} 字，未上传服务器）`);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      e.target.value = '';
    }
  };

  const handleUploadImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remain = Math.max(0, 6 - sourceImages.length);
    try {
      const added: AiImageAttachment[] = [];
      for (const f of files.slice(0, remain)) {
        added.push(await compressImageFileToAttachment(f));
      }
      setSourceImages((prev) => [...prev, ...added]);
      showToast(`已本地加载 ${added.length} 张截图/照片（可点「涂抹打码」遮盖敏感信息）`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '图片处理失败');
    } finally {
      e.target.value = '';
    }
  };

  const handleAiExtractToOfficialForm = async () => {
    if (!tpl || !draft) return;
    setExtractError('');
    if (!sourceText.trim() && sourceImages.length === 0) {
      setExtractError('请先上传传统起诉状/答辩状（.docx/.txt）、粘贴案情正文或上传截图。');
      return;
    }
    if (!isOnline) {
      setExtractError('当前处于离线模式，AI 提取需要联网；您可以直接切到「官方原表逐项编辑」免费离线填表导出 Word。');
      return;
    }
    if (!activeProvider || !hasApiKey) {
      setExtractError('尚未配置个人大模型 API Key。请前往「我的配置」2 分钟绑定，或先使用「官方原表逐项编辑」。');
      return;
    }

    let plainKey = activeProvider.apiKey;
    if (activeProvider.apiKeyEncrypted) {
      const pin = sessionUnlockedPin || pinInput.trim();
      if (!pin) {
        setExtractError('请输入本机 PIN 码以临时解锁您的 API Key。');
        return;
      }
      try {
        plainKey = await decryptWithPassphrase(activeProvider.apiKeyEncrypted, pin);
        if (!sessionUnlockedPin) setSessionUnlockedPin(pin);
      } catch {
        setExtractError('PIN 码不正确，无法解密本机 API Key。');
        return;
      }
    }

    if (sourceImages.length > 0 && !resolveVisionModel(activeProvider)) {
      setExtractError(
        `当前大模型「${activeProvider.name}」暂不支持图片识别。请在「我的配置」切换视觉模型，或导入 .docx/.txt 文本。`
      );
      return;
    }

    setExtracting(true);
    setExtractLog(`正在按最高法官方《${tpl.displayName}》逐行提取要素…`);

    let mappings: RedactionMapping[] = [];
    let promptMaterial = sourceText.trim();
    if (autoRedact && promptMaterial) {
      const res = redactLegalText(promptMaterial);
      promptMaterial = res.redactedText;
      mappings = res.mappings;
    }

    // Build exact official row specification so the LLM fills strictly inside official SPC slots
    const editableRowSpecs = tpl.rows
      .filter((r) => r.kind === 'field' || r.kind === 'full_input' || r.kind === 'grid')
      .map((r) => {
        if (r.kind === 'grid' && r.cells) {
          return { id: r.id, kind: 'grid', cells: r.cells };
        }
        return {
          id: r.id,
          kind: r.kind,
          label: (r.label || '').replace(/\n/g, ''),
          officialTemplate: r.templateText || '',
        };
      });

    const systemPrompt = `你是中国资深诉讼律师助手，专责将律师提供的传统诉状、答辩状、裁判文书或案件材料，严格按照最高人民法院《法〔2025〕82号》官方示范文本《${tpl.displayName}》的原始表格结构逐行填充为 JSON。
铁律（必须严格遵守）：
1. 必须完整保留每个栏目官方原文中的提示前缀、换行和选项结构（例如“姓名：”“名称：”“截至  年  月  日止…”“男□ 女□”“是□ 否□”），只能在对应空白处填入原文提取的事实，并将命中的“□”改为“☑”，未命中的保持“□”！
2. 严禁编造任何材料中未出现的姓名、公司名、统一社会信用代码、身份证号、金额、日期、案号或合同条款；材料未涉及的栏目直接省略（不要放进 rowValues）或保持原空白模板不动。
3. 若材料中存在脱敏占位符（如 [公司主体A]、[当事人甲]、[身份证号1]），必须原样保留在输出值中，以便本机自动还原。
4. 只输出一个合法 JSON 对象，格式如下：
{
  "rowValues": {
    "行id（如 r03）": "保留官方原行文字并填好内容、勾选☑后的完整单元格文本"
  },
  "gridValues": {
    "仅多列行id（如 r01 案号/案由）": ["案号", "具体案号", "案由", "具体案由"]
  }
}

以下是当前最高法官方示范文本《${tpl.displayName}》的逐行原始结构（仅需在 rowValues/gridValues 中返回有提取内容的栏目）：
${JSON.stringify(editableRowSpecs)}`;

    const userContent = promptMaterial
      ? `请严格对照最高法官方《${tpl.displayName}》逐行结构，提取以下材料并输出 JSON：\n\n${promptMaterial}`
      : `请识别所附材料图片，严格对照最高法官方《${tpl.displayName}》逐行结构提取并输出 JSON。`;

    let fullReply = '';
    try {
      await streamAiCompletion({
        provider: { ...activeProvider, apiKey: plainKey },
        modelSlot: 'fast',
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: userContent,
            images: sourceImages.length > 0 ? sourceImages : undefined,
          },
        ],
        onChunk: (delta) => {
          fullReply += delta;
          setExtractLog(`正在按最高法官方表逐项填充…（已接收 ${fullReply.length} 字）`);
        },
      });

      const parsed = extractFirstJsonObject(fullReply);
      if (!parsed) {
        throw new Error('模型未能返回标准 JSON 结构，请重试或改选推理能力更强的模型。');
      }

      const restored = restoreDeepStrings(parsed, mappings);
      let updatedCount = 0;

      setDraft((prev) => {
        if (!prev) return prev;
        const nextRowValues = { ...prev.rowValues };
        const nextGridValues = { ...prev.gridValues };
        const validIds = new Set(tpl.rows.map((r) => r.id));

        if (restored.rowValues && typeof restored.rowValues === 'object') {
          for (const [k, v] of Object.entries(restored.rowValues as Record<string, unknown>)) {
            if (validIds.has(k) && typeof v === 'string' && v.trim()) {
              nextRowValues[k] = v;
              updatedCount++;
            }
          }
        }
        if (restored.gridValues && typeof restored.gridValues === 'object') {
          for (const [k, v] of Object.entries(restored.gridValues as Record<string, unknown>)) {
            if (validIds.has(k) && Array.isArray(v)) {
              nextGridValues[k] = v.map((cell) => String(cell ?? ''));
              updatedCount++;
            }
          }
        }
        return {
          ...prev,
          rowValues: nextRowValues,
          gridValues: nextGridValues,
        };
      });

      setActiveMode('form');
      showToast(
        mappings.length > 0
          ? `已按最高法官方原表填入 ${updatedCount} 项要素，并本地还原 ${mappings.length} 处脱敏实体！`
          : `已按最高法官方原表精准填入 ${updatedCount} 项要素，请核对后导出 Word！`
      );
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'AI 要素提取失败');
    } finally {
      setExtracting(false);
      setExtractLog('');
    }
  };

  const handleDownloadWord = (blankMode = false) => {
    if (!tpl || !draft) return;
    const doc = buildResolvedSpcDocument(tpl, draft, { blankMode });
    const suffix = blankMode ? '_最高法官方空白示范文本' : '_已填版';
    const fileName = `${tpl.displayName}${suffix}.docx`;
    downloadOfficialSpcDocx(doc, fileName);
    showToast(
      blankMode
        ? `已下载最高法官方空白 Word 模板：${fileName}`
        : `已按最高法《法〔2025〕82号》官方格式生成 Word：${fileName}`
    );
  };

  const handlePrintPdf = () => {
    if (!resolvedDoc) return;
    const htmlDoc = buildPrintableHtml(resolvedDoc);
    const win = window.open('', '_blank', 'width=900,height=960');
    if (!win) {
      showToast('浏览器拦截了打印窗口，请改点「导出官方 Word (.docx)」');
      return;
    }
    win.document.open();
    win.document.write(htmlDoc);
    win.document.close();
    win.focus();
    setTimeout(() => {
      try {
        win.print();
      } catch {
        // user can click top button
      }
    }, 350);
  };

  const handleCopyPlainText = async () => {
    if (!resolvedDoc) return;
    await copyToClipboard(buildOfficialSpcPlainText(resolvedDoc));
    showToast('已复制最高法官方要素表完整纯文本');
  };

  const handleSaveHistory = () => {
    if (!resolvedDoc || !tpl) return;
    const txt = buildOfficialSpcPlainText(resolvedDoc);
    recordCalculation('elements-complaint', '要素式文书（最高法2025）', tpl.displayName, txt);
  };

  const handleAiFilingAudit = () => {
    if (!resolvedDoc || !tpl) return;
    const txt = buildOfficialSpcPlainText(resolvedDoc);
    sendToAi(
      'legal-sandbox',
      `${tpl.displayName} · AI 立案退件预警核验`,
      `请站在中国法院立案庭审查法官 + 资深诉讼律师的双重视角，对以下按最高人民法院《法〔2025〕82号》官方示范文本填写的《${tpl.displayName}》做一次严格的「立案退件预警与实体风险体检」：\n\n重点排查：\n1. 【诉请/答辩与事实闭环】金额、起算日、利率基数、勾选状态与事实理由是否存在遗漏或矛盾；\n2. 【程序前置与时效红线】劳动仲裁前置、行政复议前置与起诉期、普通 3 年诉讼时效或 2 年申请执行时效；\n3. 【主体与管辖】原被告/第三人适格性、约定管辖条款、担保/连带责任主体是否漏列；\n4. 【勾选与格式规范】是否存在应勾未勾项或自相矛盾的勾选项。\n\n以下为待核验文书全文：\n\n${txt}`
    );
  };

  const handleSendToDeAi = () => {
    if (!resolvedDoc || !tpl) return;
    const txt = buildOfficialSpcPlainText(resolvedDoc);
    sendToAi(
      'de-ai-polish',
      `${tpl.displayName} · 措辞润色`,
      `请帮我核查并润色以下最高法官方要素式《${tpl.displayName}》中律师填写的诉请、事实与理由措辞（严格保留官方表格项号、所有 □/☑ 勾选状态与核心事实金额日期，使语言精炼克制、符合中国法院立案与庭审标准）：\n\n${txt}`
    );
  };

  const handleDownloadCompanionDoc = (kind: CompanionDocKind) => {
    if (!tpl || !draft) return;
    const baseCtx = extractCompanionContextFromSpcDraft(tpl, draft, lawyerProfile);
    const fname = downloadCompanionDocx(kind, {
      ...baseCtx,
      courtName: companionCourt.trim() || baseCtx.courtName,
      authScope: companionAuthScope,
      preservationAmount: companionPreserveAmt.trim(),
      targetEvidenceOrg: companionInvestigateOrg.trim(),
    });
    showToast(`已复用当前主体与执业档案生成配套 Word：${fname}`);
  };

  const handleResetDraft = () => {
    if (!tpl) return;
    setDraft(createInitialSpcDraft(tpl));
    setSourceText('');
    setSourceImages([]);
    setOpenQuickFillRowId(null);
    showToast(`已重置《${tpl.displayName}》为最高法官方空白初始模板`);
  };

  const roleBadgeClass = (role: SpcDocRole) => {
    if (role === 'defense') return 'bg-amber-100 text-amber-900 border-amber-200';
    if (role === 'application') return 'bg-emerald-100 text-emerald-900 border-emerald-200';
    if (role === 'statement') return 'bg-sky-100 text-sky-900 border-sky-200';
    return 'bg-[#F3ECE0] text-[#7A5922] border-[#E0CEAE]';
  };

  const roleShortTag = (role: SpcDocRole) => {
    if (role === 'defense') return '答辩状';
    if (role === 'application') return '申请书';
    if (role === 'statement') return '意见陈述书';
    return '起诉状';
  };

  if (loadError) {
    return (
      <div className="py-10 px-4 max-w-3xl mx-auto">
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900 space-y-2">
          <div className="font-bold">加载最高法官方示范文本库失败</div>
          <div className="text-xs">{loadError}</div>
        </div>
      </div>
    );
  }

  if (!corpus || !draft || !tpl || !resolvedDoc) {
    return (
      <div className="py-16 flex flex-col items-center justify-center text-slate-600 gap-2 text-xs">
        <Loader2 className="h-6 w-6 animate-spin text-[#0E223D]" />
        <span>正在本地加载最高人民法院《法〔2025〕82号》113 份官方示范文本…</span>
      </div>
    );
  }

  // Render helper for official preview table (matching Word .docx 1:1)
  const renderOfficialPreviewTable = () => {
    const has4Col = resolvedDoc.rows.some((r) => r.kind === 'grid' && (r.cells?.length || 0) === 4);
    const has3Col = resolvedDoc.rows.some((r) => r.kind === 'grid' && (r.cells?.length || 0) === 3);
    const totalCols = has4Col && has3Col ? 6 : has4Col ? 5 : has3Col ? 3 : 2;
    const twoSpans: [number, number] =
      totalCols === 6 ? [2, 4] : totalCols === 5 ? [2, 3] : totalCols === 3 ? [1, 2] : [1, 1];
    const fourSpans: [number, number, number, number] =
      totalCols === 6 ? [1, 2, 2, 1] : [1, 2, 1, 1];
    const threeSpans: [number, number, number] = totalCols === 6 ? [2, 2, 2] : [1, 1, 1];

    return (
      <table className="w-full border-collapse border border-black text-xs sm:text-[13px] leading-6 bg-white">
        {totalCols === 2 && (
          <colgroup>
            <col className="w-[27.2%]" />
            <col className="w-[72.8%]" />
          </colgroup>
        )}
        {totalCols === 3 && (
          <colgroup>
            <col className="w-[27.2%]" />
            <col className="w-[33%]" />
            <col className="w-[39.8%]" />
          </colgroup>
        )}
        {totalCols === 5 && (
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[11.2%]" />
            <col className="w-[22.8%]" />
            <col className="w-[16%]" />
            <col className="w-[34%]" />
          </colgroup>
        )}
        {totalCols === 6 && (
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[11.2%]" />
            <col className="w-[22.8%]" />
            <col className="w-[10.1%]" />
            <col className="w-[5.9%]" />
            <col className="w-[34%]" />
          </colgroup>
        )}
        <tbody>
          {resolvedDoc.rows.map((r, i) => {
            if (r.kind === 'notice') {
              return (
                <tr key={r.id}>
                  <td colSpan={totalCols} className="border border-black px-3 py-2.5 text-[11.5px] leading-5">
                    {(r.value || '').split('\n').map((line, li) => {
                      const t = line.trim();
                      if (t.startsWith('★') && t.endsWith('★')) {
                        return (
                          <div key={li} className="text-center font-bold my-1">
                            {t}
                          </div>
                        );
                      }
                      if (t === '说明：' || t === '说明:') {
                        return (
                          <div key={li} className="font-bold">
                            {t}
                          </div>
                        );
                      }
                      return <div key={li}>{line}</div>;
                    })}
                  </td>
                </tr>
              );
            }
            if (r.kind === 'section') {
              const lines = (r.value || '').split('\n').filter((x) => x.trim());
              return (
                <tr key={r.id}>
                  <td colSpan={totalCols} className="border border-black px-3 py-2 text-center">
                    {lines.map((l, li) => (
                      <div key={li} className={li === 0 ? 'font-bold text-[13.5px]' : 'text-[11.5px] mt-0.5'}>
                        {l}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            }
            if (r.kind === 'guide' || r.kind === 'full_input') {
              return (
                <tr key={r.id}>
                  <td
                    colSpan={totalCols}
                    className={`border border-black px-3 py-2 whitespace-pre-wrap break-words ${
                      r.kind === 'guide' ? 'min-h-[44px] align-top' : 'align-middle'
                    }`}
                  >
                    {r.value}
                  </td>
                </tr>
              );
            }
            if (r.kind === 'grid' && r.cells && r.cells.length === 4) {
              return (
                <tr key={r.id}>
                  <td colSpan={fourSpans[0]} className="border border-black px-2 py-2 text-center font-bold">
                    {r.cells[0]}
                  </td>
                  <td colSpan={fourSpans[1]} className="border border-black px-2.5 py-2 whitespace-pre-wrap">
                    {r.cells[1]}
                  </td>
                  <td colSpan={fourSpans[2]} className="border border-black px-2 py-2 text-center font-bold">
                    {r.cells[2]}
                  </td>
                  <td colSpan={fourSpans[3]} className="border border-black px-2.5 py-2 whitespace-pre-wrap">
                    {r.cells[3]}
                  </td>
                </tr>
              );
            }
            if (r.kind === 'grid' && r.cells && r.cells.length === 3) {
              let rowSpan = 1;
              if (!r.vMergeContinue) {
                let j = i + 1;
                while (j < resolvedDoc.rows.length && resolvedDoc.rows[j].vMergeContinue) {
                  rowSpan++;
                  j++;
                }
              }
              return (
                <tr key={r.id}>
                  {!r.vMergeContinue && (
                    <td
                      colSpan={threeSpans[0]}
                      rowSpan={rowSpan > 1 ? rowSpan : undefined}
                      className="border border-black px-2 py-2 text-center whitespace-pre-wrap align-middle"
                    >
                      {r.cells[0]}
                    </td>
                  )}
                  <td colSpan={threeSpans[1]} className="border border-black px-2.5 py-2 whitespace-pre-wrap break-words align-middle">
                    {r.cells[1]}
                  </td>
                  <td colSpan={threeSpans[2]} className="border border-black px-2.5 py-2 whitespace-pre-wrap break-words align-middle">
                    {r.cells[2]}
                  </td>
                </tr>
              );
            }
            return (
              <tr key={r.id}>
                <td
                  colSpan={twoSpans[0]}
                  className="border border-black px-2.5 py-2 text-center whitespace-pre-wrap align-middle"
                >
                  {r.label}
                </td>
                <td
                  colSpan={twoSpans[1]}
                  className="border border-black px-2.5 py-2 whitespace-pre-wrap break-words align-middle"
                >
                  {r.value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="py-4 sm:py-6 px-3.5 sm:px-6 mx-auto max-w-5xl space-y-4">
      {/* Header & Official 113-Template Browser */}
      <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[#9A773E]">
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#B89254]" />
              <span>
                最高人民法院《{corpus.standard}》官方示范文本 · 9 大领域 · 67 类纠纷 · {corpus.count} 份全量模板
              </span>
            </div>
            <h1 className="mt-1 font-display text-xl sm:text-2xl font-bold text-[#11151C]">
              要素式起诉状 / 答辩状 / 申请书官方模板工作台
            </h1>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              100% 对照最高人民法院 2025 年 7 月 14 日起全国推广的官方示范文本原表生成（完整保留官方《说明》、全部表格要素行、多列案号/专利表、勾选项与知识产权证据清单附件）；支持离线直接勾选填表、下载空白官方模板，或 AI 转写传统诉状。
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => handleDownloadWord(false)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345C] px-3.5 py-2 text-xs font-bold text-[#F6F4EF] shadow-xs"
            >
              <Download className="h-3.5 w-3.5 text-[#D1B27A]" /> 导出官方 Word (.docx)
            </button>
            <button
              type="button"
              onClick={() => handleDownloadWord(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1B27A] bg-[#FBF7EE] hover:bg-[#F3E9D2] px-3 py-2 text-xs font-semibold text-[#7A5922]"
              title="直接下载该案由的最高法官方空白 Word 模板"
            >
              <FileText className="h-3.5 w-3.5" /> 下载官方空白表
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8D1C3] bg-[#FAF9F6] hover:border-[#0E223D] px-3 py-2 text-xs font-semibold text-[#11151C]"
            >
              <Printer className="h-3.5 w-3.5 text-[#9A773E]" /> A4 打印/PDF
            </button>
          </div>
        </div>

        {/* Official Template Search + 9 Domains + Role Filter */}
        <div className="pt-3 border-t border-[#EFECE5] space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="秒搜全部 113 份最高法示范文本（如：买卖、民间借贷、劳动、著作权、答辩状、执行异议、行政处罚…）"
                className="w-full rounded-lg border border-[#D8D1C3] bg-[#FAF9F6] pl-8 pr-8 py-1.5 text-xs focus:border-[#0E223D] focus:bg-white focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1">
              {(['all', 'claim', 'defense', 'application', 'statement'] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRoleFilter(role)}
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                    roleFilter === role
                      ? 'border-[#B89254] bg-[#B89254] text-[#11151C]'
                      : 'border-[#DED8CC] bg-[#FAF9F6] text-slate-600'
                  }`}
                >
                  {SPC_DOC_ROLE_LABELS[role]}
                </button>
              ))}
            </div>
          </div>

          {!searchQuery.trim() && (
            <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
              {SPC_DOMAINS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDomainFilter(d.id)}
                  className={`flex-none rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    domainFilter === d.id
                      ? 'border-[#0E223D] bg-[#0E223D] text-white'
                      : 'border-[#DED8CC] bg-[#FAF9F6] text-slate-600 hover:border-[#0E223D]/50'
                  }`}
                >
                  {d.label}
                  <span className="ml-1 opacity-70">({domainCounts[d.id] || 0})</span>
                </button>
              ))}
            </div>
          )}

          <div className="max-h-48 overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {filteredTemplates.map((item) => {
              const active = item.id === tpl.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTemplate(item)}
                  className={`rounded-lg border px-2.5 py-2 text-left transition-all ${
                    active
                      ? 'border-[#0E223D] bg-[#0E223D] text-white shadow-xs'
                      : 'border-[#E5DFD3] bg-[#FAF9F6] text-[#11151C] hover:border-[#0E223D]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-bold truncate">{item.shortCause}</span>
                    <span
                      className={`flex-none rounded border px-1.5 py-0.2 text-[10px] font-semibold ${
                        active
                          ? 'bg-[#B89254] text-[#11151C] border-[#B89254]'
                          : roleBadgeClass(item.docRole)
                      }`}
                    >
                      {roleShortTag(item.docRole)}
                    </span>
                  </div>
                  <div
                    className={`mt-0.5 text-[10px] truncate ${
                      active ? 'text-[#D1B27A]' : 'text-slate-500'
                    }`}
                  >
                    {item.domainName} · {item.rows.length} 行要素
                    {item.attachments.length > 0 ? ` · 含 ${item.attachments.length} 份官方附件` : ''}
                  </div>
                </button>
              );
            })}
            {filteredTemplates.length === 0 && (
              <div className="col-span-full py-4 text-center text-xs text-slate-500">
                未找到匹配的示范文本，请清空筛选条件或更换关键词。
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#FAF9F6] border border-[#EAE5DA] px-3 py-1.5 text-[11px] text-slate-700">
            <span>
              当前启用官方原表：<strong className="text-[#0E223D]">{tpl.displayName}</strong>
              {tpl.docSubtitle ? ` ${tpl.docSubtitle}` : ''}（共 {tpl.rows.length} 行官方表格结构
              {tpl.attachments.length > 0 ? ` + ${tpl.attachments.length} 份官方附件` : ''}）
            </span>
            <span className="text-slate-500 font-mono text-[10px]">
              依据：最高人民法院 {corpus.standard}（{corpus.effectiveDate} 起全国推广）
            </span>
          </div>
        </div>
      </section>

      {/* 3-Tab Mode Switcher */}
      <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-[#DED8CC] bg-white p-1.5 shadow-xs">
        <button
          type="button"
          onClick={() => setActiveMode('form')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 px-2 text-xs font-bold transition-colors ${
            activeMode === 'form'
              ? 'bg-[#0E223D] text-[#F6F4EF] shadow-xs'
              : 'text-slate-600 hover:bg-[#F6F4EF]'
          }`}
        >
          <FileText className="h-3.5 w-3.5 text-[#D1B27A]" />
          <span>官方原表逐项编辑</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveMode('ai')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 px-2 text-xs font-bold transition-colors ${
            activeMode === 'ai'
              ? 'bg-[#0E223D] text-[#F6F4EF] shadow-xs'
              : 'text-slate-600 hover:bg-[#F6F4EF]'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-[#D1B27A]" />
          <span>AI 转写传统诉状</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveMode('preview')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 px-2 text-xs font-bold transition-colors ${
            activeMode === 'preview'
              ? 'bg-[#0E223D] text-[#F6F4EF] shadow-xs'
              : 'text-slate-600 hover:bg-[#F6F4EF]'
          }`}
        >
          <Eye className="h-3.5 w-3.5 text-[#B89254]" />
          <span>官方 A4 预览导出</span>
        </button>
      </div>

      {/* MODE 1: AI Convert Traditional Doc -> Official SPC 2025 Rows */}
      {activeMode === 'ai' && (
        <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-[#11151C]">
                导入传统诉状 / 案情材料 → AI 严格按最高法《{tpl.displayName}》原表逐行填充
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                自动保留最高法原始每一行标签、公式空位与勾选项，仅填入您材料中的真实事实并勾选对应 ☑；使用您个人 API Key，支持本地前置脱敏与截图涂抹打码。
              </p>
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRedact}
                onChange={(e) => setAutoRedact(e.target.checked)}
                className="accent-[#0E223D]"
              />
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              本地先脱敏，返回自动还原
            </label>
          </div>

          {!hasApiKey && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
              <span>
                您尚未绑定个人大模型 API Key。绑定后可一键 AI 转写，也可直接点击上方{' '}
                <strong>「官方原表逐项编辑」</strong> 100% 免费离线生成官方格式 Word。
              </span>
              <button
                type="button"
                onClick={() => navigateTab('settings')}
                className="inline-flex items-center gap-1 rounded-md bg-[#0E223D] px-3 py-1.5 font-bold text-[#F6F4EF]"
              >
                <KeyRound className="h-3.5 w-3.5 text-[#D1B27A]" /> 去配置 API Key
              </button>
            </div>
          )}

          {needsPinUnlock && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex flex-wrap items-center gap-2 text-xs">
              <Lock className="h-4 w-4 text-amber-700 flex-none" />
              <span className="text-amber-950 font-medium">已开启本机 PIN 保护，请先输入 PIN 码解锁密钥：</span>
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="输入 PIN 码"
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs w-32"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.txt,.md"
              onChange={handleUploadDoc}
              className="hidden"
            />
            <input
              ref={imgInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleUploadImages}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8D1C3] bg-[#FAF9F6] hover:border-[#0E223D] px-3 py-2 text-xs font-semibold text-[#11151C]"
            >
              <FileUp className="h-3.5 w-3.5 text-[#0E223D]" /> 导入传统诉状 / 答辩状 (.docx / .txt)
            </button>
            <button
              type="button"
              onClick={() => imgInputRef.current?.click()}
              disabled={sourceImages.length >= 6}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1B27A] bg-[#FBF7EE] hover:bg-[#F5ECD9] px-3 py-2 text-xs font-semibold text-[#7A5922] disabled:opacity-45"
            >
              <ImagePlus className="h-3.5 w-3.5" /> 传诉状 / 合同截图 ({sourceImages.length}/6)
            </button>
            {sourceText && (
              <button
                type="button"
                onClick={() => setSourceText('')}
                className="text-xs text-slate-500 hover:text-red-700 ml-auto"
              >
                清空文本
              </button>
            )}
          </div>

          {sourceImages.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {sourceImages.map((img) => (
                <div
                  key={img.id}
                  className="relative rounded-lg border border-[#DED8CC] bg-[#FAF9F6] p-1.5 space-y-1.5"
                >
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="h-24 w-full object-cover rounded"
                  />
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => setRedactingImg(img)}
                      className="inline-flex items-center gap-1 rounded bg-[#0E223D] px-2 py-1 text-[11px] font-semibold text-[#F6F4EF]"
                    >
                      <Paintbrush className="h-3 w-3 text-[#D1B27A]" /> 涂抹打码
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSourceImages((prev) => prev.filter((x) => x.id !== img.id))
                      }
                      className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700"
                      aria-label="移除图片"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <textarea
            rows={7}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            onPaste={async (e) => {
              const items = Array.from(e.clipboardData?.items || []);
              const imgFiles = items
                .filter((it) => it.type.startsWith('image/'))
                .map((it) => it.getAsFile())
                .filter((f): f is File => Boolean(f));
              if (imgFiles.length === 0) return;
              e.preventDefault();
              const remain = Math.max(0, 6 - sourceImages.length);
              if (remain <= 0) {
                showToast('单次最多附带 6 张图片');
                return;
              }
              try {
                const added: AiImageAttachment[] = [];
                for (const f of imgFiles.slice(0, remain)) {
                  added.push(await compressImageFileToAttachment(f));
                }
                setSourceImages((prev) => [...prev, ...added]);
                showToast(`已从剪贴板粘贴 ${added.length} 张截图`);
              } catch {
                showToast('粘贴图片失败');
              }
            }}
            placeholder={`请粘贴传统诉状、答辩状、合同或裁判文书正文（支持导入 .docx/.txt，或直接 Ctrl+V / ⌘V 粘贴截图），AI 将严格按最高法官方《${tpl.displayName}》逐栏填充…`}
            className="w-full rounded-lg border border-[#D8D1C3] bg-[#FCFBF8] p-3 text-xs leading-6 text-[#11151C] focus:border-[#0E223D] focus:bg-white focus:outline-none"
          />

          {extractError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {extractError}
            </div>
          )}
          {extractLog && (
            <div className="rounded-lg border border-[#D1B27A]/50 bg-[#FBF7EE] p-3 text-xs text-[#7A5922] flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin flex-none" />
              <span>{extractLog}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={extracting}
              onClick={handleAiExtractToOfficialForm}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0E223D] hover:bg-[#17345C] px-5 py-2.5 text-xs sm:text-sm font-bold text-[#F6F4EF] shadow-xs disabled:opacity-50"
            >
              {extracting ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#D1B27A]" />
              ) : (
                <Sparkles className="h-4 w-4 text-[#D1B27A]" />
              )}
              <span>{extracting ? '正在按最高法官方表填充…' : 'AI 一键填入最高法官方表格'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('form')}
              className="rounded-lg border border-[#D8D1C3] bg-white hover:border-[#0E223D] px-4 py-2.5 text-xs font-semibold text-[#11151C]"
            >
              直接离线手动编辑官方表格 →
            </button>
          </div>
        </section>
      )}

      {/* MODE 2: Offline Official SPC Verbatim Table Editor */}
      {activeMode === 'form' && (
        <div className="space-y-4">
          {/* Official SPC Notice Collapsible Box */}
          {groupedSections.noticeRow && (
            <section className="rounded-xl border border-[#DED8CC] bg-[#FCFBF8] p-3.5 shadow-xs">
              <button
                type="button"
                onClick={() => setShowNoticeBox((v) => !v)}
                className="flex w-full items-center justify-between text-left text-xs font-bold text-[#0E223D]"
              >
                <span>最高人民法院官方《说明》与★特别提示★（导出 Word 时自动原样置顶保留）</span>
                {showNoticeBox ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                )}
              </button>
              {showNoticeBox && (
                <div className="mt-2.5 pt-2.5 border-t border-[#EAE5DA] text-[11.5px] leading-6 text-slate-700 whitespace-pre-wrap">
                  {groupedSections.noticeRow.templateText}
                </div>
              )}
            </section>
          )}

          {/* Render Each Official Section Verbatim */}
          {groupedSections.groups.map((grp, gIdx) => (
            <section
              key={`${grp.title}-${gIdx}`}
              className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5 shadow-xs"
            >
              <div className="border-b border-[#EFECE5] pb-2.5">
                <h2 className="font-display text-sm sm:text-base font-bold text-[#0E223D]">
                  {grp.title}
                </h2>
                {grp.subtitle && (
                  <p className="mt-0.5 text-[11.5px] text-slate-600">{grp.subtitle}</p>
                )}
              </div>

              <div className="space-y-3.5">
                {grp.rows.map((row) => {
                  // Guide row: optional narrative overview
                  if (row.kind === 'guide') {
                    return (
                      <div
                        key={row.id}
                        className="rounded-lg border border-dashed border-[#D1B27A] bg-[#FBF9F4] p-3 space-y-1.5"
                      >
                        <div className="text-[11.5px] font-semibold text-[#7A5922]">
                          {row.templateText}
                        </div>
                        <textarea
                          rows={2}
                          value={draft.rowValues[row.id] || ''}
                          onChange={(e) => updateRowValue(row.id, e.target.value)}
                          placeholder="选填：可在此整体概括表述（留空则按最高法原表仅保留上方引导提示行）"
                          className="w-full rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5 text-xs leading-5 focus:border-[#0E223D] focus:outline-none"
                        />
                      </div>
                    );
                  }

                  // Grid row (4-col 案号/案由 or 3-col Patent rows)
                  if (row.kind === 'grid' && row.cells) {
                    const cells = draft.gridValues[row.id] || row.cells;
                    if (cells.length === 4 && row.roleTag === 'case_meta') {
                      return (
                        <div
                          key={row.id}
                          className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-[#E5DFD3] bg-[#FAF9F6] p-3 text-xs"
                        >
                          <div>
                            <label className="block font-bold text-[#0E223D] mb-1">{cells[0]}</label>
                            <input
                              type="text"
                              value={cells[1] || ''}
                              onChange={(e) => updateGridCell(row.id, 1, e.target.value, row.cells!)}
                              placeholder="例：（2026）浙0106民初XXXX号"
                              className="w-full rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
                            />
                          </div>
                          <div>
                            <label className="block font-bold text-[#0E223D] mb-1">{cells[2]}</label>
                            <input
                              type="text"
                              value={cells[3] || ''}
                              onChange={(e) => updateGridCell(row.id, 3, e.target.value, row.cells!)}
                              placeholder={`例：${tpl.causeName}`}
                              className="w-full rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5"
                            />
                          </div>
                        </div>
                      );
                    }
                    // 3-col Patent/Admin grid row
                    return (
                      <div
                        key={row.id}
                        className="rounded-lg border border-[#E5DFD3] bg-[#FAF9F6] p-3 space-y-2 text-xs"
                      >
                        <div className="font-bold text-[#0E223D]">
                          {cells[0].replace(/\n/g, ' ')}
                          {row.vMergeContinue ? '（续行）' : ''}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {[1, 2].map((ci) => {
                            const cVal = cells[ci] || '';
                            const cTokens = parseCheckboxTokens(cVal);
                            return (
                              <div key={ci} className="space-y-1.5">
                                {cTokens.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {cTokens.map((tk) => (
                                      <button
                                        key={tk.index}
                                        type="button"
                                        onClick={() =>
                                          updateGridCell(
                                            row.id,
                                            ci,
                                            toggleCheckboxAtIndex(cVal, tk.index),
                                            row.cells!
                                          )
                                        }
                                        className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                                          tk.checked
                                            ? 'border-[#0E223D] bg-[#0E223D] text-white'
                                            : 'border-[#D8D1C3] bg-white text-slate-600'
                                        }`}
                                      >
                                        {tk.checked ? '☑ ' : '☐ '}
                                        {tk.label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <textarea
                                  rows={Math.min(8, Math.max(3, cVal.split('\n').length + 1))}
                                  value={cVal}
                                  onChange={(e) => updateGridCell(row.id, ci, e.target.value, row.cells!)}
                                  className="w-full rounded border border-[#D8D1C3] bg-white px-2.5 py-1.5 text-xs leading-5 focus:border-[#0E223D] focus:outline-none"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  // Standard official 2-col field OR full_input row
                  const val = draft.rowValues[row.id] ?? row.templateText ?? '';
                  const tokens = parseCheckboxTokens(val);
                  const lineCount = Math.max(2, val.split('\n').length);
                  const isPartyQuickFillable = Boolean(
                    row.roleTag &&
                      [
                        'plaintiff_person',
                        'plaintiff_org',
                        'defendant_person',
                        'defendant_org',
                        'third_person',
                        'third_org',
                        'agent',
                      ].includes(row.roleTag)
                  );
                  const extrasForRow = row.repeatable
                    ? draft.extraRows.filter((ex) => ex.sourceRowId === row.id)
                    : [];

                  return (
                    <div key={row.id} className="space-y-2">
                      <div className="rounded-lg border border-[#EAE5DA] bg-[#FCFBF8] p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="text-xs font-bold text-[#11151C]">
                            {row.kind === 'full_input'
                              ? '整行填写栏'
                              : (row.label || '').replace(/\n/g, ' ')}
                          </label>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {row.roleTag === 'mediation_benefit' && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateRowValue(row.id, setAllMediationBenefitChoices(val, true))
                                }
                                className="rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"
                              >
                                一键勾选 5 项“了解☑”
                              </button>
                            )}
                            {row.roleTag === 'agent' && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!lawyerProfile.name && !lawyerProfile.firmName) {
                                    showToast('请先在「我的配置 → 个人执业与落款档案」填一次姓名与律所，即可永久一键带入');
                                    return;
                                  }
                                  const quick = createEmptyPartyQuickFill();
                                  quick.agentHas = true;
                                  quick.name = lawyerProfile.name;
                                  quick.workUnit = lawyerProfile.firmName;
                                  quick.jobTitle = lawyerProfile.licenseNo
                                    ? `专职律师（执业证号：${lawyerProfile.licenseNo}）`
                                    : '专职律师';
                                  quick.phone = lawyerProfile.phone;
                                  quick.agentAuthority = '特别授权';
                                  const filled = applyPartyQuickFillToCellText(
                                    row.templateText || val,
                                    'agent',
                                    quick
                                  );
                                  updateRowValue(row.id, filled);
                                  showToast(`已从个人执业档案带入「${lawyerProfile.name || lawyerProfile.firmName}」代理信息`);
                                }}
                                className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"
                                title="自动带入您在「我的配置」保存的律师姓名、律所、执业证号与电话"
                              >
                                <UserCheck className="h-3 w-3" /> 一键带入我的执业档案
                              </button>
                            )}
                            {isPartyQuickFillable && (
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenQuickFillRowId((cur) => (cur === row.id ? null : row.id))
                                }
                                className="inline-flex items-center gap-1 rounded border border-[#D1B27A] bg-[#FBF7EE] hover:bg-[#F3E9D2] px-2 py-0.5 text-[11px] font-semibold text-[#7A5922]"
                              >
                                <Wand2 className="h-3 w-3" />
                                {openQuickFillRowId === row.id ? '收起快速填表' : '快速结构化填入'}
                              </button>
                            )}
                            {row.repeatable && (
                              <button
                                type="button"
                                onClick={() => handleDuplicatePartyRow(row)}
                                className="inline-flex items-center gap-1 rounded border border-[#D8D1C3] bg-white hover:border-[#0E223D] px-2 py-0.5 text-[11px] font-semibold text-[#0E223D]"
                                title="按最高法《说明》第4条复制增加多主体行"
                              >
                                <Plus className="h-3 w-3" /> 复制新增一行
                              </button>
                            )}
                          </div>
                        </div>

                        {isPartyQuickFillable && openQuickFillRowId === row.id && row.roleTag && (
                          <PartyQuickFillPanel
                            roleTag={row.roleTag}
                            templateText={row.templateText || val}
                            onApply={(filled) => {
                              updateRowValue(row.id, filled);
                              setOpenQuickFillRowId(null);
                              showToast(`已写入「${(row.label || '').replace(/\n/g, '')}」官方表格栏`);
                            }}
                          />
                        )}

                        {tokens.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {tokens.map((tk) => (
                              <button
                                key={tk.index}
                                type="button"
                                onClick={() =>
                                  updateRowValue(row.id, toggleCheckboxAtIndex(val, tk.index))
                                }
                                className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                                  tk.checked
                                    ? 'border-[#0E223D] bg-[#0E223D] text-white'
                                    : 'border-[#D8D1C3] bg-white text-slate-600 hover:border-[#0E223D]'
                                }`}
                              >
                                {tk.checked ? '☑ ' : '☐ '}
                                {tk.label}
                              </button>
                            ))}
                          </div>
                        )}

                        <textarea
                          rows={Math.min(11, Math.max(2, lineCount + 1))}
                          value={val}
                          onChange={(e) => updateRowValue(row.id, e.target.value)}
                          placeholder="按最高法官方原表直接填写内容（可留空或填“无”）"
                          className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2 text-xs leading-6 text-[#11151C] focus:border-[#0E223D] focus:outline-none"
                        />
                      </div>

                      {/* Render any duplicated extra party rows */}
                      {extrasForRow.map((ex) => {
                        const exTokens = parseCheckboxTokens(ex.value);
                        return (
                          <div
                            key={ex.uid}
                            className="ml-3 rounded-lg border border-[#D1B27A] bg-[#FBF9F4] p-3 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <input
                                type="text"
                                value={ex.label.replace(/\n/g, '')}
                                onChange={(e) =>
                                  setDraft((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          extraRows: prev.extraRows.map((x) =>
                                            x.uid === ex.uid ? { ...x, label: e.target.value } : x
                                          ),
                                        }
                                      : prev
                                  )
                                }
                                className="rounded border border-[#D8D1C3] bg-white px-2 py-0.5 text-xs font-bold text-[#0E223D]"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          extraRows: prev.extraRows.filter((x) => x.uid !== ex.uid),
                                        }
                                      : prev
                                  )
                                }
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 hover:underline"
                              >
                                <Trash2 className="h-3 w-3" /> 删除此新增行
                              </button>
                            </div>
                            {exTokens.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {exTokens.map((tk) => (
                                  <button
                                    key={tk.index}
                                    type="button"
                                    onClick={() =>
                                      setDraft((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              extraRows: prev.extraRows.map((x) =>
                                                x.uid === ex.uid
                                                  ? {
                                                      ...x,
                                                      value: toggleCheckboxAtIndex(x.value, tk.index),
                                                    }
                                                  : x
                                              ),
                                            }
                                          : prev
                                      )
                                    }
                                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                                      tk.checked
                                        ? 'border-[#0E223D] bg-[#0E223D] text-white'
                                        : 'border-[#D8D1C3] bg-white text-slate-600'
                                    }`}
                                  >
                                    {tk.checked ? '☑ ' : '☐ '}
                                    {tk.label}
                                  </button>
                                ))}
                              </div>
                            )}
                            <textarea
                              rows={Math.min(10, Math.max(3, ex.value.split('\n').length + 1))}
                              value={ex.value}
                              onChange={(e) =>
                                setDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        extraRows: prev.extraRows.map((x) =>
                                          x.uid === ex.uid ? { ...x, value: e.target.value } : x
                                        ),
                                      }
                                    : prev
                                )
                              }
                              className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2 text-xs leading-6"
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {/* Official Post-Signature Attachments (IP Evidence Lists etc.) */}
          {tpl.attachments.length > 0 && (
            <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-2.5">
                <h2 className="font-display text-sm sm:text-base font-bold text-[#0E223D]">
                  官方附表（{tpl.attachments.map((a) => a.title).join(' / ')}）
                </h2>
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0E223D] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.includeAttachments}
                    onChange={(e) =>
                      setDraft((p) => (p ? { ...p, includeAttachments: e.target.checked } : p))
                    }
                    className="accent-[#0E223D]"
                  />
                  导出 Word 时附带官方附件表
                </label>
              </div>
              {draft.includeAttachments &&
                tpl.attachments.map((att, aIdx) => {
                  const rows = draft.attachmentRows[aIdx] || att.rows;
                  return (
                    <div key={aIdx} className="space-y-2 pt-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#7A5922]">
                          {att.label}：{att.title}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((prev) => {
                              if (!prev) return prev;
                              const cur = prev.attachmentRows[aIdx] || att.rows;
                              return {
                                ...prev,
                                attachmentRows: {
                                  ...prev.attachmentRows,
                                  [aIdx]: [...cur, Array(att.columns.length).fill('')],
                                },
                              };
                            })
                          }
                          className="inline-flex items-center gap-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2 py-0.5 text-[11px] font-semibold text-[#0E223D]"
                        >
                          <Plus className="h-3 w-3" /> 添加一行
                        </button>
                      </div>
                      <div className="overflow-x-auto rounded border border-[#E5DFD3]">
                        <table className="w-full text-[11px] border-collapse">
                          <thead className="bg-[#FAF9F6]">
                            <tr>
                              {att.columns.map((c, ci) => (
                                <th key={ci} className="border border-[#E5DFD3] px-2 py-1.5 text-left font-bold">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((rCells, ri) =>
                              rCells.length === 1 && att.columns.length > 1 ? (
                                <tr key={ri} className="bg-[#F6F4EF]">
                                  <td
                                    colSpan={att.columns.length}
                                    className="border border-[#E5DFD3] px-2 py-1 font-bold text-[#0E223D]"
                                  >
                                    {rCells[0]}
                                  </td>
                                </tr>
                              ) : (
                                <tr key={ri}>
                                  {att.columns.map((_, ci) => (
                                    <td key={ci} className="border border-[#E5DFD3] p-1">
                                      <input
                                        type="text"
                                        value={rCells[ci] || ''}
                                        onChange={(e) =>
                                          setDraft((prev) => {
                                            if (!prev) return prev;
                                            const cur = (prev.attachmentRows[aIdx] || att.rows).map(
                                              (x) => [...x]
                                            );
                                            cur[ri][ci] = e.target.value;
                                            return {
                                              ...prev,
                                              attachmentRows: { ...prev.attachmentRows, [aIdx]: cur },
                                            };
                                          })
                                        }
                                        className="w-full bg-transparent px-1 py-0.5 text-[11px] focus:bg-white focus:outline-none"
                                      />
                                    </td>
                                  ))}
                                </tr>
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
            </section>
          )}

          {/* Official Sign-Off & Export Settings */}
          <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5 shadow-xs">
            <h2 className="font-display text-sm sm:text-base font-bold text-[#0E223D] border-b border-[#EFECE5] pb-2.5">
              文书落款与导出设置
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-[#11151C] block">
                  {tpl.signerLine}（选填，留空导出后直接签字盖章）
                </label>
                <input
                  type="text"
                  value={draft.signerName}
                  onChange={(e) => setDraft((p) => (p ? { ...p, signerName: e.target.value } : p))}
                  placeholder="留空则导出空位供本人手写签字或加盖公章"
                  className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-[#11151C]">{tpl.dateLine}</label>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((p) => (p ? { ...p, signDate: getTodayChinaDateCn() } : p))
                    }
                    className="text-[11px] font-semibold text-[#7A5922] hover:underline"
                  >
                    填入今日（{getTodayChinaDateCn()}）
                  </button>
                </div>
                <input
                  type="text"
                  value={draft.signDate}
                  onChange={(e) => setDraft((p) => (p ? { ...p, signDate: e.target.value } : p))}
                  placeholder="留空则导出“      年    月    日”"
                  className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2"
                />
              </div>
            </div>

            <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={draft.hideUntouchedPartyRows}
                onChange={(e) =>
                  setDraft((p) =>
                    p ? { ...p, hideUntouchedPartyRows: e.target.checked } : p
                  )
                }
                className="mt-0.5 accent-[#0E223D]"
              />
              <span>
                精简导出：隐藏本案未填写的冗余主体行（例如仅填了公司原告时，隐藏空白的“自然人原告/第三人”行；<strong>默认不勾选 = 100% 严格保留最高法原表全部行</strong>）
              </span>
            </label>

            <div className="pt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveMode('preview')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345C] px-4 py-2.5 text-xs font-bold text-[#F6F4EF]"
              >
                <CheckCircle2 className="h-4 w-4 text-[#D1B27A]" /> 预览官方 A4 表格并导出
              </button>
              <button
                type="button"
                onClick={() => handleDownloadWord(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#B89254] hover:bg-[#C9A364] px-4 py-2.5 text-xs font-bold text-[#11151C]"
              >
                <Download className="h-4 w-4" /> 直接下载官方格式 Word (.docx)
              </button>
              <button
                type="button"
                onClick={handleAiFilingAudit}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#0E223D] bg-white hover:bg-[#F3ECE0] px-3.5 py-2.5 text-xs font-bold text-[#0E223D]"
              >
                <ShieldCheck className="h-4 w-4 text-emerald-700" /> AI 立案风险复核
              </button>
              <button
                type="button"
                onClick={() => setShowCompanionPanel((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9A463] bg-[#FAF6EC] hover:bg-[#F3ECE0] px-3.5 py-2.5 text-xs font-bold text-[#7A5922]"
              >
                <FolderOutput className="h-4 w-4" />
                {showCompanionPanel ? '收起立案配套 5 件套' : '联出立案配套文书（5 份 Word）'}
              </button>
              <button
                type="button"
                onClick={handleResetDraft}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[#D8D1C3] px-3 py-2 text-xs text-slate-600 hover:text-red-700"
              >
                <RotateCcw className="h-3.5 w-3.5" /> 恢复官方空白原表
              </button>
            </div>
          </section>

          {/* 5-Doc Court Filing Companion Bundle Generator */}
          {showCompanionPanel && (
            <section className="rounded-xl border border-[#D9C7A3] bg-gradient-to-br from-[#FDFBF6] via-white to-[#F7F2E6] p-4 sm:p-5 space-y-3.5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EAE2D0] pb-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <FolderOutput className="h-4 w-4 text-[#9A7538]" />
                    <h3 className="font-display text-sm sm:text-base font-bold text-[#0E223D]">
                      立案前序配套文书一键联出（填一次主体，出全套 Word）
                    </h3>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-slate-600">
                    自动复用上方已填的当事人、案由/案号及「我的配置 → 个人执业档案」（{lawyerProfile.name ? `已绑定：${lawyerProfile.name}` : '未填执业档案时保留下划线空位'}），纯本地生成 `.docx`。
                  </p>
                </div>
                {!lawyerProfile.name && (
                  <button
                    type="button"
                    onClick={() => navigateTab('settings')}
                    className="rounded-lg border border-[#B89254] bg-white px-2.5 py-1 text-[11px] font-bold text-[#7A5922] hover:bg-[#FBF7EE]"
                  >
                    去完善执业档案 →
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-[#0E223D] mb-1">受案法院（选填）</label>
                  <input
                    type="text"
                    value={companionCourt}
                    onChange={(e) => setCompanionCourt(e.target.value)}
                    placeholder="例：杭州市西湖区人民法院"
                    className="w-full rounded-lg border border-[#D8D1C3] bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#0E223D] mb-1">委托授权范围</label>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#EFEAE0] p-0.5">
                    <button
                      type="button"
                      onClick={() => setCompanionAuthScope('special')}
                      className={`rounded-md py-1 text-[11px] font-bold ${
                        companionAuthScope === 'special'
                          ? 'bg-[#0E223D] text-white'
                          : 'text-slate-600'
                      }`}
                    >
                      特别授权
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompanionAuthScope('general')}
                      className={`rounded-md py-1 text-[11px] font-bold ${
                        companionAuthScope === 'general'
                          ? 'bg-[#0E223D] text-white'
                          : 'text-slate-600'
                      }`}
                    >
                      一般代理
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#0E223D] mb-1">保全标的额（选填）</label>
                  <input
                    type="text"
                    value={companionPreserveAmt}
                    onChange={(e) => setCompanionPreserveAmt(e.target.value)}
                    placeholder="例：人民币 500,000 元"
                    className="w-full rounded-lg border border-[#D8D1C3] bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#0E223D] mb-1">协助调查单位（选填）</label>
                  <input
                    type="text"
                    value={companionInvestigateOrg}
                    onChange={(e) => setCompanionInvestigateOrg(e.target.value)}
                    placeholder="例：某银行 / 市场监管局"
                    className="w-full rounded-lg border border-[#D8D1C3] bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {COMPANION_DOCS_CATALOG.map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    onClick={() => handleDownloadCompanionDoc(item.kind)}
                    className="group rounded-xl border border-[#E2DAC7] bg-white hover:border-[#0E223D] hover:shadow-sm p-3 text-left transition-all flex flex-col justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-display text-xs font-bold text-[#0E223D]">
                          《{item.title}》
                        </span>
                        <span className="rounded bg-[#F5F0E4] px-1.5 py-0.5 text-[9.5px] font-bold text-[#7A5922]">
                          {item.badge}
                        </span>
                      </div>
                      <p className="mt-1 text-[10.5px] leading-4 text-slate-500">{item.desc}</p>
                    </div>
                    <div className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0E223D] group-hover:text-[#9A7538]">
                      <Download className="h-3 w-3" /> 下载 Word (.docx)
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* MODE 3: Live Authentic SPC A4 Paper Preview & Export */}
      {activeMode === 'preview' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DED8CC] bg-white p-3 shadow-xs">
            <button
              type="button"
              onClick={() => handleDownloadWord(false)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345C] px-3.5 py-2 text-xs font-bold text-[#F6F4EF]"
            >
              <Download className="h-3.5 w-3.5 text-[#D1B27A]" /> 下载官方格式 Word (.docx)
            </button>
            <button
              type="button"
              onClick={() => handleDownloadWord(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1B27A] bg-[#FBF7EE] px-3 py-2 text-xs font-semibold text-[#7A5922]"
            >
              <FileText className="h-3.5 w-3.5" /> 下载官方空白表
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#0E223D] bg-white px-3 py-2 text-xs font-semibold text-[#0E223D]"
            >
              <Printer className="h-3.5 w-3.5" /> A4 打印 / 存 PDF
            </button>
            <button
              type="button"
              onClick={handleCopyPlainText}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 text-xs font-semibold text-[#11151C]"
            >
              <Copy className="h-3.5 w-3.5 text-[#9A773E]" /> 复制纯文本
            </button>
            <button
              type="button"
              onClick={handleSaveHistory}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8D1C3] bg-[#FAF9F6] px-3 py-2 text-xs font-semibold text-[#11151C]"
            >
              <BookmarkPlus className="h-3.5 w-3.5 text-[#0E223D]" /> 存入记录
            </button>
            <button
              type="button"
              onClick={handleAiFilingAudit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-900"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" /> AI 立案退件预警
            </button>
            <button
              type="button"
              onClick={handleSendToDeAi}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#B89254] px-3 py-2 text-xs font-bold text-[#11151C]"
            >
              <Sparkles className="h-3.5 w-3.5" /> 送 AI 润色
            </button>
          </div>

          <div className="rounded-xl border border-[#D6CFC2] bg-white p-5 sm:p-9 shadow-sm text-[#11151C] overflow-x-auto">
            <div className="min-w-[320px] max-w-[760px] mx-auto font-serif">
              <h2 className="text-center text-2xl sm:text-[26px] font-bold tracking-[0.2em]">
                {resolvedDoc.docTitle}
              </h2>
              {resolvedDoc.docSubtitle && (
                <div className="text-center text-base sm:text-lg font-bold mt-1 mb-4">
                  {resolvedDoc.docSubtitle}
                </div>
              )}

              {renderOfficialPreviewTable()}

              <div className="mt-6 text-right text-sm leading-8">
                <div>
                  {resolvedDoc.signerLine}
                  <span className="inline-block min-w-[110px] border-b border-dashed border-slate-400 text-center">
                    {resolvedDoc.signerName}
                  </span>
                </div>
                <div>
                  {resolvedDoc.dateLine}
                  {resolvedDoc.signDate || '      年    月    日'}
                </div>
              </div>

              {resolvedDoc.footnotes.length > 0 && (
                <div className="mt-4 text-[11.5px] leading-5 text-slate-700 space-y-1">
                  {resolvedDoc.footnotes.map((fn, fi) => (
                    <div key={fi} className={fn.startsWith('注释') ? 'font-bold' : ''}>
                      {fn}
                    </div>
                  ))}
                </div>
              )}

              {resolvedDoc.attachments.length > 0 && (
                <div className="mt-8 pt-6 border-t-2 border-dashed border-slate-300 space-y-6">
                  {resolvedDoc.attachments.map((att, ai) => (
                    <div key={ai} className="space-y-2">
                      <div className="text-xs font-bold">{att.label}</div>
                      <div className="text-center text-base font-bold">{att.title}</div>
                      {att.subtitle && (
                        <div className="text-center text-xs text-slate-600">{att.subtitle}</div>
                      )}
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse border border-black text-[11.5px] leading-5">
                          <thead>
                            <tr>
                              {att.columns.map((c, ci) => (
                                <th key={ci} className="border border-black px-2 py-1.5 text-center font-bold">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {att.rows.map((row, ri) =>
                              row.length === 1 && att.columns.length > 1 ? (
                                <tr key={ri}>
                                  <td
                                    colSpan={att.columns.length}
                                    className="border border-black px-2 py-1 font-bold"
                                  >
                                    {row[0]}
                                  </td>
                                </tr>
                              ) : (
                                <tr key={ri}>
                                  {att.columns.map((_, ci) => (
                                    <td key={ci} className="border border-black px-2 py-1 whitespace-pre-wrap">
                                      {row[ci] || ''}
                                    </td>
                                  ))}
                                </tr>
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                      {att.footerLines.length > 0 && (
                        <div className="text-right text-xs leading-6 pt-1">
                          {att.footerLines.map((fl, fi) => (
                            <div key={fi}>{fl}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Local Screenshot Redaction Modal */}
      <ImageRedactModal
        image={redactingImg}
        onClose={() => setRedactingImg(null)}
        onSave={(updated) => {
          setSourceImages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          setRedactingImg(null);
          showToast('已完成本地涂抹打码，原始像素已覆盖');
        }}
      />
    </div>
  );
};
