import { spawn } from 'node:child_process';
import zlib from 'node:zlib';

const LEGAL_PHRASE_DICT = [
  '信息网络传播权',
  '帮助信息网络犯罪',
  '追加被执行人',
  '管辖权异议',
  '人民法院案例库',
  '最高人民法院',
  '惩罚性赔偿',
  '消费者权益',
  '不正当竞争',
  '行政诉讼法',
  '民事诉讼法',
  '刑事诉讼法',
  '劳动合同法',
  '指导性案例',
  '执行异议',
  '强制执行',
  '财产保全',
  '诉讼时效',
  '仲裁协议',
  '买卖合同',
  '民间借贷',
  '借款合同',
  '金融借款',
  '融资租赁',
  '保理合同',
  '建设工程',
  '施工合同',
  '房屋租赁',
  '租赁合同',
  '物业服务',
  '承揽合同',
  '委托合同',
  '中介合同',
  '保险合同',
  '合伙协议',
  '破产重整',
  '股权转让',
  '股东出资',
  '公司决议',
  '人格否认',
  '抽逃出资',
  '加速到期',
  '劳动争议',
  '劳动合同',
  '违法解除',
  '经济补偿',
  '工伤保险',
  '人身损害',
  '交通事故',
  '医疗损害',
  '保证责任',
  '合同解除',
  '解除合同',
  '逾期付款',
  '不可抗力',
  '情势变更',
  '表见代理',
  '无权代理',
  '不当得利',
  '无因管理',
  '婚姻家庭',
  '离婚纠纷',
  '债权转让',
  '侵权责任',
  '网络侵权',
  '个人信息',
  '商标侵权',
  '专利侵权',
  '商业秘密',
  '行政处罚',
  '行政复议',
  '行政协议',
  '国家赔偿',
  '取保候审',
  '职务侵占',
  '掩饰隐瞒',
  '人工智能',
  '数据合规',
  '司法解释',
  '商品房',
  '违约金',
  '抵押权',
  '抚养权',
  '名誉权',
  '隐私权',
  '著作权',
  '代位权',
  '撤销权',
  '帮信罪',
  '诈骗罪',
  '律师费',
  '法答网',
  '民法典',
  '公司法',
  '劳动法',
  '担保',
  '利息',
  '定金',
  '继承',
  '遗嘱',
  '刑法',
].sort((a, b) => b.length - a.length);

const QUESTION_STOP_RE =
  /请问|一下|怎么判|怎么算|如何计算|如何认定|怎么处理|怎么写|怎么办|有哪些|是什么|什么标准|什么条件|标准是什么|规定是什么|是否需要|是否可以|能不能|要不要|要不要承担|是否承担|承担什么|承担|责任|法律规定|法律依据|司法实践|实务中|法院|判决|裁判|规则|依据|条件|标准|情形|问题|情况|最新|关于|以及|或者|还有|如果|没有|未约定|约定|导致|要求|主张|可以|能否|是否|如何|怎么|什么|哪些|这个|那个|我的|对方|原告|被告|公司|个人|需要|应该|应当|吗|呢|啊|呀|吧|的|了|在|和|与|及|对|向|由|被|按/g;

const FOREIGN_LAW_TOKENS = [
  '日本',
  '越南',
  '伊朗',
  '法国',
  '德国',
  '美国',
  '英国',
  '韩国',
  '俄罗斯',
  '瑞士',
  '意大利',
  '新加坡',
  '印度',
  '巴西',
  '加拿大',
  '澳大利亚',
  '乌克兰',
  '马来西亚',
  '泰国',
  '西班牙',
  '葡萄牙',
  '荷兰',
  '比利时',
  '瑞典',
  '挪威',
  '英译',
  '外译',
  '外国法',
  'Civil Code',
  '蓝海法律查明',
];

const LEGAL_SYNONYM_MAP = [
  { re: /出资期限|认缴出资|未届出资|未实缴|抽逃/, term: '股东出资' },
  { re: /转让股权|股权转让|转股/, term: '股权转让' },
  { re: /2n|2N|双倍工资|违法辞退|解雇|离职补偿|加班费/, term: '劳动争议' },
  { re: /工程款|工程价款|挂靠|转包|分包|实际施工人|竣工验收/, term: '建设工程' },
  { re: /货款|尾款|交货|验货|质量异议/, term: '买卖合同' },
  { re: /借条|欠条|借贷|砍头息|本息/, term: '民间借贷' },
  { re: /案外人|续封|查封|轮候|执行和解|追加股东/, term: '强制执行' },
  { re: /违约金过高|违约金调减|逾期付款/, term: '违约金' },
  { re: /离婚|彩礼|抚养费|夫妻共同财产/, term: '婚姻家庭' },
  { re: /车祸|交强险|三者险|误工费|残疾赔偿金/, term: '交通事故' },
  { re: /房东|租客|押金|转租|腾退/, term: '房屋租赁' },
  { re: /短视频|影视|抄袭|盗版|搬运|网盘/, term: '著作权' },
];

/**
 * Splits a natural-language Chinese legal question or multi-keyword query into
 * up to 4 clean IMA title-search keywords.
 */
export function extractLegalSearchTerms(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (!q) return [];

  const terms = [];
  const addTerm = (t) => {
    const clean = String(t || '').trim();
    if (clean.length < 2) return;
    if (!terms.includes(clean)) terms.push(clean);
  };

  // 1. Short single-phrase keyword: always keep exact query first
  const compactNoPunct = q.replace(/[？?！!，,。；;：:、（）()【】《》“”"'\s]+/g, '');
  const hasSpaces = /\s+/.test(q);
  const looksLikeQuestion =
    /[？?]|请问|怎么|如何|是否|能否|哪些|什么|承担/.test(q) || compactNoPunct.length > 14;

  if (!hasSpaces && !looksLikeQuestion && compactNoPunct.length <= 16) {
    addTerm(compactNoPunct);
  }

  // 2. Match high-value Chinese legal domain phrases & legal synonym stems
  for (const phrase of LEGAL_PHRASE_DICT) {
    if (q.includes(phrase)) {
      addTerm(phrase);
      if (terms.length >= 4) break;
    }
  }
  for (const { re, term } of LEGAL_SYNONYM_MAP) {
    if (terms.length >= 4) break;
    if (re.test(q)) {
      addTerm(term);
    }
  }

  // 3. Space / punctuation split tokens (cleaned of question filler)
  const rawTokens = q
    .split(/[\s，,。；;：:、？?！!（）()【】《》“”"']+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const tok of rawTokens) {
    if (terms.length >= 4) break;
    if (tok.length >= 2 && tok.length <= 12 && !QUESTION_STOP_RE.test(tok)) {
      addTerm(tok);
    } else {
      const stripped = tok.replace(QUESTION_STOP_RE, ' ').trim();
      for (const piece of stripped.split(/\s+/)) {
        if (piece.length >= 2 && piece.length <= 10) {
          addTerm(piece);
          if (terms.length >= 4) break;
        }
      }
    }
  }

  // 4. Fallback if still empty: stripped chunks of whole query
  if (terms.length === 0) {
    const strippedAll = q
      .replace(/[？?！!，,。；;：:、（）()【】《》“”"']+/g, ' ')
      .replace(QUESTION_STOP_RE, ' ')
      .trim();
    for (const part of strippedAll.split(/\s+/)) {
      if (part.length >= 2) {
        addTerm(part.slice(0, 10));
        if (terms.length >= 3) break;
      }
    }
  }

  if (terms.length === 0 && compactNoPunct.length >= 2) {
    addTerm(compactNoPunct.slice(0, 10));
  }

  return terms.slice(0, 4);
}

/**
 * Scores IMA search results so authoritative Chinese laws, judicial interpretations,
 * SPC Case Library precedents, and FaDaWang Q&As outrank foreign translations & folders.
 */
export function scoreImaSearchItem(item, rawQuery, terms) {
  const title = String(item?.title || '');
  const lowerTitle = title.toLowerCase();
  const q = String(rawQuery || '').trim();
  const lowerQ = q.toLowerCase();

  let score = 0;

  if (q && lowerTitle.includes(lowerQ)) {
    score += 90;
  }

  let matchedCount = 0;
  for (const t of terms || []) {
    if (t && lowerTitle.includes(t.toLowerCase())) {
      matchedCount += 1;
      score += 36;
    }
  }
  if (matchedCount >= 2) {
    score += 28 * (matchedCount - 1);
  }

  // Boost authoritative Chinese primary legal sources & newer revisions
  if (/中华人民共和国/.test(title)) score += 28;
  if (/最高人民法院|司法解释|指导性案例|法答网/.test(title)) score += 24;
  if (/人民法院案例库|参考案例|批复|纪要|规定|解释/.test(title)) score += 16;
  if (/诉.+案|纠纷案/.test(title)) score += 18;

  // Prefer newer revisions (2020-2026) over older superseded editions (2000-2019)
  const years = (title.match(/20\d{2}/g) || []).map(Number);
  const maxYear = years.length ? Math.max(...years) : 0;
  if (maxYear >= 2024) score += 14;
  else if (maxYear >= 2020) score += 9;
  else if (maxYear > 0 && maxYear < 2018) score -= 6;

  // Prefer directly text-readable formats (.pdf/.docx/.md) over legacy binary .doc
  if (lowerTitle.endsWith('.doc') && !lowerTitle.endsWith('.docx')) {
    score -= 10;
  }

  // Heavy penalty for foreign law / English translations unless explicitly queried
  const isForeignTitle = FOREIGN_LAW_TOKENS.some((ft) =>
    lowerTitle.includes(ft.toLowerCase())
  );
  const queryWantsForeign = FOREIGN_LAW_TOKENS.some((ft) =>
    lowerQ.includes(ft.toLowerCase())
  );
  if (isForeignTitle && !queryWantsForeign) {
    score -= 90;
  }

  // Mild penalty for administrative publicity circulars & folders in search mode
  if (/学习宣传|实施方案的通知|知识竞赛|普法/.test(title)) score -= 18;
  if (item?.kind === 'folder') score -= 15;

  return score;
}

/**
 * Normalizes an IMA filename into a canonical title fingerprint so duplicate uploads
 * (e.g. `2026-06-22_2026-10-2-298-001_曲某诉陈某周.pdf` vs `2026-10-2-298-001_曲某诉陈某周_4c982625.pdf`
 * or `.pdf` vs `.docx` vs `_4721.docx` copies of the same statute) collapse cleanly into the best single copy.
 */
export function canonicalImaTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\.(pdf|docx|doc|md|txt)$/i, '')
    .replace(/^(?:20\d{2}-\d{2}-\d{2}[_\s-]*)+/, '')
    .replace(/^(?:20\d{2}-\d{1,2}-\d{1,2}-\d{2,4}-\d{2,4}[_\s-]*)/, '')
    .replace(/(?:_[0-9a-f]{4,10})+$/i, '')
    .replace(/(?:_20\d{2}-\d{2}-\d{2})+$/g, '')
    .replace(/[_\s\-—()（）《》【】\[\]]+/g, '')
    .trim();
}

export function dedupeNearDuplicateImaItems(sortedItems) {
  const seen = new Set();
  const out = [];
  for (const it of sortedItems || []) {
    if (it.kind === 'folder') {
      out.push(it);
      continue;
    }
    const fp = canonicalImaTitleKey(it.title);
    if (!fp || !seen.has(fp)) {
      if (fp) seen.add(fp);
      out.push(it);
    }
  }
  return out;
}

function decodeXmlEntities(input) {
  return String(input || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Pure-Node .docx plain text extractor (supports Store=0 and Deflate=8).
 * Strips Word Track Changes deletions (<w:del>) and field codes (<w:instrText>).
 */
export function extractDocxTextFromBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) {
    throw new Error('DOCX 文件内容无效或已损坏');
  }

  let eocdOffset = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('无法识别该 DOCX 压缩结构');
  }

  const cdEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let ptr = cdOffset;
  for (let i = 0; i < cdEntries && ptr + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const compressionMethod = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const fileNameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);

    const fileName = buf.subarray(ptr + 46, ptr + 46 + fileNameLen).toString('utf8');
    ptr += 46 + fileNameLen + extraLen + commentLen;

    if (fileName === 'word/document.xml') {
      const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const slice = buf.subarray(dataStart, dataStart + compressedSize);

      let xmlBytes;
      if (compressionMethod === 0) {
        xmlBytes = slice;
      } else if (compressionMethod === 8) {
        xmlBytes = zlib.inflateRawSync(slice);
      } else {
        throw new Error(`不支持的 DOCX 压缩算法 (${compressionMethod})`);
      }

      const xml = xmlBytes.toString('utf8');
      const cleaned = xml
        .replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')
        .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, '')
        .replace(/<w:tab[^>]*\/>/g, '\t')
        .replace(/<w:(?:br|cr)[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<\/w:tc>/g, '\t')
        .replace(/<\/w:tr>/g, '\n')
        .replace(/<[^>]+>/g, '');

      return normalizeExtractedText(decodeXmlEntities(cleaned));
    }
  }

  throw new Error('未在 DOCX 中找到正文节点 word/document.xml');
}

/**
 * Extracts UTF-8 Chinese/English text from a PDF Buffer in memory via poppler `pdftotext`
 * using stdin/stdout pipes (zero temp files on disk).
 */
export function extractPdfTextFromBuffer(pdfBuffer, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftotext', ['-enc', 'UTF-8', '-', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const outChunks = [];
    const errChunks = [];
    let outLen = 0;
    const MAX_OUT = 4 * 1024 * 1024;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error('PDF 正文解析超时，请直接下载原件查看'));
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (outLen < MAX_OUT) {
        outChunks.push(chunk);
        outLen += chunk.length;
      }
    });

    child.stderr.on('data', (chunk) => {
      if (errChunks.length < 16) errChunks.push(chunk);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error(`服务端暂未启用 PDF 文字提取引擎 (${err.code || err.message})`));
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0 && outLen === 0) {
        const stderrText = Buffer.concat(errChunks).toString('utf8').trim();
        reject(new Error(stderrText || `PDF 文本提取失败 (exit ${code})`));
        return;
      }
      const raw = Buffer.concat(outChunks).toString('utf8');
      const pages = raw.split('\f').filter((p) => p.trim().length > 0);
      const text = normalizeExtractedText(raw.replace(/\f/g, '\n\n'));
      resolve({
        text,
        pageCount: pages.length || (text ? 1 : 0),
      });
    });

    child.stdin.on('error', () => {
      // ignore EPIPE if pdftotext exits early on malformed/encrypted PDF
    });
    child.stdin.end(pdfBuffer);
  });
}
