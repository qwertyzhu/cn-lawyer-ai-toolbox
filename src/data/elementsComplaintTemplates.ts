/**
 * 最高人民法院《部分案件民事起诉状示范文本》（表格化、要素式）12 类高频案由结构定义
 * 对照最高法 2024 试行 11 类及 2025.7 全面推广 67 类示范文本核心要素，
 * 100% 本地结构化，兼顾「离线手动勾选填表」与「AI 传统诉状一键提取转写」。
 */

export type ComplaintTemplateCategory =
  | '商事合同'
  | '金融借贷'
  | '劳动家事与人损'
  | '行政与执行'
  | '知产与网络'
  | '通用兜底';

export interface ElementFieldDef {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'radio' | 'radio_detail';
  options?: string[];
  defaultOption?: string;
  placeholder: string;
  detailPlaceholder?: string;
}

export interface ComplaintTemplateDef {
  id: string;
  docTitle?: string; // 默认“民事起诉状”，行政/执行可覆盖为“行政起诉状”“强制执行申请书”
  partyRoleLabels?: [string, string]; // 默认 ["原告", "被告"]，执行可为 ["申请执行人", "被执行人"]
  signerLabel?: string; // 默认“具状人（签字、盖章）”
  title: string;
  shortTitle: string;
  category: ComplaintTemplateCategory;
  badge: string;
  docRef: string;
  defaultLegalBasis: string;
  claimFields: ElementFieldDef[];
  factFields: ElementFieldDef[];
}

export interface PartyEntity {
  kind: 'org' | 'person';
  name: string;
  // Person fields
  gender: string;
  birthDate: string;
  ethnicity: string;
  workUnit: string;
  jobTitle: string;
  domicile: string;
  residence: string;
  idNumber: string;
  // Org fields
  regAddress: string;
  legalRep: string;
  repTitle: string;
  creditCode: string;
  orgType: string;
  ownershipNature?: string; // 国有 / 民营 / 外资（最高法2025示范文本项）
  // Shared
  phone: string;
}

export interface AgentInfo {
  enabled: boolean;
  name: string;
  firm: string;
  licenseNo?: string;
  phone: string;
  authority: '一般授权' | '特别授权';
}

export interface ComplaintDraftState {
  templateId: string;
  customCause: string;
  courtName: string;
  plaintiffs: PartyEntity[];
  agent: AgentInfo;
  defendants: PartyEntity[];
  thirdPartyEnabled: boolean;
  thirdParty: PartyEntity;
  serviceAddress: string;
  serviceRecipient: string;
  servicePhone: string;
  electronicService: '同意' | '不同意';
  electronicMethod: string;
  claims: Record<string, string>;
  claimChoices: Record<string, string>;
  hasJurisdictionAgreement: '有' | '无';
  jurisdictionDetail: string;
  hasPrePreservation: '是' | '否';
  prePreservationDetail: string;
  applyPreservation: '是' | '否';
  preservationDetail: string;
  facts: Record<string, string>;
  factChoices: Record<string, string>;
  evidenceSummary: string;
  mediationKnow: '了解' | '不了解';
  mediationAgree: '是' | '否' | '暂不确定，想要了解更多' | '同意' | '不同意';
  signerName: string;
  signDate: string;
}

export interface RenderedTableRow {
  label: string;
  value: string;
}

export interface RenderedComplaintSection {
  title: string;
  rows: RenderedTableRow[];
}

export function createEmptyParty(kind: 'org' | 'person' = 'org'): PartyEntity {
  return {
    kind,
    name: '',
    gender: '',
    birthDate: '',
    ethnicity: '汉族',
    workUnit: '',
    jobTitle: '',
    domicile: '',
    residence: '',
    idNumber: '',
    regAddress: '',
    legalRep: '',
    repTitle: '法定代表人',
    creditCode: '',
    orgType: '有限责任公司',
    ownershipNature: '民营',
    phone: '',
  };
}

export function getTodayChinaDateCn(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}年${m}月${day}日`;
}

export const ELEMENTS_COMPLAINT_TEMPLATES: ComplaintTemplateDef[] = [
  {
    id: 'sales_contract',
    title: '买卖合同纠纷',
    shortTitle: '买卖合同',
    category: '商事合同',
    badge: '最高法高频第1类',
    docRef: '最高人民法院《民事起诉状（买卖合同纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国民法典》第五百零九条、第五百七十七条、第五百九十五条、第六百二十八条等规定。',
    claimFields: [
      { key: 'payment', label: '1. 给付价款（货款）', kind: 'textarea', placeholder: '例：判令被告向原告支付尚欠货款人民币 380,000 元。' },
      { key: 'delay_interest', label: '2. 违约金 / 逾期付款利息', kind: 'textarea', placeholder: '例：判令被告支付逾期付款利息（以 380,000 元为基数，自 2025 年 6 月 1 日起至实际清偿之日止，按同期全国银行间同业拆借中心公布的一年期 LPR 的 1.5 倍计算，暂计至起诉日为 12,500 元）。' },
      { key: 'contract_action', label: '3. 确认解除 / 继续履行合同', kind: 'radio_detail', options: ['不主张', '解除合同', '继续履行'], defaultOption: '不主张', placeholder: '', detailPlaceholder: '如需解除/继续履行，写明合同名称、解除时间或交付内容' },
      { key: 'warranty_or_return', label: '4. 赔偿损失 / 退换货 / 修理', kind: 'text', placeholder: '选填（如无此项请求可留空）' },
      { key: 'security_claim', label: '5. 担保权利（保证/抵押/质押）', kind: 'radio_detail', options: ['不主张', '主张担保责任'], defaultOption: '不主张', placeholder: '', detailPlaceholder: '写明连带保证人或抵押物优先受偿范围' },
      { key: 'realization_cost', label: '6. 实现债权的费用', kind: 'text', placeholder: '如律师费、保全保险费等（须有合同约定）' },
      { key: 'litigation_cost', label: '7. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费、保全费由被告承担。' },
      { key: 'legal_basis', label: '8. 请求权法律依据', kind: 'textarea', placeholder: '写明具体合同条款及法律依据' },
    ],
    factFields: [
      { key: 'contract_info', label: '1. 合同签订情况', kind: 'textarea', placeholder: '写明合同名称、编号、签订时间、签订地点（或微信/口头订立买卖合同过程）。' },
      { key: 'subject_price', label: '2. 标的物与价款约定', kind: 'textarea', placeholder: '写明货物名称、规格型号、数量、单价、总价款及开票约定。' },
      { key: 'payment_delivery_terms', label: '3. 付款与交货约定', kind: 'textarea', placeholder: '写明交货时间、地点、验收方式、付款方式（月结/货到付款/分期）及违约责任条款。' },
      { key: 'delivery_perf', label: '4. 交货及验收履行情况', kind: 'textarea', placeholder: '写明原告实际发货时间、送货单/物流凭证、被告签收验收及开具增值税发票情况。' },
      { key: 'payment_perf', label: '5. 货款支付及对账情况', kind: 'textarea', placeholder: '写明总供货金额、已付金额、尚欠货款余额及双方对账单/催款函确认情况。' },
      { key: 'quality_dispute', label: '6. 是否存在质量/迟延履行争议', kind: 'radio_detail', options: ['无', '有'], defaultOption: '无', placeholder: '', detailPlaceholder: '如有质量异议或迟延交货情况，简述经过' },
      { key: 'breach_and_calc', label: '7. 违约事实及违约金/利息计算', kind: 'textarea', placeholder: '写明被告逾期付款起算日、催告经过及违约金/LPR 利息计算明细。' },
      { key: 'guarantee_info', label: '8. 担保情况（保证/抵押/质押）', kind: 'radio_detail', options: ['无', '有'], defaultOption: '无', placeholder: '', detailPlaceholder: '写明担保合同签订时间、担保人、担保方式及范围' },
      { key: 'other_facts', label: '9. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'private_lending',
    title: '民间借贷纠纷',
    shortTitle: '民间借贷',
    category: '金融借贷',
    badge: '最高法高频第2类',
    docRef: '最高人民法院《民事起诉状（民间借贷纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国民法典》第六百六十七条、第六百七十五条、第六百七十六条及《最高人民法院关于审理民间借贷案件适用法律若干问题的规定》等相关规定。',
    claimFields: [
      { key: 'principal', label: '1. 偿还借款本金', kind: 'text', placeholder: '例：判令被告偿还借款本金人民币 200,000 元。' },
      { key: 'interest', label: '2. 支付利息 / 逾期利息', kind: 'textarea', placeholder: '例：判令被告支付借期内利息及逾期利息（以 200,000 元为基数，自逾期之日起至实际清偿之日止，按合同成立时一年期 LPR 四倍/约定年利率计算，暂计 XX 元）。' },
      { key: 'security', label: '3. 担保权利主张', kind: 'radio_detail', options: ['不主张', '主张保证/抵押/质押责任'], defaultOption: '不主张', placeholder: '', detailPlaceholder: '写明保证人承担连带/一般保证责任，或对抵押物折价/拍卖变卖价款优先受偿' },
      { key: 'cost', label: '4. 实现债权费用', kind: 'text', placeholder: '如约定律师费、保全保险费（无约定可留空）' },
      { key: 'litigation_cost', label: '5. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费、保全费由被告承担。' },
      { key: 'legal_basis', label: '6. 请求权法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'agreement', label: '1. 借款合同 / 借条签订情况', kind: 'textarea', placeholder: '写明借款合同/借条签订时间、借款金额、借款用途、是否书面约定。' },
      { key: 'disbursement', label: '2. 借款交付时间与方式', kind: 'textarea', placeholder: '写明实际交付日期、交付金额及方式（银行转账/微信/支付宝/现金），是否预先扣除利息。' },
      { key: 'term_and_rate', label: '3. 借款期限与约定利率', kind: 'textarea', placeholder: '写明借款起止日期、约定月利率/年利率、逾期利率及违约金约定。' },
      { key: 'repayment', label: '4. 已还款本息情况', kind: 'textarea', placeholder: '逐笔写明被告已归还时间、金额，以及充抵利息/本金后的尚欠本息余额。' },
      { key: 'overdue_demand', label: '5. 逾期及催收情况', kind: 'textarea', placeholder: '写明到期未还事实及原告微信、短信、律师函催收记录。' },
      { key: 'guarantee', label: '6. 担保及共同借款情况', kind: 'radio_detail', options: ['无', '有'], defaultOption: '无', placeholder: '', detailPlaceholder: '写明担保人、保证方式、保证期间或抵押物登记情况' },
      { key: 'other_facts', label: '7. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'labor_dispute',
    title: '劳动争议纠纷',
    shortTitle: '劳动争议',
    category: '劳动家事与人损',
    badge: '最高法高频',
    docRef: '最高人民法院《民事起诉状（劳动争议纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国劳动法》《中华人民共和国劳动合同法》第三十条、第四十六条、第四十七条、第八十二条、第八十七条及《劳动争议调解仲裁法》等规定。',
    claimFields: [
      { key: 'unpaid_wage', label: '1. 欠付工资 / 加班费 / 年休假工资', kind: 'textarea', placeholder: '例：判令被告支付 2025 年 X 月至 X 月拖欠工资 XX 元、延时/休息日加班费 XX 元、未休年休假工资 XX 元。' },
      { key: 'double_wage', label: '2. 未签书面劳动合同二倍工资差额', kind: 'text', placeholder: '选填（写明起止月份及金额）' },
      { key: 'severance', label: '3. 经济补偿金 / 违法解除赔偿金（2N）', kind: 'textarea', placeholder: '例：判令被告支付违法解除劳动合同赔偿金人民币 XX 元（按 2N 计算）。' },
      { key: 'confirm_relation', label: '4. 确认劳动关系 / 补缴社保 / 办离职手续', kind: 'text', placeholder: '选填（如请求确认 X 年 X 月 X 日至 X 年 X 月 X 日存在劳动关系）' },
      { key: 'litigation_cost', label: '5. 诉讼费用负担', kind: 'text', placeholder: '本案诉讼费用由被告承担。' },
      { key: 'legal_basis', label: '6. 请求权法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'basic_employment', label: '1. 入职时间、岗位与工作地点', kind: 'textarea', placeholder: '写明入职日期、担任岗位、实际工作地点及所属部门。' },
      { key: 'contract_status', label: '2. 书面劳动合同签订情况', kind: 'radio_detail', options: ['已签订', '未签订'], defaultOption: '已签订', placeholder: '', detailPlaceholder: '写明合同起止期限及续签次数' },
      { key: 'salary_structure', label: '3. 工资标准及发放方式', kind: 'textarea', placeholder: '写明月工资构成、离职前 12 个月平均应发工资、发放周期及银行代发/微信发放方式。' },
      { key: 'social_insurance', label: '4. 社会保险缴纳情况', kind: 'radio_detail', options: ['已缴纳', '未缴纳', '未足额缴纳'], defaultOption: '已缴纳', placeholder: '', detailPlaceholder: '写明参保起止时间及欠缴情况' },
      { key: 'termination', label: '5. 劳动关系解除 / 终止情况', kind: 'textarea', placeholder: '写明离职时间、系用人单位辞退还是劳动者被迫解除、是否出具书面解除通知及理由。' },
      { key: 'arrears_calc', label: '6. 欠薪 / 加班 / 补偿金计算依据', kind: 'textarea', placeholder: '逐项列明起止时间、计薪基数及计算公式。' },
      { key: 'arbitration_info', label: '7. 劳动仲裁前置程序情况', kind: 'textarea', placeholder: '必填：写明仲裁委名称、仲裁案号、裁决书/不予受理通知书送达日期、裁决结果及原告不服的具体事项。' },
      { key: 'other_facts', label: '8. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'house_lease',
    title: '房屋租赁合同纠纷',
    shortTitle: '房屋租赁',
    category: '商事合同',
    badge: '最高法高频',
    docRef: '最高人民法院《民事起诉状（房屋租赁合同纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国民法典》第五百六十三条、第五百七十七条、第七百零三条、第七百二十一条、第七百二十二条等规定。',
    claimFields: [
      { key: 'rent_and_fee', label: '1. 支付欠付租金 / 占有使用费', kind: 'textarea', placeholder: '例：判令被告支付欠付租金 XX 元及逾期腾退期间的房屋占有使用费。' },
      { key: 'terminate_vacate', label: '2. 解除合同与腾退返还房屋', kind: 'radio_detail', options: ['不主张', '解除合同并腾退房屋'], defaultOption: '不主张', placeholder: '', detailPlaceholder: '写明确认合同于某日解除及返还房屋地址' },
      { key: 'deposit_and_penalty', label: '3. 押金处理 / 违约金 / 欠付水电物业费', kind: 'textarea', placeholder: '写明没收或退还押金金额、违约金及代垫水电物业费。' },
      { key: 'decoration', label: '4. 装饰装修损失 / 恢复原状', kind: 'text', placeholder: '选填（如无此项可留空）' },
      { key: 'litigation_cost', label: '5. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费、保全费由被告承担。' },
      { key: 'legal_basis', label: '6. 请求权法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'lease_contract', label: '1. 租赁合同签订与房屋概况', kind: 'textarea', placeholder: '写明合同签订日、租赁房屋坐落地址、建筑面积、规划用途及权属情况。' },
      { key: 'term_rent_deposit', label: '2. 租期、租金标准、押金及付款方式', kind: 'textarea', placeholder: '写明起止租期、免租期、月/季租金标准、递增比例、押金金额及交租日。' },
      { key: 'handover', label: '3. 房屋交付及使用情况', kind: 'textarea', placeholder: '写明交房日期、是否经过装修改造、是否存在转租情形。' },
      { key: 'breach_facts', label: '4. 欠租 / 擅自退租 / 违约事实', kind: 'textarea', placeholder: '写明欠付租金的具体期间、累计金额、催缴及发送《解除合同通知书》送达情况。' },
      { key: 'utilities_and_return', label: '5. 腾房交接与水电物业结算情况', kind: 'textarea', placeholder: '写明目前是否已交还钥匙及水电燃气物业费欠缴明细。' },
      { key: 'other_facts', label: '6. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'construction_contract',
    title: '建设工程施工合同纠纷',
    shortTitle: '建设工程',
    category: '商事合同',
    badge: '最高法高频',
    docRef: '最高人民法院《民事起诉状（建设工程施工合同纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国民法典》第七百八十八条、第七百九十九条、第八百零七条及《最高人民法院关于审理建设工程施工合同纠纷案件适用法律问题的解释（一）》等规定。',
    claimFields: [
      { key: 'project_payment', label: '1. 支付尚欠工程款及质保金', kind: 'textarea', placeholder: '例：判令被告支付尚欠工程款人民币 XX 元（含已到期质保金 XX 元）。' },
      { key: 'interest_penalty', label: '2. 逾期付款利息 / 停窝工损失', kind: 'textarea', placeholder: '写明逾期利息起算日、利率标准（LPR）及暂计金额。' },
      { key: 'priority_right', label: '3. 建设工程价款优先受偿权', kind: 'radio_detail', options: ['不主张', '主张优先受偿权'], defaultOption: '不主张', placeholder: '', detailPlaceholder: '写明在欠付工程款 XX 元范围内对涉案工程折价/拍卖价款享有优先受偿权（注意 18 个月除斥期间）' },
      { key: 'litigation_cost', label: '4. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费、鉴定费、保全费由被告承担。' },
      { key: 'legal_basis', label: '5. 请求权法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'contract_base', label: '1. 工程概况与合同签订', kind: 'textarea', placeholder: '写明项目名称、建设地点、承包范围、签订日期、是否经招投标、是否涉及转包/挂靠/分包。' },
      { key: 'price_mode', label: '2. 合同价款与计价方式', kind: 'textarea', placeholder: '写明固定总价/固定单价/据实结算、进度款支付比例、结算审计及质保金条款。' },
      { key: 'schedule_acceptance', label: '3. 工期、竣工验收及交付情况', kind: 'textarea', placeholder: '写明实际开工/竣工日期、竣工验收合格日期或发包人擅自使用日期。' },
      { key: 'settlement', label: '4. 工程款结算与已付明细', kind: 'textarea', placeholder: '写明送审/审定结算总价、变更签证金额、发包人已付款、开票及尚欠工程款余额。' },
      { key: 'priority_deadline', label: '5. 优先受偿权期限核验', kind: 'textarea', placeholder: '如主张优先受偿权，写明应当给付工程价款之日及起诉时未满 18 个月的事实依据。' },
      { key: 'other_facts', label: '6. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'traffic_accident',
    title: '机动车交通事故责任纠纷',
    shortTitle: '交通事故',
    category: '劳动家事与人损',
    badge: '最高法高频',
    docRef: '最高人民法院《民事起诉状（机动车交通事故责任纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国民法典》第一千一百七十九条、第一千二百零八条、第一千二百一十三条及《道路交通安全法》第七十六条等规定。',
    claimFields: [
      { key: 'medical_and_care', label: '1. 医疗费、住院伙食补助费、营养费、护理费', kind: 'textarea', placeholder: '逐项列出金额及计算明细。' },
      { key: 'lost_income_disability', label: '2. 误工费、残疾赔偿金、精神损害抚慰金', kind: 'textarea', placeholder: '写明误工天数/月收入、伤残等级、赔偿系数及具体金额。' },
      { key: 'property_and_other', label: '3. 交通费、鉴定费、车辆维修/财产损失等', kind: 'textarea', placeholder: '写明其他费用及合计赔偿总额。' },
      { key: 'insurer_order', label: '4. 保险公司赔付顺位要求', kind: 'textarea', placeholder: '例：判令被告保险公司先在交强险责任限额内赔付，不足部分在商业三者险限额内按责赔付，仍有不足由侵权人承担。' },
      { key: 'litigation_cost', label: '5. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费由被告承担。' },
      { key: 'legal_basis', label: '6. 请求权法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'accident_basic', label: '1. 事故发生时间、地点与经过', kind: 'textarea', placeholder: '写明事发时间、路段、肇事车牌号、驾驶人与受害人通行方式。' },
      { key: 'liability', label: '2. 交警部门责任认定情况', kind: 'textarea', placeholder: '写明交警队名称、事故认定书编号及各方责任比例（全责/主责/同责/次责）。' },
      { key: 'insurance', label: '3. 肇事车辆投保情况', kind: 'textarea', placeholder: '写明交强险及商业三者险承保保险公司、保单号、商业险保额及是否在保险期内。' },
      { key: 'injury_treatment', label: '4. 伤情救治与司法鉴定情况', kind: 'textarea', placeholder: '写明就诊医院、住院天数、出院诊断、司法鉴定机构及伤残等级/三期鉴定意见。' },
      { key: 'advance_payment', label: '5. 垫付情况与费用清单说明', kind: 'textarea', placeholder: '写明侵权人或保险公司已垫付金额及本次诉请扣减说明。' },
      { key: 'other_facts', label: '6. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'financial_loan',
    title: '金融借款合同纠纷',
    shortTitle: '金融借款',
    category: '金融借贷',
    badge: '最高法高频',
    docRef: '最高人民法院《民事起诉状（金融借款合同纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国民法典》第六百六十七条、第六百七十四条、第六百七十五条、第六百七十六条、第三百九十四条、第六百八十八条等规定。',
    claimFields: [
      { key: 'principal', label: '1. 偿还借款本金', kind: 'text', placeholder: '例：判令被告偿还借款本金人民币 XX 元。' },
      { key: 'interest_penalty', label: '2. 利息、罚息及复利', kind: 'textarea', placeholder: '写明截至暂计日的正常利息、逾期罚息、复利金额及此后计息标准。' },
      { key: 'early_maturity', label: '3. 是否主张宣布贷款提前到期 / 解除合同', kind: 'radio_detail', options: ['到期自然违约', '宣布提前到期'], defaultOption: '到期自然违约', placeholder: '', detailPlaceholder: '写明宣布提前到期的依据与通知日' },
      { key: 'collateral_guarantee', label: '4. 担保权利（抵押优先受偿 / 保证连带责任）', kind: 'textarea', placeholder: '写明抵押不动产证号或保证人连带清偿范围。' },
      { key: 'realization_cost', label: '5. 实现债权费用（律师费等）', kind: 'text', placeholder: '依据借款合同约定填写' },
      { key: 'litigation_cost', label: '6. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费、保全费由被告承担。' },
      { key: 'legal_basis', label: '7. 请求权法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'loan_contract', label: '1. 借款合同签订及放款情况', kind: 'textarea', placeholder: '写明合同编号、签订日、授信与实际放款日期及金额。' },
      { key: 'rate_and_term', label: '2. 借款期限、利率与还款方式', kind: 'textarea', placeholder: '写明起止日、LPR 加减点利率、罚息上浮比例及按月付息/等额本息方式。' },
      { key: 'overdue_detail', label: '3. 违约逾期与尚欠本息明细', kind: 'textarea', placeholder: '写明首次逾期日、累计逾期期数、已还本息及尚欠本金/利息/罚息/复利清单。' },
      { key: 'security_detail', label: '4. 抵押、质押及保证担保情况', kind: 'textarea', placeholder: '写明担保合同编号、担保物权属及他项权证登记情况、保证方式及期间。' },
      { key: 'other_facts', label: '5. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'property_service',
    title: '物业服务合同纠纷',
    shortTitle: '物业服务',
    category: '商事合同',
    badge: '最高法高频',
    docRef: '最高人民法院《民事起诉状（物业服务合同纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国民法典》第九百三十七条、第九百四十四条等规定。',
    claimFields: [
      { key: 'property_fee', label: '1. 支付欠付物业服务费', kind: 'textarea', placeholder: '例：判令被告支付 XX 年 X 月至 XX 年 X 月物业服务费共计 XX 元。' },
      { key: 'late_fee', label: '2. 违约金 / 逾期利息', kind: 'text', placeholder: '选填（写明合同依据及暂计金额）' },
      { key: 'litigation_cost', label: '3. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费由被告承担。' },
      { key: 'legal_basis', label: '4. 请求权法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'contract_base', label: '1. 物业服务合同签订情况', kind: 'textarea', placeholder: '写明前期物业合同或业委会物业服务合同签订时间、服务期限及备案情况。' },
      { key: 'property_info', label: '2. 涉案房屋信息与收费标准', kind: 'textarea', placeholder: '写明小区名称、房号、建筑面积、物业费单价（元/㎡/月）及公摊水电约定。' },
      { key: 'service_and_arrears', label: '3. 物业服务履行及欠费催缴情况', kind: 'textarea', placeholder: '写明原告履约情况、被告欠费起止时段、金额及书面/短信/律师函催缴经过。' },
      { key: 'other_facts', label: '4. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'online_shopping',
    title: '信息网络买卖合同纠纷',
    shortTitle: '网络购物',
    category: '知产与网络',
    badge: '互联网法院高频',
    docRef: '最高人民法院《民事起诉状（信息网络买卖合同纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国民法典》第五百七十七条、第六百一十七条及《消费者权益保护法》第五十五条、《食品安全法》第一百四十八条等规定。',
    claimFields: [
      { key: 'refund', label: '1. 退还货款 / 解除合同', kind: 'textarea', placeholder: '例：判令解除买卖合同，被告退还货款人民币 XX 元。' },
      { key: 'punitive_damage', label: '2. 惩罚性赔偿 / 违约损失（如退一赔三/十倍赔偿）', kind: 'textarea', placeholder: '选填（如主张欺诈三倍赔偿或食品安全十倍赔偿，写明金额及依据）' },
      { key: 'platform_liability', label: '3. 电商平台责任（如列平台为共同被告）', kind: 'text', placeholder: '选填（无平台被告可留空）' },
      { key: 'litigation_cost', label: '4. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费由被告承担。' },
      { key: 'legal_basis', label: '5. 请求权法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'order_info', label: '1. 网购平台、店铺与订单信息', kind: 'textarea', placeholder: '写明购物平台（淘宝/京东/抖音/拼多多等）、店铺名称、订单号、下单及付款时间、实付金额。' },
      { key: 'goods_and_receipt', label: '2. 商品名称、宣传承诺与签收情况', kind: 'textarea', placeholder: '写明商品详情页宣传内容、物流签收日期及收货地址。' },
      { key: 'defect_or_fraud', label: '3. 违约 / 假冒伪劣 / 虚假宣传事实', kind: 'textarea', placeholder: '写明商品存在质量瑕疵、货不对板、假冒或不符合安全标准的具体事实与检测证据。' },
      { key: 'after_sales', label: '4. 沟通退换货及平台投诉经过', kind: 'textarea', placeholder: '写明与客服沟通记录、平台介入处理结果。' },
      { key: 'other_facts', label: '5. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'copyright_infringement',
    title: '侵害著作权及邻接权纠纷',
    shortTitle: '著作权侵权',
    category: '知产与网络',
    badge: '最高法知产示范文本',
    docRef: '最高人民法院《民事起诉状（侵害著作权及邻接权纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国著作权法》第十条、第五十二条、第五十三条、第五十四条等规定。',
    claimFields: [
      { key: 'stop_infringement', label: '1. 停止侵害行为', kind: 'textarea', placeholder: '例：判令被告立即停止侵害原告对涉案作品享有的著作权（包括删除侵权内容、停止传播/销售等）。' },
      { key: 'damages', label: '2. 赔偿经济损失', kind: 'textarea', placeholder: '例：判令被告赔偿原告经济损失人民币 XX 元（写明按实际损失/违法所得/法定赔偿计算依据）。' },
      { key: 'reasonable_cost', label: '3. 维权合理开支', kind: 'text', placeholder: '例：判令被告赔偿原告为制止侵权支出的公证/时间戳取证费、律师费等合理开支共计 XX 元。' },
      { key: 'apology', label: '4. 赔礼道歉 / 消除影响', kind: 'radio_detail', options: ['不主张', '主张赔礼道歉/消除影响'], defaultOption: '不主张', placeholder: '', detailPlaceholder: '写明刊登声明平台与时长' },
      { key: 'litigation_cost', label: '5. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费由被告承担。' },
      { key: 'legal_basis', label: '6. 请求权法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'work_info', label: '1. 权利作品名称、类型与完成发表时间', kind: 'textarea', placeholder: '写明作品名称、作品类别（文字/美术/摄影/视听/软件等）、首次发表时间及版权登记号。' },
      { key: 'ownership_chain', label: '2. 原告权属及授权链条', kind: 'textarea', placeholder: '写明原告系原始著作权人还是专有/普通被许可人、授权范围、地域、期限及是否具有独立维权诉权。' },
      { key: 'infringement_act', label: '3. 被诉侵权行为与载体', kind: 'textarea', placeholder: '写明被告侵权方式（信息网络传播/复制发行/改编等）、侵权网站/App/账号/店铺及取证公证/可信时间戳编号。' },
      { key: 'comparison', label: '4. 作品比对与实质性相似说明', kind: 'textarea', placeholder: '简述被诉内容与权利作品相同或构成实质性相似的核心比对点。' },
      { key: 'damages_basis', label: '5. 索赔金额及合理开支计算依据', kind: 'textarea', placeholder: '写明作品知名度、侵权持续时间、播放/销量规模及公证/律师费票据情况。' },
      { key: 'other_facts', label: '6. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'divorce_dispute',
    title: '离婚纠纷',
    shortTitle: '离婚纠纷',
    category: '劳动家事与人损',
    badge: '最高法高频',
    docRef: '最高人民法院《民事起诉状（离婚纠纷）示范文本》',
    defaultLegalBasis: '《中华人民共和国民法典》第一千零七十九条、第一千零八十四条、第一千零八十五条、第一千零八十七条等规定。',
    claimFields: [
      { key: 'divorce', label: '1. 解除婚姻关系', kind: 'text', placeholder: '判令准予原告与被告离婚。' },
      { key: 'custody', label: '2. 子女抚养权与抚养费', kind: 'textarea', placeholder: '写明婚生子女姓名、出生年月、请求由何方直接抚养及另一方每月支付抚养费金额与探望方式（无子女填无）。' },
      { key: 'property_split', label: '3. 夫妻共同财产分割', kind: 'textarea', placeholder: '逐项写明房产、车辆、存款、股权/理财等共同财产清单及分割方案。' },
      { key: 'debt_split', label: '4. 夫妻共同债务处理', kind: 'text', placeholder: '写明共同债务金额及分担方式（无共同债务填无）。' },
      { key: 'compensation', label: '5. 离婚经济补偿 / 经济帮助 / 损害赔偿', kind: 'text', placeholder: '选填（如无此项请求可留空）' },
      { key: 'litigation_cost', label: '6. 诉讼费用负担', kind: 'text', placeholder: '本案诉讼费用由被告承担（或由双方依法分担）。' },
      { key: 'legal_basis', label: '7. 请求权法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'marriage_basic', label: '1. 婚姻关系基本情况', kind: 'textarea', placeholder: '写明结婚登记时间、登记机关、是否初婚、生育子女情况。' },
      { key: 'breakdown_reason', label: '2. 夫妻感情确已破裂的事实与理由', kind: 'textarea', placeholder: '写明感情不和原因、是否分居满二年、是否存在家暴/赌博/重婚/与他人同居等法定情形，以及此前是否起诉过离婚。' },
      { key: 'children_status', label: '3. 子女目前生活、学习及抚养条件', kind: 'textarea', placeholder: '写明子女目前随何方生活、学校及原告抚养优势（无子女填无）。' },
      { key: 'property_detail', label: '4. 夫妻共同财产及权属明细', kind: 'textarea', placeholder: '写明房产地址与登记人、车辆牌号、银行账户/股权/公积金等情况。' },
      { key: 'debt_detail', label: '5. 共同债务及家务补偿依据', kind: 'textarea', placeholder: '写明房贷或其他共同债务余额及用途（无则填无）。' },
      { key: 'other_facts', label: '6. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'administrative_action',
    docTitle: '行政起诉状',
    partyRoleLabels: ['原告', '被告（行政机关）'],
    signerLabel: '具状人（签字、盖章）',
    title: '行政处罚 / 行政行为行政诉讼',
    shortTitle: '行政起诉状',
    category: '行政与执行',
    badge: '最高法行政示范文本',
    docRef: '最高人民法院《行政起诉状（行政处罚/复议/履职/赔偿）示范文本》',
    defaultLegalBasis: '《中华人民共和国行政诉讼法》第十二条、第四十九条、第七十条、第七十四条及《中华人民共和国行政处罚法》《中华人民共和国行政复议法》等规定。',
    claimFields: [
      { key: 'admin_type', label: '1. 被诉行政行为类型', kind: 'radio_detail', options: ['撤销行政处罚/决定', '确认行政行为违法/无效', '判令履行法定职责', '撤销行政复议决定'], defaultOption: '撤销行政处罚/决定', placeholder: '', detailPlaceholder: '写明被诉决定书全称、文号及作出日期（如：撤销被告作出的 X 罚决字〔2026〕XX 号《行政处罚决定书》）' },
      { key: 'compensation', label: '2. 一并请求行政赔偿 / 补偿', kind: 'radio_detail', options: ['不主张', '一并主张行政赔偿/补偿'], defaultOption: '不主张', placeholder: '', detailPlaceholder: '写明赔偿金额及计算明细' },
      { key: 'normative_review', label: '3. 附带审查规范性文件', kind: 'radio_detail', options: ['无', '请求附带审查'], defaultOption: '无', placeholder: '', detailPlaceholder: '写明规范性文件名称、文号及违法条款' },
      { key: 'litigation_cost', label: '4. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费由被告承担。' },
      { key: 'legal_basis', label: '5. 法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'act_summary', label: '1. 被诉行政行为作出及送达情况', kind: 'textarea', placeholder: '写明作出机关、行政行为内容、文书编号及原告知道/收到该行政行为的确切日期。' },
      { key: 'reconsideration', label: '2. 是否经过行政复议（含 2024 新法复议前置核验）', kind: 'radio_detail', options: ['未经复议直诉', '经复议维持（列双被告）', '经复议改变（单列复议机关）'], defaultOption: '未经复议直诉', placeholder: '', detailPlaceholder: '如经复议，写明复议机关、复议决定书文号及收到复议决定书日期（确认在 15 日内起诉）' },
      { key: 'illegality_authority_proc', label: '3. 职权与法定程序违法要点', kind: 'textarea', placeholder: '写明被告是否超越职权、执法人员不足两人、未告知陈述申辩权/听证权、未依法送达或超期作出等程序违法事实。' },
      { key: 'illegality_fact_law', label: '4. 认定事实不清、主要证据不足及适用法律错误', kind: 'textarea', placeholder: '逐点反驳被诉决定认定的事实错误、证据瑕疵、法律条文适用不当或裁量明显不当。' },
      { key: 'standing_and_loss', label: '5. 原告利害关系与合法权益受损说明', kind: 'textarea', placeholder: '写明被诉行政行为如何直接侵害原告人身权、财产权或其他合法权益。' },
      { key: 'other_facts', label: '6. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
  {
    id: 'enforcement_application',
    docTitle: '强制执行申请书',
    partyRoleLabels: ['申请执行人', '被执行人'],
    signerLabel: '申请执行人（签字、盖章）',
    title: '强制执行申请（生效裁判/仲裁/公证）',
    shortTitle: '强制执行申请',
    category: '行政与执行',
    badge: '最高法执行示范文本',
    docRef: '最高人民法院《强制执行申请书（要素式）示范文本》',
    defaultLegalBasis: '《中华人民共和国民事诉讼法》第二百四十七条、第二百五十条、第二百六十四条及《最高人民法院关于人民法院执行工作若干问题的规定（试行）》等规定。',
    claimFields: [
      { key: 'exec_principal', label: '1. 申请执行本金及生效文书确定款项', kind: 'textarea', placeholder: '例：请求依法强制被执行人向申请执行人支付本金 XX 元、律师费 XX 元、案件受理费/保全费 XX 元。' },
      { key: 'exec_interest', label: '2. 一般债务利息及加倍迟延履行金（日万分之1.75）', kind: 'textarea', placeholder: '例：请求强制执行一般债务利息 XX 元，以及自履行期限届满次日起至实际清偿日止按日万分之 1.75 计算的加倍部分债务利息。' },
      { key: 'exec_behavior', label: '3. 行为执行 / 交付标的物 / 腾退房屋', kind: 'text', placeholder: '选填（如腾退交房、办理过户、停止侵权等非金钱给付义务）' },
      { key: 'exec_measures', label: '4. 申请采取的执行与惩戒措施', kind: 'radio_detail', options: ['常规查控扣划', '查控+限高+纳入失信名单'], defaultOption: '查控+限高+纳入失信名单', placeholder: '', detailPlaceholder: '写明对被执行人及其法定代表人采取限制高消费、纳入失信名单或评估拍卖已保全财产' },
      { key: 'exec_fee', label: '5. 执行费负担', kind: 'text', placeholder: '本案执行费用由被执行人承担。' },
      { key: 'legal_basis', label: '6. 法律依据', kind: 'textarea', placeholder: '写明法律依据' },
    ],
    factFields: [
      { key: 'basis_doc', label: '1. 执行依据文书名称、案号及生效日期', kind: 'textarea', placeholder: '必填：写明作出法院/仲裁委/公证处名称、裁判文书案号、主文确定的履行期限届满日及生效证明日期。' },
      { key: 'performance_status', label: '2. 被执行人履行情况及 2 年执行时效核验', kind: 'textarea', placeholder: '写明是否已履行部分款项、尚欠执行标的总额，确认未超过 2 年申请执行时效。' },
      { key: 'preservation_status', label: '3. 诉前/诉中财产保全查封冻结情况', kind: 'radio_detail', options: ['无保全', '已有诉中/诉前保全'], defaultOption: '无保全', placeholder: '', detailPlaceholder: '写明保全裁定案号、已冻结账户/查封房产及续封到期日（防止超期解封！）' },
      { key: 'asset_clues', label: '4. 已掌握的被执行人财产线索', kind: 'textarea', placeholder: '列明开户银行及账号、不动产坐落、车辆牌号、对外投资股权、应收债权、微信/支付宝收款账户等线索。' },
      { key: 'receive_account', label: '5. 申请执行人收款账户信息（法院案款直付）', kind: 'textarea', placeholder: '写明户名、开户行及银行账号（确保与申请执行人主体一致）。' },
      { key: 'other_facts', label: '6. 其他需要说明的内容', kind: 'textarea', placeholder: '选填（如是否需同步申请律师调查令或追加股东/配偶线索提示）' },
    ],
  },
  {
    id: 'general_civil',
    title: '通用民商事纠纷（自定义案由）',
    shortTitle: '通用民商事',
    category: '通用兜底',
    badge: '全案由万用版',
    docRef: '参照最高人民法院《部分案件民事起诉状示范文本》通用表格结构',
    defaultLegalBasis: '《中华人民共和国民法典》《中华人民共和国民事诉讼法》等相关法律规定。',
    claimFields: [
      { key: 'main_claim', label: '1. 核心给付 / 确认 / 变更诉讼请求', kind: 'textarea', placeholder: '逐项清晰列明主要诉讼请求（金额精确到分，或明确具体履行行为）。' },
      { key: 'interest_or_penalty', label: '2. 违约金 / 逾期利息 / 损失赔偿', kind: 'textarea', placeholder: '写明基数、起算时间、利率标准及暂计金额（如无留空）。' },
      { key: 'auxiliary_claim', label: '3. 解除合同 / 担保责任 / 实现债权费用', kind: 'textarea', placeholder: '选填（如律师费、保证责任等）' },
      { key: 'litigation_cost', label: '4. 诉讼费用负担', kind: 'text', placeholder: '本案案件受理费、保全费由被告承担。' },
      { key: 'legal_basis', label: '5. 请求权法律依据', kind: 'textarea', placeholder: '写明合同条款及法律依据' },
    ],
    factFields: [
      { key: 'legal_relationship', label: '1. 法律关系形成背景（合同/交易/侵权发生经过）', kind: 'textarea', placeholder: '写明双方建立法律关系的时间、合同名称或事件背景。' },
      { key: 'key_terms', label: '2. 核心权利义务约定（或法定要件）', kind: 'textarea', placeholder: '写明合同标的、价款、履行期限、违约责任等关键约定。' },
      { key: 'performance', label: '3. 己方履行情况', kind: 'textarea', placeholder: '写明原告已全面履行己方义务的具体事实与凭证。' },
      { key: 'breach_or_tort', label: '4. 对方违约 / 侵权事实及损害后果', kind: 'textarea', placeholder: '写明被告违约或侵权的具体行为、造成损失及因果关系。' },
      { key: 'demand_and_calc', label: '5. 催告协商经过及金额计算明细', kind: 'textarea', placeholder: '写明诉前催告、律师函、对账记录及各项诉请金额算式。' },
      { key: 'other_facts', label: '6. 其他需要说明的内容', kind: 'textarea', placeholder: '选填' },
    ],
  },
];

export function createInitialComplaintDraft(templateId = 'sales_contract'): ComplaintDraftState {
  const tpl =
    ELEMENTS_COMPLAINT_TEMPLATES.find((t) => t.id === templateId) ||
    ELEMENTS_COMPLAINT_TEMPLATES[0];

  const claims: Record<string, string> = {
    litigation_cost:
      tpl.id === 'administrative_action'
        ? '本案案件受理费由被告承担。'
        : '本案案件受理费、保全费由被告承担。',
    ...(tpl.id === 'enforcement_application' ? { exec_fee: '本案执行费用由被执行人承担。' } : {}),
    legal_basis: tpl.defaultLegalBasis,
  };
  const claimChoices: Record<string, string> = {};
  for (const f of tpl.claimFields) {
    if (f.defaultOption) claimChoices[f.key] = f.defaultOption;
  }

  const factChoices: Record<string, string> = {};
  for (const f of tpl.factFields) {
    if (f.defaultOption) factChoices[f.key] = f.defaultOption;
  }

  return {
    templateId: tpl.id,
    customCause: '',
    courtName: '',
    plaintiffs: [createEmptyParty('org')],
    agent: {
      enabled: false,
      name: '',
      firm: '',
      licenseNo: '',
      phone: '',
      authority: '特别授权',
    },
    defendants: [createEmptyParty('org')],
    thirdPartyEnabled: false,
    thirdParty: createEmptyParty('org'),
    serviceAddress: '',
    serviceRecipient: '',
    servicePhone: '',
    electronicService: '同意',
    electronicMethod: '短信 / 微信 / 人民法院在线服务平台',
    claims,
    claimChoices,
    hasJurisdictionAgreement: '无',
    jurisdictionDetail: '',
    hasPrePreservation: '否',
    prePreservationDetail: '',
    applyPreservation: '否',
    preservationDetail: '',
    facts: {},
    factChoices,
    evidenceSummary: '',
    mediationKnow: '了解',
    mediationAgree: '是',
    signerName: '',
    signDate: getTodayChinaDateCn(),
  };
}

export function formatCheckboxOptions(options: string[], selected: string): string {
  return options.map((opt) => `${opt === selected ? '☑' : '☐'} ${opt}`).join('   ');
}

function formatPartyText(p: PartyEntity, isDefendant = false): string {
  const emptyOpt = isDefendant ? '不详' : '—';
  const emptyReq = isDefendant ? '不详' : '________';
  if (p.kind === 'person') {
    const lines = [
      `姓名：${p.name.trim() || emptyReq}   性别：${p.gender.trim() || emptyOpt}   出生日期：${p.birthDate.trim() || emptyOpt}   民族：${p.ethnicity.trim() || '汉族'}`,
      `工作单位：${p.workUnit.trim() || emptyOpt}   职务：${p.jobTitle.trim() || emptyOpt}   联系电话：${p.phone.trim() || emptyOpt}`,
      `住所地（户籍所在地）：${p.domicile.trim() || emptyReq}`,
      `经常居住地：${p.residence.trim() || p.domicile.trim() || emptyOpt}`,
      `公民身份号码：${p.idNumber.trim() || emptyOpt}`,
    ];
    return lines.join('\n');
  }
  const nature = p.ownershipNature?.trim()
    ? `   所有制性质：${formatCheckboxOptions(['国有', '民营', '外资'], p.ownershipNature.trim())}`
    : '';
  const lines = [
    `名称：${p.name.trim() || emptyReq}`,
    `住所地（主要办事机构所在地）：${p.domicile.trim() || emptyReq}`,
    `注册地 / 登记地：${p.regAddress.trim() || p.domicile.trim() || emptyOpt}`,
    `法定代表人 / 主要负责人：${p.legalRep.trim() || emptyOpt}   职务：${p.repTitle.trim() || '法定代表人'}   联系电话：${p.phone.trim() || emptyOpt}`,
    `统一社会信用代码：${p.creditCode.trim() || emptyOpt}`,
    `类型：${p.orgType.trim() || '有限责任公司'}${nature}`,
  ];
  return lines.join('\n');
}

export function getResolvedCauseTitle(tpl: ComplaintTemplateDef, draft: ComplaintDraftState): string {
  if (tpl.id === 'general_civil' && draft.customCause.trim()) {
    return draft.customCause.trim();
  }
  return tpl.title;
}

/**
 * Generates canonical SPC element-style complaint table sections.
 * Shared verbatim by live A4 preview, plain-text copy, and .docx Word export.
 */
export function buildComplaintSections(
  tpl: ComplaintTemplateDef,
  draft: ComplaintDraftState
): RenderedComplaintSection[] {
  const partyRows: RenderedTableRow[] = [];

  const [plaintiffRoleLabel, defendantRoleLabel] = tpl.partyRoleLabels || ['原告', '被告'];

  draft.plaintiffs.forEach((p, idx) => {
    const num = draft.plaintiffs.length > 1 ? String(idx + 1) : '';
    const suffix = p.kind === 'person' ? '（自然人）' : '（法人、非法人组织）';
    partyRows.push({
      label: `${plaintiffRoleLabel}${num}${suffix}`,
      value: formatPartyText(p),
    });
  });

  if (draft.agent.enabled) {
    const licPart = draft.agent.licenseNo?.trim()
      ? `   执业证号：${draft.agent.licenseNo.trim()}`
      : '';
    partyRows.push({
      label: '委托诉讼代理人',
      value: [
        formatCheckboxOptions(['有', '无'], '有'),
        `姓名：${draft.agent.name.trim() || '________'}   单位：${draft.agent.firm.trim() || '________'}${licPart}`,
        `联系电话：${draft.agent.phone.trim() || '________'}   代理权限：${formatCheckboxOptions(['一般授权', '特别授权'], draft.agent.authority)}`,
      ].join('\n'),
    });
  } else {
    partyRows.push({
      label: '委托诉讼代理人',
      value: formatCheckboxOptions(['有', '无'], '无'),
    });
  }

  partyRows.push({
    label: '送达地址（所填信息除书面特别声明更改外，适用于案件一审、二审、再审所有后续程序）及电子送达',
    value: [
      `送达地址：${draft.serviceAddress.trim() || draft.plaintiffs[0]?.domicile.trim() || '________'}`,
      `收件人：${draft.serviceRecipient.trim() || draft.agent.name.trim() || draft.plaintiffs[0]?.name.trim() || '________'}   联系电话：${draft.servicePhone.trim() || draft.agent.phone.trim() || draft.plaintiffs[0]?.phone.trim() || '________'}`,
      `是否接受电子送达：${formatCheckboxOptions(['是', '否'], draft.electronicService === '同意' ? '是' : '否')}${draft.electronicService === '同意' && draft.electronicMethod.trim() ? `（方式：${draft.electronicMethod.trim()}）` : ''}`,
    ].join('\n'),
  });

  draft.defendants.forEach((d, idx) => {
    const num = draft.defendants.length > 1 ? String(idx + 1) : '';
    const suffix = d.kind === 'person' ? '（自然人）' : '（法人、非法人组织）';
    partyRows.push({
      label: `${defendantRoleLabel}${num}${suffix}`,
      value: formatPartyText(d, true),
    });
  });

  if (draft.thirdPartyEnabled) {
    const suffix = draft.thirdParty.kind === 'person' ? '（自然人）' : '（法人、非法人组织）';
    partyRows.push({
      label: `第三人${suffix}`,
      value: formatPartyText(draft.thirdParty, true),
    });
  }

  const formatFieldRow = (
    f: ElementFieldDef,
    values: Record<string, string>,
    choices: Record<string, string>
  ): RenderedTableRow => {
    const textVal = (values[f.key] || '').trim();
    if (f.kind === 'radio' && f.options) {
      return {
        label: f.label,
        value: formatCheckboxOptions(f.options, choices[f.key] || f.defaultOption || f.options[0]),
      };
    }
    if (f.kind === 'radio_detail' && f.options) {
      const selected = choices[f.key] || f.defaultOption || f.options[0];
      const checkLine = formatCheckboxOptions(f.options, selected);
      return {
        label: f.label,
        value: textVal ? `${checkLine}\n具体说明：${textVal}` : checkLine,
      };
    }
    return {
      label: f.label,
      value: textVal || '无',
    };
  };

  const claimRows = tpl.claimFields.map((f) => formatFieldRow(f, draft.claims, draft.claimChoices));

  const jurisdictionRows: RenderedTableRow[] = [
    {
      label: '1. 有无仲裁、法院管辖约定',
      value:
        formatCheckboxOptions(['有', '无'], draft.hasJurisdictionAgreement) +
        (draft.hasJurisdictionAgreement === '有' && draft.jurisdictionDetail.trim()
          ? `\n合同条款及内容：${draft.jurisdictionDetail.trim()}`
          : ''),
    },
    {
      label: '2. 是否已申请诉前财产保全',
      value:
        formatCheckboxOptions(['是', '否'], draft.hasPrePreservation) +
        (draft.hasPrePreservation === '是' && draft.prePreservationDetail.trim()
          ? `\n保全法院及文号：${draft.prePreservationDetail.trim()}`
          : ''),
    },
    {
      label: '3. 是否申请诉讼财产保全',
      value:
        formatCheckboxOptions(['是', '否'], draft.applyPreservation) +
        (draft.applyPreservation === '是' && draft.preservationDetail.trim()
          ? `\n拟保全标的及财产线索：${draft.preservationDetail.trim()}`
          : ''),
    },
  ];

  const factRows = tpl.factFields.map((f) => formatFieldRow(f, draft.facts, draft.factChoices));
  factRows.push({
    label: `${tpl.factFields.length + 1}. 证据清单（可另附）`,
    value: (draft.evidenceSummary || '').trim() || '详见另附《证据目录》及证据材料复印件。',
  });

  const normalizedMediationAgree =
    draft.mediationAgree === '同意'
      ? '是'
      : draft.mediationAgree === '不同意'
      ? '否'
      : draft.mediationAgree || '是';

  const mediationRows: RenderedTableRow[] = [
    {
      label: '了解调解作为非诉讼纠纷解决方式，能及时、高效、低成本、不伤和气地解决纠纷',
      value: formatCheckboxOptions(['了解', '不了解'], draft.mediationKnow),
    },
    {
      label: '是否考虑先行调解',
      value: formatCheckboxOptions(
        ['是', '否', '暂不确定，想要了解更多'],
        normalizedMediationAgree
      ),
    },
  ];

  const isEnforcement = tpl.id === 'enforcement_application';
  return [
    { title: '一、当事人信息', rows: partyRows },
    { title: isEnforcement ? '二、执行请求和依据' : '二、诉讼请求和依据', rows: claimRows },
    { title: isEnforcement ? '三、管辖与既有保全衔接' : '三、约定管辖和诉讼保全', rows: jurisdictionRows },
    { title: '四、事实和理由', rows: factRows },
    { title: isEnforcement ? '五、对执行和解方式的意愿' : '五、对纠纷解决方式的意愿', rows: mediationRows },
  ];
}

export function buildComplaintPlainText(
  tpl: ComplaintTemplateDef,
  draft: ComplaintDraftState
): string {
  const causeTitle = getResolvedCauseTitle(tpl, draft);
  const sections = buildComplaintSections(tpl, draft);
  const docTitle = tpl.docTitle || '民事起诉状';
  const signerLabel = tpl.signerLabel || '具状人（签字、盖章）';
  const lines: string[] = [
    docTitle,
    `（${causeTitle}）`,
    '',
  ];
  if (draft.courtName.trim()) {
    lines.push(`此致 ${draft.courtName.trim()}`, '');
  }
  for (const sec of sections) {
    lines.push(`【${sec.title}】`);
    for (const row of sec.rows) {
      lines.push(`${row.label}：`);
      lines.push(row.value);
      lines.push('');
    }
  }
  lines.push(`${signerLabel}：${draft.signerName.trim()}`);
  lines.push(`日期：${draft.signDate || getTodayChinaDateCn()}`);
  return lines.join('\n').trim();
}
