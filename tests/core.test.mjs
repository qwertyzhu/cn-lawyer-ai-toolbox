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
  buildProviderRequestPayload,
  normalizeModelsEndpoints,
  parseModelsResponsePayload,
  suggestModelSlots,
} from '../src/lib/aiClient.ts';
import { buildIcsContent } from '../src/lib/icsGenerator.ts';
import {
  ELEMENTS_COMPLAINT_TEMPLATES,
  createInitialComplaintDraft,
  buildComplaintSections,
  getResolvedCauseTitle,
} from '../src/data/elementsComplaintTemplates.ts';
import {
  buildElementsComplaintDocxBytes,
  buildMarkdownReportDocxBytes,
} from '../src/lib/docxBuilder.ts';
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
  verifyActivationCode,
  signActivationCodeWithMasterToken,
  formatWeChatInvitationCard,
  buildSignedAdminHeaders,
  createOpenModeLicense,
} from '../src/lib/licenseEngine.ts';

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
  assert.ok(headers['X-Toolbox-Admin-Sig'] && headers['X-Toolbox-Admin-Ts']);
  const sigBytes = Buffer.from(headers['X-Toolbox-Admin-Sig'], 'base64url');
  assert.equal(sigBytes.length, 64);
  const bodyHash = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  ).toString('hex');
  const msg = new TextEncoder().encode(
    `POST:/api/admin/accounts/toggle:${headers['X-Toolbox-Admin-Ts']}:${bodyHash}`
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


