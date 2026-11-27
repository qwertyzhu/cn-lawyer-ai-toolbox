/**
 * 最高人民法院《关于印发部分案件起诉状答辩状示范文本的通知》（法〔2025〕82号）
 * 2025 年 5 月 28 日发布、2025 年 7 月 14 日起全国法院全面推广使用
 * 全量 9 大领域 · 67 类纠纷 · 113 份官方示范文本数据模型、勾选项交互引擎与文书解析器。
 */

export type SpcDomainId =
  | 'civil_commercial'
  | 'ip_civil'
  | 'ip_admin'
  | 'admin'
  | 'execution'
  | 'maritime'
  | 'env_resource'
  | 'state_comp'
  | 'criminal_private';

export type SpcDocRole = 'claim' | 'defense' | 'application' | 'statement';

export type SpcRoleTag =
  | 'plaintiff_person'
  | 'plaintiff_org'
  | 'agent'
  | 'service'
  | 'defendant_person'
  | 'defendant_org'
  | 'third_person'
  | 'third_org'
  | 'mediation_know'
  | 'mediation_benefit'
  | 'mediation_agree'
  | 'case_meta';

export interface OfficialSpcRow {
  id: string;
  kind: 'notice' | 'section' | 'guide' | 'field' | 'full_input' | 'grid';
  label?: string;
  templateText?: string;
  cells?: string[];
  vMergeContinue?: boolean;
  roleTag?: SpcRoleTag;
  repeatable?: boolean;
}

export interface OfficialSpcAttachment {
  label: string;
  title: string;
  subtitle?: string;
  columns: string[];
  rows: string[][];
  footerLines: string[];
}

export interface OfficialSpcTemplate {
  id: string;
  domainId: SpcDomainId;
  domainName: string;
  causeName: string;
  shortCause: string;
  docRole: SpcDocRole;
  docTitle: string;
  docSubtitle: string;
  displayName: string;
  sourceFile: string;
  rows: OfficialSpcRow[];
  signerLine: string;
  dateLine: string;
  footnotes?: string[];
  attachments: OfficialSpcAttachment[];
}

export interface SpcTemplateCorpus {
  standard: string;
  issuedDate: string;
  effectiveDate: string;
  source: string;
  count: number;
  templates: OfficialSpcTemplate[];
}

export interface ExtraPartyInstance {
  uid: string;
  sourceRowId: string;
  label: string;
  value: string;
}

export interface OfficialSpcDraftState {
  templateId: string;
  /** Map of row.id -> edited full verbatim cell text (for field / guide / full_input) */
  rowValues: Record<string, string>;
  /** Map of row.id -> edited cells array (for grid rows such as 案号/案由 or 3-col patent rows) */
  gridValues: Record<string, string[]>;
  /** Duplicated repeatable party rows or custom added element rows */
  extraRows: ExtraPartyInstance[];
  /** Official row IDs explicitly hidden/excluded by the lawyer or AI instruction */
  excludedRowIds: string[];
  /** Edited attachment tables: attachmentIndex -> 2D string array */
  attachmentRows: Record<number, string[][]>;
  /** Attachment submitter/date overrides */
  attachmentSubmitter: string;
  attachmentDate: string;
  /** Optional hide completely untouched duplicate party type rows (default false = strict 100% official blank rows preserved) */
  hideUntouchedPartyRows: boolean;
  /** Whether to include post-signature official attachments when present */
  includeAttachments: boolean;
  /** Sign-off name (defaults empty so lawyer can hand-sign / affix seal) */
  signerName: string;
  /** Sign-off date */
  signDate: string;
  /** True when populated from the built-in fictional demo sample; forces demo watermark filename on export */
  isDemoSample?: boolean;
}

export interface ResolvedSpcRow {
  id: string;
  kind: OfficialSpcRow['kind'];
  label?: string;
  value?: string;
  cells?: string[];
  vMergeContinue?: boolean;
  roleTag?: SpcRoleTag;
}

export interface ResolvedSpcAttachment {
  label: string;
  title: string;
  subtitle?: string;
  columns: string[];
  rows: string[][];
  footerLines: string[];
}

export interface ResolvedSpcDocument {
  templateId: string;
  docTitle: string;
  docSubtitle: string;
  displayName: string;
  rows: ResolvedSpcRow[];
  signerLine: string;
  signerName: string;
  dateLine: string;
  signDate: string;
  footnotes: string[];
  attachments: ResolvedSpcAttachment[];
}

export interface CheckboxToken {
  index: number;
  charPos: number;
  label: string;
  checked: boolean;
}

export interface PartyQuickFillData {
  // Natural person
  name: string;
  gender: '' | '男' | '女';
  birthDate: string;
  ethnicity: string;
  workUnit: string;
  jobTitle: string;
  phone: string;
  domicile: string;
  residence: string;
  idType: string;
  idNumber: string;
  // Org
  regAddress: string;
  legalRep: string;
  repTitle: string;
  creditCode: string;
  orgType: string;
  ownershipNature: '' | '国有' | '民营' | '其他';
  stateControl?: '' | '控股' | '参股';
  // Execution bank info (optional)
  bankAccount?: string;
  bankHolder?: string;
  bankName?: string;
  // Agent
  agentHas: boolean;
  agentAuthority: '' | '一般授权' | '特别授权';
}

export const SPC_DOMAINS: { id: 'popular' | SpcDomainId; label: string }[] = [
  { id: 'popular', label: '高频精选' },
  { id: 'civil_commercial', label: '民商事' },
  { id: 'ip_civil', label: '知产民事' },
  { id: 'ip_admin', label: '知产行政' },
  { id: 'admin', label: '普通行政' },
  { id: 'execution', label: '执行' },
  { id: 'maritime', label: '海事' },
  { id: 'env_resource', label: '环境资源' },
  { id: 'state_comp', label: '国家赔偿' },
  { id: 'criminal_private', label: '刑事自诉' },
];

export const SPC_DOC_ROLE_LABELS: Record<'all' | SpcDocRole, string> = {
  all: '全部文书',
  claim: '起诉状 / 自诉状',
  defense: '答辩状',
  application: '申请书',
  statement: '意见陈述书',
};

export const POPULAR_TEMPLATE_NAMES: string[] = [
  '买卖合同纠纷民事起诉状',
  '买卖合同纠纷民事答辩状',
  '民间借贷纠纷民事起诉状',
  '民间借贷纠纷民事答辩状',
  '劳动争议纠纷民事起诉状',
  '房屋租赁合同纠纷民事起诉状',
  '建设工程施工合同纠纷民事起诉状',
  '金融借款合同纠纷民事起诉状',
  '机动车交通事故责任纠纷民事起诉状',
  '物业服务合同纠纷民事起诉状',
  '离婚纠纷民事起诉状',
  '侵害著作权及邻接权纠纷民事起诉状',
  '侵害商标权纠纷民事起诉状',
  '侵害发明专利权纠纷民事起诉状',
  '行政处罚行政起诉状',
  '强制执行申请书',
];

let cachedCorpus: SpcTemplateCorpus | null = null;
let inflightCorpus: Promise<SpcTemplateCorpus> | null = null;

export async function loadOfficialSpcCorpus(): Promise<SpcTemplateCorpus> {
  if (cachedCorpus) return cachedCorpus;
  if (inflightCorpus) return inflightCorpus;
  const baseUrl =
    (typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
    '/';
  inflightCorpus = fetch(`${baseUrl}data/spc-2025-templates.json`, { cache: 'force-cache' })
    .then(async (resp) => {
      if (!resp.ok) {
        throw new Error(`加载最高法示范文本库失败 (HTTP ${resp.status})`);
      }
      const data = (await resp.json()) as SpcTemplateCorpus;
      if (!data || !Array.isArray(data.templates) || data.templates.length === 0) {
        throw new Error('最高法示范文本数据格式异常');
      }
      cachedCorpus = data;
      return data;
    })
    .finally(() => {
      inflightCorpus = null;
    });
  return inflightCorpus;
}

export function getTodayChinaDateCn(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}年${m}月${day}日`;
}

export function createInitialSpcDraft(tpl: OfficialSpcTemplate): OfficialSpcDraftState {
  const rowValues: Record<string, string> = {};
  const gridValues: Record<string, string[]> = {};
  for (const r of tpl.rows) {
    if (r.kind === 'field' || r.kind === 'full_input') {
      rowValues[r.id] = r.templateText ?? '';
    } else if (r.kind === 'guide') {
      rowValues[r.id] = '';
    } else if (r.kind === 'grid' && r.cells) {
      gridValues[r.id] = [...r.cells];
    }
  }
  const attachmentRows: Record<number, string[][]> = {};
  (tpl.attachments || []).forEach((att, idx) => {
    attachmentRows[idx] = att.rows.map((r) => [...r]);
  });
  return {
    templateId: tpl.id,
    rowValues,
    gridValues,
    extraRows: [],
    excludedRowIds: [],
    attachmentRows,
    attachmentSubmitter: '',
    attachmentDate: '',
    hideUntouchedPartyRows: false,
    includeAttachments: (tpl.attachments || []).length > 0,
    signerName: '',
    signDate: '',
  };
}

/**
 * Parses every □ / ☑ checkbox inside an official SPC cell text and returns
 * clean human-readable labels for interactive 1-click toggling in the UI.
 * Supports BOTH suffix checkboxes ("男□ 女□", "有限责任公司□") and prefix checkboxes ("□是 □否", "□ 1. ...").
 */
export function parseCheckboxTokens(text: string): CheckboxToken[] {
  const tokens: CheckboxToken[] = [];
  if (!text) return tokens;

  const lines = text.split('\n');
  let offset = 0;
  let boxIdx = 0;

  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch !== '□' && ch !== '☑') continue;
      const checked = ch === '☑';
      const charPos = offset + i;

      // Determine whether label precedes the box (suffix style: "男□") or follows it (prefix style: "□是")
      const before = line.slice(0, i);
      const after = line.slice(i + 1);
      const beforeTrim = before.trimEnd();
      const prevChar = beforeTrim.slice(-1);

      let label = '';
      // If box is at start of line, or immediately after punctuation/space/another box with non-CJK before it,
      // check if this is prefix-style ("□是", "□ 1. 未经...", "□警告")
      const looksPrefix =
        beforeTrim.length === 0 ||
        /[：:，,。；;（(□☑]$/.test(beforeTrim) ||
        (after.trimStart().length > 0 &&
          /^(?:\s*\d+\.\s*[\u4e00-\u9fff]|是|否|有|无|警告|罚款|没收|暂扣|限制|行政拘留|其他|大气|水|土壤|电子|固体|噪声|光|放射性)/.test(
            after
          ) &&
          !/[\u4e00-\u9fff）)]$/.test(beforeTrim));

      if (looksPrefix) {
        const afterClean = after.trimStart();
        const m = afterClean.match(/^([^□☑\n]{1,22})/);
        if (m) {
          label = m[1]
            .split(/[ ]{2,}|[：:，,。；;]/)[0]
            .trim();
        }
      } else {
        // Suffix style: take the nearest phrase immediately before □
        // Split by wide spaces, colons, parentheses, or previous checkboxes
        const m = beforeTrim.match(/([^□☑：:（(；;，,。]+)$/);
        if (m) {
          const seg = m[1].trim();
          const parts = seg.split(/\s+/);
          label = parts[parts.length - 1] || seg;
        }
      }

      if (!label) {
        label = prevChar ? `选项${boxIdx + 1}` : `勾选${boxIdx + 1}`;
      }
      if (label.length > 18) {
        label = label.slice(0, 18) + '…';
      }

      tokens.push({
        index: boxIdx,
        charPos,
        label,
        checked,
      });
      boxIdx++;
    }
    offset += line.length + 1;
  }

  return tokens;
}

export function toggleCheckboxAtIndex(text: string, targetIndex: number): string {
  let idx = 0;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '□' || ch === '☑') {
      if (idx === targetIndex) {
        out += ch === '□' ? '☑' : '□';
      } else {
        out += ch;
      }
      idx++;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Quick helper for "是否了解先行调解解决纠纷的好处" (5 points, each has 了解□ 不了解□):
 * sets all 5 points to 了解☑ 不了解□ (or vice versa) in 1 click!
 */
export function setAllMediationBenefitChoices(text: string, know: boolean): string {
  if (know) {
    return text.replace(/了解[□☑](\s+)不了解[□☑]/g, '了解☑$1不了解□');
  }
  return text.replace(/了解[□☑](\s+)不了解[□☑]/g, '了解□$1不了解☑');
}

export function createEmptyPartyQuickFill(): PartyQuickFillData {
  return {
    name: '',
    gender: '',
    birthDate: '',
    ethnicity: '汉族',
    workUnit: '',
    jobTitle: '',
    phone: '',
    domicile: '',
    residence: '',
    idType: '居民身份证',
    idNumber: '',
    regAddress: '',
    legalRep: '',
    repTitle: '法定代表人',
    creditCode: '',
    orgType: '有限责任公司',
    ownershipNature: '民营',
    stateControl: '',
    bankAccount: '',
    bankHolder: '',
    bankName: '',
    agentHas: true,
    agentAuthority: '特别授权',
  };
}

/**
 * Precision-populates a verbatim official SPC party cell (自然人 / 法人、非法人组织 / 委托诉讼代理人)
 * without altering any official SPC label or checkbox order!
 */
export function applyPartyQuickFillToCellText(
  templateText: string,
  roleTag: SpcRoleTag | undefined,
  data: PartyQuickFillData
): string {
  let text = templateText;
  if (!roleTag) return text;

  if (roleTag === 'agent') {
    if (!data.agentHas) {
      text = text.replace(/有[□☑]/, '有□').replace(/无[□☑]/, '无☑');
      return text;
    }
    text = text.replace(/有[□☑]/, '有☑').replace(/无[□☑]/, '无□');
    if (data.name.trim()) text = text.replace(/(姓名：)[^\n]*/, `$1${data.name.trim()}`);
    if (data.workUnit.trim() || data.jobTitle.trim() || data.phone.trim()) {
      text = text.replace(
        /单位：[^\n]*职务：[^\n]*联系电话：[^\n]*/,
        `单位：${data.workUnit.trim() || '        '}    职务：${data.jobTitle.trim() || '律师'}    联系电话：${data.phone.trim() || '        '}`
      );
    }
    if (data.agentAuthority === '一般授权') {
      text = text.replace(/一般授权[□☑]/, '一般授权☑').replace(/特别授权[□☑]/, '特别授权□');
    } else if (data.agentAuthority === '特别授权') {
      text = text.replace(/一般授权[□☑]/, '一般授权□').replace(/特别授权[□☑]/, '特别授权☑');
    }
    return text;
  }

  if (roleTag === 'plaintiff_person' || roleTag === 'defendant_person' || roleTag === 'third_person') {
    if (data.name.trim()) text = text.replace(/(姓名：)[^\n]*/, `$1${data.name.trim()}`);
    if (data.gender === '男') {
      text = text.replace(/男[□☑]/, '男☑').replace(/女[□☑]/, '女□');
    } else if (data.gender === '女') {
      text = text.replace(/男[□☑]/, '男□').replace(/女[□☑]/, '女☑');
    }
    if (data.birthDate.trim() || data.ethnicity.trim()) {
      const m = data.birthDate.trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
      const birthStr = m
        ? `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`
        : data.birthDate.trim() || '        年        月        日';
      text = text.replace(
        /出生日期：[^\n]*民族：[^\n]*/,
        `出生日期：${birthStr}    民族：${data.ethnicity.trim() || ''}`
      );
    }
    if (data.workUnit.trim() || data.jobTitle.trim() || data.phone.trim()) {
      text = text.replace(
        /工作单位：[^\n]*职务：[^\n]*联系电话：[^\n]*/,
        `工作单位：${data.workUnit.trim() || '    '}    职务：${data.jobTitle.trim() || '    '}    联系电话：${data.phone.trim() || ''}`
      );
    }
    if (data.domicile.trim()) {
      text = text.replace(/(住所地（户籍所在地）：)[^\n]*/, `$1${data.domicile.trim()}`);
    }
    if (data.residence.trim()) {
      text = text.replace(/(经常居住地：)[^\n]*/, `$1${data.residence.trim()}`);
    }
    if (data.idType.trim()) {
      text = text.replace(/(证件类型：)[^\n]*/, `$1${data.idType.trim()}`);
    }
    if (data.idNumber.trim()) {
      text = text.replace(/(证件号码：)[^\n]*/, `$1${data.idNumber.trim()}`);
    }
    return text;
  }

  if (roleTag === 'plaintiff_org' || roleTag === 'defendant_org' || roleTag === 'third_org') {
    if (data.name.trim()) text = text.replace(/(名称：)[^\n]*/, `$1${data.name.trim()}`);
    if (data.domicile.trim()) {
      text = text.replace(/(住所地（主要办事机构所在地）：)[^\n]*/, `$1${data.domicile.trim()}`);
    }
    if (data.regAddress.trim()) {
      text = text.replace(/(注册地\s*\/\s*登记地：)[^\n]*/, `$1${data.regAddress.trim()}`);
    }
    if (data.legalRep.trim() || data.repTitle.trim() || data.phone.trim()) {
      text = text.replace(
        /法定代表人\s*\/\s*负责人：[^\n]*职务：[^\n]*联系电话：[^\n]*/,
        `法定代表人 / 负责人：${data.legalRep.trim() || '    '}    职务：${data.repTitle.trim() || '法定代表人'}    联系电话：${data.phone.trim() || ''}`
      );
    }
    if (data.creditCode.trim()) {
      text = text.replace(/(统一社会信用代码：)[^\n]*/, `$1${data.creditCode.trim()}`);
    }
    if (data.bankAccount?.trim()) {
      text = text.replace(/(银行账号：)[^\n]*/, `$1${data.bankAccount.trim()}`);
    }
    if (data.bankHolder?.trim()) {
      text = text.replace(/(开户名：)[^\n]*/, `$1${data.bankHolder.trim()}`);
    }
    if (data.bankName?.trim()) {
      text = text.replace(/(开户行：)[^\n]*/, `$1${data.bankName.trim()}`);
    }
    if (data.orgType.trim()) {
      // Clear any previously checked org types on the 类型 lines, then check the chosen one
      const knownOrgTypes = [
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
      for (const ot of knownOrgTypes) {
        text = text.replace(new RegExp(`${ot}[□☑]`), `${ot}${ot === data.orgType ? '☑' : '□'}`);
      }
    }
    if (data.ownershipNature) {
      text = text
        .replace(/国有[□☑]/, `国有${data.ownershipNature === '国有' ? '☑' : '□'}`)
        .replace(/控股[□☑]/, `控股${data.ownershipNature === '国有' && data.stateControl === '控股' ? '☑' : '□'}`)
        .replace(/参股[□☑]/, `参股${data.ownershipNature === '国有' && data.stateControl === '参股' ? '☑' : '□'}`)
        .replace(/民营[□☑]/, `民营${data.ownershipNature === '民营' ? '☑' : '□'}`)
        .replace(/其他[□☑]/, `其他${data.ownershipNature === '其他' ? '☑' : '□'}`);
    }
    return text;
  }

  return text;
}

/**
 * Checks whether a repeatable party row still equals its blank official template verbatim.
 */
export function isRowUntouched(row: OfficialSpcRow, currentVal: string | undefined): boolean {
  const base = (row.templateText || '').trim();
  const cur = (currentVal ?? base).trim();
  return cur === base;
}

/**
 * Builds the canonical resolved official SPC document used verbatim by:
 * - A4 live preview
 * - A4 print/PDF
 * - OOXML Word (.docx) builder
 * - Plain-text copy & AI audit
 */
export function buildResolvedSpcDocument(
  tpl: OfficialSpcTemplate,
  draft: OfficialSpcDraftState,
  opts?: { blankMode?: boolean }
): ResolvedSpcDocument {
  const blankMode = Boolean(opts?.blankMode);
  const resolvedRows: ResolvedSpcRow[] = [];

  // Pre-check which party roles have a sibling filled (so hideUntouchedPartyRows never hides ALL plaintiffs/defendants!)
  const hasFilledPlaintiff = tpl.rows.some(
    (r) =>
      (r.roleTag === 'plaintiff_person' || r.roleTag === 'plaintiff_org') &&
      !isRowUntouched(r, draft.rowValues[r.id])
  );
  const hasFilledDefendant = tpl.rows.some(
    (r) =>
      (r.roleTag === 'defendant_person' || r.roleTag === 'defendant_org') &&
      !isRowUntouched(r, draft.rowValues[r.id])
  );

  const excludedSet = new Set(!blankMode && Array.isArray(draft.excludedRowIds) ? draft.excludedRowIds : []);

  for (const r of tpl.rows) {
    if (!blankMode && r.kind !== 'notice' && r.kind !== 'section' && excludedSet.has(r.id)) {
      // Still splice custom extraRows anchored after this row if any exist
      const extrasAfterExcluded = draft.extraRows.filter((ex) => ex.sourceRowId === r.id);
      for (const ex of extrasAfterExcluded) {
        resolvedRows.push({
          id: ex.uid,
          kind: 'field',
          label: ex.label,
          value: ex.value,
          roleTag: r.roleTag,
        });
      }
      continue;
    }

    if (!blankMode && draft.hideUntouchedPartyRows && r.kind === 'field') {
      const untouched = isRowUntouched(r, draft.rowValues[r.id]);
      if (untouched) {
        if (
          (r.roleTag === 'plaintiff_person' || r.roleTag === 'plaintiff_org') &&
          hasFilledPlaintiff
        ) {
          continue;
        }
        if (
          (r.roleTag === 'defendant_person' || r.roleTag === 'defendant_org') &&
          hasFilledDefendant
        ) {
          continue;
        }
        if (r.roleTag === 'third_person' || r.roleTag === 'third_org') {
          continue;
        }
      }
    }

    if (r.kind === 'notice' || r.kind === 'section') {
      resolvedRows.push({
        id: r.id,
        kind: r.kind,
        value: r.templateText || '',
      });
    } else if (r.kind === 'guide') {
      const userGuide = blankMode ? '' : (draft.rowValues[r.id] || '').trim();
      resolvedRows.push({
        id: r.id,
        kind: 'guide',
        value: userGuide
          ? `${r.templateText || ''}\n${userGuide}`
          : r.templateText || '',
      });
    } else if (r.kind === 'full_input') {
      resolvedRows.push({
        id: r.id,
        kind: 'full_input',
        value: blankMode ? r.templateText || '' : draft.rowValues[r.id] ?? r.templateText ?? '',
      });
    } else if (r.kind === 'grid') {
      const cells = blankMode
        ? [...(r.cells || [])]
        : draft.gridValues[r.id]
        ? [...draft.gridValues[r.id]]
        : [...(r.cells || [])];
      resolvedRows.push({
        id: r.id,
        kind: 'grid',
        cells,
        vMergeContinue: r.vMergeContinue,
        roleTag: r.roleTag,
      });
    } else {
      const val = blankMode ? r.templateText || '' : draft.rowValues[r.id] ?? r.templateText ?? '';
      resolvedRows.push({
        id: r.id,
        kind: 'field',
        label: r.label || '',
        value: val,
        roleTag: r.roleTag,
      });
    }

    // Insert any duplicated party rows OR custom lawyer/AI-added element rows right after their anchor row
    if (!blankMode) {
      const extras = draft.extraRows.filter((ex) => ex.sourceRowId === r.id);
      for (const ex of extras) {
        resolvedRows.push({
          id: ex.uid,
          kind: 'field',
          label: ex.label,
          value: ex.value,
          roleTag: r.roleTag,
        });
      }
    }
  }

  const resolvedAttachments: ResolvedSpcAttachment[] =
    (blankMode || draft.includeAttachments) && tpl.attachments?.length
      ? tpl.attachments.map((att, idx) => {
          const rows =
            !blankMode && draft.attachmentRows[idx]
              ? draft.attachmentRows[idx].map((r) => [...r])
              : att.rows.map((r) => [...r]);
          const footerLines = (att.footerLines || []).map((fl) => {
            if (!blankMode && fl.startsWith('提交人') && draft.attachmentSubmitter.trim()) {
              return `提交人：${draft.attachmentSubmitter.trim()}`;
            }
            if (!blankMode && fl.startsWith('提交时间') && draft.attachmentDate.trim()) {
              return `提交时间：${draft.attachmentDate.trim()}`;
            }
            return fl;
          });
          return {
            label: att.label,
            title: att.title,
            subtitle: att.subtitle,
            columns: [...att.columns],
            rows,
            footerLines,
          };
        })
      : [];

  return {
    templateId: tpl.id,
    docTitle: tpl.docTitle,
    docSubtitle: tpl.docSubtitle,
    displayName: tpl.displayName,
    rows: resolvedRows,
    signerLine: tpl.signerLine || '具状人（签字、盖章）：',
    signerName: blankMode ? '' : draft.signerName.trim(),
    dateLine: tpl.dateLine || '日期：',
    signDate: blankMode ? '' : draft.signDate.trim(),
    footnotes: [...(tpl.footnotes || [])],
    attachments: resolvedAttachments,
  };
}

export function buildOfficialSpcPlainText(doc: ResolvedSpcDocument): string {
  const lines: string[] = [doc.docTitle];
  if (doc.docSubtitle) lines.push(doc.docSubtitle);
  lines.push('');

  for (const r of doc.rows) {
    if (r.kind === 'notice') {
      lines.push(r.value || '', '');
    } else if (r.kind === 'section') {
      lines.push(`【${r.value || ''}】`);
    } else if (r.kind === 'guide' || r.kind === 'full_input') {
      if (r.value) lines.push(r.value, '');
    } else if (r.kind === 'grid' && r.cells) {
      lines.push(r.cells.join(' | '));
    } else if (r.kind === 'field') {
      lines.push(`${(r.label || '').replace(/\n/g, '')}：`);
      if (r.value) lines.push(r.value);
      lines.push('');
    }
  }

  lines.push(`${doc.signerLine}${doc.signerName}`);
  lines.push(`${doc.dateLine}${doc.signDate || '    年    月    日'}`);

  if (doc.attachments.length > 0) {
    for (const att of doc.attachments) {
      lines.push('', `--- ${att.label}：${att.title} ---`);
      if (att.columns.length) lines.push(att.columns.join(' | '));
      for (const row of att.rows) {
        lines.push(row.join(' | '));
      }
      for (const fl of att.footerLines) {
        lines.push(fl);
      }
    }
  }

  return lines.join('\n').trim();
}

export interface SpcAiPatchPayload {
  rowValues?: Record<string, string>;
  gridValues?: Record<string, string[]>;
  excludeRowIds?: string[];
  restoreRowIds?: string[];
  addExtraRows?: { afterRowId: string; label: string; value: string }[];
  updateExtraRows?: { uid: string; label?: string; value?: string }[];
  removeExtraRowUids?: string[];
  signerName?: string;
  signDate?: string;
  courtName?: string;
  summary?: string;
  missingChecklist?: string[];
}

export interface SpcAiPatchApplyResult {
  nextDraft: OfficialSpcDraftState;
  changedLabels: string[];
  excludedLabels: string[];
  restoredLabels: string[];
  addedLabels: string[];
  removedExtraCount: number;
  totalOps: number;
}

/**
 * Safely applies a structured AI patch (both Round 1 extraction and Round N multi-turn edits)
 * onto an OfficialSpcDraftState without ever deleting official notice/section headers or corrupting untouched rows.
 */
export function applySpcAiPatch(
  tpl: OfficialSpcTemplate,
  draft: OfficialSpcDraftState,
  patch: SpcAiPatchPayload
): SpcAiPatchApplyResult {
  const rowMap = new Map(tpl.rows.map((r) => [r.id, r]));
  const nextRowValues = { ...draft.rowValues };
  const nextGridValues = { ...draft.gridValues };
  const excludedSet = new Set(Array.isArray(draft.excludedRowIds) ? draft.excludedRowIds : []);
  let nextExtraRows = Array.isArray(draft.extraRows) ? draft.extraRows.map((x) => ({ ...x })) : [];
  let nextSignerName = draft.signerName;
  let nextSignDate = draft.signDate;

  const changedLabels: string[] = [];
  const excludedLabels: string[] = [];
  const restoredLabels: string[] = [];
  const addedLabels: string[] = [];
  let removedExtraCount = 0;

  const rowDisplayName = (r: OfficialSpcRow): string =>
    (r.label || (r.cells ? r.cells[0] : '') || r.id).replace(/\n/g, '').trim() || r.id;

  if (patch.rowValues && typeof patch.rowValues === 'object') {
    for (const [k, v] of Object.entries(patch.rowValues)) {
      const target = rowMap.get(k);
      if (!target || target.kind === 'notice' || target.kind === 'section' || target.kind === 'grid') continue;
      if (typeof v !== 'string') continue;
      if (nextRowValues[k] !== v) {
        nextRowValues[k] = v;
        changedLabels.push(rowDisplayName(target));
        // If AI explicitly updates a previously excluded row, restore it automatically
        if (excludedSet.has(k)) {
          excludedSet.delete(k);
          restoredLabels.push(rowDisplayName(target));
        }
      }
    }
  }

  if (patch.gridValues && typeof patch.gridValues === 'object') {
    for (const [k, v] of Object.entries(patch.gridValues)) {
      const target = rowMap.get(k);
      if (!target || target.kind !== 'grid' || !Array.isArray(v)) continue;
      const normalized = v.map((cell) => String(cell ?? ''));
      nextGridValues[k] = normalized;
      changedLabels.push(rowDisplayName(target));
    }
  }

  if (Array.isArray(patch.excludeRowIds)) {
    for (const id of patch.excludeRowIds) {
      const target = rowMap.get(String(id));
      if (!target || target.kind === 'notice' || target.kind === 'section') continue;
      if (!excludedSet.has(target.id)) {
        excludedSet.add(target.id);
        excludedLabels.push(rowDisplayName(target));
      }
    }
  }

  if (Array.isArray(patch.restoreRowIds)) {
    for (const id of patch.restoreRowIds) {
      const target = rowMap.get(String(id));
      if (target && excludedSet.has(target.id)) {
        excludedSet.delete(target.id);
        restoredLabels.push(rowDisplayName(target));
      }
    }
  }

  if (Array.isArray(patch.removeExtraRowUids) && patch.removeExtraRowUids.length > 0) {
    const rmSet = new Set(patch.removeExtraRowUids.map(String));
    const before = nextExtraRows.length;
    nextExtraRows = nextExtraRows.filter((ex) => !rmSet.has(ex.uid));
    removedExtraCount = before - nextExtraRows.length;
  }

  if (Array.isArray(patch.updateExtraRows)) {
    for (const upd of patch.updateExtraRows) {
      if (!upd || typeof upd.uid !== 'string') continue;
      const target = nextExtraRows.find((ex) => ex.uid === upd.uid);
      if (!target) continue;
      if (typeof upd.label === 'string' && upd.label.trim()) target.label = upd.label.trim();
      if (typeof upd.value === 'string') target.value = upd.value;
      changedLabels.push(target.label);
    }
  }

  if (Array.isArray(patch.addExtraRows)) {
    const fallbackAnchor =
      [...tpl.rows].reverse().find((r) => r.kind === 'field' || r.kind === 'full_input')?.id ||
      tpl.rows[tpl.rows.length - 1]?.id ||
      'r01';
    patch.addExtraRows.forEach((item, idx) => {
      if (!item || typeof item.label !== 'string' || !item.label.trim()) return;
      const anchor = rowMap.has(String(item.afterRowId || '')) ? String(item.afterRowId) : fallbackAnchor;
      nextExtraRows.push({
        uid: `extra_ai_${anchor}_${Date.now()}_${idx}`,
        sourceRowId: anchor,
        label: item.label.trim(),
        value: typeof item.value === 'string' ? item.value : '',
      });
      addedLabels.push(item.label.trim());
    });
  }

  if (typeof patch.signerName === 'string' && patch.signerName.trim() !== nextSignerName.trim()) {
    nextSignerName = patch.signerName.trim();
    changedLabels.push('具状人/落款人');
  }
  if (typeof patch.signDate === 'string' && patch.signDate.trim() !== nextSignDate.trim()) {
    nextSignDate = patch.signDate.trim();
    changedLabels.push('落款日期');
  }

  const totalOps =
    changedLabels.length +
    excludedLabels.length +
    restoredLabels.length +
    addedLabels.length +
    removedExtraCount;

  return {
    nextDraft: {
      ...draft,
      rowValues: nextRowValues,
      gridValues: nextGridValues,
      excludedRowIds: Array.from(excludedSet),
      extraRows: nextExtraRows,
      signerName: nextSignerName,
      signDate: nextSignDate,
    },
    changedLabels,
    excludedLabels,
    restoredLabels,
    addedLabels,
    removedExtraCount,
    totalOps,
  };
}

