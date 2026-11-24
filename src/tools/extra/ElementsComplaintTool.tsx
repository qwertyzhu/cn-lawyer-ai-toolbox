import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FileUp,
  ImagePlus,
  KeyRound,
  Loader2,
  Lock,
  Paintbrush,
  Plus,
  Printer,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { ImageRedactModal } from '../../components/ImageRedactModal';
import { useToolbox } from '../../context/ToolboxContext';
import {
  buildComplaintPlainText,
  buildComplaintSections,
  createEmptyParty,
  createInitialComplaintDraft,
  ELEMENTS_COMPLAINT_TEMPLATES,
  getResolvedCauseTitle,
  type ComplaintDraftState,
  type ComplaintTemplateCategory,
  type ComplaintTemplateDef,
  type ElementFieldDef,
  type PartyEntity,
} from '../../data/elementsComplaintTemplates';
import { resolveVisionModel, streamAiCompletion } from '../../lib/aiClient';
import { copyToClipboard } from '../../lib/clipboard';
import { decryptWithPassphrase } from '../../lib/cryptoVault';
import { downloadElementsComplaintDocx } from '../../lib/docxBuilder';
import { extractLocalDocumentText } from '../../lib/docxReader';
import { compressImageFileToAttachment } from '../../lib/imageUtils';
import { redactLegalText, restoreRedactedText } from '../../lib/redactor';
import type { AiImageAttachment, RedactionMapping } from '../../types/toolbox';

const DRAFT_STORAGE_KEY = 'cn_lawyer_box_elements_complaint_draft_v1';

const TEMPLATE_CATEGORIES: ('全部' | ComplaintTemplateCategory)[] = [
  '全部',
  '商事合同',
  '金融借贷',
  '劳动家事与人损',
  '行政与执行',
  '知产与网络',
  '通用兜底',
];

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadSavedDraft(): ComplaintDraftState {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ComplaintDraftState>;
      if (parsed && parsed.templateId) {
        const base = createInitialComplaintDraft(parsed.templateId);
        return {
          ...base,
          ...parsed,
          plaintiffs:
            Array.isArray(parsed.plaintiffs) && parsed.plaintiffs.length > 0
              ? parsed.plaintiffs
              : base.plaintiffs,
          defendants:
            Array.isArray(parsed.defendants) && parsed.defendants.length > 0
              ? parsed.defendants
              : base.defendants,
          agent: { ...base.agent, ...(parsed.agent || {}) },
          thirdParty: { ...base.thirdParty, ...(parsed.thirdParty || {}) },
          claims: { ...base.claims, ...(parsed.claims || {}) },
          claimChoices: { ...base.claimChoices, ...(parsed.claimChoices || {}) },
          facts: { ...base.facts, ...(parsed.facts || {}) },
          factChoices: { ...base.factChoices, ...(parsed.factChoices || {}) },
        };
      }
    }
  } catch {
    // ignore corrupt draft
  }
  return createInitialComplaintDraft('sales_contract');
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

function normalizePartyKind(raw: unknown, fallback: 'org' | 'person'): 'org' | 'person' {
  if (raw === 'person' || raw === 'org') return raw;
  if (typeof raw === 'string') {
    if (/自然人|个人|公民|person/i.test(raw)) return 'person';
    if (/公司|法人|组织|机构|单位|企业|机关|org/i.test(raw)) return 'org';
  }
  return fallback;
}

function normalizePartyArray(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));
  }
  if (raw && typeof raw === 'object') {
    return [raw as Record<string, unknown>];
  }
  return [];
}

function reconcileFieldChoices(
  fields: ElementFieldDef[],
  values: Record<string, string>,
  choices: Record<string, string>
): Record<string, string> {
  const out = { ...choices };
  const isNeg = (s: string) => /^(无|否|不主张|无保全|未经复议直诉|到期自然违约)$/.test(s.trim());
  for (const f of fields) {
    if ((f.kind !== 'radio' && f.kind !== 'radio_detail') || !f.options || f.options.length === 0) {
      continue;
    }
    const detail = (values[f.key] || '').trim();
    const cur = (out[f.key] || '').trim();
    // If model wrote an option or affirmative detail into values[key] while choice is missing/negative, reconcile cleanly
    if (cur && !f.options.includes(cur)) {
      const fuzzy = f.options.find((o) => o.includes(cur) || cur.includes(o));
      if (fuzzy) out[f.key] = fuzzy;
    }
    if (detail && !/^(无|暂无|不适用|不主张|否)$/i.test(detail)) {
      if (!out[f.key] || isNeg(out[f.key])) {
        const matchedOpt =
          f.options.find((o) => !isNeg(o) && detail.includes(o.replace(/主张|合同/g, ''))) ||
          f.options.find((o) => !isNeg(o));
        if (matchedOpt) out[f.key] = matchedOpt;
      }
    }
  }
  return out;
}

function mergeExtractedParty(
  rawObj: Record<string, unknown> | undefined,
  fallback: PartyEntity
): PartyEntity {
  if (!rawObj || typeof rawObj !== 'object') return fallback;
  const s = (k: string, def = '') =>
    typeof rawObj[k] === 'string' && (rawObj[k] as string).trim()
      ? (rawObj[k] as string).trim()
      : def;
  const kind = normalizePartyKind(rawObj.kind, fallback.kind);
  return {
    ...fallback,
    kind,
    name: s('name', fallback.name),
    gender: s('gender', fallback.gender),
    birthDate: s('birthDate', fallback.birthDate),
    ethnicity: s('ethnicity', fallback.ethnicity),
    workUnit: s('workUnit', fallback.workUnit),
    jobTitle: s('jobTitle', fallback.jobTitle),
    domicile: s('domicile', fallback.domicile),
    residence: s('residence', fallback.residence),
    idNumber: s('idNumber', fallback.idNumber),
    regAddress: s('regAddress', fallback.regAddress),
    legalRep: s('legalRep', fallback.legalRep),
    repTitle: s('repTitle', fallback.repTitle),
    creditCode: s('creditCode', fallback.creditCode),
    orgType: s('orgType', fallback.orgType),
    ownershipNature: s('ownershipNature', fallback.ownershipNature || '民营'),
    phone: s('phone', fallback.phone),
  };
}

export const ElementsComplaintTool: React.FC = () => {
  const {
    isOnline,
    byok,
    sessionUnlockedPin,
    setSessionUnlockedPin,
    recordCalculation,
    sendToAi,
    navigateTab,
    showToast,
  } = useToolbox();

  const [draft, setDraft] = useState<ComplaintDraftState>(loadSavedDraft);
  const [activeMode, setActiveMode] = useState<'ai' | 'form' | 'preview'>('ai');
  const [catFilter, setCatFilter] = useState<'全部' | ComplaintTemplateCategory>('全部');

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

  const tpl: ComplaintTemplateDef = useMemo(
    () =>
      ELEMENTS_COMPLAINT_TEMPLATES.find((t) => t.id === draft.templateId) ||
      ELEMENTS_COMPLAINT_TEMPLATES[0],
    [draft.templateId]
  );

  const filteredTemplates = useMemo(
    () =>
      catFilter === '全部'
        ? ELEMENTS_COMPLAINT_TEMPLATES
        : ELEMENTS_COMPLAINT_TEMPLATES.filter((t) => t.category === catFilter),
    [catFilter]
  );

  const activeProvider =
    byok.providers.find((p) => p.id === byok.activeProviderId) || byok.providers[0];
  const hasApiKey = Boolean(activeProvider?.apiKey || activeProvider?.apiKeyEncrypted);
  const needsPinUnlock = Boolean(
    byok.pinEnabled && activeProvider?.apiKeyEncrypted && !sessionUnlockedPin
  );

  // Persist local draft automatically
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // ignore quota error
    }
  }, [draft]);

  const sections = useMemo(() => buildComplaintSections(tpl, draft), [tpl, draft]);
  const causeTitle = useMemo(() => getResolvedCauseTitle(tpl, draft), [tpl, draft]);
  const docTitle = tpl.docTitle || '民事起诉状';
  const [plaintiffRoleLabel, defendantRoleLabel] = tpl.partyRoleLabels || ['原告', '被告'];
  const signerLabel = tpl.signerLabel || '具状人（签字、盖章）';

  const handleSelectTemplate = (nextId: string) => {
    if (nextId === draft.templateId) return;
    const nextTpl =
      ELEMENTS_COMPLAINT_TEMPLATES.find((t) => t.id === nextId) ||
      ELEMENTS_COMPLAINT_TEMPLATES[0];
    const nextClaimChoices: Record<string, string> = {};
    for (const f of nextTpl.claimFields) {
      if (f.defaultOption) nextClaimChoices[f.key] = f.defaultOption;
    }
    const nextFactChoices: Record<string, string> = {};
    for (const f of nextTpl.factFields) {
      if (f.defaultOption) nextFactChoices[f.key] = f.defaultOption;
    }
    setDraft((prev) => ({
      ...prev,
      templateId: nextTpl.id,
      claims: {
        litigation_cost: prev.claims.litigation_cost || '本案案件受理费、保全费由被告承担。',
        legal_basis: nextTpl.defaultLegalBasis,
      },
      claimChoices: nextClaimChoices,
      facts: {},
      factChoices: nextFactChoices,
    }));
    showToast(`已切换示范文本：${nextTpl.title}（原被告信息已保留）`);
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
    const slice = files.slice(0, remain);
    try {
      const added: AiImageAttachment[] = [];
      for (const f of slice) {
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

  const handleAiExtractToForm = async () => {
    setExtractError('');
    if (!sourceText.trim() && sourceImages.length === 0) {
      setExtractError('请先上传传统起诉状（.docx/.txt）、粘贴案情正文或上传起诉状/合同截图。');
      return;
    }
    if (!isOnline) {
      setExtractError('当前处于断网离线模式，AI 提取需要联网；您可以直接切到「离线填表编辑」手动填写并导出 Word。');
      return;
    }
    if (!activeProvider || !hasApiKey) {
      setExtractError('尚未配置个人大模型 API Key。请点击下方按钮前往「我的配置」2 分钟绑定，或先用「离线填表编辑」。');
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
        `当前大模型「${activeProvider.name}」暂不支持图片识别。请在「我的配置」切换为阿里云百炼 / 硅基流动 / 智谱等支持识图的模型，或直接粘贴/导入 .docx 文本。`
      );
      return;
    }

    setExtracting(true);
    setExtractLog('正在通过您个人配置的大模型提取起诉状核心要素…');

    let mappings: RedactionMapping[] = [];
    let promptMaterial = sourceText.trim();
    if (autoRedact && promptMaterial) {
      const res = redactLegalText(promptMaterial);
      promptMaterial = res.redactedText;
      mappings = res.mappings;
    }

    const claimSchemaHints = tpl.claimFields
      .map((f) =>
        f.options
          ? `  "${f.key}": "${f.label}（如有选项从 ${f.options.join('/')} 选填，附具体说明）"`
          : `  "${f.key}": "${f.label}"`
      )
      .join(',\n');

    const factSchemaHints = tpl.factFields
      .map((f) =>
        f.options
          ? `  "${f.key}": "${f.label}（如有选项从 ${f.options.join('/')} 选填，附具体说明）"`
          : `  "${f.key}": "${f.label}"`
      )
      .join(',\n');

    const systemPrompt = `你是中国资深诉讼律师助手，专责将律师提供的传统民事起诉状、案情摘要或合同/证据材料，精准解析为最高人民法院《民事起诉状（${causeTitle}）示范文本》的严格结构化 JSON。
铁律：
1. 严禁编造任何原文中未出现的姓名、公司名、统一社会信用代码、身份证号、金额、日期或合同编号；原文未提及的字段一律填 ""（空字符串）。
2. 若材料中存在脱敏占位符（如 [公司主体A]、[当事人甲]、[身份证号1]），必须一字不差原样保留在 JSON 值中，以便本地自动还原。
3. 只输出一个合法的 JSON 对象（不要输出任何额外解释文字），结构必须严格匹配以下字段：
{
  "courtName": "受诉人民法院名称（如未写填空）",
  "customCause": "具体案由名称（通用版使用）",
  "plaintiffs": [
    {
      "kind": "org 或 person",
      "name": "", "gender": "", "birthDate": "", "ethnicity": "",
      "workUnit": "", "jobTitle": "", "domicile": "", "residence": "",
      "idNumber": "", "regAddress": "", "legalRep": "", "repTitle": "",
      "creditCode": "", "orgType": "", "phone": ""
    }
  ],
  "defendants": [ 同上结构 ],
  "hasJurisdictionAgreement": "有 或 无",
  "jurisdictionDetail": "",
  "hasPrePreservation": "是 或 否",
  "prePreservationDetail": "",
  "applyPreservation": "是 或 否",
  "preservationDetail": "",
  "claims": {
${claimSchemaHints}
  },
  "claimChoices": { "仅针对带选项的诉请字段 key 填入匹配的选项原文" },
  "facts": {
${factSchemaHints}
  },
  "factChoices": { "仅针对带选项的事实字段 key 填入匹配的选项原文" },
  "evidenceSummary": "根据材料归纳的主要证据清单要点"
}`;

    const userContent = promptMaterial
      ? `请将以下传统起诉状/案件材料提取为「${causeTitle}」要素式起诉状 JSON：\n\n${promptMaterial}`
      : `请识别所附起诉状/合同图片内容，提取为「${causeTitle}」要素式起诉状 JSON。`;

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
          setExtractLog(`正在解析要素字段…（已接收 ${fullReply.length} 字）`);
        },
      });

      const parsed = extractFirstJsonObject(fullReply);
      if (!parsed) {
        throw new Error('模型未能返回标准 JSON 结构，请重试或改选更稳定的推理模型。');
      }

      const restored = restoreDeepStrings(parsed, mappings);

      setDraft((prev) => {
        const next = { ...prev };
        if (typeof restored.courtName === 'string' && restored.courtName.trim()) {
          next.courtName = restored.courtName.trim();
        }
        if (
          tpl.id === 'general_civil' &&
          typeof restored.customCause === 'string' &&
          restored.customCause.trim()
        ) {
          next.customCause = restored.customCause.trim();
        }
        const extractedPlaintiffs = normalizePartyArray(restored.plaintiffs);
        if (extractedPlaintiffs.length > 0) {
          next.plaintiffs = extractedPlaintiffs.map((p, idx) =>
            mergeExtractedParty(p, prev.plaintiffs[idx] || createEmptyParty('org'))
          );
        }
        const extractedDefendants = normalizePartyArray(restored.defendants);
        if (extractedDefendants.length > 0) {
          next.defendants = extractedDefendants.map((d, idx) =>
            mergeExtractedParty(d, prev.defendants[idx] || createEmptyParty('org'))
          );
        }
        if (restored.hasJurisdictionAgreement === '有' || restored.hasJurisdictionAgreement === '无') {
          next.hasJurisdictionAgreement = restored.hasJurisdictionAgreement;
        }
        if (typeof restored.jurisdictionDetail === 'string' && restored.jurisdictionDetail.trim()) {
          next.jurisdictionDetail = restored.jurisdictionDetail.trim();
          if (next.hasJurisdictionAgreement === '无') next.hasJurisdictionAgreement = '有';
        }
        if (restored.hasPrePreservation === '是' || restored.hasPrePreservation === '否') {
          next.hasPrePreservation = restored.hasPrePreservation;
        }
        if (typeof restored.prePreservationDetail === 'string' && restored.prePreservationDetail.trim()) {
          next.prePreservationDetail = restored.prePreservationDetail.trim();
          if (next.hasPrePreservation === '否') next.hasPrePreservation = '是';
        }
        if (restored.applyPreservation === '是' || restored.applyPreservation === '否') {
          next.applyPreservation = restored.applyPreservation;
        }
        if (typeof restored.preservationDetail === 'string' && restored.preservationDetail.trim()) {
          next.preservationDetail = restored.preservationDetail.trim();
          if (next.applyPreservation === '否') next.applyPreservation = '是';
        }
        if (restored.claims && typeof restored.claims === 'object') {
          const nextClaims = { ...prev.claims };
          for (const [k, v] of Object.entries(restored.claims as Record<string, unknown>)) {
            if (typeof v === 'string' && v.trim()) nextClaims[k] = v.trim();
          }
          next.claims = nextClaims;
        }
        const rawClaimChoices = { ...prev.claimChoices };
        if (restored.claimChoices && typeof restored.claimChoices === 'object') {
          for (const [k, v] of Object.entries(restored.claimChoices as Record<string, unknown>)) {
            if (typeof v === 'string' && v.trim()) rawClaimChoices[k] = v.trim();
          }
        }
        next.claimChoices = reconcileFieldChoices(tpl.claimFields, next.claims, rawClaimChoices);

        if (restored.facts && typeof restored.facts === 'object') {
          const nextFacts = { ...prev.facts };
          for (const [k, v] of Object.entries(restored.facts as Record<string, unknown>)) {
            if (typeof v === 'string' && v.trim()) nextFacts[k] = v.trim();
          }
          next.facts = nextFacts;
        }
        const rawFactChoices = { ...prev.factChoices };
        if (restored.factChoices && typeof restored.factChoices === 'object') {
          for (const [k, v] of Object.entries(restored.factChoices as Record<string, unknown>)) {
            if (typeof v === 'string' && v.trim()) rawFactChoices[k] = v.trim();
          }
        }
        next.factChoices = reconcileFieldChoices(tpl.factFields, next.facts, rawFactChoices);
        if (typeof restored.evidenceSummary === 'string' && restored.evidenceSummary.trim()) {
          next.evidenceSummary = restored.evidenceSummary.trim();
        }
        return next;
      });

      setActiveMode('form');
      showToast(
        mappings.length > 0
          ? `提取完成并已本地自动还原 ${mappings.length} 项脱敏实体，请核对细节后导出 Word！`
          : 'AI 要素提取完成，已自动灌入下方表格，请核对后导出 Word！'
      );
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'AI 要素提取失败');
    } finally {
      setExtracting(false);
      setExtractLog('');
    }
  };

  const handleDownloadWord = () => {
    const pName = (draft.plaintiffs[0]?.name || '').trim().slice(0, 12);
    const dName = (draft.defendants[0]?.name || '').trim().slice(0, 12);
    const partyTag = pName && dName ? `_${pName}诉${dName}` : '';
    const fileName = `${docTitle}（${causeTitle}）${partyTag}.docx`;
    downloadElementsComplaintDocx(
      {
        docTitle,
        signerLabel,
        causeTitle,
        courtName: draft.courtName,
        sections,
        signerName: draft.signerName,
        signDate: draft.signDate,
      },
      fileName
    );
    showToast(`已生成法院表格版 Word：${fileName}`);
  };

  const handlePrintPdf = () => {
    const rowsHtml = sections
      .map((sec) => {
        const header = `<tr class="sec"><td colspan="2">${escapeHtml(sec.title)}</td></tr>`;
        const items = sec.rows
          .map(
            (r) =>
              `<tr><td class="lbl">${escapeHtml(r.label)}</td><td class="val">${escapeHtml(r.value).replace(/\n/g, '<br/>')}</td></tr>`
          )
          .join('');
        return header + items;
      })
      .join('');

    const htmlDoc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(docTitle)}（${escapeHtml(causeTitle)}）</title>
<style>
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: "FangSong", "STFangsong", "仿宋", "SimSun", serif; color: #000; margin: 0; padding: 20px; background: #fff; font-size: 14px; line-height: 1.7; }
  h1 { text-align: center; font-family: "SimHei", "Heiti SC", sans-serif; font-size: 24px; margin: 0 0 4px; letter-spacing: 6px; }
  .sub { text-align: center; font-family: "SimSun", serif; font-size: 16px; font-weight: 700; margin: 0 0 12px; }
  .note { font-size: 12.5px; margin: 0 0 10px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  td { border: 1px solid #000; padding: 6px 9px; vertical-align: middle; word-break: break-word; }
  tr.sec td { background: #efefef; text-align: center; font-family: "SimHei", "Heiti SC", sans-serif; font-weight: 700; font-size: 14.5px; }
  td.lbl { width: 27%; font-family: "SimSun", serif; font-weight: 700; }
  td.val { width: 73%; }
  .court { margin-top: 20px; font-size: 15px; }
  .sign { margin-top: 24px; text-align: right; font-size: 15px; line-height: 2; }
  .no-print { text-align: right; margin-bottom: 12px; }
  .no-print button { padding: 7px 16px; background: #0E223D; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-size: 13px; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">打印 / 另存为 PDF</button></div>
  <h1>${escapeHtml(docTitle)}</h1>
  <div class="sub">（${escapeHtml(causeTitle)}）</div>
  <div class="note">说明：为了方便您参加诉讼，保护您的合法权利，请参照本表如实填写；有“☐”选项的，在对应项打“☑”；本表空间不足的，可另附页说明。</div>
  <table>${rowsHtml}</table>
  ${draft.courtName.trim() ? `<div class="court">此致<br/>${escapeHtml(draft.courtName.trim())}</div>` : ''}
  <div class="sign">
    ${escapeHtml(signerLabel)}：${escapeHtml(draft.signerName.trim()) || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}<br/>
    日期：${escapeHtml(draft.signDate || '')}
  </div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=880,height=960');
    if (!win) {
      showToast('浏览器拦截了打印窗口，请改点「下载 Word (.docx)」导出文件');
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
    const txt = buildComplaintPlainText(tpl, draft);
    await copyToClipboard(txt);
    showToast('已复制要素式起诉状完整纯文本');
  };

  const handleSaveHistory = () => {
    const txt = buildComplaintPlainText(tpl, draft);
    const summary = `要素式起诉状 · ${causeTitle}${draft.plaintiffs[0]?.name ? ` · ${draft.plaintiffs[0].name}` : ''}`;
    recordCalculation('elements-complaint', '要素式起诉状', summary, txt);
  };

  const handleSendToDeAi = () => {
    const txt = buildComplaintPlainText(tpl, draft);
    sendToAi(
      'de-ai-polish',
      `${docTitle}（${causeTitle}）`,
      `请帮我核查并润色以下要素式${docTitle}的诉讼请求与事实理由表述（保留全部核心事实、日期、金额与表格项号，使其更精炼专业、符合法院立案标准）：\n\n${txt}`
    );
  };

  const handleAiFilingAudit = () => {
    const txt = buildComplaintPlainText(tpl, draft);
    sendToAi(
      'legal-sandbox',
      `${docTitle} · AI 立案退件预警核验`,
      `请站在中国法院立案庭审查法官 + 资深诉讼律师的双重视角，对以下拟提交的要素式《${docTitle}（${causeTitle}）》做一次严格的「立案退件预警与实体风险体检」：\n\n重点排查：\n1. 【诉请与事实闭环】诉请金额、起算日期、利率基数与事实理由是否存在矛盾、漏项或不可执行表述；\n2. 【程序前置与时效红线】是否漏填劳动仲裁前置、2024 新《行政复议法》复议前置及 15 日/6 个月起诉期、普通 3 年诉讼时效或 2 年申请执行时效；\n3. 【管辖与适格主体】受诉法院管辖依据是否充分、有无漏列共同被告/连带保证人/复议维持双被告；\n4. 【立案必附证据清单】列出网上立案最容易被补正退件的缺失材料。\n\n以下为待核验诉状全文：\n\n${txt}`
    );
  };

  const handleResetDraft = () => {
    const fresh = createInitialComplaintDraft(draft.templateId);
    setDraft(fresh);
    setSourceText('');
    setSourceImages([]);
    showToast('已清空当前起诉状草稿');
  };

  const updateParty = (
    listKey: 'plaintiffs' | 'defendants',
    index: number,
    patch: Partial<PartyEntity>
  ) => {
    setDraft((prev) => {
      const nextList = prev[listKey].map((item, i) =>
        i === index ? { ...item, ...patch } : item
      );
      return { ...prev, [listKey]: nextList };
    });
  };

  const renderPartyEditor = (
    titleLabel: string,
    party: PartyEntity,
    onChange: (patch: Partial<PartyEntity>) => void,
    onRemove?: () => void
  ) => (
    <div className="rounded-lg border border-[#E5DFD3] bg-[#FAF9F6] p-3.5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs font-bold text-[#0E223D]">{titleLabel}</span>
          <div className="inline-flex rounded-md border border-[#D8D1C3] bg-white p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => onChange({ kind: 'org' })}
              className={`rounded px-2 py-0.5 font-semibold ${
                party.kind === 'org' ? 'bg-[#0E223D] text-white' : 'text-slate-600'
              }`}
            >
              公司 / 组织
            </button>
            <button
              type="button"
              onClick={() => onChange({ kind: 'person' })}
              className={`rounded px-2 py-0.5 font-semibold ${
                party.kind === 'person' ? 'bg-[#0E223D] text-white' : 'text-slate-600'
              }`}
            >
              自然人
            </button>
          </div>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3" /> 移除
          </button>
        )}
      </div>

      {party.kind === 'org' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <input
            type="text"
            value={party.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="公司 / 机构全称 *"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
          />
          <input
            type="text"
            value={party.creditCode}
            onChange={(e) => onChange({ creditCode: e.target.value })}
            placeholder="统一社会信用代码（18位）"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2 font-mono"
          />
          <input
            type="text"
            value={party.domicile}
            onChange={(e) => onChange({ domicile: e.target.value })}
            placeholder="住所地 / 经营地址"
            className="sm:col-span-2 rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
          />
          <input
            type="text"
            value={party.legalRep}
            onChange={(e) => onChange({ legalRep: e.target.value })}
            placeholder="法定代表人 / 负责人姓名"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
          />
          <input
            type="text"
            value={party.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            placeholder="联系电话（被告未知可留空）"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
          />
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
            <span className="font-semibold">所有制性质：</span>
            {['民营', '国有', '外资', ''].map((nat) => (
              <button
                key={nat || 'none'}
                type="button"
                onClick={() => onChange({ ownershipNature: nat })}
                className={`rounded border px-2 py-0.5 font-semibold ${
                  (party.ownershipNature || '') === nat
                    ? 'border-[#0E223D] bg-[#0E223D] text-white'
                    : 'border-[#D8D1C3] bg-white text-slate-600'
                }`}
              >
                {nat || '不注明'}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <input
            type="text"
            value={party.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="姓名 *"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
          />
          <input
            type="text"
            value={party.gender}
            onChange={(e) => onChange({ gender: e.target.value })}
            placeholder="性别（男/女）"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
          />
          <input
            type="text"
            value={party.birthDate}
            onChange={(e) => onChange({ birthDate: e.target.value })}
            placeholder="出生日期（如1990-01-01）"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
          />
          <input
            type="text"
            value={party.idNumber}
            onChange={(e) => onChange({ idNumber: e.target.value })}
            placeholder="公民身份号码（18位）"
            className="sm:col-span-2 rounded border border-[#D8D1C3] bg-white px-2.5 py-2 font-mono"
          />
          <input
            type="text"
            value={party.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            placeholder="联系电话"
            className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
          />
          <input
            type="text"
            value={party.domicile}
            onChange={(e) => onChange({ domicile: e.target.value })}
            placeholder="户籍地 / 住所地"
            className="sm:col-span-3 rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
          />
        </div>
      )}
    </div>
  );

  const renderElementField = (
    f: ElementFieldDef,
    values: Record<string, string>,
    choices: Record<string, string>,
    onValChange: (key: string, val: string) => void,
    onChoiceChange: (key: string, val: string) => void
  ) => (
    <div key={f.key} className="space-y-1.5">
      <label className="block text-xs font-bold text-[#11151C]">{f.label}</label>
      {(f.kind === 'radio' || f.kind === 'radio_detail') && f.options && (
        <div className="flex flex-wrap gap-1.5">
          {f.options.map((opt) => {
            const active = (choices[f.key] || f.defaultOption || f.options![0]) === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChoiceChange(f.key, opt)}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[#0E223D] bg-[#0E223D] text-white'
                    : 'border-[#D8D1C3] bg-white text-slate-600 hover:border-[#0E223D]'
                }`}
              >
                {active ? '☑ ' : '☐ '}
                {opt}
              </button>
            );
          })}
        </div>
      )}
      {f.kind === 'text' && (
        <input
          type="text"
          value={values[f.key] || ''}
          onChange={(e) => onValChange(f.key, e.target.value)}
          placeholder={f.placeholder}
          className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2 text-xs text-[#11151C] focus:border-[#0E223D] focus:outline-none"
        />
      )}
      {(f.kind === 'textarea' || f.kind === 'radio_detail') && (
        <textarea
          rows={f.kind === 'radio_detail' ? 2 : 3}
          value={values[f.key] || ''}
          onChange={(e) => onValChange(f.key, e.target.value)}
          placeholder={f.detailPlaceholder || f.placeholder}
          className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2 text-xs leading-5 text-[#11151C] focus:border-[#0E223D] focus:outline-none"
        />
      )}
    </div>
  );

  return (
    <div className="py-4 sm:py-6 px-3.5 sm:px-6 mx-auto max-w-5xl space-y-4">
      {/* Header Card */}
      <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9A773E]">
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#B89254]" />
              <span>最高人民法院表格化示范文本 · 14 类高频案由（民事 / 行政 / 执行）</span>
            </div>
            <h1 className="mt-1 font-display text-xl sm:text-2xl font-bold text-[#11151C]">
              要素式起诉状与申请书一键生成工作台
            </h1>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              既支持上传传统起诉状 / 案情材料通过您自己的 AI 一键提取转写为表格化要素诉状（支持本地脱敏 + 截图涂抹打码），也支持 100% 离线直接填表，一键导出法院提交级真 Word（.docx）与 A4 PDF。
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={handleDownloadWord}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345C] px-3.5 py-2 text-xs font-bold text-[#F6F4EF] shadow-xs"
            >
              <Download className="h-3.5 w-3.5 text-[#D1B27A]" /> 导出 Word (.docx)
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

        {/* Cause of Action Selector */}
        <div className="pt-2 border-t border-[#EFECE5] space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#0E223D]">
              第一步：选择案件类型 / 要素示范文本（当前：{tpl.title}）
            </span>
            <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar">
              {TEMPLATE_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCatFilter(c)}
                  className={`flex-none rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                    catFilter === c
                      ? 'border-[#0E223D] bg-[#0E223D] text-white'
                      : 'border-[#DED8CC] bg-[#FAF9F6] text-slate-600'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {filteredTemplates.map((item) => {
              const active = item.id === tpl.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTemplate(item.id)}
                  className={`rounded-lg border px-2.5 py-2 text-left transition-all ${
                    active
                      ? 'border-[#0E223D] bg-[#0E223D] text-white shadow-xs'
                      : 'border-[#E5DFD3] bg-[#FAF9F6] text-[#11151C] hover:border-[#0E223D]/60'
                  }`}
                >
                  <div className="text-xs font-bold truncate">{item.shortTitle}</div>
                  <div
                    className={`mt-0.5 text-[10px] truncate ${
                      active ? 'text-[#D1B27A]' : 'text-slate-500'
                    }`}
                  >
                    {item.badge}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3-Tab Mode Switcher */}
      <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-[#DED8CC] bg-white p-1.5 shadow-xs">
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
          onClick={() => setActiveMode('form')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 px-2 text-xs font-bold transition-colors ${
            activeMode === 'form'
              ? 'bg-[#0E223D] text-[#F6F4EF] shadow-xs'
              : 'text-slate-600 hover:bg-[#F6F4EF]'
          }`}
        >
          <FileText className="h-3.5 w-3.5 text-[#B89254]" />
          <span>离线要素填表</span>
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
          <span>A4 预览导出</span>
        </button>
      </div>

      {/* MODE 1: AI Convert Traditional Complaint -> Structured Elements */}
      {activeMode === 'ai' && (
        <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-[#11151C]">
                上传传统起诉状 / 案情材料 → AI 一键转写为「{tpl.title}」要素表
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                支持本地导入 <code>.docx</code> / <code>.txt</code>、直接粘贴正文或上传诉状/合同截图；使用您个人配置的 API Key，全程不经律所留存。
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
                <strong>「离线要素填表」</strong> 免费离线生成 Word。
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
              <FileUp className="h-3.5 w-3.5 text-[#0E223D]" /> 导入传统起诉状 (.docx / .txt)
            </button>
            <button
              type="button"
              onClick={() => imgInputRef.current?.click()}
              disabled={sourceImages.length >= 6}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1B27A] bg-[#FBF7EE] hover:bg-[#F5ECD9] px-3 py-2 text-xs font-semibold text-[#7A5922] disabled:opacity-45"
            >
              <ImagePlus className="h-3.5 w-3.5" /> 传诉状/合同截图 ({sourceImages.length}/6)
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
                showToast(`已从剪贴板粘贴 ${added.length} 张截图（可点「涂抹打码」）`);
              } catch {
                showToast('粘贴图片失败');
              }
            }}
            placeholder="请将传统民事/行政起诉状全文、案件事实或合同条款粘贴至此（支持导入 .docx/.txt，或直接 Ctrl+V / ⌘V 粘贴起诉状截图）…"
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
              onClick={handleAiExtractToForm}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0E223D] hover:bg-[#17345C] px-5 py-2.5 text-xs sm:text-sm font-bold text-[#F6F4EF] shadow-xs disabled:opacity-50"
            >
              {extracting ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#D1B27A]" />
              ) : (
                <Sparkles className="h-4 w-4 text-[#D1B27A]" />
              )}
              <span>{extracting ? 'AI 正在提取要素…' : 'AI 一键提取要素并填入表格'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('form')}
              className="rounded-lg border border-[#D8D1C3] bg-white hover:border-[#0E223D] px-4 py-2.5 text-xs font-semibold text-[#11151C]"
            >
              跳过 AI，直接离线手动填表 →
            </button>
          </div>
        </section>
      )}

      {/* MODE 2: Offline Structured Element Form */}
      {activeMode === 'form' && (
        <div className="space-y-4">
          {tpl.id === 'general_civil' && (
            <section className="rounded-xl border border-[#DED8CC] bg-white p-4 space-y-2 shadow-xs">
              <label className="block text-xs font-bold text-[#0E223D]">
                自定义案由名称（将显示在标题《民事起诉状（XX纠纷）》括号内）
              </label>
              <input
                type="text"
                value={draft.customCause}
                onChange={(e) => setDraft((p) => ({ ...p, customCause: e.target.value }))}
                placeholder="例如：服务合同纠纷 / 股权转让纠纷 / 不正当竞争纠纷"
                className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2 text-xs"
              />
            </section>
          )}

          {/* Section 1: Parties */}
          <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-2.5">
              <h2 className="font-display text-sm sm:text-base font-bold text-[#0E223D]">
                一、当事人信息
              </h2>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setDraft((p) => ({ ...p, plaintiffs: [...p.plaintiffs, createEmptyParty('org')] }))
                  }
                  className="inline-flex items-center gap-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-1 text-[11px] font-semibold text-[#0E223D]"
                >
                  <Plus className="h-3 w-3" /> 添加原告
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((p) => ({ ...p, defendants: [...p.defendants, createEmptyParty('org')] }))
                  }
                  className="inline-flex items-center gap-1 rounded border border-[#D8D1C3] bg-[#FAF9F6] px-2.5 py-1 text-[11px] font-semibold text-[#0E223D]"
                >
                  <Plus className="h-3 w-3" /> 添加被告
                </button>
              </div>
            </div>

            {draft.plaintiffs.map((p, idx) =>
              renderPartyEditor(
                `${plaintiffRoleLabel}${draft.plaintiffs.length > 1 ? idx + 1 : ''}`,
                p,
                (patch) => updateParty('plaintiffs', idx, patch),
                draft.plaintiffs.length > 1
                  ? () =>
                      setDraft((prev) => ({
                        ...prev,
                        plaintiffs: prev.plaintiffs.filter((_, i) => i !== idx),
                      }))
                  : undefined
              )
            )}

            {/* Agent */}
            <div className="rounded-lg border border-[#E5DFD3] bg-[#FAF9F6] p-3.5 space-y-2.5">
              <label className="inline-flex items-center gap-2 text-xs font-bold text-[#0E223D] cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.agent.enabled}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, agent: { ...p.agent, enabled: e.target.checked } }))
                  }
                  className="accent-[#0E223D]"
                />
                <span>填写委托诉讼代理人（选填，律师自行填写本人信息）</span>
              </label>
              {draft.agent.enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <input
                    type="text"
                    value={draft.agent.name}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, agent: { ...p.agent, name: e.target.value } }))
                    }
                    placeholder="代理律师姓名"
                    className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
                  />
                  <input
                    type="text"
                    value={draft.agent.firm}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, agent: { ...p.agent, firm: e.target.value } }))
                    }
                    placeholder="律师事务所名称"
                    className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
                  />
                  <input
                    type="text"
                    value={draft.agent.phone}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, agent: { ...p.agent, phone: e.target.value } }))
                    }
                    placeholder="代理人联系电话"
                    className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
                  />
                  <input
                    type="text"
                    value={draft.agent.licenseNo || ''}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, agent: { ...p.agent, licenseNo: e.target.value } }))
                    }
                    placeholder="律师执业证号（选填）"
                    className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2 font-mono"
                  />
                  <div className="sm:col-span-2 flex items-center gap-2">
                    {(['特别授权', '一般授权'] as const).map((auth) => (
                      <button
                        key={auth}
                        type="button"
                        onClick={() =>
                          setDraft((p) => ({ ...p, agent: { ...p.agent, authority: auth } }))
                        }
                        className={`flex-1 rounded border py-2 text-xs font-semibold ${
                          draft.agent.authority === auth
                            ? 'border-[#0E223D] bg-[#0E223D] text-white'
                            : 'border-[#D8D1C3] bg-white text-slate-600'
                        }`}
                      >
                        {draft.agent.authority === auth ? '☑ ' : '☐ '}
                        {auth}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {draft.defendants.map((d, idx) =>
              renderPartyEditor(
                `${defendantRoleLabel}${draft.defendants.length > 1 ? idx + 1 : ''}`,
                d,
                (patch) => updateParty('defendants', idx, patch),
                draft.defendants.length > 1
                  ? () =>
                      setDraft((prev) => ({
                        ...prev,
                        defendants: prev.defendants.filter((_, i) => i !== idx),
                      }))
                  : undefined
              )
            )}

            {/* Service address */}
            <div className="rounded-lg border border-[#E5DFD3] bg-[#FAF9F6] p-3.5 space-y-2.5">
              <div className="text-xs font-bold text-[#0E223D]">送达地址与电子送达确认</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <input
                  type="text"
                  value={draft.serviceAddress}
                  onChange={(e) => setDraft((p) => ({ ...p, serviceAddress: e.target.value }))}
                  placeholder="文书送达地址（留空默认同原告住所地）"
                  className="sm:col-span-3 rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
                />
                <input
                  type="text"
                  value={draft.serviceRecipient}
                  onChange={(e) => setDraft((p) => ({ ...p, serviceRecipient: e.target.value }))}
                  placeholder="收件人"
                  className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
                />
                <input
                  type="text"
                  value={draft.servicePhone}
                  onChange={(e) => setDraft((p) => ({ ...p, servicePhone: e.target.value }))}
                  placeholder="收件联系电话"
                  className="rounded border border-[#D8D1C3] bg-white px-2.5 py-2"
                />
                <div className="flex items-center gap-1.5">
                  {(['同意', '不同意'] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, electronicService: opt }))}
                      className={`flex-1 rounded border py-2 text-xs font-semibold ${
                        draft.electronicService === opt
                          ? 'border-[#0E223D] bg-[#0E223D] text-white'
                          : 'border-[#D8D1C3] bg-white text-slate-600'
                      }`}
                    >
                      {opt}电子送达
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Claims */}
          <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5 shadow-xs">
            <h2 className="font-display text-sm sm:text-base font-bold text-[#0E223D] border-b border-[#EFECE5] pb-2.5">
              二、诉讼请求和依据（{tpl.title}）
            </h2>
            {tpl.claimFields.map((f) =>
              renderElementField(
                f,
                draft.claims,
                draft.claimChoices,
                (key, val) => setDraft((p) => ({ ...p, claims: { ...p.claims, [key]: val } })),
                (key, val) =>
                  setDraft((p) => ({ ...p, claimChoices: { ...p.claimChoices, [key]: val } }))
              )
            )}
          </section>

          {/* Section 3: Jurisdiction & Preservation */}
          <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5 shadow-xs">
            <h2 className="font-display text-sm sm:text-base font-bold text-[#0E223D] border-b border-[#EFECE5] pb-2.5">
              三、约定管辖和诉讼保全
            </h2>
            <div className="space-y-3 text-xs">
              <div className="space-y-1.5">
                <span className="font-bold text-[#11151C] block">1. 有无仲裁、法院管辖约定</span>
                <div className="flex gap-2">
                  {(['无', '有'] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, hasJurisdictionAgreement: opt }))}
                      className={`rounded-md border px-3 py-1 font-semibold ${
                        draft.hasJurisdictionAgreement === opt
                          ? 'border-[#0E223D] bg-[#0E223D] text-white'
                          : 'border-[#D8D1C3] bg-white text-slate-600'
                      }`}
                    >
                      {draft.hasJurisdictionAgreement === opt ? '☑ ' : '☐ '}
                      {opt}
                    </button>
                  ))}
                </div>
                {draft.hasJurisdictionAgreement === '有' && (
                  <input
                    type="text"
                    value={draft.jurisdictionDetail}
                    onChange={(e) => setDraft((p) => ({ ...p, jurisdictionDetail: e.target.value }))}
                    placeholder="写明合同第几条约定由 XX 人民法院管辖"
                    className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2"
                  />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <span className="font-bold text-[#11151C] block">2. 是否已申请诉前保全</span>
                  <div className="flex gap-2">
                    {(['否', '是'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, hasPrePreservation: opt }))}
                        className={`rounded-md border px-3 py-1 font-semibold ${
                          draft.hasPrePreservation === opt
                            ? 'border-[#0E223D] bg-[#0E223D] text-white'
                            : 'border-[#D8D1C3] bg-white text-slate-600'
                        }`}
                      >
                        {draft.hasPrePreservation === opt ? '☑ ' : '☐ '}
                        {opt}
                      </button>
                    ))}
                  </div>
                  {draft.hasPrePreservation === '是' && (
                    <input
                      type="text"
                      value={draft.prePreservationDetail}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, prePreservationDetail: e.target.value }))
                      }
                      placeholder="保全法院及裁定案号"
                      className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2"
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <span className="font-bold text-[#11151C] block">3. 是否申请诉讼财产保全</span>
                  <div className="flex gap-2">
                    {(['否', '是'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, applyPreservation: opt }))}
                        className={`rounded-md border px-3 py-1 font-semibold ${
                          draft.applyPreservation === opt
                            ? 'border-[#0E223D] bg-[#0E223D] text-white'
                            : 'border-[#D8D1C3] bg-white text-slate-600'
                        }`}
                      >
                        {draft.applyPreservation === opt ? '☑ ' : '☐ '}
                        {opt}
                      </button>
                    ))}
                  </div>
                  {draft.applyPreservation === '是' && (
                    <input
                      type="text"
                      value={draft.preservationDetail}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, preservationDetail: e.target.value }))
                      }
                      placeholder="拟保全金额及银行账户/房产/股权线索"
                      className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2"
                    />
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Facts and Reasons */}
          <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5 shadow-xs">
            <h2 className="font-display text-sm sm:text-base font-bold text-[#0E223D] border-b border-[#EFECE5] pb-2.5">
              四、事实和理由（{tpl.title}要素清单）
            </h2>
            {tpl.factFields.map((f) =>
              renderElementField(
                f,
                draft.facts,
                draft.factChoices,
                (key, val) => setDraft((p) => ({ ...p, facts: { ...p.facts, [key]: val } })),
                (key, val) =>
                  setDraft((p) => ({ ...p, factChoices: { ...p.factChoices, [key]: val } }))
              )
            )}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[#11151C]">
                {tpl.factFields.length + 1}. 证据清单概要（可另附《证据目录》）
              </label>
              <textarea
                rows={2}
                value={draft.evidenceSummary}
                onChange={(e) => setDraft((p) => ({ ...p, evidenceSummary: e.target.value }))}
                placeholder="例：1. 合同原件；2. 银行转账回单；3. 微信对账记录；4. 催款律师函及签收凭证。"
                className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2 text-xs leading-5"
              />
            </div>
          </section>

          {/* Section 5: Mediation & Sign-off (Zero prefilled personal info!) */}
          <section className="rounded-xl border border-[#DED8CC] bg-white p-4 sm:p-5 space-y-3.5 shadow-xs">
            <h2 className="font-display text-sm sm:text-base font-bold text-[#0E223D] border-b border-[#EFECE5] pb-2.5">
              五、先行调解意愿、受诉法院与落款（自行填写）
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1.5">
                <span className="font-bold text-[#11151C] block">是否了解先行调解的益处</span>
                <div className="flex gap-2">
                  {(['了解', '不了解'] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, mediationKnow: opt }))}
                      className={`rounded-md border px-3 py-1 font-semibold ${
                        draft.mediationKnow === opt
                          ? 'border-[#0E223D] bg-[#0E223D] text-white'
                          : 'border-[#D8D1C3] bg-white text-slate-600'
                      }`}
                    >
                      {draft.mediationKnow === opt ? '☑ ' : '☐ '}
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="font-bold text-[#11151C] block">是否考虑先行调解（最高法 2025 示范文本三选项）</span>
                <div className="flex flex-wrap gap-1.5">
                  {(['是', '否', '暂不确定，想要了解更多'] as const).map((opt) => {
                    const currentNorm =
                      draft.mediationAgree === '同意'
                        ? '是'
                        : draft.mediationAgree === '不同意'
                        ? '否'
                        : draft.mediationAgree;
                    const active = currentNorm === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, mediationAgree: opt }))}
                        className={`rounded-md border px-2.5 py-1 font-semibold ${
                          active
                            ? 'border-[#0E223D] bg-[#0E223D] text-white'
                            : 'border-[#D8D1C3] bg-white text-slate-600'
                        }`}
                      >
                        {active ? '☑ ' : '☐ '}
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <label className="font-bold text-[#11151C] block">此致（受诉人民法院名称）</label>
                <input
                  type="text"
                  value={draft.courtName}
                  onChange={(e) => setDraft((p) => ({ ...p, courtName: e.target.value }))}
                  placeholder="例：杭州市西湖区人民法院"
                  className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-[#11151C] block">具状人落款（选填，留空则导出空位供签字盖章）</label>
                <input
                  type="text"
                  value={draft.signerName}
                  onChange={(e) => setDraft((p) => ({ ...p, signerName: e.target.value }))}
                  placeholder="留空导出后直接手写签名或加盖公章"
                  className="w-full rounded-lg border border-[#D8D1C3] bg-white px-3 py-2"
                />
              </div>
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveMode('preview')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345C] px-4 py-2.5 text-xs font-bold text-[#F6F4EF]"
              >
                <CheckCircle2 className="h-4 w-4 text-[#D1B27A]" /> 预览 A4 表格并导出 Word
              </button>
              <button
                type="button"
                onClick={handleDownloadWord}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#B89254] hover:bg-[#C9A364] px-4 py-2.5 text-xs font-bold text-[#11151C]"
              >
                <Download className="h-4 w-4" /> 直接下载 Word (.docx)
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
                onClick={handleResetDraft}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[#D8D1C3] px-3 py-2 text-xs text-slate-600 hover:text-red-700"
              >
                <RotateCcw className="h-3.5 w-3.5" /> 清空草稿
              </button>
            </div>
          </section>
        </div>
      )}

      {/* MODE 3: Live A4 Court Table Preview & Export */}
      {activeMode === 'preview' && (
        <div className="space-y-3">
          {/* Action Bar */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DED8CC] bg-white p-3 shadow-xs">
            <button
              type="button"
              onClick={handleDownloadWord}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0E223D] hover:bg-[#17345C] px-3.5 py-2 text-xs font-bold text-[#F6F4EF]"
            >
              <Download className="h-3.5 w-3.5 text-[#D1B27A]" /> 下载 Word (.docx)
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
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" /> AI 立案退件预警核验
            </button>
            <button
              type="button"
              onClick={handleSendToDeAi}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#B89254] px-3 py-2 text-xs font-bold text-[#11151C]"
            >
              <Sparkles className="h-3.5 w-3.5" /> 送 AI 去AI味润色
            </button>
          </div>

          {/* A4 Paper Court Table */}
          <div className="rounded-xl border border-[#D6CFC2] bg-white p-5 sm:p-9 shadow-sm text-[#11151C] overflow-x-auto">
            <div className="min-w-[300px] max-w-[740px] mx-auto font-serif">
              <h2 className="text-center text-xl sm:text-2xl font-bold tracking-[0.28em]">
                {docTitle}
              </h2>
              <div className="text-center text-sm sm:text-base font-bold mt-1 mb-3">
                （{causeTitle}）
              </div>
              <p className="text-[11.5px] leading-5 text-slate-600 mb-3">
                说明：为了方便您参加诉讼，保护您的合法权利，请参照本表如实填写；有“☐”选项的，在对应项打“☑”；本表空间不足的，可另附页说明。
              </p>

              <table className="w-full border-collapse border border-black text-xs sm:text-[13px] leading-6">
                <tbody>
                  {sections.map((sec) => (
                    <React.Fragment key={sec.title}>
                      <tr className="bg-[#EFEFEF]">
                        <td
                          colSpan={2}
                          className="border border-black px-3 py-1.5 text-center font-bold"
                        >
                          {sec.title}
                        </td>
                      </tr>
                      {sec.rows.map((row) => (
                        <tr key={`${sec.title}-${row.label}`}>
                          <td className="border border-black px-2.5 py-2 font-bold align-middle w-[30%] bg-[#FCFCFB]">
                            {row.label}
                          </td>
                          <td className="border border-black px-2.5 py-2 whitespace-pre-wrap break-words align-middle w-[70%]">
                            {row.value}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>

              {draft.courtName.trim() && (
                <div className="mt-5 text-sm leading-7">
                  <div>此致</div>
                  <div className="pl-6">{draft.courtName.trim()}</div>
                </div>
              )}

              <div className="mt-6 text-right text-sm leading-8">
                <div>
                  {signerLabel}：
                  <span className="inline-block min-w-[110px] border-b border-dashed border-slate-400 text-center">
                    {draft.signerName.trim()}
                  </span>
                </div>
                <div>日期：{draft.signDate}</div>
              </div>
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
