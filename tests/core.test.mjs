import test from 'node:test';
import assert from 'node:assert/strict';

// Note: Node v24+ supports importing TypeScript directly with experimental strip-types or we test via compiled/imported modules
import {
  toLegalRmbUppercase,
  calculateArt561Offset,
  calcStatutoryRiskAgencyCap,
  PROHIBITED_RISK_CATEGORIES,
} from '../src/lib/financeUtils.ts';
import { redactLegalText, restoreRedactedText } from '../src/lib/redactor.ts';
import {
  AI_PROVIDER_PRESETS,
  AiDirectConnectError,
  buildProviderRequestHeaders,
  buildProviderRequestPayload,
  fetchAvailableModels,
  isOpenCodeEndpoint,
  normalizeModelsEndpoints,
  parseModelsResponsePayload,
  streamAiCompletion,
  suggestModelSlots,
} from '../src/lib/aiClient.ts';
import {
  AI_LEGAL_DISCLAIMER,
  checkLprDateCoverage,
  isDateOutsideHolidayCoverage,
} from '../src/data/legalDataManifest.ts';
import { buildIcsContent } from '../src/lib/icsGenerator.ts';
import { AI_SPECIALISTS_REGISTRY } from '../src/data/toolRegistry.ts';
import {
  COMPANION_PLACEHOLDER_SPECS,
  extractCompanionContextFromSpcDraft,
  fillCustomDocxTemplateBytes,
  inspectUploadedDocxTemplate,
  replacePlaceholdersInWordXml,
} from '../src/lib/companionDocsBuilder.ts';
import {
  ELEMENTS_COMPLAINT_TEMPLATES,
  createInitialComplaintDraft,
  buildComplaintSections,
  getResolvedCauseTitle,
} from '../src/data/elementsComplaintTemplates.ts';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  buildElementsComplaintDocxBytes,
  buildMarkdownReportDocxBytes,
  buildOfficialSpcDocxBytes,
  buildZipBundleBytes,
} from '../src/lib/docxBuilder.ts';
import {
  buildSpcBatchZipEntries,
  runSpcBatchQueue,
} from '../src/lib/spcBatchEngine.ts';
import {
  applyPartyQuickFillToCellText,
  applySpcAiPatch,
  buildResolvedSpcDocument,
  createEmptyPartyQuickFill,
  createInitialSpcDraft,
  parseCheckboxTokens,
  setAllMediationBenefitChoices,
  toggleCheckboxAtIndex,
} from '../src/lib/spcOfficialTemplates.ts';
import { extractLocalDocumentText, extractXmlTextFromWordDocument } from '../src/lib/docxReader.ts';
import {
  dedupeNearDuplicateImaItems,
  extractLegalSearchTerms,
  scoreImaSearchItem,
  extractDocxTextFromBuffer,
} from '../server/imaHelpers.mjs';
import {
  encryptWithPassphrase,
  decryptWithPassphrase,
  exportEncryptedSyncCode,
  importEncryptedSyncCode,
} from '../src/lib/cryptoVault.ts';
import {
  DEFAULT_CLOUD_SYNC_PREFS,
  buildLocalSyncSnapshot,
  encodeSyncSnapshotForUpload,
  decodeSyncSnapshotFromCloud,
  resetLocalUserWorkspaceForAccountSwitch,
} from '../src/lib/cloudSync.ts';
import {
  verifyActivationCode,
  signActivationCodeWithMasterToken,
  formatWeChatInvitationCard,
  buildSignedAdminHeaders,
  createOpenModeLicense,
} from '../src/lib/licenseEngine.ts';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import {
  CN_ADJUSTED_WORKDAYS,
  CN_HOLIDAYS,
  calculateWorkdayInterval,
  computeLegalDeadline,
} from '../src/lib/legalCalendar.ts';
import {
  computeLprAndDelayInterest,
  evaluatePrivateLendingCap,
} from '../src/lib/lprEngine.ts';
import {
  calculateLaborSeveranceTenure,
  calculateLitigationLifecycleFees,
  calculatePersonalInjuryRecoverable,
} from '../src/lib/legalCalculators.ts';
import {
  isDemoSampleDraft,
  makeScopedSpcDraftKey,
  parseSpcDraftBundle,
  serializeSpcDraftBundle,
  switchSpcTemplatePreservingDrafts,
} from '../src/lib/spcDraftStorage.ts';
import {
  classifyGlobalStatuteQuery,
  searchStatuteEntries,
  searchStatuteEntriesDetailed,
} from '../src/lib/statuteSearch.ts';
import { describeAiReadiness } from '../src/lib/pwaUpdate.ts';
import { toolboxStorage } from '../src/lib/storage.ts';
import { splitPdfIntoVerifiedVolumes } from '../src/lib/pdfVolumeSplitter.ts';

async function createEphemeralP256KeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const cleanPub = { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y };
  const cleanPriv = { kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y, d: privateJwk.d };
  const masterToken =
    'TR-MASTER-' + Buffer.from(JSON.stringify(cleanPriv), 'utf8').toString('base64url');
  return { publicJwk: cleanPub, privateJwk: cleanPriv, masterToken };
}

test('RMB Legal Uppercase handles zero, cents, wan/yi boundaries accurately', () => {
  assert.equal(toLegalRmbUppercase(0), '人民币零元整');
  assert.equal(toLegalRmbUppercase(100000), '人民币壹拾万元整');
  assert.equal(toLegalRmbUppercase(100000.05), '人民币壹拾万元零伍分');
  assert.equal(toLegalRmbUppercase(128500.5), '人民币壹拾贰万捌仟伍佰元伍角');
});

test('Civil Code Art. 561 offsets Expense -> Interest -> Principal in strict statutory order', () => {
  const res = calculateArt561Offset({
    initialPrincipal: 100000,
    initialExpense: 5000,
    startDate: '2026-01-01',
    annualRatePercent: 3.65, // 10 yuan/day on 100,000 over 365-day year
    yearBasis: 365,
    repayments: [
      { id: '1', date: '2026-01-11', amount: 16000 }, // 10 days interest = 100; expense = 5000; remaining 10,900 -> principal
    ],
  });
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].paidToExpense, 5000);
  assert.equal(res.rows[0].paidToInterest, 100);
  assert.equal(res.rows[0].paidToPrincipal, 10900);
  assert.equal(res.finalPrincipal, 89100);

  // Regression: empty/cleared dates must NOT yield NaN
  const emptyDateRes = calculateArt561Offset({
    initialPrincipal: 100000,
    startDate: '',
    annualRatePercent: 6,
    repayments: [{ id: '1', date: '', amount: 10000 }],
    settleDate: '',
  });
  assert.equal(Number.isNaN(emptyDateRes.totalGrandRemaining), false);
  assert.equal(emptyDateRes.finalPrincipal, 100000);
});

test('Lawyer Risk Agency statutory caps match 司发通〔2021〕87号 (18%/15%/12%/9%/6%)', () => {
  // 6,000,000 => 1,000,000*18% (180,000) + 4,000,000*15% (600,000) + 1,000,000*12% (120,000) = 900,000
  const cap = calcStatutoryRiskAgencyCap(6_000_000);
  assert.equal(cap.maxAllowedFee, 900_000);
  assert.ok(PROHIBITED_RISK_CATEGORIES.criminal?.includes('严禁'));
  assert.equal(PROHIBITED_RISK_CATEGORIES.ip_copyright, null);
});

test('Local Legal Redactor strips PII/companies/names and restores both half/full-width placeholders', () => {
  const sample =
    '原告：杭州星河光影文化传媒有限公司，法定代表人：林建国，手机13858129988，身份证33010619890512341X，案号（2025）浙0105民初4321号。';
  const red = redactLegalText(sample);
  assert.ok(!red.redactedText.includes('杭州星河光影文化传媒有限公司'));
  assert.ok(!red.redactedText.includes('林建国'));
  assert.ok(!red.redactedText.includes('13858129988'));
  assert.ok(!red.redactedText.includes('33010619890512341X'));
  assert.ok(red.redactedText.includes('[公司主体A]'));
  assert.ok(red.redactedText.includes('[当事人甲]'));

  // Simulate LLM returning full-width brackets 【公司主体A】
  const aiOutput = '经审阅，建议【公司主体A】由法定代表人[当事人甲]签署补充授权函。';
  const restored = restoreRedactedText(aiOutput, red.mappings);
  assert.equal(
    restored,
    '经审阅，建议杭州星河光影文化传媒有限公司由法定代表人林建国签署补充授权函。'
  );

  // Regression test: company regex must NOT greedily swallow preceding person name/prose!
  const greedyCase =
    '被告：陈志强，案情摘要：被告陈志强至今未向原告杭州星河光影文化传媒有限公司支付涉案款项。';
  const redGreedy = redactLegalText(greedyCase);
  const compMapping = redGreedy.mappings.find((m) => m.category === 'company');
  assert.equal(compMapping?.original, '杭州星河光影文化传媒有限公司');
  assert.ok(!redGreedy.redactedText.includes('陈志强'));
  assert.ok(redGreedy.redactedText.includes('至今未向原告[公司主体A]支付'));
});

test('Web Crypto AES-GCM PIN Vault & Cross-Device Sync encrypt/decrypt roundtrip', async () => {
  const secretKey = 'sk-test-deepseek-key-998877';
  const cipher = await encryptWithPassphrase(secretKey, '2009');
  assert.ok(cipher.startsWith('TRVAULT1:'));
  const plain = await decryptWithPassphrase(cipher, '2009');
  assert.equal(plain, secretKey);

  await assert.rejects(() => decryptWithPassphrase(cipher, '9999'));

  const syncStr = await exportEncryptedSyncCode('{"providers":[]}', 'pass1234');
  assert.ok(syncStr.startsWith('TRSYNC1:'));
  assert.equal(await importEncryptedSyncCode(syncStr, 'pass1234'), '{"providers":[]}');

  // Cloud Sync snapshot encode/decode (both standard mode and optional E2EE passphrase mode)
  const sampleSnap = {
    schemaVersion: 1,
    syncedAt: 1795514000000,
    deviceLabel: 'Mac 桌面端',
    byok: {
      activeProviderId: 'ds',
      defaultModelSlot: 'fast',
      autoRedactPrompt: true,
      pinEnabled: false,
      providers: [],
    },
  };
  const plainEncoded = await encodeSyncSnapshotForUpload(sampleSnap, '');
  assert.equal(plainEncoded.clientEncrypted, false);
  const plainDecoded = await decodeSyncSnapshotFromCloud(false, plainEncoded.payload, '');
  assert.equal(plainDecoded.deviceLabel, 'Mac 桌面端');

  const e2eeEncoded = await encodeSyncSnapshotForUpload(sampleSnap, 'my-secret-pass');
  assert.equal(e2eeEncoded.clientEncrypted, true);
  assert.equal(typeof e2eeEncoded.payload, 'string');
  await assert.rejects(() => decodeSyncSnapshotFromCloud(true, e2eeEncoded.payload, ''), /E2EE_LOCKED/);
  const e2eeDecoded = await decodeSyncSnapshotFromCloud(true, e2eeEncoded.payload, 'my-secret-pass');
  assert.equal(e2eeDecoded.syncedAt, 1795514000000);
});

test('ICS Calendar generator emits valid RFC 5545 VCALENDAR with VALARM triggers', () => {
  const ics = buildIcsContent([
    {
      title: '基本户冻结续封红线',
      dueDate: '2027-10-20',
      description: '提前30日申请续冻',
      alarmDaysBefore: [7, 1],
    },
  ]);
  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20271020'));
  assert.ok(ics.includes('TRIGGER:-P6DT15H'));
  assert.ok(ics.includes('TRIGGER:-PT15H'));
  assert.ok(ics.includes('TRIGGER:PT9H'));
  assert.ok(!ics.includes('DT-9H'), 'Must NOT emit invalid negative hours inside RFC 5545 duration');
  assert.ok(ics.includes('END:VCALENDAR'));
});

test('Open-mode default license initializes cleanly without key files', () => {
  const openLic = createOpenModeLicense();
  assert.equal(openLic.rawCode, 'OPEN-MODE-LOCAL');
  assert.equal(openLic.expiresAt, null);
  assert.ok(openLic.holderName.length > 0);
});

test('ECDSA P-256 Activation License verifies genuine codes, WeChat cards, and blocks tampering/expiry', async () => {
  const { publicJwk, privateJwk, masterToken } = await createEphemeralP256KeyPair();

  // 1. Valid permanent code + full WeChat message extraction
  const { code, info } = await signActivationCodeWithMasterToken(
    masterToken,
    {
      holderName: '张测试律师',
      role: '专职律师',
      serialNo: 'LAW-2026-088',
    },
    publicJwk
  );
  assert.equal(info.holderName, '张测试律师');
  assert.equal(info.expiresAt, null);

  const wechatMsg = formatWeChatInvitationCard(info, 'https://example.com');
  const parsedFromWeChat = await verifyActivationCode(wechatMsg, publicJwk);
  assert.equal(parsedFromWeChat.serialNo, 'LAW-2026-088');

  // 2. Tamper payload (attempt to forge another lawyer name without private key) -> MUST reject
  const [, sigPart] = code.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({ i: 'TR', n: '外部伪造人', r: '合伙人律师', s: 'LAW-999', t: '2026-11-23', e: '' })
  ).toString('base64url');
  await assert.rejects(
    () => verifyActivationCode(`TR1-${forgedPayload}.${sigPart}`, publicJwk),
    /防伪签名校验未通过/
  );

  // 3. Expired code -> MUST reject
  const privKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const wireBytes = new TextEncoder().encode(
    JSON.stringify({ i: 'TR', n: '实习甲', r: '实习律师', s: 'LAW-EXP', t: '2020-01-01', e: '2020-12-31' })
  );
  const sig = Buffer.from(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, wireBytes)
  ).toString('base64url');
  const expiredSignedPayload = `TR1-${Buffer.from(wireBytes).toString('base64url')}.${sig}`;
  await assert.rejects(
    () => verifyActivationCode(expiredSignedPayload, publicJwk),
    /已于 2020-12-31 到期/
  );
});

test('Multi-turn incremental redaction reuses prior placeholders and avoids collisions across turns', () => {
  const turn1 = redactLegalText('原告：杭州星河光影文化传媒有限公司，法定代表人：林建国。');
  assert.ok(turn1.redactedText.includes('[公司主体A]'));
  assert.ok(turn1.redactedText.includes('[当事人甲]'));

  const turn2 = redactLegalText(
    '请把林建国的违约责任改为由杭州星河光影文化传媒有限公司与被告宁波极光影业有限公司承担连带责任。',
    { existingMappings: turn1.mappings }
  );
  assert.ok(turn2.redactedText.includes('[当事人甲]'), 'Must reuse [当事人甲] for 林建国');
  assert.ok(turn2.redactedText.includes('[公司主体A]'), 'Must reuse [公司主体A] for 星河');
  assert.ok(turn2.redactedText.includes('[公司主体B]'), 'Must assign next placeholder [公司主体B] for 宁波极光');
  const restored = restoreRedactedText(turn2.redactedText, turn2.mappings);
  assert.ok(restored.includes('林建国') && restored.includes('宁波极光影业有限公司'));
});

test('Multimodal AI payload builder formats OpenAI/Anthropic vision blocks and guards text-only providers', () => {
  const sampleImg = {
    id: 'img-1',
    name: 'contract.jpg',
    dataUrl: 'data:image/jpeg;base64,AAAA',
    mimeType: 'image/jpeg',
    width: 800,
    height: 600,
    sizeKb: 42,
  };

  // 1. DeepSeek text-only provider -> helpful Chinese error when image attached
  assert.throws(
    () =>
      buildProviderRequestPayload(
        {
          id: 'ds',
          presetId: 'deepseek',
          name: 'DeepSeek 官方',
          protocol: 'openai',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'sk-test',
          fastModel: 'deepseek-chat',
          reasoningModel: 'deepseek-reasoner',
          visionModel: '',
        },
        'fast',
        [{ role: 'user', content: '看图', images: [sampleImg] }]
      ),
    /未配置视觉识图模型/
  );

  // 2. Bailian OpenAI-compatible vision provider -> auto-switches to visionModel with image_url block
  const oai = buildProviderRequestPayload(
    {
      id: 'qwen',
      presetId: 'aliyun-bailian',
      name: '阿里云百炼',
      protocol: 'openai',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'sk-test',
      fastModel: 'qwen-plus',
      reasoningModel: 'qwq-plus',
      visionModel: 'qwen-vl-max-latest',
    },
    'reasoning',
    [{ role: 'user', content: '审核这张截图', images: [sampleImg] }]
  );
  assert.equal(oai.usedModel, 'qwen-vl-max-latest');
  const oaiContent = oai.payload.messages[0].content;
  assert.ok(Array.isArray(oaiContent) && oaiContent.some((p) => p.type === 'image_url'));

  // 3. Anthropic vision provider -> emits base64 source block without data URL prefix
  const ant = buildProviderRequestPayload(
    {
      id: 'claude',
      presetId: 'custom-anthropic',
      name: 'Claude',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
      fastModel: 'claude-sonnet-4-20250514',
      reasoningModel: 'claude-sonnet-4-20250514',
      visionModel: 'claude-sonnet-4-20250514',
    },
    'fast',
    [{ role: 'user', content: '识别传票', images: [sampleImg] }]
  );
  assert.equal(ant.usedModel, 'claude-sonnet-4-20250514');
  const antContent = ant.payload.messages[0].content;
  assert.equal(antContent[0].type, 'image');
  assert.equal(antContent[0].source.data, 'AAAA');
});

test('Auto-fetch models normalizes endpoints, parses OpenAI/Anthropic/Ollama payloads, and suggests smart slots', () => {
  assert.deepEqual(
    normalizeModelsEndpoints({
      id: '1',
      presetId: 'custom-openai',
      name: 'Custom',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1/',
      apiKey: 'sk-x',
      fastModel: '',
      reasoningModel: '',
    }),
    ['https://api.deepseek.com/v1/models']
  );
  assert.deepEqual(
    normalizeModelsEndpoints({
      id: '2',
      presetId: 'custom-openai',
      name: 'Proxy',
      protocol: 'openai',
      baseUrl: 'https://proxy.example.com/chat/completions',
      apiKey: 'sk-x',
      fastModel: '',
      reasoningModel: '',
    }),
    ['https://proxy.example.com/models', 'https://proxy.example.com/v1/models']
  );
  assert.deepEqual(
    normalizeModelsEndpoints({
      id: '3',
      presetId: 'custom-anthropic',
      name: 'Claude',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-x',
      fastModel: '',
      reasoningModel: '',
    }),
    ['https://api.anthropic.com/v1/models', 'https://api.anthropic.com/models']
  );

  const parsed = parseModelsResponsePayload({
    data: [
      { id: 'text-embedding-3-large' },
      { id: 'deepseek-reasoner' },
      { id: 'deepseek-chat' },
      { id: 'qwen-vl-max-latest' },
      { id: 'deepseek-chat' },
    ],
  });
  assert.equal(parsed.length, 4);
  assert.equal(parsed[parsed.length - 1], 'text-embedding-3-large', 'Utility models should sort to bottom');

  const slots = suggestModelSlots(parsed);
  assert.equal(slots.fastModel, 'deepseek-chat');
  assert.equal(slots.reasoningModel, 'deepseek-reasoner');
  assert.equal(slots.visionModel, 'qwen-vl-max-latest');
});

test('Director Admin API signed headers verify cleanly against ephemeral P-256 public JWK', async () => {
  const { publicJwk, masterToken } = await createEphemeralP256KeyPair();
  const { code } = await signActivationCodeWithMasterToken(
    masterToken,
    {
      holderName: '张示范',
      role: '主任',
      serialNo: 'LAW-2026-001',
    },
    publicJwk
  );
  const body = JSON.stringify({ key: 'LAW-2026-002', status: 'disabled' });
  const headers = await buildSignedAdminHeaders(
    masterToken,
    code,
    'POST',
    '/api/admin/accounts/toggle',
    body,
    publicJwk
  );
  assert.ok(
    headers['X-Toolbox-Admin-Sig'] &&
      headers['X-Toolbox-Admin-Ts'] &&
      headers['X-Toolbox-Admin-Nonce']
  );
  const sigBytes = Buffer.from(headers['X-Toolbox-Admin-Sig'], 'base64url');
  assert.equal(sigBytes.length, 64);
  const bodyHash = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  ).toString('hex');
  const msg = new TextEncoder().encode(
    `POST:/api/admin/accounts/toggle:${headers['X-Toolbox-Admin-Ts']}:${headers['X-Toolbox-Admin-Nonce']}:${bodyHash}`
  );
  const pubKey = await crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, sigBytes, msg);
  assert.equal(ok, true);
});

test('Elements Complaint templates (14 civil/admin/exec causes) & local OOXML .docx builder roundtrip cleanly', async () => {
  assert.equal(ELEMENTS_COMPLAINT_TEMPLATES.length, 14);
  const adminTpl = ELEMENTS_COMPLAINT_TEMPLATES.find((t) => t.id === 'administrative_action');
  const execTpl = ELEMENTS_COMPLAINT_TEMPLATES.find((t) => t.id === 'enforcement_application');
  assert.equal(adminTpl?.docTitle, '行政起诉状');
  assert.equal(execTpl?.docTitle, '强制执行申请书');

  for (const tpl of ELEMENTS_COMPLAINT_TEMPLATES) {
    const draft = createInitialComplaintDraft(tpl.id);
    assert.equal(draft.signerName, '', 'Default signerName must stay empty (zero prefilled personal info)');
    const secs = buildComplaintSections(tpl, draft);
    assert.equal(secs.length, 5);
    assert.ok(secs.every((s) => s.rows.length > 0));
  }

  const salesTpl = ELEMENTS_COMPLAINT_TEMPLATES[0];
  const draft = createInitialComplaintDraft(salesTpl.id);
  draft.courtName = '杭州市西湖区人民法院';
  draft.plaintiffs[0].name = '杭州示例商贸有限公司';
  draft.plaintiffs[0].ownershipNature = '民营';
  draft.defendants[0].name = '宁波示例实业有限公司';
  draft.agent.enabled = true;
  draft.agent.name = '王测试';
  draft.agent.firm = '杭州示例律师事务所';
  draft.agent.licenseNo = '13301202010123456';
  draft.mediationAgree = '暂不确定，想要了解更多';
  draft.claims.payment = '判令被告支付尚欠货款人民币 380,000 元。';
  draft.hasJurisdictionAgreement = '有';
  draft.jurisdictionDetail = '合同第十条约定由原告住所地法院管辖';

  const sections = buildComplaintSections(salesTpl, draft);
  const docxBytes = buildElementsComplaintDocxBytes({
    causeTitle: getResolvedCauseTitle(salesTpl, draft),
    courtName: draft.courtName,
    sections,
    signerName: draft.signerName,
    signDate: draft.signDate,
  });

  // Must start with PKZIP signature PK\x03\x04
  assert.equal(docxBytes[0], 0x50);
  assert.equal(docxBytes[1], 0x4b);
  assert.equal(docxBytes[2], 0x03);
  assert.equal(docxBytes[3], 0x04);

  // Verify OOXML CJK compatibility parts (settings.xml, fontTable.xml, zh-CN eastAsia font hints)
  const rawArchiveStr = Buffer.from(docxBytes).toString('utf8');
  assert.ok(rawArchiveStr.includes('word/settings.xml'), 'Must include word/settings.xml');
  assert.ok(rawArchiveStr.includes('word/fontTable.xml'), 'Must include word/fontTable.xml');
  assert.ok(rawArchiveStr.includes('w:eastAsia="zh-CN"'), 'Must declare zh-CN eastAsia theme/lang');
  assert.ok(rawArchiveStr.includes('FangSong'), 'Must declare canonical FangSong CJK font');

  // Roundtrip through our own local docxReader
  const fakeFile = {
    name: '民事起诉状（买卖合同纠纷）.docx',
    arrayBuffer: async () => docxBytes.buffer.slice(docxBytes.byteOffset, docxBytes.byteOffset + docxBytes.byteLength),
    text: async () => '',
  };
  const extracted = await extractLocalDocumentText(fakeFile);
  assert.ok(extracted.includes('民事起诉状'));
  assert.ok(extracted.includes('买卖合同纠纷'));
  assert.ok(extracted.includes('杭州示例商贸有限公司'));
  assert.ok(extracted.includes('☑ 民营'));
  assert.ok(extracted.includes('13301202010123456'));
  assert.ok(extracted.includes('☑ 暂不确定，想要了解更多'));
  assert.ok(extracted.includes('380,000'));
  assert.ok(extracted.includes('☑ 有'));
  assert.ok(!extracted.includes('有 ☑'), 'Checkbox symbol must consistently precede label');
  assert.ok(!extracted.includes('（待填写）'), 'Final court filing must not print ugly （待填写） placeholders');
  assert.ok(extracted.includes('杭州市西湖区人民法院'));
});

test('AI Markdown Report to Word (.docx) builder converts headings, tables & bullets cleanly', async () => {
  const md = `# 合同风险审查意见\n\n## 一、核心风险\n\n- **违约责任不对等**：建议明确违约金上限。\n\n| 条款 | 风险等级 | 修改建议 |\n| --- | --- | --- |\n| 第5条 | 高 | 增加验收逾期视为合格条款 |\n`;
  const bytes = buildMarkdownReportDocxBytes({
    title: 'AI 合同风险快审报告',
    subtitle: '生成日期：2026-11-24',
    markdownBody: md,
  });
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const rawReportStr = Buffer.from(bytes).toString('utf8');
  assert.ok(rawReportStr.includes('w:tblW w:w="9266" w:type="dxa"'), 'Markdown table must span full A4 width');
  assert.ok(rawReportStr.includes('word/fontTable.xml'), 'Report .docx must include fontTable.xml');
  const fakeFile = {
    name: '合同快审.docx',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => '',
  };
  const txt = await extractLocalDocumentText(fakeFile);
  assert.ok(txt.includes('AI 合同风险快审报告'));
  assert.ok(txt.includes('违约责任不对等'));
  assert.ok(txt.includes('增加验收逾期视为合格条款'));
});

test('Local DOCX XML extractor strips tracked deletions/field codes and never leaks browser parsererror', () => {
  const wordXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    `<w:p><w:r><w:t>民事起诉状</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>违约金为</w:t></w:r><w:del><w:r><w:delText>50万元</w:delText></w:r></w:del><w:r><w:t>38万元</w:t></w:r><w:r><w:instrText>HYPERLINK "http://bad"</w:instrText></w:r></w:p>` +
    `</w:body></w:document>`;

  const plain = extractXmlTextFromWordDocument(wordXml);
  assert.ok(plain.includes('民事起诉状'));
  assert.ok(plain.includes('违约金为38万元'));
  assert.ok(!plain.includes('50万元'), 'Must strip Word Track Changes deleted text');
  assert.ok(!plain.includes('HYPERLINK'), 'Must strip Word field instrText');

  // Simulate Chromium DOMParser returning <parsererror> on malformed XML
  const prevDOMParser = globalThis.DOMParser;
  try {
    globalThis.DOMParser = class {
      parseFromString() {
        return {
          documentElement: { textContent: 'This page contains the following errors: bad tag' },
          getElementsByTagName: (name) => (name === 'parsererror' ? [{}] : []),
          getElementsByTagNameNS: () => [],
        };
      }
    };
    const safe = extractXmlTextFromWordDocument(wordXml);
    assert.ok(!safe.includes('This page contains the following errors'));
    assert.ok(safe.includes('民事起诉状'));
  } finally {
    if (prevDOMParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = prevDOMParser;
  }
});

test('IMA smart search term extractor, Chinese authority ranker, and Node DOCX extractor work accurately', () => {
  // 1. Natural-language question -> high-signal legal terms (with synonym stems)
  const terms1 = extractLegalSearchTerms('股东未届出资期限转让股权，原股东是否承担补充责任？');
  assert.ok(terms1.includes('股东出资'), `Expected 股东出资 in ${JSON.stringify(terms1)}`);
  assert.ok(terms1.includes('股权转让'), `Expected 股权转让 in ${JSON.stringify(terms1)}`);

  const terms2 = extractLegalSearchTerms('买卖合同 违约金');
  assert.deepEqual(terms2, ['买卖合同', '违约金']);

  // 2. Authority ranker puts PRC Civil Code & FaDaWang well above Japanese/Iranian translations
  const candidates = [
    { title: '日本民法典Civil Code(官方英译版).pdf', kind: 'pdf' },
    { title: '[伊朗] 伊朗民法典(有效-深圳蓝海法律查明).pdf', kind: 'pdf' },
    { title: '20_法答网精选答问（第十七批）——民法典合同编通则专题.pdf', kind: 'pdf' },
    { title: '中华人民共和国民法典_2020-05-28_2021-01-01.pdf', kind: 'pdf' },
  ];
  const sorted = [...candidates].sort(
    (a, b) => scoreImaSearchItem(b, '民法典', ['民法典']) - scoreImaSearchItem(a, '民法典', ['民法典'])
  );
  assert.ok(sorted[0].title.includes('中华人民共和国民法典'));
  assert.ok(sorted[1].title.includes('法答网'));

  // 2b. Near-duplicate collapse keeps one clean edition per document
  const collapsed = dedupeNearDuplicateImaItems([
    { title: '2026-06-22_2026-10-2-298-001_曲某诉陈某周股权转让纠纷案.pdf', kind: 'pdf' },
    { title: '2026-10-2-298-001_曲某诉陈某周股权转让纠纷案_4c982625.pdf', kind: 'pdf' },
    { title: '福建某环保公司诉某科技集团公司股东出资纠纷案.pdf', kind: 'pdf' },
  ]);
  assert.equal(collapsed.length, 2);

  // 3. Server pure-Node DOCX extractor roundtrip
  const bytes = buildMarkdownReportDocxBytes({
    title: '人民法院案例库参考案例测试',
    markdownBody: '裁判要旨：买受人逾期付款且未约定违约金的，参照 LPR 1.5 倍计算损失。',
  });
  const text = extractDocxTextFromBuffer(Buffer.from(bytes));
  assert.ok(text.includes('人民法院案例库参考案例测试'));
  assert.ok(text.includes('LPR 1.5 倍'));
});

test('Official SPC 法〔2025〕82号 113-template corpus, checkbox toggles, party quick-fill, and OOXML exact-format roundtrip', async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const corpusPath = path.resolve(__dirname, '..', 'public', 'data', 'spc-2025-templates.json');
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  assert.equal(corpus.standard, '法〔2025〕82号');
  assert.equal(corpus.count, 113);
  assert.equal(corpus.templates.length, 113);

  for (const t of corpus.templates) {
    assert.ok(t.docTitle && t.rows.length >= 8, `Invalid template ${t.displayName}`);
    assert.equal(t.rows[0].kind, 'notice', `Template ${t.displayName} must start with official 说明 row`);
    assert.ok(t.signerLine.includes('签字') || t.signerLine.includes('盖章'));
    assert.ok(!JSON.stringify(t).includes('☑'), `Blank template ${t.displayName} must not have pre-checked ☑`);
  }

  const tSales = corpus.templates.find((t) => t.displayName === '买卖合同纠纷民事起诉状');
  assert.ok(tSales);
  const dSales = createInitialSpcDraft(tSales);
  assert.equal(dSales.signerName, '', 'Default signerName must stay empty');
  const pOrgRow = tSales.rows.find((r) => r.roleTag === 'plaintiff_org');
  const quickOrg = createEmptyPartyQuickFill();
  quickOrg.name = '杭州示例商贸有限公司';
  quickOrg.creditCode = '91330106MA2EXAMPLE';
  quickOrg.legalRep = '张示例';
  quickOrg.orgType = '有限责任公司';
  quickOrg.ownershipNature = '民营';
  dSales.rowValues[pOrgRow.id] = applyPartyQuickFillToCellText(pOrgRow.templateText, 'plaintiff_org', quickOrg);

  const medBenRow = tSales.rows.find((r) => r.roleTag === 'mediation_benefit');
  dSales.rowValues[medBenRow.id] = setAllMediationBenefitChoices(medBenRow.templateText, true);
  assert.equal((dSales.rowValues[medBenRow.id].match(/了解☑/g) || []).length, 5);

  const medAgreeRow = tSales.rows.find((r) => r.roleTag === 'mediation_agree');
  assert.equal(parseCheckboxTokens(medAgreeRow.templateText).length, 3);
  dSales.rowValues[medAgreeRow.id] = toggleCheckboxAtIndex(medAgreeRow.templateText, 2);

  const salesDocx = buildOfficialSpcDocxBytes(buildResolvedSpcDocument(tSales, dSales));
  const salesExtracted = await extractLocalDocumentText({
    name: '买卖合同纠纷民事起诉状.docx',
    arrayBuffer: async () => salesDocx.buffer.slice(salesDocx.byteOffset, salesDocx.byteOffset + salesDocx.byteLength),
    text: async () => '',
  });
  assert.ok(salesExtracted.includes('民事起诉状'));
  assert.ok(salesExtracted.includes('★特别提示★'));
  assert.ok(salesExtracted.includes('杭州示例商贸有限公司'));
  assert.ok(salesExtracted.includes('有限责任公司☑'));
  assert.ok(salesExtracted.includes('民营☑'));

  const tDef = corpus.templates.find((t) => t.displayName === '买卖合同纠纷民事答辩状');
  const dDef = createInitialSpcDraft(tDef);
  const metaRow = tDef.rows.find((r) => r.roleTag === 'case_meta');
  dDef.gridValues[metaRow.id] = ['案号', '（2026）浙0106民初8888号', '案由', '买卖合同纠纷'];
  const defDocx = buildOfficialSpcDocxBytes(buildResolvedSpcDocument(tDef, dDef));
  const defExtracted = await extractLocalDocumentText({
    name: '买卖合同纠纷民事答辩状.docx',
    arrayBuffer: async () => defDocx.buffer.slice(defDocx.byteOffset, defDocx.byteOffset + defDocx.byteLength),
    text: async () => '',
  });
  assert.ok(defExtracted.includes('（2026）浙0106民初8888号'));

  const tCopy = corpus.templates.find((t) => t.displayName === '侵害著作权及邻接权纠纷民事起诉状');
  const copyDocx = buildOfficialSpcDocxBytes(buildResolvedSpcDocument(tCopy, createInitialSpcDraft(tCopy)));
  const copyExtracted = await extractLocalDocumentText({
    name: '侵害著作权及邻接权纠纷民事起诉状.docx',
    arrayBuffer: async () => copyDocx.buffer.slice(copyDocx.byteOffset, copyDocx.byteOffset + copyDocx.byteLength),
    text: async () => '',
  });
  assert.ok(copyExtracted.includes('原告证据清单'));

  const tPat = corpus.templates.find((t) => t.displayName === '侵害发明专利权纠纷民事起诉状');
  const patXml = Buffer.from(buildOfficialSpcDocxBytes(buildResolvedSpcDocument(tPat, createInitialSpcDraft(tPat)))).toString('utf8');
  assert.ok(patXml.includes('<w:vMerge w:val="restart"/>') && patXml.includes('<w:vMerge/>'));

  const tExec = corpus.templates.find((t) => t.displayName === '强制执行申请书');
  const execDocx = buildOfficialSpcDocxBytes(buildResolvedSpcDocument(tExec, createInitialSpcDraft(tExec)));
  const execExtracted = await extractLocalDocumentText({
    name: '强制执行申请书.docx',
    arrayBuffer: async () => execDocx.buffer.slice(execDocx.byteOffset, execDocx.byteOffset + execDocx.byteLength),
    text: async () => '',
  });
  assert.ok(execExtracted.includes('执行依据信息'));
});

test('AI Hub 6 specialists cover full practice domains (civil/commercial/IP/criminal/admin/execution/general) and de-AI redlines', () => {
  assert.equal(AI_SPECIALISTS_REGISTRY.length, 6);
  for (const sp of AI_SPECIALISTS_REGISTRY) {
    assert.ok(Array.isArray(sp.presetOptions) && sp.presetOptions.length >= 6, `${sp.code} should have >=6 presets`);
    assert.ok(sp.presetOptions.every((o) => Boolean(o.group && o.label && o.value)), `${sp.code} presets must be grouped`);
  }
  const deAi = AI_SPECIALISTS_REGISTRY.find((s) => s.id === 'de-ai-polish');
  assert.ok(deAi && deAi.presetOptions && deAi.presetOptions.length >= 12);
  const allGroups = deAi.presetOptions.map((o) => o.group).join(' | ');
  for (const kw of ['民事', '知识产权', '刑事', '行政', '执行与仲裁', '非诉', '通用']) {
    assert.ok(allGroups.includes(kw), `AI-02 missing practice group keyword: ${kw}`);
  }
  assert.ok(deAi.systemPrompt.includes('只改表达，不改法律含义'));
  assert.ok(deAi.systemPrompt.includes('固定程序性表述与司法引述语一字不动'));
  assert.ok(deAi.systemPrompt.includes('可能影响法律含义的修改清单'));
});

test('Local custom .docx template engine handles Word-split XML runs, detects privacy residuals, and fills user-uploaded templates cleanly', async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const corpus = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../public/data/spc-2025-templates.json'), 'utf8')
  );
  const tpl = corpus.templates.find((t) => t.displayName === '买卖合同纠纷民事起诉状');
  const draft = createInitialSpcDraft(tpl);
  const pOrg = tpl.rows.find((r) => r.roleTag === 'plaintiff_org');
  const dOrg = tpl.rows.find((r) => r.roleTag === 'defendant_org');
  draft.rowValues[pOrg.id] = '名称：示例甲方科技公司\n统一社会信用代码：91330100MA0000001A\n住所地：杭州市西湖区测试路1号';
  draft.rowValues[dOrg.id] = '名称：示例乙方贸易公司\n住所地：上海市浦东新区测试路2号';

  const ctx = extractCompanionContextFromSpcDraft(tpl, draft, {
    name: '示例律师',
    licenseNo: '13301202010000001',
    firmName: '示例律师事务所',
    phone: '13800000000',
    address: '杭州市西湖区文三路100号',
    email: 'lawyer@example.com',
  });
  assert.equal(ctx.clientName, '示例甲方科技公司');
  assert.equal(ctx.opponentName, '示例乙方贸易公司');
  assert.equal(ctx.lawyerName, '示例律师');
  assert.ok(COMPANION_PLACEHOLDER_SPECS.length >= 18);

  const splitXml =
    `<w:p><w:r><w:t>委托人：</w:t></w:r><w:r><w:t>{{</w:t></w:r><w:r><w:t>委托</w:t></w:r><w:r><w:t>人}}</w:t></w:r><w:r><w:t>诉{{对方当事人}}</w:t></w:r></w:p>`;
  const patched = replacePlaceholdersInWordXml(splitXml, {
    委托人: '示例甲方科技公司',
    对方当事人: '示例乙方贸易公司',
  });
  assert.equal(patched.replacedCount, 2);
  assert.ok(patched.xml.includes('示例甲方科技公司'));
  assert.ok(patched.xml.includes('示例乙方贸易公司'));
  assert.ok(!patched.xml.includes('{{'));

  const blankTemplateBytes = buildMarkdownReportDocxBytes({
    title: '自定义空白授权模板',
    markdownBody:
      '委托人：{{委托人}}\n对方当事人：{{对方当事人}}\n受案法院：{{受案法院}}\n受托律师：{{受托律师}}（证号：{{执业证号}}）\n律所：{{律所名称}}\n授权范围：{{授权范围}}',
  });
  const cleanInspect = await inspectUploadedDocxTemplate(blankTemplateBytes);
  assert.equal(cleanInspect.totalPrivacyHits, 0, 'Clean blank placeholder template should have 0 privacy hits');
  assert.ok(cleanInspect.matchedPlaceholders.includes('{{委托人}}'));
  assert.ok(cleanInspect.matchedPlaceholders.includes('{{受托律师}}'));

  const filled = await fillCustomDocxTemplateBytes(blankTemplateBytes, {
    ...ctx,
    courtName: '杭州市西湖区人民法院',
  });
  assert.ok(filled.replacedCount >= 7);
  const extracted = await extractLocalDocumentText({
    name: '套打结果.docx',
    arrayBuffer: async () =>
      filled.bytes.buffer.slice(filled.bytes.byteOffset, filled.bytes.byteOffset + filled.bytes.byteLength),
    text: async () => '',
  });
  assert.ok(extracted.includes('示例甲方科技公司'));
  assert.ok(extracted.includes('示例乙方贸易公司'));
  assert.ok(extracted.includes('杭州市西湖区人民法院'));
  assert.ok(extracted.includes('13301202010000001'));
  assert.ok(!extracted.includes('{{委托人}}'));

  const leakyTemplateBytes = buildMarkdownReportDocxBytes({
    title: '未清空旧案信息的误传模板',
    markdownBody: '委托人：杭州某演示文化有限公司，联系电话：13958001234，案号（2025）浙0106民初999号。',
  });
  const leakyInspect = await inspectUploadedDocxTemplate(leakyTemplateBytes);
  assert.ok(leakyInspect.totalPrivacyHits >= 2, 'Residual privacy detector must flag leftover company/phone/caseNo');
});

test('SPC multi-turn AI patch engine supports row updates, row exclusion/restoration, custom extra rows, and OOXML .docx roundtrip', async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const corpus = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../public/data/spc-2025-templates.json'), 'utf8')
  );
  const tpl = corpus.templates.find((t) => t.id === 'spc2025_035');
  assert.ok(tpl, 'spc2025_035 (侵害著作权及邻接权纠纷民事起诉状) must exist');

  const d0 = createInitialSpcDraft(tpl);
  const r1 = applySpcAiPatch(tpl, d0, {
    rowValues: {
      r00: '恶意覆盖官方说明测试',
      r03: '名称：示例甲方影视文化有限公司\n住所地（主要办事机构所在地）：杭州市示例区文创园1号\n统一社会信用代码：91330100MA0000001X',
      r06: '名称：示例乙方网络科技有限公司\n住所地（主要办事机构所在地）：长春市示例区科技路2号\n联系电话：0431-80000001',
      r11: '判令被告立即停止侵害原告涉案视听作品《星河夜雨》信息网络传播权的行为。',
      r12: '判令被告赔偿原告经济损失人民币 45,000 元。',
      r13: '判令被告赔偿原告为维权支出的合理开支人民币 5,000 元（以上共计 50,000 元）。',
      r19: '涉案视听作品《星河夜雨》（电视剧，共30集），原告经合法授权取得独占信息网络传播权及维权权利。',
      r20: '信息网络传播权☑',
    },
    signerName: '示例甲方影视文化有限公司',
    signDate: '2026年11月24日',
  });
  assert.equal(r1.nextDraft.rowValues['r00'], undefined, 'Must never overwrite official notice row r00');
  assert.equal(r1.nextDraft.signerName, '示例甲方影视文化有限公司');
  assert.ok(r1.changedLabels.length >= 7);

  const r2 = applySpcAiPatch(tpl, r1.nextDraft, {
    excludeRowIds: ['r00', 'r02', 'r05', 'r07', 'r08'],
    addExtraRows: [
      {
        afterRowId: 'r13',
        label: '4a. 诉讼费用及迟延履行说明',
        value: '本案案件受理费由被告全部承担，逾期履行加倍支付迟延履行期间债务利息。',
      },
    ],
    rowValues: {
      r12: '判令被告赔偿原告经济损失人民币 50,000 元。',
    },
  });
  assert.ok(!r2.nextDraft.excludedRowIds.includes('r00'), 'Must never exclude official notice row r00');
  assert.deepEqual(r2.nextDraft.excludedRowIds.sort(), ['r02', 'r05', 'r07', 'r08']);
  assert.equal(r2.addedLabels.length, 1);
  assert.ok(r2.nextDraft.rowValues['r11'].includes('《星河夜雨》'));
  assert.ok(r2.nextDraft.rowValues['r12'].includes('50,000'));

  const resolved = buildResolvedSpcDocument(tpl, r2.nextDraft);
  assert.ok(!resolved.rows.some((row) => row.id === 'r02' || row.id === 'r05' || row.id === 'r07' || row.id === 'r08'));
  assert.ok(resolved.rows.some((row) => row.label === '4a. 诉讼费用及迟延履行说明'));

  const docxBytes = buildOfficialSpcDocxBytes(resolved);
  const extracted = await extractLocalDocumentText({
    name: '侵害著作权及邻接权纠纷民事起诉状.docx',
    arrayBuffer: async () => docxBytes.buffer.slice(docxBytes.byteOffset, docxBytes.byteOffset + docxBytes.byteLength),
    text: async () => '',
  });
  assert.ok(extracted.includes('示例甲方影视文化有限公司'));
  assert.ok(extracted.includes('信息网络传播权☑'));
  assert.ok(extracted.includes('4a. 诉讼费用及迟延履行说明'));
  assert.ok(!extracted.includes('第三人（自然人）'), 'Excluded third-person row must be omitted from exported .docx');

  const r3 = applySpcAiPatch(tpl, r2.nextDraft, {
    restoreRowIds: ['r02'],
  });
  assert.ok(!r3.nextDraft.excludedRowIds.includes('r02'));
  assert.equal(r3.restoredLabels.length, 1);
});

test('S-1: Cloud Sync defaults keep sensitive meeting notes & calculation history strictly local unless explicitly opted in', () => {
  assert.equal(DEFAULT_CLOUD_SYNC_PREFS.syncSensitiveNotes, false);

  const mem = new Map();
  mem.set(
    'cn_lawyer_box_scratchpads_v1',
    JSON.stringify([{ id: 'n1', title: '绝密会见笔录', content: '当事人私密陈述', updatedAt: '2026-11-24' }])
  );
  mem.set(
    'cn_lawyer_box_calc_history_v1',
    JSON.stringify([{ id: 'h1', toolId: 'lpr-interest-calculator', summary: '标的额1000万', createdAt: '2026-11-24' }])
  );
  const prevLS = globalThis.localStorage;
  try {
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
    const defaultSnap = buildLocalSyncSnapshot(DEFAULT_CLOUD_SYNC_PREFS);
    assert.deepEqual(defaultSnap.workspace?.scratchpads, []);
    assert.deepEqual(defaultSnap.workspace?.history, []);

    const optInSnap = buildLocalSyncSnapshot({
      ...DEFAULT_CLOUD_SYNC_PREFS,
      syncSensitiveNotes: true,
    });
    assert.equal(optInSnap.workspace?.scratchpads?.length, 1);
    assert.equal(optInSnap.workspace?.history?.length, 1);
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
});

test('S-2: Direct-connect failure NEVER silently falls back to /api/ai-relay unless provider.useCorsRelayFallback is explicitly true', async () => {
  const calls = [];
  const prevFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      throw new TypeError('Failed to fetch (simulated CORS block)');
    };

    const strictProvider = {
      id: 'p1',
      presetId: 'custom-openai',
      name: '示例直连模型',
      protocol: 'openai',
      baseUrl: 'https://api.example-llm.test/v1',
      apiKey: 'sk-test-never-relay',
      fastModel: 'demo-chat',
      reasoningModel: 'demo-reasoner',
      useCorsRelayFallback: false,
    };

    await assert.rejects(
      () =>
        streamAiCompletion({
          provider: strictProvider,
          modelSlot: 'fast',
          messages: [{ role: 'user', content: '测试直连红线' }],
        }),
      (err) => err instanceof AiDirectConnectError && err.code === 'AI_DIRECT_CORS_FAILED'
    );
    assert.ok(calls.every((u) => !u.includes('/api/ai-relay')));

    calls.length = 0;
    await assert.rejects(
      () => fetchAvailableModels(strictProvider),
      (err) => err instanceof AiDirectConnectError && err.code === 'AI_DIRECT_CORS_FAILED'
    );
    assert.ok(calls.every((u) => !u.includes('/api/ai-relay')));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('L-1 & L-3: Legal dataset manifest detects out-of-coverage holiday years, stale LPR windows, and embeds AI disclaimer in Word exports', () => {
  assert.equal(isDateOutsideHolidayCoverage('2025-10-01'), false);
  assert.equal(isDateOutsideHolidayCoverage('2026-05-01'), false);
  assert.equal(isDateOutsideHolidayCoverage('2027-01-15'), false);
  assert.equal(isDateOutsideHolidayCoverage('2024-12-31'), true);
  assert.equal(isDateOutsideHolidayCoverage('2028-01-15'), true);

  const okLpr = checkLprDateCoverage('2024-06-01', '2026-11-24');
  assert.equal(okLpr.staleEnd, false);
  assert.equal(okLpr.beforeLprReform, false);

  const staleLpr = checkLprDateCoverage('2018-01-01', '2027-02-01');
  assert.equal(staleLpr.staleEnd, true);
  assert.equal(staleLpr.beforeLprReform, true);

  const withDisclaimer = buildMarkdownReportDocxBytes({
    title: 'AI 研判测试',
    markdownBody: '一、结论：示例文本。',
  });
  const textWith = extractDocxTextFromBuffer(Buffer.from(withDisclaimer));
  assert.ok(textWith.includes(AI_LEGAL_DISCLAIMER));

  const withoutDisclaimer = buildMarkdownReportDocxBytes({
    title: '原始文献转换测试',
    markdownBody: '示例正文。',
    includeAiDisclaimer: false,
  });
  const textWithout = extractDocxTextFromBuffer(Buffer.from(withoutDisclaimer));
  assert.ok(!textWithout.includes(AI_LEGAL_DISCLAIMER));
});

test('L-2: Synthetic 30-paragraph legal redaction regression suite achieves >=95% structured PII recall', () => {
  const syntheticCases = [
    { text: '原告：杭州青岚网络科技有限公司，法定代表人：周明轩。', mustHide: ['杭州青岚网络科技有限公司', '周明轩'] },
    { text: '被告：宁波海潮实业有限公司，统一社会信用代码：91330200MA29AB1201。', mustHide: ['宁波海潮实业有限公司', '91330200MA29AB1201'] },
    { text: '委托人：林清河，身份证号：33010619870314251X。', mustHide: ['林清河', '33010619870314251X'] },
    { text: '联系电话：13957112233，电子邮箱：lin.qinghe@example-law.test。', mustHide: ['13957112233', 'lin.qinghe@example-law.test'] },
    { text: '一审案号：（2025）浙0106民初6789号，二审案号：（2026）浙01民终1234号。', mustHide: ['（2025）浙0106民初6789号', '（2026）浙01民终1234号'] },
    { text: '收款账户：6222021202019876543，开户行某支行。', mustHide: ['6222021202019876543'] },
    { text: '上诉人：苏州明月文化传媒有限公司诉被上诉人：南京晨星电子商务有限公司。', mustHide: ['苏州明月文化传媒有限公司', '南京晨星电子商务有限公司'] },
    { text: '借款人：陈志远于2025年向出借人：赵海燕借款50万元。', mustHide: ['陈志远', '赵海燕'] },
    { text: '担保人：徐文博提供连带责任保证，手机号18605718899。', mustHide: ['徐文博', '18605718899'] },
    { text: '申请执行人：上海云帆信息技术有限公司，信用代码91310115MA1K99887X。', mustHide: ['上海云帆信息技术有限公司', '91310115MA1K99887X'] },
    { text: '被执行人：王建军，公民身份号码110105197911083321。', mustHide: ['王建军', '110105197911083321'] },
    { text: '劳动者：吴思琪在温州星光物业服务有限公司任职三年。', mustHide: ['吴思琪', '温州星光物业服务有限公司'] },
    { text: '第三人：嘉兴江南建筑工程有限公司未按期结算工程款。', mustHide: ['嘉兴江南建筑工程有限公司'] },
    { text: '犯罪嫌疑人：郑伟民涉嫌合同诈骗案，手机13777889900。', mustHide: ['郑伟民', '13777889900'] },
    { text: '被害人：孙晓梅报案称被骗转账至账号6214830199887766。', mustHide: ['孙晓梅', '6214830199887766'] },
    { text: '甲方：成都天府建设集团有限公司与乙方：重庆山城贸易有限公司签约。', mustHide: ['成都天府建设集团有限公司', '重庆山城贸易有限公司'] },
    { text: '联系邮箱：finance.dept@demo-corp.org，备用手机：+86 158-6810-4455。', mustHide: ['finance.dept@demo-corp.org', '+86 158-6810-4455'] },
    { text: '执行案号：(2026)苏0508执5566号，执行标的120万元。', mustHide: ['(2026)苏0508执5566号'] },
    { text: '申请人：深圳前海星辰投资合伙企业（有限合伙）申请财产保全。', mustHide: ['深圳前海星辰投资合伙企业（有限合伙）'] },
    { text: '被申请人：广州岭南管理咨询有限公司，统一社会信用代码91440101MA59CD3422。', mustHide: ['广州岭南管理咨询有限公司', '91440101MA59CD3422'] },
    { text: '出租方：沈国强将商铺出租给承租方：韩雪梅，租金月付。', mustHide: ['沈国强', '韩雪梅'] },
    { text: '原告：北京京华影视文化有限公司诉被告：天津渤海信息科技有限公司。', mustHide: ['北京京华影视文化有限公司', '天津渤海信息科技有限公司'] },
    { text: '案号（2024）京0491民初1024号判决已生效，收款卡号6228480038123456789。', mustHide: ['（2024）京0491民初1024号', '6228480038123456789'] },
    { text: '受托人：马晓东联系邮箱ma_xd@sample.cn，手机号13512345678。', mustHide: ['马晓东', 'ma_xd@sample.cn', '13512345678'] },
    { text: '发包人：合肥科创新材料股份有限公司拖欠承包人：武汉长江实业有限公司工程款。', mustHide: ['合肥科创新材料股份有限公司', '武汉长江实业有限公司'] },
    { text: '保证人：冯立新，身份证号320102198206254418，承诺清偿。', mustHide: ['冯立新', '320102198206254418'] },
    { text: '异议人：长沙湘江文化工作室不服（2025）湘0102执异301号裁定。', mustHide: ['长沙湘江文化工作室', '（2025）湘0102执异301号'] },
    { text: '债权人：青岛海韵贸易有限公司申报债权，联系人电话13698765432。', mustHide: ['青岛海韵贸易有限公司', '13698765432'] },
    { text: '股东：董明辉将其持有的郑州中原科技发展有限责任公司股权转让。', mustHide: ['董明辉', '郑州中原科技发展有限责任公司'] },
    {
      text: '内部项目代号“苍穹计划”由定制客户“星尘剧组”委托，不得外泄。',
      customTerms: ['苍穹计划', '星尘剧组'],
      mustHide: ['苍穹计划', '星尘剧组'],
    },
  ];

  assert.equal(syntheticCases.length, 30);
  let totalEntities = 0;
  let maskedEntities = 0;
  for (const sc of syntheticCases) {
    const res = redactLegalText(sc.text, { customTerms: sc.customTerms || [] });
    for (const target of sc.mustHide) {
      totalEntities += 1;
      if (!res.redactedText.includes(target)) maskedEntities += 1;
    }
    assert.equal(restoreRedactedText(res.redactedText, res.mappings), sc.text);
  }
  assert.ok(maskedEntities / totalEntities >= 0.95);
});

test('Batch SPC conversion engine isolates per-case redaction, handles partial errors, and supports ZIP bundle export', async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const corpus = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../public/data/spc-2025-templates.json'), 'utf8')
  );
  const tpl = corpus.templates.find((t) => t.id === 'spc2025_035');
  assert.ok(tpl, 'spc2025_035 template must exist');

  const items = [
    {
      id: 'case-1',
      sourceFilename: '《星河夜雨》起诉状.docx',
      caseLabel: '《星河夜雨》起诉状',
      sourceText:
        '原告：杭州甲影业有限公司，住所地杭州市西湖区1号。被告：北京乙网络科技有限公司。作品《星河夜雨》，诉请赔偿经济损失30000元。此致杭州市西湖区人民法院。',
      templateId: tpl.id,
      templateName: tpl.displayName,
      status: 'pending',
      updatedAt: Date.now(),
    },
    {
      id: 'case-2',
      sourceFilename: '《故障测试》起诉状.docx',
      caseLabel: '《故障测试》起诉状',
      sourceText: 'SIMULATE_API_ERROR_CASE',
      templateId: tpl.id,
      templateName: tpl.displayName,
      status: 'pending',
      updatedAt: Date.now(),
    },
    {
      id: 'case-3',
      sourceFilename: '《春风十里》起诉状.docx',
      caseLabel: '《春风十里》起诉状',
      sourceText:
        '原告：上海丙传媒有限公司，住所地上海市徐汇区9号。被告：深圳丁科技有限公司。作品《春风十里》，诉请赔偿经济损失50000元。此致上海市徐汇区人民法院。',
      templateId: tpl.id,
      templateName: tpl.displayName,
      status: 'pending',
      updatedAt: Date.now(),
    },
  ];

  const stateMap = new Map(items.map((x) => [x.id, { ...x }]));

  const summary = await runSpcBatchQueue({
    items,
    tpl,
    provider: {
      id: 'mock',
      presetId: 'deepseek',
      name: 'Mock',
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      fastModel: 'mock-fast',
      reasoningModel: 'mock-reason',
    },
    modelSlot: 'fast',
    autoRedact: true,
    sharedInstruction: '统一勾选主张诉讼费用',
    concurrency: 2,
    completeFn: async ({ messages }) => {
      const userText = messages[1].content;
      if (userText.includes('SIMULATE_API_ERROR_CASE')) {
        throw new Error('429 模拟接口限流');
      }
      assert.ok(!userText.includes('杭州甲影业有限公司'));
      assert.ok(!userText.includes('上海丙传媒有限公司'));
      assert.ok(userText.includes('[公司主体A]'));
      const isCase1 = userText.includes('《星河夜雨》');
      const pMatch = userText.match(/原告：(\[[^\]]+\])/);
      const dMatch = userText.match(/被告：(\[[^\]]+\])/);
      assert.ok(pMatch && dMatch);
      return {
        content: JSON.stringify({
          rowValues: {
            r03: `名称：${pMatch[1]}`,
            r06: `名称：${dMatch[1]}`,
            r11: isCase1 ? '判令被告停止侵害《星河夜雨》信息网络传播权。' : '判令被告停止侵害《春风十里》信息网络传播权。',
          },
          signerName: pMatch[1],
          courtName: isCase1 ? '杭州市西湖区人民法院' : '上海市徐汇区人民法院',
          summary: isCase1 ? '已填充星河夜雨案要素' : '已填充春风十里案要素',
          missingChecklist: ['原告统一社会信用代码'],
        }),
      };
    },
    onItemUpdate: (id, patch) => {
      stateMap.set(id, { ...stateMap.get(id), ...patch });
    },
  });

  assert.equal(summary.totalTargeted, 3);
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.failed, 1);
  const c1 = stateMap.get('case-1');
  const c2 = stateMap.get('case-2');
  const c3 = stateMap.get('case-3');
  assert.equal(c1.draft.rowValues.r03, '名称：杭州甲影业有限公司');
  assert.equal(c3.draft.rowValues.r03, '名称：上海丙传媒有限公司');
  assert.equal(c2.status, 'error');

  const built = buildSpcBatchZipEntries(corpus, [c1, c2, c3]);
  assert.equal(built.exportedCount, 2);
  assert.equal(built.skippedCount, 1);
  const zipBytes = buildZipBundleBytes(built.entries);
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4b);
  assert.ok(Buffer.from(zipBytes).toString('utf8').includes('00_批量生成核对清单.txt'));
});

test('PWA Service Worker never silently calls skipWaiting on install and awaits explicit SKIP_WAITING message', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const swSrc = fs.readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../src/main.tsx'), 'utf8');
  assert.ok(!swSrc.includes('.then(() => self.skipWaiting())'));
  assert.ok(swSrc.includes("event.data.type === 'SKIP_WAITING'"));
  assert.ok(!mainSrc.includes('window.location.reload()'));
});

test('Custom OpenAI endpoint cleanly supports opencode.ai session headers and non-chat model filtering without standalone preset', () => {
  assert.equal(
    AI_PROVIDER_PRESETS.some((p) => p.id === 'opencode-go'),
    false
  );
  assert.equal(isOpenCodeEndpoint('https://opencode.ai/inference/go/openai/v1'), true);
  assert.equal(isOpenCodeEndpoint('https://opencode.ai/zen/go/v1'), true);
  assert.equal(isOpenCodeEndpoint('https://api.deepseek.com/v1'), false);

  const ocHeaders = buildProviderRequestHeaders(
    {
      id: 'custom-1',
      presetId: 'custom-openai',
      name: '自定义 OpenAI 兼容接口',
      protocol: 'openai',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1',
      apiKey: 'oc-key',
      fastModel: 'glm-5.3-flash',
      reasoningModel: 'glm-5.3',
    },
    'oc-key',
    'ses_oss_001'
  );
  assert.equal(ocHeaders['x-opencode-session'], 'ses_oss_001');

  const parsed = parseModelsResponsePayload({
    data: [
      { id: 'glm-5.3-flash', type: 'chat' },
      { id: 'glm-5.3', type: 'chat' },
      { id: 'jev-1.14', type: 'decision' },
      { id: 'text-embedding-3-small', type: 'embedding' },
    ],
  });
  assert.deepEqual(parsed.sort(), ['glm-5.3', 'glm-5.3-flash']);
});

test('Unified legal calendar engine enforces 2027 State Council holidays, leap-day clamping, program-specific rollover, and uncapped workday spans', () => {
  assert.equal(CN_HOLIDAYS['2027-02-05'], '春节（除夕）');
  assert.equal(CN_HOLIDAYS['2027-02-13'], '春节');
  assert.equal(CN_ADJUSTED_WORKDAYS.has('2027-01-31'), true);
  assert.equal(CN_ADJUSTED_WORKDAYS.has('2027-02-14'), true);
  assert.equal(CN_ADJUSTED_WORKDAYS.has('2027-05-08'), true);
  assert.equal(CN_ADJUSTED_WORKDAYS.has('2027-09-26'), true);
  assert.equal(CN_ADJUSTED_WORKDAYS.has('2027-10-09'), true);

  const labor15 = computeLegalDeadline({
    startYmd: '2026-09-16',
    days: 15,
    rolloverMode: 'civil_statutory',
  });
  assert.equal(labor15.rawEndYmd, '2026-10-01');
  assert.equal(labor15.finalEndYmd, '2026-10-08');
  assert.equal(labor15.extended, true);

  const appeal2027 = computeLegalDeadline({
    startYmd: '2026-12-17',
    days: 15,
    rolloverMode: 'civil_statutory',
  });
  assert.equal(appeal2027.rawEndYmd, '2027-01-01');
  assert.equal(appeal2027.finalEndYmd, '2027-01-04');
  assert.equal(appeal2027.verificationStatus, 'exact');

  const spring2027 = computeLegalDeadline({
    startYmd: '2027-01-25',
    days: 15,
    rolloverMode: 'civil_statutory',
  });
  assert.equal(spring2027.rawEndYmd, '2027-02-09');
  assert.equal(spring2027.finalEndYmd, '2027-02-14');

  const leap2y = computeLegalDeadline({
    startYmd: '2024-02-29',
    months: 24,
    rolloverMode: 'civil_statutory',
  });
  assert.equal(leap2y.rawEndYmd, '2026-02-28');

  const freeze = computeLegalDeadline({
    startYmd: '2025-10-02',
    months: 12,
    rolloverMode: 'preservation_freeze',
  });
  assert.equal(freeze.rawEndYmd, '2026-10-01');
  assert.equal(freeze.finalEndYmd, '2026-10-01');
  assert.equal(freeze.extended, false);
  assert.ok(freeze.holidayWarningText.includes('不适用民事期间顺延'));

  assert.equal(computeLegalDeadline({ startYmd: '', days: 15, rolloverMode: 'civil_statutory' }), null);
  assert.equal(
    computeLegalDeadline({ startYmd: '2026-02-30', days: 15, rolloverMode: 'civil_statutory' }),
    null
  );

  const span = calculateWorkdayInterval('2010-01-01', '2026-01-01');
  assert.equal(span.absDays, 5844);
  assert.equal(span.inclusiveTotalDays, 5845);
  assert.equal(span.workdays + span.weekendOrHoliday, 5845);
  assert.equal(span.exceededMaxRange, false);
});

test('Private lending judicial cap compares against 4x 1-year LPR on contract formation date', () => {
  const off = evaluatePrivateLendingCap({
    enabled: false,
    contractDateIso: '2024-08-01',
    testedAnnualRate: 18,
  });
  assert.equal(off.status, 'disabled');

  const aug2024 = evaluatePrivateLendingCap({
    enabled: true,
    contractDateIso: '2024-08-01',
    testedAnnualRate: 13,
  });
  assert.equal(aug2024.quoteDate, '2024-07-22');
  assert.equal(aug2024.baseRate1y, 3.35);
  assert.equal(aug2024.capRate, 13.4);
  assert.equal(aug2024.status, 'within_cap');

  const jun2025 = evaluatePrivateLendingCap({
    enabled: true,
    contractDateIso: '2025-06-01',
    testedAnnualRate: 13,
  });
  assert.equal(jun2025.capRate, 12);
  assert.equal(jun2025.status, 'exceeds_cap');

  const pre2019 = evaluatePrivateLendingCap({
    enabled: true,
    contractDateIso: '2019-05-01',
    testedAnnualRate: 15,
  });
  assert.equal(pre2019.status, 'needs_manual_review');
});

test('Redactor prevents literal placeholder collisions, masks compound surnames & HK addresses, redacts batch sharedInstruction, and defaults syncByok to false', async () => {
  assert.equal(DEFAULT_CLOUD_SYNC_PREFS.syncByok, false);

  const collisionInput =
    '原告：张三，原件批注[当事人甲]及【公司主体A】，联系手机13800138000，诉被告：杭州星河文化传媒有限公司。';
  const redCol = redactLegalText(collisionInput);
  assert.ok(!redCol.redactedText.includes('张三'));
  assert.ok(!redCol.redactedText.includes('13800138000'));
  assert.ok(!redCol.redactedText.includes('杭州星河文化传媒有限公司'));
  assert.equal(restoreRedactedText(redCol.redactedText, redCol.mappings), collisionInput);

  const narr = redactLegalText('张三于3月1日借款2万元至今未还。');
  assert.ok(!narr.redactedText.includes('张三'));
  assert.equal(restoreRedactedText(narr.redactedText, narr.mappings), '张三于3月1日借款2万元至今未还。');

  const hk = redactLegalText('原告：欧阳修，住址：中国香港九龙弥敦道100号8楼。');
  assert.ok(!hk.redactedText.includes('欧阳修'));
  assert.ok(!hk.redactedText.includes('弥敦道100号'));
  assert.equal(restoreRedactedText(hk.redactedText, hk.mappings), '原告：欧阳修，住址：中国香港九龙弥敦道100号8楼。');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const corpus = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../public/data/spc-2025-templates.json'), 'utf8')
  );
  const tpl = corpus.templates[0];
  let capturedPrompt = '';
  await runSpcBatchQueue({
    items: [
      {
        id: 'b-1',
        sourceFilename: '案卷1.docx',
        caseLabel: '案卷1',
        sourceText: '被告：宁波海曙贸易有限公司拖欠货款10万元。',
        templateId: tpl.id,
        templateName: tpl.displayName,
        status: 'pending',
        updatedAt: Date.now(),
      },
    ],
    tpl,
    provider: {
      id: 'mock',
      presetId: 'deepseek',
      name: 'Mock',
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      fastModel: 'mock-fast',
      reasoningModel: 'mock-reason',
    },
    modelSlot: 'fast',
    autoRedact: true,
    sharedInstruction: '原告统一填写为杭州星河文化传媒有限公司，联系人王建军13912345678',
    concurrency: 1,
    completeFn: async ({ messages }) => {
      capturedPrompt = messages[1].content;
      return { content: JSON.stringify({ rowValues: {}, summary: 'ok', missingChecklist: [] }) };
    },
    onItemUpdate: () => {},
  });
  assert.ok(!capturedPrompt.includes('杭州星河文化传媒有限公司'));
  assert.ok(!capturedPrompt.includes('13912345678'));
});

test('SPC multi-template draft switching (A -> B -> A) and 100k-char draft bundle roundtrip without truncation', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const corpus = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../public/data/spc-2025-templates.json'), 'utf8')
  );
  const tplA = corpus.templates[0];
  const tplB = corpus.templates[1];

  const draftA = createInitialSpcDraft(tplA);
  draftA.courtName = '杭州市西湖区人民法院';
  draftA.signerName = '示例原告甲';

  const toB = switchSpcTemplatePreservingDrafts({
    currentDraft: draftA,
    draftsByTemplate: { [tplA.id]: draftA },
    nextTpl: tplB,
  });
  assert.equal(toB.nextDraft.templateId, tplB.id);
  assert.equal(toB.restoredExisting, false);

  toB.nextDraft.courtName = '上海市浦东新区人民法院';
  const backToA = switchSpcTemplatePreservingDrafts({
    currentDraft: toB.nextDraft,
    draftsByTemplate: toB.nextDraftsByTemplate,
    nextTpl: tplA,
  });
  assert.equal(backToA.restoredExisting, true);
  assert.equal(backToA.nextDraft.courtName, '杭州市西湖区人民法院');
  assert.equal(backToA.nextDraft.signerName, '示例原告甲');
  assert.equal(backToA.nextDraftsByTemplate[tplB.id].courtName, '上海市浦东新区人民法院');

  const longMaterial = '案件事实长段摘录。'.repeat(12000) + '__END_MARKER_108K__';
  assert.ok(longMaterial.length > 100_000);
  const json = serializeSpcDraftBundle({
    activeTemplateId: tplA.id,
    draftsByTemplate: backToA.nextDraftsByTemplate,
    sourceText: longMaterial,
    companionCourt: '杭州市西湖区人民法院',
  });
  const restored = parseSpcDraftBundle(json, corpus);
  assert.equal(restored.sourceText.length, longMaterial.length);
  assert.ok(restored.sourceText.endsWith('__END_MARKER_108K__'));
});

test('Statute search supports natural law + article compound queries in Arabic and Chinese numerals', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const corpus = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../public/data/laws-offline.json'), 'utf8')
  );
  const items = [];
  for (const a of corpus.civilArticles) {
    items.push({
      key: `civil:${a.no}`,
      lawTitle: '民法典',
      fullLawTitle: '中华人民共和国民法典',
      articleNo: a.no,
      articleLabel: a.label,
      breadcrumb: `${a.book} / ${a.chapter}`,
      summary: a.summary,
      text: a.text,
    });
  }
  for (const doc of corpus.companionDocs) {
    for (const it of doc.items) {
      items.push({
        key: `${doc.id}:${it.no}`,
        lawTitle: doc.shortTitle,
        fullLawTitle: doc.fullTitle,
        articleNo: it.no,
        articleLabel: it.label,
        breadcrumb: doc.shortTitle,
        text: it.text,
      });
    }
  }

  for (const q of ['585', '第585条', '民法典第585条', '《民法典》第 585 条', '民法典 585', '民法典 第五百八十五条']) {
    const hits = searchStatuteEntries(items, q, 10);
    assert.ok(hits.length > 0, `Query "${q}" returned 0 hits`);
    assert.equal(hits[0].key, 'civil:585', `Query "${q}" should rank 民法典第585条 first, got ${hits[0].key}`);
  }

  const cplHits = searchStatuteEntries(items, '民诉法第171条', 10);
  assert.ok(cplHits.some((h) => h.fullLawTitle.includes('民事诉讼法') && h.articleNo === 171));
});

test('Workspace backup merges by ID without clobbering newer items, supports rollback, rolls back atomically on quota failure, and verifies oversize single-page PDFs', async () => {
  const store = new Map();
  let failAfterWrites = Infinity;
  let writeCount = 0;
  const prevDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        writeCount++;
        if (writeCount > failAfterWrites) {
          throw new Error('QuotaExceededError');
        }
        store.set(k, String(v));
      },
      removeItem: (k) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    },
  });

  try {
    toolboxStorage.saveDeadlines([
      {
        id: 'dl-local-new',
        title: '本机新立案件上诉期',
        dueDate: '2026-12-20',
        category: '上诉期',
        createdAt: '2026-11-26T10:00:00.000Z',
      },
    ]);
    const oldBackupJson = JSON.stringify({
      app: 'cn-lawyer-ai-toolbox',
      exportedAt: '2026-10-01T00:00:00.000Z',
      deadlines: [
        {
          id: 'dl-backup-old',
          title: '旧备份案件举证期',
          dueDate: '2026-10-15',
          category: '举证期',
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      scratchpads: [],
    });

    const preview = toolboxStorage.previewWorkspaceImport(oldBackupJson);
    assert.equal(preview.keptLocalDeadlines, 1);

    toolboxStorage.importFullWorkspaceJson(oldBackupJson);
    const mergedIds = toolboxStorage.getDeadlines().map((d) => d.id).sort();
    assert.deepEqual(mergedIds, ['dl-backup-old', 'dl-local-new']);
    assert.equal(toolboxStorage.hasImportRollback(), true);

    toolboxStorage.restoreImportRollback();
    assert.deepEqual(
      toolboxStorage.getDeadlines().map((d) => d.id),
      ['dl-local-new']
    );

    writeCount = 0;
    failAfterWrites = 2;
    assert.throws(
      () =>
        toolboxStorage.importFullWorkspaceJson(
          JSON.stringify({
            app: 'cn-lawyer-ai-toolbox',
            history: [{ id: 'h1', toolId: 't', title: 'x', summary: 'y', createdAt: '2026-11-01' }],
            deadlines: [],
            scratchpads: [{ id: 's1', title: 'huge', content: 'x', updatedAt: '2026-11-01' }],
          }),
          { mode: 'overwrite' }
        ),
      /空间不足|回滚/
    );
    failAfterWrites = Infinity;
    assert.deepEqual(
      toolboxStorage.getDeadlines().map((d) => d.id),
      ['dl-local-new']
    );
  } finally {
    if (prevDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', prevDescriptor);
    }
  }

  const width = 600;
  const height = 600;
  const rawScanlines = Buffer.alloc((width * 3 + 1) * height);
  const rnd = crypto.randomBytes(width * 3 * height);
  for (let y = 0; y < height; y++) {
    rawScanlines[y * (width * 3 + 1)] = 0;
    rnd.copy(rawScanlines, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcVal = zlib.crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = zlib.deflateSync(rawScanlines, { level: 0 });
  const pngBytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  const doc = await PDFDocument.create();
  const img = await doc.embedPng(pngBytes);
  const p1 = doc.addPage([595, 842]);
  p1.drawImage(img, { x: 20, y: 20, width: 500, height: 500 });
  const p2 = doc.addPage([595, 842]);
  p2.drawText('Page 2 small attachment', { x: 50, y: 700, size: 14 });
  const fullPdfBytes = await doc.save({ useObjectStreams: true });
  assert.ok(fullPdfBytes.byteLength > 1_000_000);

  const splitRes = await splitPdfIntoVerifiedVolumes({
    pdfBytes: fullPdfBytes,
    baseName: '测试超限卷宗',
    maxMb: 1,
    unit: 'decimal_mb',
  });
  assert.equal(splitRes.volumes.length, 2);
  assert.equal(splitRes.allWithinLimit, false);
  assert.equal(splitRes.oversizeVolumes.length, 1);
  assert.equal(splitRes.oversizeVolumes[0].pageStart, 1);
  assert.equal(splitRes.volumes[1].exceedsLimit, false);
});

test('v1.9: Global/Home statute router, 3-state AI readiness, and two-tier Service Worker progressive caching work consistently', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const corpus = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../public/data/laws-offline.json'), 'utf8')
  );
  const items = corpus.civilArticles.map((a) => ({
    key: `civil:${a.no}`,
    lawTitle: '民法典',
    fullLawTitle: '中华人民共和国民法典',
    articleNo: a.no,
    articleLabel: a.label,
    breadcrumb: `${a.book} / ${a.chapter}`,
    summary: a.summary,
    text: a.text,
  }));

  // 1. HomeTab & CommandSearchModal shared query router lands on identical Civil Code Art. 585
  for (const raw of ['585', '民法典第585条', '民法典第五百八十五条', '《民法典》第 585 条']) {
    const route = classifyGlobalStatuteQuery(raw);
    assert.equal(route.isArticleLookup, true, `Expected "${raw}" to be recognized as article lookup`);
    const hits = searchStatuteEntries(items, route.statuteQuery, 5);
    assert.equal(hits[0]?.key, 'civil:585', `Expected "${raw}" -> "${route.statuteQuery}" to rank civil:585 #1`);
  }

  // 2. Honest 3-state AI readiness never conflates stored key with verified connection
  assert.equal(
    describeAiReadiness({
      id: '1',
      presetId: 'deepseek',
      name: 'DeepSeek（官方直连）',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      fastModel: 'deepseek-chat',
      reasoningModel: 'deepseek-reasoner',
    }).state,
    'unconfigured'
  );
  assert.equal(
    describeAiReadiness({
      id: '1',
      presetId: 'deepseek',
      name: 'DeepSeek（官方直连）',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-untested-demo',
      fastModel: 'deepseek-chat',
      reasoningModel: 'deepseek-reasoner',
    }).state,
    'untested'
  );
  assert.equal(
    describeAiReadiness({
      id: '1',
      presetId: 'deepseek',
      name: 'DeepSeek（官方直连）',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-verified-demo',
      fastModel: 'deepseek-chat',
      reasoningModel: 'deepseek-reasoner',
      lastTestedAt: '2026-11-27T08:00:00.000Z',
    }).state,
    'verified'
  );

  // 3. Service Worker defers heavy packs out of blocking install & ToolboxContext avoids smooth-scroll jank
  const swSrc = fs.readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');
  assert.ok(swSrc.includes('warmDeferredOfflinePacks'), 'SW must warm heavy data/font packs asynchronously');
  assert.ok(swSrc.includes('RETRY_OFFLINE_PACKS'), 'SW must support explicit offline pack retry');
  const ctxSrc = fs.readFileSync(path.resolve(__dirname, '../src/context/ToolboxContext.tsx'), 'utf8');
  assert.ok(!ctxSrc.includes("behavior: 'smooth'"), 'Cross-tab navigation must not force smooth scroll');
});

test('v1.9.1 Adversarial Legal & Isolation Regression Suite (Appraisal 5d, Account/Case Isolation, 0% Fault, Cross-Month Tenure, Art.31 LPR, Sub-Fees, Strict Statutes & SW Sub-HTML)', async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  // 1. P0: Asset appraisal report written objection = 5 days (法释〔2018〕15号第22条) & date-inversion conflict guard
  const appraisalDl = computeLegalDeadline({
    startYmd: '2026-11-18',
    days: 5,
    rolloverMode: 'civil_statutory',
    warnDaysBefore: 2,
  });
  assert.equal(appraisalDl?.finalEndYmd, '2026-11-23', '2026-11-18 + 5d must land on Monday 2026-11-23');
  assert.equal(appraisalDl?.warnYmd, '2026-11-21');

  const deadlineToolSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/tools/extra/PreservationDeadlineTool.tsx'),
    'utf8'
  );
  assert.ok(!deadlineToolSrc.includes('exec_objection_15d'), 'Merged 15d appraisal preset must be removed');
  assert.ok(deadlineToolSrc.includes('appraisal_report_obj_5d') && deadlineToolSrc.includes('法释〔2018〕15号'));

  const invertedDl = computeLegalDeadline({
    startYmd: '2026-11-18',
    days: 5,
    rolloverMode: 'civil_statutory',
    manualDueYmd: '2026-11-15',
  });
  assert.equal(invertedDl?.hasDateConflict, true, 'Manual due date earlier than start date must flag conflict');
  assert.equal(invertedDl?.verificationStatus, 'conflict_invalid');

  // 2. P0: Account-switch purge wipes ALL v1.8/v1.9 keys + BOTH IndexedDBs & detects blocked IDB
  const prevLs = globalThis.localStorage;
  const prevSs = globalThis.sessionStorage;
  const prevIdb = globalThis.indexedDB;
  try {
    const store = new Map([
      ['spc2025_drafts_by_tpl_v3', '{"drafts":{"tpl1":{}}}'],
      ['spc2025_elements_doc_draft_v2', '{"templateId":"tpl1"}'],
      ['lawyer_local_custom_docx_templates_v1', '[{"id":"t1"}]'],
      ['cn_lawyer_box_import_rollback_v1', '{"snap":1}'],
      ['cn_lawyer_spc_workspace_v1', '{"sourceText":"secret"}'],
      ['lf-mine', 'custom'],
    ]);
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.sessionStorage = {
      removeItem: () => {},
    };
    const deletedDbs = [];
    globalThis.indexedDB = {
      deleteDatabase: (name) => {
        deletedDbs.push(name);
        const req = {};
        queueMicrotask(() => req.onsuccess && req.onsuccess());
        return req;
      },
    };
    const resClean = await resetLocalUserWorkspaceForAccountSwitch();
    assert.equal(resClean.blocked, false);
    assert.equal(store.size, 0, `Expected all localStorage keys wiped, remaining: ${[...store.keys()]}`);
    assert.ok(deletedDbs.includes('spc2025_single_workspace_db_v1'));
    assert.ok(deletedDbs.includes('cn_lawyer_spc_batch_db_v1'));

    globalThis.indexedDB = {
      deleteDatabase: () => {
        const req = {};
        queueMicrotask(() => req.onblocked && req.onblocked());
        return req;
      },
    };
    const resBlocked = await resetLocalUserWorkspaceForAccountSwitch();
    assert.equal(resBlocked.blocked, true, 'Blocked IDB deletion must surface blocked=true');
  } finally {
    globalThis.localStorage = prevLs;
    globalThis.sessionStorage = prevSs;
    globalThis.indexedDB = prevIdb;
  }

  // 3. P0: Per-case SPC draft isolation (Case A vs Case B on same template) + Demo watermark detection + Brief strict caseId
  const spcCorpus = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../public/data/spc-2025-templates.json'), 'utf8')
  );
  const tLoan = spcCorpus.templates.find((t) => t.displayName === '民间借贷纠纷民事起诉状');
  assert.ok(tLoan);
  const draftCaseA = createInitialSpcDraft(tLoan);
  draftCaseA.signerName = '甲案件原告张某';
  const switchedToB = switchSpcTemplatePreservingDrafts({
    currentDraft: draftCaseA,
    draftsByTemplate: {},
    nextTpl: tLoan,
    currentCaseId: 'case-A',
    nextCaseId: 'case-B',
  });
  assert.equal(switchedToB.nextDraft.signerName, '', 'Case B must NEVER inherit Case A draft on same template');
  assert.equal(
    switchedToB.nextDraftsByTemplate[makeScopedSpcDraftKey('case-A', tLoan.id)]?.signerName,
    '甲案件原告张某'
  );
  const switchedBackToA = switchSpcTemplatePreservingDrafts({
    currentDraft: switchedToB.nextDraft,
    draftsByTemplate: switchedToB.nextDraftsByTemplate,
    nextTpl: tLoan,
    currentCaseId: 'case-B',
    nextCaseId: 'case-A',
  });
  assert.equal(switchedBackToA.restoredExisting, true);
  assert.equal(switchedBackToA.nextDraft.signerName, '甲案件原告张某');

  const demoDraft = createInitialSpcDraft(tLoan);
  demoDraft.signerName = '杭州云栖示例商贸有限公司（虚构样例）';
  assert.equal(isDemoSampleDraft(demoDraft), true);
  demoDraft.signerName = '真实原告公司';
  demoDraft.isDemoSample = false;
  assert.equal(isDemoSampleDraft(demoDraft), false);

  const homeSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/HomeTab.tsx'), 'utf8');
  assert.ok(
    homeSrc.includes('deadlines.filter((d) => d.caseId === activeCase.id)'),
    'Case brief deadlines must strictly match d.caseId === activeCase.id'
  );

  // 4. P1: Personal injury 0% fault & motor compulsory no-fault cap
  const zeroFaultGeneral = calculatePersonalInjuryRecoverable({
    medicalCategoryTotal: 30000,
    disabilityCategoryTotal: 200000,
    faultPctInput: '0',
    hasCompulsoryIns: false,
  });
  assert.equal(zeroFaultGeneral.faultPct, 0);
  assert.equal(zeroFaultGeneral.estimatedRecoverable, 0, '0% fault without compulsory insurance must equal 0');

  const zeroFaultMotor = calculatePersonalInjuryRecoverable({
    medicalCategoryTotal: 30000,
    disabilityCategoryTotal: 200000,
    faultPctInput: '0',
    hasCompulsoryIns: true,
  });
  assert.equal(zeroFaultMotor.compulsoryMode, 'no_fault_cap');
  assert.equal(zeroFaultMotor.compulsoryPay, 19800, 'Motor no-fault compulsory cap = 1,800 med + 18,000 dis');
  assert.equal(zeroFaultMotor.commercialOrPartyPay, 0);
  assert.equal(zeroFaultMotor.estimatedRecoverable, 19800);

  // 5. P1: Labor severance tenure end-of-month cross-month (2025-01-31 -> 2025-02-01 = 0.5N)
  const crossMonthTenure = calculateLaborSeveranceTenure('2025-01-31', '2025-02-01');
  assert.equal(crossMonthTenure.valid, true);
  assert.equal(crossMonthTenure.nMonths, 0.5, '2025-01-31 to 2025-02-01 must be 0.5N, never 0N');
  assert.equal(calculateLaborSeveranceTenure('2025-01-15', '2025-07-15').nMonths, 1.0);
  assert.equal(calculateLaborSeveranceTenure('2025-06-01', '2025-05-01').hasDateConflict, true);

  // 6. P1: LPR pre-2019 guard, Art.31 transitional lending cap (2020-01-01 + 2023-09-01 filing), and independent delay base
  const pre2019Blocked = computeLprAndDelayInterest({
    mode: 'lpr_floating',
    principalYuan: 100000,
    startDate: '2018-05-01',
    endDate: '2020-01-01',
    term: '1y',
    multiplier: 1,
    bps: 0,
    customRate: 6,
    preReformAnnualRate: null,
    dayBasis: 365,
    isPrivateLending: false,
    contractDate: '2018-05-01',
    includeDelay: false,
    delayStartDate: '2020-01-01',
  });
  assert.equal(pre2019Blocked.requiresPreReformRate, true);
  assert.equal(pre2019Blocked.segments.length, 0, 'Must never silently apply 4.25% to pre-2019-08-20');

  const transNoFiling = evaluatePrivateLendingCap({
    enabled: true,
    contractDateIso: '2020-01-01',
    testedAnnualRate: 16,
  });
  assert.equal(transNoFiling.status, 'needs_manual_review', 'Pre-2020-08-20 contract without filing date must not say within_cap');

  const transWith2023Filing = evaluatePrivateLendingCap({
    enabled: true,
    contractDateIso: '2020-01-01',
    filingDateIso: '2023-09-01',
    testedAnnualRate: 16,
  });
  assert.equal(transWith2023Filing.status, 'exceeds_cap');
  assert.equal(transWith2023Filing.capRate, 13.8, '2023-09-01 1y LPR 3.45% * 4 = 13.80%');

  const delaySplit = computeLprAndDelayInterest({
    mode: 'custom_rate',
    principalYuan: 100000,
    startDate: '2025-01-01',
    endDate: '2025-08-21',
    term: '1y',
    multiplier: 1,
    bps: 0,
    customRate: 6,
    dayBasis: 365,
    isPrivateLending: false,
    contractDate: '2025-01-01',
    includeDelay: true,
    delayStartDate: '2025-08-01',
    delayBaseYuan: 60000,
  });
  assert.equal(delaySplit.delayDays, 20);
  assert.ok(Math.abs(delaySplit.delayInterest - 210) < 1e-6, '60,000 * 0.000175 * 20d = 210.00');

  // 7. P2: Litigation fee independent sub-amounts (100w claim, 10w appeal -> 2,300, 30w preservation -> 2,020)
  const subFees = calculateLitigationLifecycleFees({
    claimAmountYuan: 1_000_000,
    appealAmountYuan: 100_000,
    preservationAmountYuan: 300_000,
  });
  assert.equal(subFees.firstFull, 13800);
  assert.equal(subFees.appeal, 2300);
  assert.equal(subFees.preservation, 2020);

  // 8. P1: Statute strict non-substitution ("公司法解释三第13条") & clause notice ("民法典 第1165条 第2款")
  const lawsCorpus = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../public/data/laws-offline.json'), 'utf8')
  );
  const fullStatutes = [
    ...lawsCorpus.civilArticles.map((a) => ({
      key: `civil:${a.no}`,
      lawTitle: '民法典',
      fullLawTitle: '中华人民共和国民法典',
      articleNo: a.no,
      articleLabel: a.label,
      breadcrumb: `${a.book} · ${a.chapter}`,
      summary: a.summary,
      text: a.text,
    })),
    ...lawsCorpus.companionDocs.flatMap((doc) =>
      doc.items.map((it) => ({
        key: `${doc.id}:${it.no}`,
        lawTitle: doc.shortTitle,
        fullLawTitle: doc.fullTitle || doc.shortTitle,
        articleNo: it.no,
        articleLabel: it.label,
        breadcrumb: doc.docNo,
        text: it.text,
      }))
    ),
  ];
  const uncollectedInterp = searchStatuteEntriesDetailed(fullStatutes, '公司法解释三第13条', 10);
  assert.equal(uncollectedInterp.hits.length, 0, 'Must NEVER return《公司法》第13条 for 公司法解释三第13条');
  assert.ok(uncollectedInterp.uncollectedLawNotice.includes('公司法解释三'));

  const clauseQuery = searchStatuteEntriesDetailed(fullStatutes, '民法典 第1165条 第2款', 5);
  assert.equal(clauseQuery.hits[0]?.key, 'civil:1165');
  assert.ok(clauseQuery.clauseNotice.includes('第2款'));

  // 9. P1: Service Worker queryless sub-HTML offline matching (never returns SPA index.html inside iframe!)
  const swCode = fs.readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');
  const listeners = {};
  const cachedMap = new Map([
    ['/cn-lawyer-ai-toolbox/index.html', new Response('<html>SPA_ROOT</html>', { status: 200 })],
    [
      '/cn-lawyer-ai-toolbox/tool-assets/lawyer-fee-workbench.html',
      new Response('<html>FEE_WORKBENCH</html>', { status: 200 }),
    ],
  ]);
  const sandbox = {
    URL,
    Request,
    Response,
    Promise,
    self: {
      location: { origin: 'https://qwertyzhu.github.io' },
      registration: { scope: 'https://qwertyzhu.github.io/cn-lawyer-ai-toolbox/' },
      clients: { matchAll: async () => [], claim: async () => {} },
      skipWaiting: () => {},
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
    },
    caches: {
      open: async () => ({ put: async () => {}, match: async () => null, add: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async (reqOrUrl) => {
        const key = typeof reqOrUrl === 'string' ? reqOrUrl : new URL(reqOrUrl.url).pathname + new URL(reqOrUrl.url).search;
        const resp = cachedMap.get(key);
        return resp ? resp.clone() : undefined;
      },
    },
    fetch: async () => {
      throw new Error('offline');
    },
  };
  vm.runInNewContext(swCode, sandbox);

  let subHtmlPromise = null;
  listeners.fetch({
    request: new Request(
      'https://qwertyzhu.github.io/cn-lawyer-ai-toolbox/tool-assets/lawyer-fee-workbench.html?embed=1'
    ),
    respondWith: (p) => {
      subHtmlPromise = p;
    },
  });
  const subHtmlResp = await subHtmlPromise;
  assert.equal(await subHtmlResp.text(), '<html>FEE_WORKBENCH</html>');

  let missingSubHtmlPromise = null;
  listeners.fetch({
    request: new Request(
      'https://qwertyzhu.github.io/cn-lawyer-ai-toolbox/tool-assets/uncached-subtool.html?embed=1'
    ),
    respondWith: (p) => {
      missingSubHtmlPromise = p;
    },
  });
  const missingResp = await missingSubHtmlPromise;
  assert.equal(missingResp.status, 503, 'Uncached sub-HTML must return 503 card, never SPA_ROOT index.html');
  assert.ok(!(await missingResp.text()).includes('SPA_ROOT'));
});





