import type { AiSpecialistId, OfflineToolId, ToolCategoryCode } from '../types/toolbox';

export interface OfflineToolMeta {
  id: OfflineToolId;
  code: string;
  category: ToolCategoryCode;
  title: string;
  shortTitle: string;
  kicker: string;
  desc: string;
  sourceTag: '官网升级' | '律师新增';
  iconName: string;
  keywords: string[];
  aiTarget?: AiSpecialistId;
}

export const TOOL_CATEGORIES_META: {
  id: ToolCategoryCode;
  title: string;
  en: string;
  subtitle: string;
}[] = [
  {
    id: 'pleading_lit',
    title: '要素式诉状与立案起草',
    en: 'PLEADING & FILING',
    subtitle: '对照最高人民法院表格化、要素式示范文本，支持上传传统诉状 AI 一键提取转换、离线填表与真 Word (.docx) 导出。',
  },
  {
    id: 'civil_exec',
    title: '民商事、收费与执行',
    en: 'LITIGATION, FEES & ENFORCEMENT',
    subtitle: '诉讼费、律师费合规报价、LPR 分段计息、第 561 条债之冲抵、审限及保全续封预警。',
  },
  {
    id: 'labor_injury',
    title: '劳动争议与工伤人损',
    en: 'LABOR & PERSONAL INJURY',
    subtitle: '浙江及杭州最新口径经济补偿金、双倍工资、工伤基金/单位拆分及道交人损测算。',
  },
  {
    id: 'privacy_doc',
    title: '保密脱敏、证据 PDF 与会见速记',
    en: 'PRIVACY, EVIDENCE & FIELD NOTES',
    subtitle: '100% 本地零上传：案件隐私一键脱敏/还原、50MB+ 证据 PDF 自动分卷与页码水印、现场结构化速记。',
  },
];

export const OFFLINE_TOOLS_REGISTRY: OfflineToolMeta[] = [
  {
    id: 'elements-complaint',
    code: '01',
    category: 'pleading_lit',
    title: '要素式起诉状与申请书一键生成（最高法示范文本）',
    shortTitle: '要素式诉状',
    kicker: '14类民事/行政/执行 · AI转写 · 导出Word',
    desc: '对照最高人民法院 2025 全面推广表格化要素式示范文本，覆盖买卖/借贷/劳动/租赁/建工/道交/金融/物业/网购/著作权/离婚/行政诉讼/强制执行及通用民商事；支持上传传统诉状 AI 一键转写与立案退件预警核验，或离线勾选填写，一键导出法院提交级真 Word (.docx) 与 A4 PDF。',
    sourceTag: '律师新增',
    iconName: 'FileSpreadsheet',
    keywords: ['要素式', '起诉状', '示范文本', '最高法', '行政起诉状', '强制执行申请书', '表格', '立案', 'docx', 'Word', '买卖', '民间借贷', '劳动争议'],
    aiTarget: 'de-ai-polish',
  },
  {
    id: 'litigation-fee-calculator',
    code: '02',
    category: 'civil_exec',
    title: '诉讼费与诉讼全成本计算器',
    shortTitle: '诉讼费计算',
    kicker: '受理费 · 保全费 · 执行费',
    desc: '依据《诉讼费用交纳办法》，一单测算一审、简易减半、财产保全费、二审与执行费，联动律师费报价。',
    sourceTag: '官网升级',
    iconName: 'Calculator',
    keywords: ['诉讼费', '保全费', '执行费', '减半', '受理费'],
    aiTarget: 'client-wechat-reply',
  },
  {
    id: 'lawyer-fee-quote',
    code: '03',
    category: 'civil_exec',
    title: '律师费标准与客户报价单（全国31省）',
    shortTitle: '律师费与报价单',
    kicker: '31省标准 · 多方案A4报价 · 批量维权',
    desc: '内置全国 31 省 A/B 级核验标准与自定义落款模板，支持常规/半风险/全风险跳档/计时/知产批量维权测算、可现场点字改价的 A4 客户报价单、工时合理开支测算单与全国对比。',
    sourceTag: '律师新增',
    iconName: 'BadgeDollarSign',
    keywords: ['律师费', '报价', '报价单', '31省', '本所标准', '风险代理', '批量维权', '合理开支', '工时', '对比', '18%'],
    aiTarget: 'client-wechat-reply',
  },
  {
    id: 'lpr-interest-calculator',
    code: '04',
    category: 'civil_exec',
    title: 'LPR 逾期付款利息与迟延履行金计算器',
    shortTitle: 'LPR与迟延金',
    kicker: '2019–2026完整LPR分段',
    desc: '内置央行完整 1年/5年期 LPR 历史表，自动按调息日分段拆算逾期利息及日万分之 1.75 加倍迟延履行金。',
    sourceTag: '官网升级',
    iconName: 'Percent',
    keywords: ['LPR', '利息', '逾期', '迟延履行', '1.75', '违约金'],
    aiTarget: 'timeline-elements',
  },
  {
    id: 'rmb-debt-offset',
    code: '05',
    category: 'civil_exec',
    title: '文书金额大写 & 第561条债之冲抵计算器',
    shortTitle: '大写与债冲抵',
    kicker: '财务大写 · 先息后本冲抵',
    desc: '标准法院文书人民币大写转换、多笔赔偿维权开支累加，以及《民法典》第561条（费用→利息→本金）多期还款冲抵表。',
    sourceTag: '律师新增',
    iconName: 'Coins',
    keywords: ['大写', '人民币', '561', '冲抵', '先息后本', '还款'],
  },
  {
    id: 'date-calculator',
    code: '06',
    category: 'civil_exec',
    title: '法律期间与诉讼时效速算器',
    shortTitle: '期间与时效',
    kicker: '节假日顺延 · 黄金37天',
    desc: '内置 2025–2026 法定节假日与调休安排，按《民法典》第203条自动顺延届满日，一键写入手机系统日历。',
    sourceTag: '官网升级',
    iconName: 'CalendarDays',
    keywords: ['期间', '上诉期', '15天', '37天', '诉讼时效', '举证期', '节假日'],
  },
  {
    id: 'preservation-deadline',
    code: '07',
    category: 'civil_exec',
    title: '财产保全续封与执行期限预警看板',
    shortTitle: '保全续封预警',
    kicker: '账户1年 · 动产2年 · 不动产3年',
    desc: '精准核算银行冻结、动产、不动产/股权查封到期日及提前 30 日续封红线，保存台账并导出手机 .ics 闹钟。',
    sourceTag: '律师新增',
    iconName: 'BellRing',
    keywords: ['保全', '查封', '冻结', '续封', '执行', '闹钟', 'ics'],
  },
  {
    id: 'labor-compensation',
    code: '08',
    category: 'labor_injury',
    title: '劳动争议经济补偿金测算器（杭州口径）',
    shortTitle: '劳动补偿金',
    kicker: 'N / N+1 / 2N · 三倍社平封顶',
    desc: '测算经济补偿金、代通知金、违法解除 2N 与未签合同双倍工资，自动识别浙江 2026 三倍社平封顶规则。',
    sourceTag: '官网升级',
    iconName: 'Briefcase',
    keywords: ['劳动', '经济补偿', '2N', 'N+1', '双倍工资', '辞退', '裁员'],
    aiTarget: 'client-wechat-reply',
  },
  {
    id: 'injury-compensation',
    code: '09',
    category: 'labor_injury',
    title: '工伤与人身损害赔偿计算器（浙江2026）',
    shortTitle: '工伤与人损',
    kicker: '浙人社发〔2026〕52号口径',
    desc: '清晰拆分浙江工伤社保基金支付与单位自付金额，同步支持交通事故人身损害城乡统一标准与责任比例折算。',
    sourceTag: '官网升级',
    iconName: 'HardHat',
    keywords: ['工伤', '人身损害', '伤残', '交通事故', '一次性伤残', '医疗费'],
    aiTarget: 'client-wechat-reply',
  },
  {
    id: 'local-redactor',
    code: '10',
    category: 'privacy_doc',
    title: '本地案件材料一键脱敏与还原器',
    shortTitle: '案件隐私脱敏',
    kicker: 'AI前置安全盾 · 零上传',
    desc: '100% 手机本地识别替换当事人姓名、公司全称、身份证、信用代码、手机、银行卡与案号，AI 生成后一键反向还原。',
    sourceTag: '律师新增',
    iconName: 'ShieldAlert',
    keywords: ['脱敏', '匿名', '隐私', '保密', '还原', '身份证'],
    aiTarget: 'contract-review',
  },
  {
    id: 'evidence-pdf-toolkit',
    code: '11',
    category: 'privacy_doc',
    title: '律所保密证据 PDF 工具箱（本地零上传）',
    shortTitle: '证据PDF工具',
    kicker: '支持50MB+大卷宗 · 自动分卷 · 页码水印',
    desc: '100% 浏览器本地处理：支持 50MB+ 大卷宗合并与截图压缩，可按 10MB（法院网上立案）或 50MB（仲裁/大卷宗）一键自动分卷拆分，并加盖连续证据页码与举证水印。',
    sourceTag: '官网升级',
    iconName: 'Layers',
    keywords: ['PDF', '证据', '合并', '压缩', '50MB', '分卷', '页码', '水印', '拆分'],
  },
  {
    id: 'meeting-scratchpad',
    code: '12',
    category: 'privacy_doc',
    title: '会见 / 庭审 / 咨询结构化速记板',
    shortTitle: '办案结构速记',
    kicker: '计时防丢 · 一键转AI纪要',
    desc: '看守所会见、法庭庭审或客户面谈时按「核心事实/争议焦点/待补证据/待办事项」分栏离线速记，防切后台丢失。',
    sourceTag: '律师新增',
    iconName: 'NotebookPen',
    keywords: ['速记', '会见', '笔录', '庭审', '咨询', '看守所', '笔记'],
    aiTarget: 'client-wechat-reply',
  },
];

export interface AiSpecialistMeta {
  id: AiSpecialistId;
  code: string;
  title: string;
  shortTitle: string;
  badge: string;
  recommendedSlot: 'fast' | 'reasoning';
  desc: string;
  placeholder: string;
  systemPrompt: string;
  presetOptions?: { label: string; value: string }[];
}

export const AI_SPECIALISTS_REGISTRY: AiSpecialistMeta[] = [
  {
    id: 'contract-review',
    code: 'AI-01',
    title: 'AI 合同风险快审与示范条款改写',
    shortTitle: '合同快审',
    badge: '支持本地传 .docx',
    recommendedSlot: 'reasoning',
    desc: '站在委托人立场逐条排查致命商业与法律风险，直接给出可复制替换的中文示范修改条款及漏项补充条款。',
    placeholder:
      '请粘贴待审合同全文或核心条款（或点击上方“导入本地 .docx/.txt”按钮直接选手机里的合同文件）…',
    presetOptions: [
      { label: '审查立场：通用甲方（付款/委托/采购方）', value: '代表甲方（委托方/采购方/出资方），重点防范交付缩水、验收流于形式、违约责任不对等及解约退出困难。' },
      { label: '审查立场：通用乙方（服务/承制/收款方）', value: '代表乙方（服务提供方/收款方/供货方），重点锁定验收标准闭环（逾期视为验收合格）、付款节点、责任上限封顶及防止无限连带赔偿。' },
      { label: '商事高频：公司股权转让 / 增资与股东协议', value: '依据新《公司法》及民法典合同编，重点审查出资实缴与未届期股权转让连带责任、交割先决条件、陈述保证与债务兜底、对赌回购触发口径及公司治理表决权安排。' },
      { label: '商事高频：建设工程施工 / 装饰装修 / 承揽合同', value: '重点审查资质与转分包效力红线、工程价款计价方式（固定总价/单价）、变更签证确认时限、竣工验收与结算期限、质保金返还及工程价款优先受偿权保护。' },
      { label: '常法专项：企业劳动用工 / 保密竞业协议', value: '依据《劳动合同法》及浙江司法实践，排查违法约定试用期、调岗降薪依据缺失、竞业限制补偿金标准及违约金过高风险。' },
    ],
    systemPrompt: `你是资深中国商事与知识产权合同审查律师助手。请严格遵循以下中国法律实务规则审查用户提交的合同文本：
1. 【事实与法源边界】仅基于用户提供的合同文本和现行有效的中国法律（《民法典》及合同编通则司法解释、《著作权法》《公司法》《劳动合同法》等）进行分析。严禁捏造任何不存在的法条条文序号、司法解释文号或裁判案号；若不确定具体条号，只表述法律规则本身并标注“[条号待核对]”。
2. 【保留代号】若文本中包含脱敏占位符（如 [公司主体A]、[当事人甲]），请在输出与修改条款中严格原样保留该占位符，以便系统自动本地还原。
3. 【输出结构（简洁有力、杜绝空话套话）】
   - **一、整体风险评级与致命红线摘要**（不超过 4 条，直击最可能导致败诉或资金打水漂的硬伤）；
   - **二、核心风险条款逐条批注与替换示范**（每项按「原条款位置/摘要」→「法律与实务风险点」→「**建议直接替换的修改条款原文**」输出，示范条款必须具备可直接粘贴进正式合同的严谨法言法语）；
   - **三、关键缺失条款补强建议**（如管辖约定、送达地址确认、违约方承担律师费/公证取证费条款等）。`,
  },
  {
    id: 'de-ai-polish',
    code: 'AI-02',
    title: '法律文书「去 AI 味」资深律师笔法改稿',
    shortTitle: '文书去AI味',
    badge: '法院提交级文风',
    recommendedSlot: 'fast',
    desc: '消除“综上所述、值得注意的是、赋能、闭环、不仅…而且”等浓重 AI 翻译腔，改为冷峻克制的中国诉讼律师实务笔法。',
    placeholder:
      '请粘贴需要润色改稿的起诉状、答辩状、代理词、质证意见、律师函或法律意见书初稿…',
    presetOptions: [
      { label: '文书类型：民事/知产《代理词 / 答辩状》', value: '法院提交版诉讼文书：句式短促、逻辑锋利、围绕要件事实与证据链层层递进，彻底删掉情绪化形容词与空洞排比。' },
      { label: '文书类型：《律师函 / 侵权警告函》', value: '正式对外律师函：事实陈述克制精准，限期整改/停止侵权要求明确具体，严正告知法律后果但不使用虚张声势的网文词汇。' },
      { label: '文书类型：企业常法《法律咨询意见书》', value: '致企业管理层的商业法律意见：先给明确结论与可执行动作，再分述法律依据与风控备选方案。' },
    ],
    systemPrompt: `你是一位执业十五年以上的中国资深出庭诉讼律师，专责对法律文书初稿进行「去 AI 味（De-AI）」实务改稿。
必须严格遵守以下铁律：
1. 【零虚构铁律】绝对不得增删、篡改原文中的任何案件事实、日期、金额、主体代号（如 [公司主体A]）、证据名称或法律结论；严禁自行补充原文未提及的法条序号或案例号。
2. 【彻底清除 AI 腔与公文废话】
   - 禁用词清单：“值得注意的是”、“需要指出的是”、“不难发现”、“显而易见”、“综上所述（非结尾总结处滥用）”、“赋能”、“抓手”、“闭环”、“底层逻辑”、“维度”、“不仅如此…更…”、“一方面…另一方面…（机械套用）”、“严重践踏了法律尊严”等空泛修辞。
   - 改写准则：主谓宾清晰，多用主动语态与中国法院判决书/资深律师习惯用语（如“在案证据足以证明”、“退一步而言，即便…”、“对方该项抗辩于法无据，与在案事实相悖”、“系争合同/涉案作品”）。
3. 【固定交付格式】
   - **第一部分：完整改定稿正文**（直接给出可复制使用的完整改写结果）；
   - **第二部分：涉及法律含义边界的审慎提示**（若有某处原表述歧义，单独列出供主办律师拍板确认；若无则写“本次改稿仅作专业语域优化，未触及实质法律含义变动”）。`,
  },
  {
    id: 'timeline-elements',
    code: 'AI-03',
    title: '案情时间线提取 & 请求权/抗辩要件拆解',
    shortTitle: '时间线与要件',
    badge: '庭前梳理利器',
    recommendedSlot: 'reasoning',
    desc: '将杂乱的微信记录、当事人自述或起诉状清洗为精确《案件事实大事记表》，并拆解请求权基础要件与抗辩切入点。',
    placeholder:
      '请粘贴当事人的案情叙述、微信聊天记录整理文本、询问笔录或对方起诉状事实与理由…',
    presetOptions: [
      { label: '代理角色：拟作为【原告 / 申请人】起诉维权', value: '以原告代理律师视角梳理请求权基础、构成要件满足度、诉讼时效/管辖连接点及立案前急需补强的证据缺口。' },
      { label: '代理角色：拟作为【被告 / 被申请人】应诉抗辩', value: '以被告代理律师视角排查原告权利链瑕疵、程序管辖异议空间、诉讼时效抗辩、违约金/赔偿额调减抗辩及反诉可行性。' },
    ],
    systemPrompt: `你是中国诉讼办案中枢分析助手。请对用户提交的原始案情材料进行结构化事实提取与请求权要件拆解：
1. 【事实边界优先】严格区分「材料已载明事实」与「待向当事人核实事项」，日期、金额不明确的一律标明“[具体日期待核实]”或“[金额待核实]”，绝不脑补。保留所有脱敏占位符（如 [当事人甲]、[公司主体A]）。
2. 【输出结构】
   - **一、案件事实时间线大事记**（使用 Markdown 表格：\`序号 | 时间节点 | 核心法律事实 | 现有/待补证据支撑\`，按时间先后排列）；
   - **二、核心法律关系与请求权基础拆解**（明确案由方向、核心请求权基础及各项构成要件的举证对应情况；法条号如无十足把握请提示通过工具箱“法典清单”核对原文）；
   - **三、对方高频抗辩预判 / 己方突破口**（3–5 条实务攻防焦点）；
   - **四、向委托人追补证据及发问核实清单**（可直接发给委托人准备材料的具体清单）。`,
  },
  {
    id: 'cross-exam-questions',
    code: 'AI-04',
    title: '庭审质证意见（三性一力）& 发问提纲生成',
    shortTitle: '质证与发问',
    badge: '出庭实战专席',
    recommendedSlot: 'reasoning',
    desc: '输入对方证据目录及证明目的，按真实性、合法性、关联性、证明力生成质证底稿，并设计封闭式庭审发问链。',
    placeholder:
      '请粘贴对方的《证据目录》（证据名称、形式、证明目的）或需要当庭发问核实的争议事实…',
    presetOptions: [
      { label: '任务：针对对方证据起草《书面质证意见》', value: '严格按单份或成组证据分别围绕【真实性、合法性、关联性、证明力】四维起草质证意见，重点识别复印件/无原件、单方制作、电子数据未公证/时间戳哈希未核验、超举证期、证明目的过度引申等软肋。' },
      { label: '任务：设计出庭《封闭式发问提纲》', value: '围绕核心待证事实设计逻辑闭环的庭审发问链条：全部采用“是或不是”“有没有”的封闭式设问，预设对方承认或否认两种回答的追问后手，避免给对方长篇辩解机会。' },
    ],
    systemPrompt: `你是经验丰富的中国民商事及知识产权出庭律师。请根据用户提供的证据目录或争议事实，起草专业、严谨的《质证意见底稿》或《庭审发问提纲》：
1. 严守事实边界，不编造在案不存在的细节；对于需要当庭核验原件/原始载体的项目，明确标注“[视当庭核对原件/原始载体情况确认]”。
2. 质证意见须表格或清晰分项呈现「证据序号与名称 → 三性确认表态（真实性/合法性/关联性） → 证明力及具体质证理由」，语言简练犀利，符合法庭书记员庭审记录习惯。
3. 庭审发问须遵循「一问一事实、封闭式提问、层层锁死」原则，注明每一问背后的证明意图。`,
  },
  {
    id: 'client-wechat-reply',
    code: 'AI-05',
    title: '客户咨询体面微信回复 & 案件进展汇报生成',
    shortTitle: '客户微信回复',
    badge: '手机碎片场景高频',
    recommendedSlot: 'fast',
    desc: '在外奔波不便手机打长字时，输入几句口语核心判断，秒出结构清晰、分寸得当、带执业免责提示的微信回复。',
    placeholder:
      '用大白话或语音输入您的核心判断即可（例如：看了对方发来的设备采购合同和送货单，签收人不是法定代表人但有公司收货章，建议先发正式书面催款函固定对账金额，同时准备财产保全线索，法院保全费和诉讼费大概几千元）…',
    presetOptions: [
      { label: '场景：新客户初步咨询专业回复（温和稳重+促成委托）', value: '语气专业、沉稳、有条理，让客户感受到律师切中要害的专业度，同时严守执业规范，不作包赢承诺，末尾附“以上系基于目前提供信息所作初步分析”的得体提示。' },
      { label: '场景：在办案件阶段性进展向客户汇报', value: '清晰交代已完成动作、当前法院/对方反馈节点、下一步我方推进计划及需要客户配合的事项，提升客户安全感与体验。' },
      { label: '场景：向客户解释不利风险 / 调解方案利弊对比', value: '客观理性算清诉讼时间成本、执行回款风险与当前调解方案的净收益对比，把决策权清晰交给委托人，避免日后执业投诉。' },
    ],
    systemPrompt: `你是中国执业律师的随身客户沟通起草助手。律师在手机端外出场景下输入简短判断或测算结果，请你将其整理为一段**可直接复制发送到微信对话框**的专业法律回复：
1. 【排版适配微信阅读】不使用复杂的 Markdown # 井号标题或表格（微信纯文本显示不美观），改用清晰的自然分段与「1. 2. 3.」或「【核心判断】【下一步建议】」等干净的纯文本标识，篇幅控制在 250–500 字左右，手机一屏半可读完。
2. 【执业合规红线】严禁出现任何“包赢”、“肯定能判下来”、“100%没问题”、“认识法官”等违规承诺表述；涉及金额或结果预估时，必须自然融入“结合目前您提供的现有材料初步评估，最终以法院审理认定为准”的审慎边界。
3. 【保留代号】若输入含脱敏代号（如 [公司主体A]），原样保留以便系统一键还原真实名称。`,
  },
  {
    id: 'legal-sandbox',
    code: 'AI-06',
    title: '严谨法律对话沙盒（带防幻觉护栏）',
    shortTitle: '严谨对话沙盒',
    badge: '双模型多轮推演',
    recommendedSlot: 'reasoning',
    desc: '支持多轮自由研讨疑难法律问题、类案争议焦点推演与文书片段起草，底层锁死反编造法条/案号合规护栏。',
    placeholder: '输入任何需要推演的法律实务问题、争议焦点或起草指令…',
    systemPrompt: `你是「中国律师 AI 工具箱」内置的严谨中国法律实务研判助手，服务于中国执业律师。
必须严格遵守以下执业辅助底线：
1. 事实、判断、建议、风险四者分离；绝不编造任何虚假的最高人民法院指导性案例编号、裁判文书案号或司法解释条文原文。
2. 当引用具体法条但对精确条号或最新修正字句无 100% 把握时，必须标注“[请点开工具箱底部‘法典清单’核对条文原文]”，宁可坦诚提示核验，绝不拼凑近似条文。
3. 回答直奔主题、法理扎实、紧扣中国司法实践（尤其是浙江及长三角法院、互联网法院审理思路），不讲正确的废话。`,
  },
];
