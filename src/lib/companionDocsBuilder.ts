import type { LawyerProfile } from '../types/toolbox';
import {
  buildMarkdownReportDocxBytes,
  downloadMarkdownReportDocx,
} from './docxBuilder.ts';
import type {
  OfficialSpcDraftState,
  OfficialSpcTemplate,
} from './spcOfficialTemplates.ts';

export type CompanionDocKind =
  | 'power_of_attorney'
  | 'service_address'
  | 'preservation_app'
  | 'investigation_order'
  | 'withdrawal_app';

export interface CompanionDocMeta {
  kind: CompanionDocKind;
  title: string;
  badge: string;
  desc: string;
}

export const COMPANION_DOCS_CATALOG: CompanionDocMeta[] = [
  {
    kind: 'power_of_attorney',
    title: '授权委托书',
    badge: '立案必交',
    desc: '自动带入委托人、律所、受托律师与执业证号，支持一般/特别授权切换',
  },
  {
    kind: 'service_address',
    title: '送达地址确认书',
    badge: '补齐2025表',
    desc: '最高法 2025 示范文本移除送达地址栏后的独立立案配套确认书',
  },
  {
    kind: 'preservation_app',
    title: '财产保全申请书',
    badge: '防转移财产',
    desc: '复用双方主体与案由，附保全金额、担保说明与财产线索框架',
  },
  {
    kind: 'investigation_order',
    title: '律师调查令申请书',
    badge: '庭前取证',
    desc: '带入持令律师姓名与执业证号，快速列明协助调查单位与证据清单',
  },
  {
    kind: 'withdrawal_app',
    title: '撤诉申请书',
    badge: '和解结案',
    desc: '自动带入案号、案由与当事人，适配庭前和解或调整诉请撤诉',
  },
];

export interface CompanionDocContext {
  causeName: string;
  caseNo: string;
  courtName: string;
  clientName: string;
  clientIdOrCode: string;
  clientAddress: string;
  clientPhone: string;
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

function extractLineField(text: string, labels: string[]): string {
  if (!text) return '';
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}[：:][ \\t]*([^\\n]+)`);
    const m = text.match(re);
    if (m && m[1]) {
      const val = m[1]
        .replace(/(?:^|\s+)(?:性别|民族|出生日期|法定代表人|主要负责人|职务|联系电话|统一社会信用代码|身份证号|住所地|所有制性质)[：:]?.*$/, '')
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
  let opponentName = '';
  let opponentIdOrCode = '';
  let opponentAddress = '';
  let opponentPhone = '';

  const isDefense = tpl.docRole === 'defense';

  for (const row of tpl.rows) {
    if (row.kind === 'grid' && row.roleTag === 'case_meta') {
      const cells = draft.gridValues[row.id] || row.cells || [];
      if (cells[1]?.trim()) caseNo = cells[1].trim();
      if (cells[3]?.trim()) causeName = cells[3].trim();
      continue;
    }

    const val = draft.rowValues[row.id] || '';
    if (!val.trim() || val === (row.templateText || '')) continue;

    const isClientRole = isDefense
      ? row.roleTag === 'defendant_person' || row.roleTag === 'defendant_org'
      : row.roleTag === 'plaintiff_person' || row.roleTag === 'plaintiff_org';
    const isOpponentRole = isDefense
      ? row.roleTag === 'plaintiff_person' || row.roleTag === 'plaintiff_org'
      : row.roleTag === 'defendant_person' || row.roleTag === 'defendant_org';

    if (isClientRole && !clientName) {
      const n = extractLineField(val, ['名称', '姓名']);
      if (n) {
        clientName = n;
        clientIdOrCode = extractLineField(val, ['统一社会信用代码', '身份证号', '证件号码']);
        clientAddress = extractLineField(val, ['住所地', '经常居住地', '户籍所在地', '通讯地址']);
        clientPhone = extractLineField(val, ['联系电话', '手机', '联系方式']);
      }
    }
    if (isOpponentRole && !opponentName) {
      const n = extractLineField(val, ['名称', '姓名']);
      if (n) {
        opponentName = n;
        opponentIdOrCode = extractLineField(val, ['统一社会信用代码', '身份证号', '证件号码']);
        opponentAddress = extractLineField(val, ['住所地', '经常居住地', '户籍所在地', '通讯地址']);
        opponentPhone = extractLineField(val, ['联系电话', '手机', '联系方式']);
      }
    }
  }

  if (!clientName && draft.signerName?.trim()) {
    clientName = draft.signerName.trim();
  }

  return {
    causeName,
    caseNo,
    courtName: '',
    clientName,
    clientIdOrCode,
    clientAddress,
    clientPhone,
    opponentName,
    opponentIdOrCode,
    opponentAddress,
    opponentPhone,
    lawyerName: profile.name || '',
    lawyerLicenseNo: profile.licenseNo || '',
    lawyerFirm: profile.firmName || '',
    lawyerPhone: profile.phone || '',
    lawyerAddress: profile.address || '',
    lawyerEmail: profile.email || '',
    authScope: 'special',
    preservationAmount: '',
    targetEvidenceOrg: '',
    signDateCn: draft.signDate?.trim() || formatTodayCn(),
  };
}

function blankOr(val: string, placeholder: string): string {
  return val.trim() ? val.trim() : placeholder;
}

export function buildCompanionDocSpec(
  kind: CompanionDocKind,
  ctx: CompanionDocContext
): { title: string; subtitle: string; markdownBody: string; fileName: string } {
  const court = blankOr(ctx.courtName, '____________人民法院');
  const cause = blankOr(ctx.causeName, '________纠纷');
  const caseNo = blankOr(ctx.caseNo, '（待立案编立案号）');
  const client = blankOr(ctx.clientName, '________________');
  const opponent = blankOr(ctx.opponentName, '________________');
  const lawyer = blankOr(ctx.lawyerName, '________');
  const firm = blankOr(ctx.lawyerFirm, '________________律师事务所');
  const licNo = blankOr(ctx.lawyerLicenseNo, '________________');
  const lawyerPhone = blankOr(ctx.lawyerPhone, '________________');
  const dateStr = ctx.signDateCn || formatTodayCn();
  const safeCause = (ctx.causeName || '案件').replace(/[\\/:*?"<>|]/g, '_');

  if (kind === 'power_of_attorney') {
    const authDetail =
      ctx.authScope === 'special'
        ? '特别授权：代为立案、起诉或应诉、提交和签收法律文书、参加庭审、举证质证、进行辩论、承认/放弃/变更诉讼请求、进行和解与调解、提起反诉或上诉、申请财产保全与调查令、申请强制执行及代收相关款项（具体以委托人勾选确认为准）。'
        : '一般代理：代为起诉或应诉、提交证据、参加庭审调查与法庭辩论、签收法律文书等一般程序性诉讼权利。';

    return {
      title: '授权委托书',
      subtitle: `案由：${cause}${ctx.caseNo ? ` ｜ 案号：${ctx.caseNo}` : ''}`,
      fileName: `授权委托书_${safeCause}.docx`,
      markdownBody: [
        `## 委托人信息`,
        `- **委托人**：${client}`,
        ...(ctx.clientIdOrCode ? [`- **证件号 / 统一社会信用代码**：${ctx.clientIdOrCode}`] : []),
        ...(ctx.clientAddress ? [`- **住所地 / 联系地址**：${ctx.clientAddress}`] : []),
        ...(ctx.clientPhone ? [`- **联系电话**：${ctx.clientPhone}`] : []),
        '',
        `## 受托人（委托诉讼代理人）信息`,
        `- **姓名**：${lawyer}`,
        `- **工作单位**：${firm}`,
        `- **职务及执业证号**：执业律师（执业证号：${licNo}）`,
        `- **联系电话**：${lawyerPhone}`,
        '',
        `## 委托事项与代理权限`,
        `现委托上列受托人在本委托人与 **${opponent}** 因 **${cause}** 一案（案号：${caseNo}）中，作为本委托人的委托诉讼代理人。`,
        '',
        `- **代理权限类型**：${ctx.authScope === 'special' ? '☑ 特别授权   □ 一般代理' : '□ 特别授权   ☑ 一般代理'}`,
        `- **具体代理权限**：${authDetail}`,
        `- **代理期限**：自本授权委托书签署之日起至本审级程序终结之日止。`,
        '',
        `---`,
        `此致`,
        `${court}`,
        '',
        `**委托人（签字或盖章）**：____________________`,
        `**签署日期**：${dateStr}`,
      ].join('\n'),
    };
  }

  if (kind === 'service_address') {
    const recvAddr = blankOr(ctx.lawyerAddress || ctx.clientAddress, '________________________________________');
    const recvPhone = blankOr(ctx.lawyerPhone || ctx.clientPhone, '________________');
    const recvEmail = blankOr(ctx.lawyerEmail, '________________（选填）');
    const receiver = ctx.lawyerName
      ? `${ctx.lawyerName}（委托诉讼代理人，${firm}）`
      : client;

    return {
      title: '当事人送达地址确认书',
      subtitle: `配套最高法 2025 要素式示范文本 ｜ 案由：${cause}`,
      fileName: `送达地址确认书_${safeCause}.docx`,
      markdownBody: [
        `## 一、案件基本信息`,
        `| 项目 | 填写内容 |`,
        `| :--- | :--- |`,
        `| 受案法院 | ${court} |`,
        `| 案由 / 案号 | ${cause} ｜ ${caseNo} |`,
        `| 当事人 | ${client} |`,
        `| 指定代收人 / 代理律师 | ${receiver} |`,
        '',
        `## 二、确认的送达地址与电子送达方式`,
        `| 送达方式 | 确认信息 |`,
        `| :--- | :--- |`,
        `| 书面邮寄送达地址 | ${recvAddr} |`,
        `| 接收手机号码（短信/微信） | ${recvPhone} |`,
        `| 电子邮箱（选填） | ${recvEmail} |`,
        `| 是否同意电子送达 | ☑ 同意（接受法院通过中国审判流程信息网、人民法院在线服务小程序、短信或邮箱送达裁判文书以外或依法可电子送达的诉讼文书）   □ 不同意 |`,
        '',
        `## 三、当事人确认声明`,
        `本人/本单位已阅读并知晓人民法院关于送达地址确认的法律规定与不利后果：如确认的送达地址不准确、送达地址变更未及时书面告知人民法院，或者本人/指定代收人拒绝签收，导致诉讼文书未能实际接收的，文书退回之日（邮寄送达）或到达特定系统之日（电子送达）依法视为送达。`,
        '',
        `---`,
        `**确认人（当事人或特别授权代理人签字/盖章）**：____________________`,
        `**日期**：${dateStr}`,
      ].join('\n'),
    };
  }

  if (kind === 'preservation_app') {
    const amountStr = blankOr(ctx.preservationAmount, '人民币 ____________ 元');
    return {
      title: '财产保全申请书',
      subtitle: `案由：${cause}${ctx.caseNo ? ` ｜ 案号：${ctx.caseNo}` : ''}`,
      fileName: `财产保全申请书_${safeCause}.docx`,
      markdownBody: [
        `## 一、当事人信息`,
        `- **申请人**：${client}${ctx.clientIdOrCode ? `（证件号/信用代码：${ctx.clientIdOrCode}）` : ''}`,
        ...(ctx.clientAddress ? [`- **住所地**：${ctx.clientAddress}`] : []),
        ...(ctx.clientPhone ? [`- **联系电话**：${ctx.clientPhone}`] : []),
        `- **委托诉讼代理人**：${lawyer}（${firm}，电话：${lawyerPhone}）`,
        `- **被申请人**：${opponent}${ctx.opponentIdOrCode ? `（证件号/信用代码：${ctx.opponentIdOrCode}）` : ''}`,
        ...(ctx.opponentAddress ? [`- **住所地**：${ctx.opponentAddress}`] : []),
        ...(ctx.opponentPhone ? [`- **联系电话**：${ctx.opponentPhone}`] : []),
        '',
        `## 二、请求事项`,
        `请求贵院依法裁定查封、扣押、冻结被申请人 **${opponent}** 名下价值 **${amountStr}** 的银行存款、房产、股权或其他等值财产（具体以所附《财产线索清单》及法院网络查控结果为准）。`,
        '',
        `## 三、事实与理由`,
        `申请人与被申请人因 **${cause}** 一案（案号：${caseNo}），已依法向贵院提起诉讼/正在审理中。鉴于被申请人至今拒不履行到期义务，且存在转移、隐匿或处分名下财产的现实风险，如不及时采取财产保全措施，极可能导致将来生效判决难以执行或使申请人合法权益遭受难以弥补的损害。`,
        '',
        `现申请人依据《中华人民共和国民事诉讼法》第一百零三条及相关司法解释规定，申请对被申请人名下等值财产采取保全措施，并愿依法提供诉讼财产保全责任保险保单（或现金/房产担保），承担因申请错误造成损失的赔偿责任。`,
        '',
        `## 四、附交材料清单`,
        `1. 财产线索清单（银行账号 / 不动产 / 股权 / 车辆线索）；`,
        `2. 诉讼财产保全责任保险保单保函（或担保材料）。`,
        '',
        `---`,
        `此致`,
        `${court}`,
        '',
        `**申请人（签字或盖章）**：____________________`,
        `**日期**：${dateStr}`,
      ].join('\n'),
    };
  }

  if (kind === 'investigation_order') {
    const targetOrg = blankOr(ctx.targetEvidenceOrg, '____________________（填写银行 / 市场监管 / 税务 / 平台运营方等协助调查单位全称）');
    return {
      title: '律师调查令申请书',
      subtitle: `案由：${cause}${ctx.caseNo ? ` ｜ 案号：${ctx.caseNo}` : ''}`,
      fileName: `律师调查令申请书_${safeCause}.docx`,
      markdownBody: [
        `## 一、申请主体与持令律师信息`,
        `- **申请人**：${client}`,
        `- **案号 / 案由**：${caseNo} ｜ ${cause}`,
        `- **持令调查律师**：${lawyer}（执业机构：${firm}；执业证号：${licNo}；联系电话：${lawyerPhone}）`,
        '',
        `## 二、申请事项`,
        `请求贵院依法向持令律师签发《律师调查令》，准许持令律师前往 **${targetOrg}** 调取以下与本案待证事实直接相关的证据材料：`,
        `1. ________________________________________________________；`,
        `2. ________________________________________________________。`,
        '',
        `## 三、事实与理由`,
        `申请人与 **${opponent}** 因 **${cause}** 一案正在贵院审理（或执行）中。上述拟调取的证据材料系查明本案核心事实、核算涉案金额或核实责任主体的关键依据，且由协助调查单位依法掌握。申请人及代理律师因客观原因无法自行调取，特依据《中华人民共和国民事诉讼法》第六十七条及最高人民法院关于民事诉讼证据与调查令的相关规定，恳请贵院准予签发律师调查令。`,
        '',
        `## 四、附交材料`,
        `1. 授权委托书、律师事务所函及持令律师执业证复印件；`,
        `2. 与待调取证据相关的初步线索材料。`,
        '',
        `---`,
        `此致`,
        `${court}`,
        '',
        `**申请人（签字或盖章）**：____________________`,
        `**代理律师**：${lawyer}`,
        `**日期**：${dateStr}`,
      ].join('\n'),
    };
  }

  return {
    title: '撤诉申请书',
    subtitle: `案由：${cause}${ctx.caseNo ? ` ｜ 案号：${ctx.caseNo}` : ''}`,
    fileName: `撤诉申请书_${safeCause}.docx`,
    markdownBody: [
      `## 一、当事人信息`,
      `- **申请人（原告/上诉人）**：${client}${ctx.clientIdOrCode ? `（证件号/信用代码：${ctx.clientIdOrCode}）` : ''}`,
      `- **委托诉讼代理人**：${lawyer}（${firm}，电话：${lawyerPhone}）`,
      `- **被申请人（被告/被上诉人）**：${opponent}`,
      '',
      `## 二、申请事项`,
      `请求贵院准许申请人撤回对 **${opponent}** 就 **${cause}** 一案（案号：${caseNo}）的起诉，并依法减半退还已预交的案件受理费。`,
      '',
      `## 三、事实与理由`,
      `申请人诉被申请人 **${cause}** 一案已由贵院立案受理。现因双方已就案涉争议达成和解协议并妥善处理（或：因案情及诉讼策略调整需要，申请人决定暂撤回本案起诉），特依据《中华人民共和国民事诉讼法》第一百四十八条之规定，向贵院提出撤诉申请。本撤诉系申请人真实意思表示，不损害国家利益、社会公共利益及他人合法权益，恳请贵院依法裁定准许。`,
      '',
      `---`,
      `此致`,
      `${court}`,
      '',
      `**申请人（签字或盖章）**：____________________`,
      `**日期**：${dateStr}`,
    ].join('\n'),
  };
}

export function buildCompanionDocxBytes(
  kind: CompanionDocKind,
  ctx: CompanionDocContext
): { bytes: Uint8Array; fileName: string; title: string } {
  const spec = buildCompanionDocSpec(kind, ctx);
  const bytes = buildMarkdownReportDocxBytes({
    title: spec.title,
    subtitle: spec.subtitle,
    markdownBody: spec.markdownBody,
  });
  return { bytes, fileName: spec.fileName, title: spec.title };
}

export function downloadCompanionDocx(
  kind: CompanionDocKind,
  ctx: CompanionDocContext
): string {
  const spec = buildCompanionDocSpec(kind, ctx);
  downloadMarkdownReportDocx(
    {
      title: spec.title,
      subtitle: spec.subtitle,
      markdownBody: spec.markdownBody,
    },
    spec.fileName
  );
  return spec.fileName;
}
