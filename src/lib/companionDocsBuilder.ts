/**
 * 100% Browser-Local Custom Word (.docx) Template Fill Engine.
 *
 * Design principles:
 * - ZERO hardcoded built-in legal templates (no fixed 授权委托书 / 送达地址确认书 / 财产保全申请书 etc.)
 *   because every law firm, court, and case uses its own Word version.
 * - Lawyers upload THEIR OWN blank .docx templates strictly into local browser storage
 *   (NEVER uploaded to any server, NEVER included in activation-code cloud sync).
 * - Preserves 100% of the lawyer's original Word layout, tables, logos, fonts, headers, and footers
 *   by patching only word/document.xml & word/header*.xml & word/footer*.xml inside the ZIP archive,
 *   including Word's split <w:r><w:t> runs around {{placeholder}} tokens.
 * - Automatically runs local PII/case-info residual detection on upload to warn the lawyer if an
 *   uploaded template accidentally still contains old client names, phone numbers, IDs, or case numbers.
 */

import type { LawyerProfile } from '../types/toolbox';
import { extractXmlTextFromWordDocument } from './docxReader.ts';
import { redactLegalText } from './redactor.ts';
import type {
  OfficialSpcDraftState,
  OfficialSpcTemplate,
} from './spcOfficialTemplates.ts';

export const LOCAL_CUSTOM_TEMPLATES_STORAGE_KEY = 'lawyer_local_custom_docx_templates_v1';
export const MAX_CUSTOM_TEMPLATE_BYTES = 2.5 * 1024 * 1024; // 2.5 MB per .docx
export const MAX_CUSTOM_TEMPLATES_COUNT = 12;

export interface CompanionDocContext {
  causeName: string;
  caseNo: string;
  courtName: string;
  clientName: string;
  clientIdOrCode: string;
  clientAddress: string;
  clientPhone: string;
  clientLegalRep: string;
  opponentName: string;
  opponentIdOrCode: string;
  opponentAddress: string;
  opponentPhone: string;
  lawyerName: string;
  lawyerLicenseNo: string;
  lawyerFirm: string;
  lawyerPhone: string;
  lawyerAddress: string;
  lawyerEmail: string;
  authScope: 'special' | 'general';
  preservationAmount: string;
  targetEvidenceOrg: string;
  signDateCn: string;
}

export interface CompanionPlaceholderSpec {
  token: string;
  label: string;
  group: '案件与当事主体' | '律师与律所档案' | '常用可变项';
  aliases?: string[];
}

export const COMPANION_PLACEHOLDER_SPECS: CompanionPlaceholderSpec[] = [
  { token: '{{委托人}}', label: '委托人 / 原告名称', group: '案件与当事主体', aliases: ['{{原告}}'] },
  { token: '{{委托人证件号}}', label: '统一信用代码 / 身份证号', group: '案件与当事主体', aliases: ['{{原告信用代码}}', '{{原告证件号}}'] },
  { token: '{{委托人住所地}}', label: '委托人住所地', group: '案件与当事主体', aliases: ['{{原告住所地}}'] },
  { token: '{{委托人法定代表人}}', label: '委托人法定代表人', group: '案件与当事主体', aliases: ['{{原告法定代表人}}'] },
  { token: '{{委托人电话}}', label: '委托人联系电话', group: '案件与当事主体' },
  { token: '{{对方当事人}}', label: '对方 / 被告名称', group: '案件与当事主体', aliases: ['{{被告}}'] },
  { token: '{{被告住所地}}', label: '对方 / 被告住所地', group: '案件与当事主体', aliases: ['{{对方住所地}}'] },
  { token: '{{被告电话}}', label: '对方 / 被告电话', group: '案件与当事主体', aliases: ['{{对方电话}}'] },
  { token: '{{案由}}', label: '纠纷案由', group: '案件与当事主体' },
  { token: '{{案号}}', label: '案号（答辩/执行等）', group: '案件与当事主体' },
  { token: '{{受案法院}}', label: '管辖 / 受案法院', group: '案件与当事主体', aliases: ['{{法院}}'] },

  { token: '{{受托律师}}', label: '主办律师姓名', group: '律师与律所档案', aliases: ['{{律师姓名}}'] },
  { token: '{{执业证号}}', label: '律师执业证号', group: '律师与律所档案' },
  { token: '{{律所名称}}', label: '律师事务所全称', group: '律师与律所档案' },
  { token: '{{律师电话}}', label: '律师联系电话', group: '律师与律所档案' },
  { token: '{{律所地址}}', label: '律所通讯 / 送达地址', group: '律师与律所档案' },
  { token: '{{律师邮箱}}', label: '律师电子送达邮箱', group: '律师与律所档案' },

  { token: '{{授权范围}}', label: '特别授权 / 一般代理文本', group: '常用可变项' },
  { token: '{{保全标的额}}', label: '保全标的额', group: '常用可变项' },
  { token: '{{协助调查单位}}', label: '协助调查单位', group: '常用可变项' },
  { token: '{{日期}}', label: '落款日期（中文）', group: '常用可变项' },
];

export interface PrivacyResidualAlert {
  categoryLabel: string;
  count: number;
}

export interface InspectedDocxTemplate {
  matchedPlaceholders: string[];
  unknownPlaceholders: string[];
  privacyAlerts: PrivacyResidualAlert[];
  totalPrivacyHits: number;
}

export interface LocalCustomDocxTemplate {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: number;
  base64Bytes: string;
  matchedPlaceholders: string[];
  unknownPlaceholders: string[];
  privacyAlerts: PrivacyResidualAlert[];
  totalPrivacyHits: number;
}

function extractLineField(text: string, labels: string[]): string {
  if (!text) return '';
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}[：:][ \\t]*([^\\n]+)`);
    const m = text.match(re);
    if (m && m[1]) {
      const val = m[1]
        .replace(
          /(?:^|\s+)(?:性别|民族|出生日期|法定代表人|主要负责人|职务|联系电话|统一社会信用代码|身份证号|住所地|所有制性质)[：:]?.*$/,
          ''
        )
        .replace(/[□☑]/g, '')
        .trim();
      if (val && val !== '无') return val;
    }
  }
  return '';
}

function formatTodayCn(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
}

/**
 * Extracts already-filled party, cause, and case number fields from the active
 * SPC 2025 official draft and merges the lawyer's local profile (all empty by default).
 */
export function extractCompanionContextFromSpcDraft(
  tpl: OfficialSpcTemplate,
  draft: OfficialSpcDraftState,
  profile: LawyerProfile
): CompanionDocContext {
  let caseNo = '';
  let causeName = tpl.causeName || '';
  let clientName = '';
  let clientIdOrCode = '';
  let clientAddress = '';
  let clientPhone = '';
  let clientLegalRep = '';
  let opponentName = '';
  let opponentIdOrCode = '';
  let opponentAddress = '';
  let opponentPhone = '';

  for (const row of tpl.rows) {
    if (row.kind === 'grid' && row.roleTag === 'case_meta') {
      const cells = draft.gridValues[row.id] || row.cells || [];
      for (let i = 0; i < cells.length - 1; i++) {
        const k = (cells[i] || '').trim();
        const v = (cells[i + 1] || '').trim();
        if (k.includes('案号') && v && !v.includes('案号')) caseNo = v;
        if (k.includes('案由') && v && !v.includes('案由')) causeName = v;
      }
      continue;
    }

    const val = (draft.rowValues[row.id] || '').trim();
    const base = (row.templateText || '').trim();
    if (!val || val === base) continue;

    if (row.roleTag === 'plaintiff_org' || row.roleTag === 'plaintiff_person') {
      const name = extractLineField(val, ['名称', '姓名']);
      if (name && !clientName) {
        clientName = name;
        clientIdOrCode = extractLineField(val, ['统一社会信用代码', '证件号码', '身份证号']);
        clientAddress = extractLineField(val, [
          '住所地（主要办事机构所在地）',
          '住所地（户籍所在地）',
          '经常居住地',
          '住所地',
        ]);
        clientPhone = extractLineField(val, ['联系电话', '手机']);
        clientLegalRep = extractLineField(val, ['法定代表人 / 负责人', '法定代表人/负责人', '法定代表人']);
      }
    }

    if (row.roleTag === 'defendant_org' || row.roleTag === 'defendant_person') {
      const name = extractLineField(val, ['名称', '姓名']);
      if (name && !opponentName) {
        opponentName = name;
        opponentIdOrCode = extractLineField(val, ['统一社会信用代码', '证件号码', '身份证号']);
        opponentAddress = extractLineField(val, [
          '住所地（主要办事机构所在地）',
          '住所地（户籍所在地）',
          '经常居住地',
          '住所地',
        ]);
        opponentPhone = extractLineField(val, ['联系电话', '手机']);
      }
    }
  }

  return {
    causeName,
    caseNo,
    courtName: '',
    clientName: clientName || draft.signerName.trim(),
    clientIdOrCode,
    clientAddress,
    clientPhone,
    clientLegalRep,
    opponentName,
    opponentIdOrCode,
    opponentAddress,
    opponentPhone,
    lawyerName: profile.name.trim(),
    lawyerLicenseNo: profile.licenseNo.trim(),
    lawyerFirm: profile.firmName.trim(),
    lawyerPhone: profile.phone.trim(),
    lawyerAddress: profile.address.trim(),
    lawyerEmail: profile.email.trim(),
    authScope: 'special',
    preservationAmount: '',
    targetEvidenceOrg: '',
    signDateCn: draft.signDate.trim() || formatTodayCn(),
  };
}

export function buildCompanionVariableMap(ctx: CompanionDocContext): Record<string, string> {
  const authScopeText =
    ctx.authScope === 'special'
      ? '特别授权：代为承认、放弃、变更诉讼请求，进行和解，提起反诉或者上诉，签收法律文书及办理财产保全、申请执行等事宜'
      : '一般代理：代为起诉/应诉、提交证据、参加庭审调查与辩论、签收法律文书等一般诉讼事务';

  return {
    委托人: ctx.clientName,
    原告: ctx.clientName,
    委托人证件号: ctx.clientIdOrCode,
    原告信用代码: ctx.clientIdOrCode,
    原告证件号: ctx.clientIdOrCode,
    委托人住所地: ctx.clientAddress,
    原告住所地: ctx.clientAddress,
    委托人法定代表人: ctx.clientLegalRep,
    原告法定代表人: ctx.clientLegalRep,
    委托人电话: ctx.clientPhone,
    对方当事人: ctx.opponentName,
    被告: ctx.opponentName,
    被告住所地: ctx.opponentAddress,
    对方住所地: ctx.opponentAddress,
    被告电话: ctx.opponentPhone,
    对方电话: ctx.opponentPhone,
    案由: ctx.causeName,
    案号: ctx.caseNo,
    受案法院: ctx.courtName,
    法院: ctx.courtName,
    受托律师: ctx.lawyerName,
    律师姓名: ctx.lawyerName,
    执业证号: ctx.lawyerLicenseNo,
    律所名称: ctx.lawyerFirm,
    律师电话: ctx.lawyerPhone,
    律所地址: ctx.lawyerAddress,
    律师邮箱: ctx.lawyerEmail,
    授权范围: authScopeText,
    保全标的额: ctx.preservationAmount,
    协助调查单位: ctx.targetEvidenceOrg,
    日期: ctx.signDateCn,
  };
}

// ---- Pure-JS Lossless ZIP Reader & Writer (Preserves untouched compressed entries verbatim) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ParsedZipEntry {
  name: string;
  compressionMethod: number;
  crc: number;
  compressedData: Uint8Array;
  uncompressedSize: number;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器版本较低，暂不支持本地解析 .docx 模板');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compressed as BufferSource);
  writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function parseZipEntries(bytes: Uint8Array): ParsedZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  const minPos = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('无法识别该 .docx 压缩结构，请确认文件是标准 Word (.docx) 文档');
  }

  const cdEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries: ParsedZipEntry[] = [];

  let ptr = cdOffset;
  for (let i = 0; i < cdEntries && ptr + 46 <= bytes.length; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(ptr + 10, true);
    const crc = view.getUint32(ptr + 16, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const fileNameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + fileNameLen));
    ptr += 46 + fileNameLen + extraLen + commentLen;

    if (localHeaderOffset + 30 > bytes.length) continue;
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > bytes.length) continue;

    entries.push({
      name,
      compressionMethod,
      crc,
      compressedData: bytes.subarray(dataStart, dataStart + compressedSize),
      uncompressedSize,
    });
  }

  return entries;
}

function packZipMixed(entries: ParsedZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.compressedData;

    const lh = new Uint8Array(30 + nameBytes.length);
    const lhv = new DataView(lh.buffer);
    lhv.setUint32(0, 0x04034b50, true);
    lhv.setUint16(4, 20, true);
    lhv.setUint16(6, 0x0800, true); // UTF-8 filename, sizes known in header
    lhv.setUint16(8, entry.compressionMethod, true);
    lhv.setUint16(10, 0, true);
    lhv.setUint16(12, 0x5621, true);
    lhv.setUint32(14, entry.crc, true);
    lhv.setUint32(18, data.length, true);
    lhv.setUint32(22, entry.uncompressedSize, true);
    lhv.setUint16(26, nameBytes.length, true);
    lhv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    localParts.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const chv = new DataView(ch.buffer);
    chv.setUint32(0, 0x02014b50, true);
    chv.setUint16(4, 20, true);
    chv.setUint16(6, 20, true);
    chv.setUint16(8, 0x0800, true);
    chv.setUint16(10, entry.compressionMethod, true);
    chv.setUint16(12, 0, true);
    chv.setUint16(14, 0x5621, true);
    chv.setUint32(16, entry.crc, true);
    chv.setUint32(20, data.length, true);
    chv.setUint32(24, entry.uncompressedSize, true);
    chv.setUint16(28, nameBytes.length, true);
    chv.setUint16(30, 0, true);
    chv.setUint16(32, 0, true);
    chv.setUint16(34, 0, true);
    chv.setUint16(36, 0, true);
    chv.setUint32(38, 0, true);
    chv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    centralParts.push(ch);
    offset += lh.length + data.length;
  }

  const cdSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const out = new Uint8Array(offset + cdSize + eocd.length);
  let ptr = 0;
  for (const part of localParts) {
    out.set(part, ptr);
    ptr += part.length;
  }
  for (const part of centralParts) {
    out.set(part, ptr);
    ptr += part.length;
  }
  out.set(eocd, ptr);
  return out;
}

function isEditableWordXmlPart(name: string): boolean {
  return (
    name === 'word/document.xml' ||
    /^word\/header\d*\.xml$/i.test(name) ||
    /^word\/footer\d*\.xml$/i.test(name)
  );
}

function decodeXmlBasic(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXmlWithBreaks(str: string): string {
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return escaped.replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
}

/**
 * Replaces {{placeholder}} tokens inside WordprocessingML XML even when Microsoft Word or WPS
 * has split a single placeholder across multiple adjacent <w:r><w:t> runs.
 * Preserves the exact formatting (<w:rPr>, tables, styles, logos) of the lawyer's own .docx!
 */
export function replacePlaceholdersInWordXml(
  xml: string,
  vars: Record<string, string>
): { xml: string; replacedCount: number } {
  let replacedCount = 0;

  const updatedXml = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paraXml) => {
    const tRegex = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;
    const nodes: {
      start: number;
      end: number;
      attrs: string;
      decoded: string;
      cStart: number;
      cEnd: number;
    }[] = [];

    let concat = '';
    let m: RegExpExecArray | null;
    while ((m = tRegex.exec(paraXml)) !== null) {
      const decoded = decodeXmlBasic(m[2]);
      const cStart = concat.length;
      concat += decoded;
      nodes.push({
        start: m.index,
        end: m.index + m[0].length,
        attrs: m[1] || '',
        decoded,
        cStart,
        cEnd: concat.length,
      });
    }

    if (nodes.length === 0 || !concat.includes('{{')) {
      return paraXml;
    }

    const tokenRe = /\{\{\s*([^{}]+?)\s*\}\}/g;
    const matches: { start: number; end: number; key: string }[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(concat)) !== null) {
      const key = tm[1].trim();
      if (Object.prototype.hasOwnProperty.call(vars, key)) {
        matches.push({ start: tm.index, end: tm.index + tm[0].length, key });
      }
    }

    if (matches.length === 0) {
      return paraXml;
    }

    const nodeTexts = nodes.map((n) => n.decoded);

    // Apply right-to-left so offsets earlier in the same <w:t> node remain exact
    for (let mi = matches.length - 1; mi >= 0; mi--) {
      const hit = matches[mi];
      const replacement = (vars[hit.key] || '').trim() || '________';
      let firstDone = false;

      for (let ni = 0; ni < nodes.length; ni++) {
        const n = nodes[ni];
        if (n.cEnd <= hit.start || n.cStart >= hit.end) continue;

        const curText = nodeTexts[ni];
        if (!firstDone) {
          firstDone = true;
          const localStart = Math.max(0, hit.start - n.cStart);
          const localEnd = Math.min(n.cEnd - n.cStart, hit.end - n.cStart);
          const prefix = curText.slice(0, localStart);
          const suffix = hit.end < n.cEnd ? curText.slice(localEnd) : '';
          nodeTexts[ni] = prefix + replacement + suffix;
          replacedCount += 1;
        } else {
          const localEnd = Math.min(n.cEnd - n.cStart, hit.end - n.cStart);
          nodeTexts[ni] = hit.end < n.cEnd ? curText.slice(localEnd) : '';
        }
      }
    }

    // Rebuild paragraph XML replacing only the <w:t> elements
    let out = '';
    let cursor = 0;
    for (let ni = 0; ni < nodes.length; ni++) {
      const n = nodes[ni];
      out += paraXml.slice(cursor, n.start);
      const nextText = nodeTexts[ni];
      const needsSpacePreserve = /^\s|\s$/.test(nextText);
      const hasSpaceAttr = /xml:space=/.test(n.attrs);
      const attrs = needsSpacePreserve && !hasSpaceAttr ? `${n.attrs} xml:space="preserve"` : n.attrs;
      out += `<w:t${attrs}>${escapeXmlWithBreaks(nextText)}</w:t>`;
      cursor = n.end;
    }
    out += paraXml.slice(cursor);
    return out;
  });

  return { xml: updatedXml, replacedCount };
}

const REDACTION_CATEGORY_LABELS: Record<string, string> = {
  company: '公司/机构全称',
  person: '当事人姓名',
  id_card: '身份证号',
  credit_code: '统一社会信用代码',
  phone: '手机号',
  bank_card: '银行卡号',
  case_no: '案号',
};

/**
 * Inspects a lawyer-uploaded .docx template strictly inside browser memory:
 * 1. Validates ZIP & word/document.xml structure;
 * 2. Lists recognized & unrecognized {{placeholders}};
 * 3. Runs local privacy residual detection so the lawyer is immediately alerted if the
 *    uploaded Word template accidentally still contains old client/case information.
 */
export async function inspectUploadedDocxTemplate(
  bytes: Uint8Array
): Promise<InspectedDocxTemplate> {
  const entries = parseZipEntries(bytes);
  const decoder = new TextDecoder('utf-8');
  const knownKeys = new Set(
    Object.keys(
      buildCompanionVariableMap({
        causeName: '',
        caseNo: '',
        courtName: '',
        clientName: '',
        clientIdOrCode: '',
        clientAddress: '',
        clientPhone: '',
        clientLegalRep: '',
        opponentName: '',
        opponentIdOrCode: '',
        opponentAddress: '',
        opponentPhone: '',
        lawyerName: '',
        lawyerLicenseNo: '',
        lawyerFirm: '',
        lawyerPhone: '',
        lawyerAddress: '',
        lawyerEmail: '',
        authScope: 'special',
        preservationAmount: '',
        targetEvidenceOrg: '',
        signDateCn: '',
      })
    )
  );

  let foundDocXml = false;
  const textParts: string[] = [];

  for (const e of entries) {
    if (!isEditableWordXmlPart(e.name)) continue;
    if (e.name === 'word/document.xml') foundDocXml = true;
    const xmlBytes =
      e.compressionMethod === 0
        ? e.compressedData
        : e.compressionMethod === 8
        ? await inflateRawBytes(e.compressedData)
        : (() => {
            throw new Error(`不支持的 DOCX 压缩方式 (${e.compressionMethod})`);
          })();
    const xmlText = decoder.decode(xmlBytes);
    textParts.push(extractXmlTextFromWordDocument(xmlText));
  }

  if (!foundDocXml) {
    throw new Error('未在该 .docx 中找到正文 word/document.xml，请确认不是旧版 .doc 或损坏文件');
  }

  const combinedText = textParts.join('\n');
  const matchedSet = new Set<string>();
  const unknownSet = new Set<string>();
  const tokenRe = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(combinedText)) !== null) {
    const key = tm[1].trim();
    if (knownKeys.has(key)) matchedSet.add(`{{${key}}}`);
    else unknownSet.add(`{{${key}}}`);
  }

  // Strip placeholders before running local residual PII/case-info check
  const strippedText = combinedText.replace(/\{\{[^{}]+\}\}/g, '');
  const red = redactLegalText(strippedText);
  const countsByCat = new Map<string, number>();
  for (const m of red.mappings) {
    const lbl = REDACTION_CATEGORY_LABELS[m.category] || m.category;
    countsByCat.set(lbl, (countsByCat.get(lbl) || 0) + 1);
  }
  const privacyAlerts: PrivacyResidualAlert[] = Array.from(countsByCat.entries()).map(
    ([categoryLabel, count]) => ({ categoryLabel, count })
  );

  return {
    matchedPlaceholders: Array.from(matchedSet),
    unknownPlaceholders: Array.from(unknownSet),
    privacyAlerts,
    totalPrivacyHits: red.mappings.length,
  };
}

/**
 * Fills a lawyer-uploaded .docx template strictly in browser memory, returning valid OOXML .docx bytes
 * with 100% of original Word styles, tables, logos, headers, and footers intact.
 */
export async function fillCustomDocxTemplateBytes(
  templateBytes: Uint8Array,
  ctx: CompanionDocContext
): Promise<{ bytes: Uint8Array; replacedCount: number }> {
  const entries = parseZipEntries(templateBytes);
  const vars = buildCompanionVariableMap(ctx);
  const decoder = new TextDecoder('utf-8');
  const encoder = new TextEncoder();

  let totalReplaced = 0;
  const outputEntries: ParsedZipEntry[] = [];

  for (const e of entries) {
    if (!isEditableWordXmlPart(e.name)) {
      outputEntries.push(e);
      continue;
    }
    const xmlBytes =
      e.compressionMethod === 0
        ? e.compressedData
        : e.compressionMethod === 8
        ? await inflateRawBytes(e.compressedData)
        : (() => {
            throw new Error(`不支持的 DOCX 压缩方式 (${e.compressionMethod})`);
          })();
    const xmlText = decoder.decode(xmlBytes);
    const { xml: patchedXml, replacedCount } = replacePlaceholdersInWordXml(xmlText, vars);
    totalReplaced += replacedCount;
    const outBytes = encoder.encode(patchedXml);
    outputEntries.push({
      name: e.name,
      compressionMethod: 0, // STORE for patched XML parts
      crc: crc32(outBytes),
      compressedData: outBytes,
      uncompressedSize: outBytes.length,
    });
  }

  return {
    bytes: packZipMixed(outputEntries),
    replacedCount: totalReplaced,
  };
}

// ---- Strictly Local-Only Browser Storage Helpers (NEVER synced to server/cloud) ----

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function loadLocalCustomDocxTemplates(): LocalCustomDocxTemplate[] {
  try {
    const raw = localStorage.getItem(LOCAL_CUSTOM_TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persistLocalCustomDocxTemplates(list: LocalCustomDocxTemplate[]): void {
  try {
    localStorage.setItem(LOCAL_CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    throw new Error('本机浏览器存储空间不足，请删除不常用的本地模板或压缩模板内图片后重试');
  }
}

export async function addLocalCustomDocxTemplateFromFile(
  file: File
): Promise<{ template: LocalCustomDocxTemplate; list: LocalCustomDocxTemplate[] }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
    throw new Error('请先在 Word/WPS 中将旧版 .doc 另存为 .docx 格式后再导入');
  }
  if (!lower.endsWith('.docx')) {
    throw new Error('仅支持导入标准 Word (.docx) 模板文件');
  }
  if (file.size > MAX_CUSTOM_TEMPLATE_BYTES) {
    throw new Error('单个模板文件请控制在 2.5MB 以内（可压缩页眉大图片）');
  }

  const current = loadLocalCustomDocxTemplates();
  if (current.length >= MAX_CUSTOM_TEMPLATES_COUNT) {
    throw new Error(`当前浏览器最多保留 ${MAX_CUSTOM_TEMPLATES_COUNT} 份本地模板，请先删除旧模板`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspection = await inspectUploadedDocxTemplate(bytes);
  const cleanName = file.name.replace(/\.docx$/i, '').trim() || '自定义模板';

  const record: LocalCustomDocxTemplate = {
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    fileName: file.name,
    sizeBytes: bytes.length,
    uploadedAt: Date.now(),
    base64Bytes: uint8ArrayToBase64(bytes),
    matchedPlaceholders: inspection.matchedPlaceholders,
    unknownPlaceholders: inspection.unknownPlaceholders,
    privacyAlerts: inspection.privacyAlerts,
    totalPrivacyHits: inspection.totalPrivacyHits,
  };

  const next = [record, ...current];
  persistLocalCustomDocxTemplates(next);
  return { template: record, list: next };
}

export function deleteLocalCustomDocxTemplate(id: string): LocalCustomDocxTemplate[] {
  const next = loadLocalCustomDocxTemplates().filter((t) => t.id !== id);
  persistLocalCustomDocxTemplates(next);
  return next;
}

export function clearAllLocalCustomDocxTemplates(): void {
  try {
    localStorage.removeItem(LOCAL_CUSTOM_TEMPLATES_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function downloadFilledCustomDocx(
  template: LocalCustomDocxTemplate,
  ctx: CompanionDocContext
): Promise<{ fileName: string; replacedCount: number }> {
  const rawBytes = base64ToUint8Array(template.base64Bytes);
  const { bytes, replacedCount } = await fillCustomDocxTemplateBytes(rawBytes, ctx);
  const safeClient = (ctx.clientName || ctx.causeName || '已填表')
    .replace(/[\\/:*?"<>|\s]+/g, '')
    .slice(0, 18);
  const fileName = `${template.name}_${safeClient}.docx`;

  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  return { fileName, replacedCount };
}
