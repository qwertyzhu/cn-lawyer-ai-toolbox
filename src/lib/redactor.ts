import type { RedactionMapping, RedactionResult } from '../types/toolbox';

const CHINESE_LABELS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ALPHA_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const ROLE_STOPWORDS = new Set([
  '公司',
  '本人',
  '先生',
  '女士',
  '代理人',
  '律师',
  '法院',
  '法官',
  '检察院',
  '公安局',
  '派出所',
  '仲裁委',
  '委员会',
  '银行',
  '支行',
  '分行',
  '住所地',
  '所在地',
  '委托诉讼',
  '特别授权',
  '一般授权',
  '一致行动',
  '工作人员',
  '负责人',
  '法定代表',
]);

// Common Chinese single surnames to boost precision of context-extracted names
const COMMON_SURNAMES = new Set(
  '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤虞鲁葛章伍韦申尤许倪严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公'.split(
    ''
  )
);

export interface RedactOptions {
  redactNames?: boolean;
  redactCompanies?: boolean;
  redactIds?: boolean;
  redactPhones?: boolean;
  redactBanks?: boolean;
  redactCaseNos?: boolean;
  redactAddresses?: boolean;
  customTerms?: string[];
  /** Existing mappings from prior turns so multi-turn follow-ups reuse placeholders & never collide */
  existingMappings?: RedactionMapping[];
}

const DEFAULT_OPTS: Required<Omit<RedactOptions, 'existingMappings'>> = {
  redactNames: true,
  redactCompanies: true,
  redactIds: true,
  redactPhones: true,
  redactBanks: true,
  redactCaseNos: true,
  redactAddresses: true,
  customTerms: [],
};

export function redactLegalText(input: string, options?: RedactOptions): RedactionResult {
  const existing = options?.existingMappings || [];
  if (!input || !input.trim()) {
    return { redactedText: input, mappings: [...existing], totalReplaced: 0 };
  }

  const opts = { ...DEFAULT_OPTS, ...options };
  const candidates = new Map<
    string,
    { category: RedactionMapping['category']; priority: number }
  >();

  const register = (raw: string, category: RedactionMapping['category'], priority: number) => {
    const clean = raw.trim();
    if (clean.length < 2) return;
    if (!candidates.has(clean)) {
      candidates.set(clean, { category, priority });
    }
  };

  // 0. Pre-register originals from previous turns so follow-up mentions reuse exact same placeholders
  const existingByOriginal = new Map<string, RedactionMapping>();
  const usedPlaceholders = new Set<string>();
  for (const prev of existing) {
    existingByOriginal.set(prev.original, prev);
    usedPlaceholders.add(prev.placeholder);
    if (input.includes(prev.original)) {
      register(prev.original, prev.category, 110);
    }
  }

  // 1. Custom sensitive terms (highest priority)
  for (const term of opts.customTerms) {
    const t = term.trim();
    if (t.length >= 2 && input.includes(t)) {
      register(t, 'custom', 100);
    }
  }

  // 2. Court case numbers: （2025）浙0105民初1234号 or (2024)京0491民初88号
  if (opts.redactCaseNos) {
    const caseRe = /[（(]\d{4}[）)][\u4e00-\u9fa5]{1,3}\d{0,4}[\u4e00-\u9fa5]{1,6}\d{1,6}号/g;
    for (const m of input.matchAll(caseRe)) {
      register(m[0], 'case_no', 95);
    }
  }

  // 3. 18-digit Resident ID card numbers
  if (opts.redactIds) {
    const idRe = /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g;
    for (const m of input.matchAll(idRe)) {
      register(m[0], 'id_card', 92);
    }
    // Unified Social Credit Code (18 chars starting with 91/92/93/51/11/12)
    const creditRe = /(?<![0-9A-Z])(?:91|92|93|51|52|53|11|12)[0-9A-HJ-NPQRTUWXY]{16}(?![0-9A-Z])/g;
    for (const m of input.matchAll(creditRe)) {
      register(m[0], 'credit_code', 91);
    }
  }

  // 4. Bank card / corporate account numbers (16 to 21 digits, optional spaces)
  if (opts.redactBanks) {
    const bankRe = /(?<!\d)(?:\d{4}[\s-]?){3}\d{4,7}(?!\d)/g;
    for (const m of input.matchAll(bankRe)) {
      const digitsOnly = m[0].replace(/[\s-]/g, '');
      // Skip if already matched as 18-digit ID card
      if (digitsOnly.length >= 16 && digitsOnly.length <= 21 && !candidates.has(m[0])) {
        register(m[0], 'bank_card', 85);
      }
    }
  }

  // 5. Mobile phones & emails
  if (opts.redactPhones) {
    const phoneRe = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g;
    for (const m of input.matchAll(phoneRe)) {
      register(m[0], 'phone', 80);
    }
    const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,10}/g;
    for (const m of input.matchAll(emailRe)) {
      register(m[0], 'email', 79);
    }
  }

  // 6. Company & Enterprise names (non-greedy clause boundary trimming so preceding prose/names are NEVER swallowed)
  if (opts.redactCompanies) {
    const compRe =
      /[\u4e00-\u9fa5]{2,26}(?:有限责任公司|股份有限公司|集团有限公司|影视文化有限公司|文化传媒有限公司|网络科技有限公司|科技有限公司|信息科技有限公司|电子商务有限公司|实业有限公司|贸易有限公司|建筑工程有限公司|建设集团有限公司|物业服务有限公司|管理咨询有限公司|投资合伙企业（有限合伙）|创业投资合伙企业（有限合伙）|合伙企业（有限合伙）|有限合伙企业|有限公司|影视工作室|文化工作室)(?:[\u4e00-\u9fa5]{2,8}分公司)?/g;
    // Boundary phrases that commonly appear immediately before a company name in legal prose
    const boundarySplitRe =
      /.*?(?:被上诉人|上诉人|被申请人|申请人|被执行人|申请执行人|原告|被告|第三人|法定代表人|委托人|受托人|出租方|承租方|发包人|承包人|出借人|借款人|保证人|担保人|甲方|乙方|丙方|其持有的|持有的|名下的|旗下的|所属的|未向|已向|向|与|和|及|诉|系|为|对|将|把|由|在|经|因|就|关于|针对|要求|请求|通知|委托|授权|支付|赔偿|起诉|告知)/;

    for (const m of input.matchAll(compRe)) {
      let cleaned = m[0];
      // Repeatedly trim any leading prose/role/verb prefix before the true company name
      for (let round = 0; round < 3; round++) {
        const next = cleaned.replace(boundarySplitRe, '');
        if (next.length >= 6 && next !== cleaned) {
          cleaned = next;
        } else {
          break;
        }
      }
      if (cleaned.length >= 6) {
        register(cleaned, 'company', 75);
      }
    }
  }

  // 7. Detailed street/room addresses
  if (opts.redactAddresses) {
    const addrRe =
      /(?:住址|住所地|联系地址|送达地址|位于|坐落于)[：:\s]*([\u4e00-\u9fa5]{2,12}(?:省|自治区|市)[\u4e00-\u9fa50-9A-Za-z\-（）()]{4,36}(?:号|室|层|幢|栋|单元|弄|大厦|中心|园))/g;
    for (const m of input.matchAll(addrRe)) {
      if (m[1]) register(m[1], 'address', 70);
    }
  }

  // 8. Context-triggered Chinese Personal Names
  if (opts.redactNames) {
    const roleList =
      '原告|被告|上诉人|被上诉人|申请人|被申请人|被执行人|申请执行人|第三人|法定代表人|委托人|受托人|出租方|承租方|发包人|承包人|甲方|乙方|丙方|借款人|出借人|保证人|担保人|犯罪嫌疑人|被告人|被害人|证人|员工|劳动者|联系人|收款人|户名|股东|异议人|债权人|债务人';
    const roleNamePunctRe = new RegExp(
      `(?:${roleList})(?:（[^）]{1,10}）)?[：:\\s、，]*([\\u4e00-\\u9fa5]{2,4})(?=[，,。；;：:（(\\s、]|$)`,
      'g'
    );
    const roleNameClauseRe = new RegExp(
      `(?:${roleList})(?:（[^）]{1,10}）)?[：:\\s]+([\\u4e00-\\u9fa5]{2,3}?)(?=于|在|向|将|把|对|与|和|系|为|因|经|未|已|涉嫌|报案|提供|联系|借款|拖欠|承诺|持有|任职|签署|起诉|诉|被|称)`,
      'g'
    );
    const tryRegisterName = (name: string | undefined) => {
      if (
        name &&
        !ROLE_STOPWORDS.has(name) &&
        COMMON_SURNAMES.has(name[0]) &&
        !/公司|企业|中心|银行|局|院|所|会|部$/.test(name)
      ) {
        register(name, 'name', 65);
      }
    };
    for (const m of input.matchAll(roleNamePunctRe)) {
      tryRegisterName(m[1]);
    }
    for (const m of input.matchAll(roleNameClauseRe)) {
      tryRegisterName(m[1]);
    }
  }

  // Assign stable human-readable placeholders per category
  const counters: Record<RedactionMapping['category'], number> = {
    custom: 0,
    name: 0,
    company: 0,
    id_card: 0,
    credit_code: 0,
    phone: 0,
    bank_card: 0,
    case_no: 0,
    email: 0,
    address: 0,
  };

  const makePlaceholder = (cat: RedactionMapping['category'], idx: number): string => {
    switch (cat) {
      case 'name':
        return `[当事人${CHINESE_LABELS[idx] || idx + 1}]`;
      case 'company':
        return `[公司主体${ALPHA_LABELS[idx] || idx + 1}]`;
      case 'id_card':
        return `[身份证号${idx + 1}]`;
      case 'credit_code':
        return `[统一信用代码${idx + 1}]`;
      case 'phone':
        return `[联系电话${idx + 1}]`;
      case 'bank_card':
        return `[银行账号${idx + 1}]`;
      case 'case_no':
        return `[关联案号${idx + 1}]`;
      case 'email':
        return `[电子邮箱${idx + 1}]`;
      case 'address':
        return `[详细地址${idx + 1}]`;
      case 'custom':
        return `[涉密主体${idx + 1}]`;
    }
  };

  // Sort by length descending so longer entities ("杭州某某网络科技有限公司") replace before shorter substrings
  const sortedOriginals = Array.from(candidates.entries()).sort(
    (a, b) => b[0].length - a[0].length || b[1].priority - a[1].priority
  );

  let working = input;
  const mappings: RedactionMapping[] = existing.map((m) => ({ ...m }));
  const mappingIndexByOriginal = new Map<string, number>();
  mappings.forEach((m, idx) => mappingIndexByOriginal.set(m.original, idx));
  let totalReplaced = 0;

  for (const [original, meta] of sortedOriginals) {
    if (!working.includes(original)) continue;
    const reused = existingByOriginal.get(original);
    let placeholder: string;
    if (reused) {
      placeholder = reused.placeholder;
    } else {
      do {
        placeholder = makePlaceholder(meta.category, counters[meta.category]++);
      } while (usedPlaceholders.has(placeholder));
      usedPlaceholders.add(placeholder);
    }
    const parts = working.split(original);
    const occurrences = parts.length - 1;
    if (occurrences > 0) {
      working = parts.join(placeholder);
      totalReplaced += occurrences;
      const existingIdx = mappingIndexByOriginal.get(original);
      if (existingIdx !== undefined) {
        mappings[existingIdx] = {
          ...mappings[existingIdx],
          count: mappings[existingIdx].count + occurrences,
        };
      } else {
        mappingIndexByOriginal.set(original, mappings.length);
        mappings.push({
          placeholder,
          original,
          category: meta.category,
          count: occurrences,
        });
      }
    }
  }

  return {
    redactedText: working,
    mappings,
    totalReplaced,
  };
}

export function restoreRedactedText(text: string, mappings: RedactionMapping[]): string {
  if (!text || !mappings || mappings.length === 0) return text;
  let restored = text;
  // Sort placeholders longest-first just in case
  const sorted = [...mappings].sort((a, b) => b.placeholder.length - a.placeholder.length);
  for (const item of sorted) {
    if (restored.includes(item.placeholder)) {
      restored = restored.split(item.placeholder).join(item.original);
    }
    // Also tolerate full-width brackets if an LLM converted [公司主体A] -> 【公司主体A】
    const fullWidthPh = item.placeholder.replace(/^\[/, '【').replace(/\]$/, '】');
    if (restored.includes(fullWidthPh)) {
      restored = restored.split(fullWidthPh).join(item.original);
    }
  }
  return restored;
}

export function hasSensitiveEntitiesQuickCheck(text: string): boolean {
  if (!text || text.length < 6) return false;
  const quick = redactLegalText(text);
  return quick.totalReplaced > 0;
}
