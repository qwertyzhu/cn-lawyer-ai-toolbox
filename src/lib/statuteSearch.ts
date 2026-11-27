/**
 * Chinese Statute Search Parser & Matcher.
 *
 * Supports natural lawyer queries such as:
 * - "585", "第585条", "第五百八十五条"
 * - "民法典第585条", "《民法典》第 585 条", "民法典 585", "民法典585", "民法典 第五百八十五条"
 * - "民法典 第1165条 第2款" (preserves clauseHint "第2款" and surfaces article-level granularity notice)
 * - Strict non-substitution: NEVER substitutes a base statute (e.g.《公司法》) when the user explicitly
 *   queries an uncollected judicial interpretation or statute (e.g.《公司法解释三》第13条 or《刑法》第264条).
 */

export interface SearchableStatuteItem {
  key: string;
  lawTitle: string;
  fullLawTitle: string;
  articleNo: number;
  articleLabel: string;
  breadcrumb: string;
  summary?: string;
  text: string;
}

const CN_DIGIT_VAL: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CN_UNIT_VAL: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
};

export function parseChineseArticleNumber(raw: string): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{1,4}$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n : null;
  }
  if (!/^[零〇一二两三四五六七八九十百千]+$/.test(s)) {
    return null;
  }

  let total = 0;
  let currentDigit = 0;
  let hasUnit = false;

  for (const ch of s) {
    if (ch in CN_DIGIT_VAL) {
      currentDigit = CN_DIGIT_VAL[ch];
    } else if (ch in CN_UNIT_VAL) {
      hasUnit = true;
      const unit = CN_UNIT_VAL[ch];
      const mult = currentDigit === 0 && ch === '十' && total === 0 ? 1 : currentDigit;
      total += mult * unit;
      currentDigit = 0;
    }
  }
  total += currentDigit;

  // Handle pure positional Chinese digits like "五八五" -> 585
  if (!hasUnit && s.length >= 2) {
    let posVal = 0;
    for (const ch of s) {
      if (!(ch in CN_DIGIT_VAL)) return null;
      posVal = posVal * 10 + CN_DIGIT_VAL[ch];
    }
    return posVal > 0 ? posVal : null;
  }

  return total > 0 ? total : null;
}

// Strict synonyms: NEVER map "*解释*" or "*规定*" to a bare parent statute without "解释"/"规定"!
const LAW_SYNONYMS: Array<[RegExp, string[]]> = [
  [/^民诉法解释$|^民诉解释$/, ['民事诉讼法', '解释']],
  [/^民诉法$/, ['民事诉讼法']],
  [/^民诉证据|^证据规定$/, ['民事诉讼证据']],
  [/^反法$|^反不正当竞争$/, ['反不正当竞争']],
  [/^建工解释$/, ['建设工程', '解释']],
  [/^道交解释$/, ['道路交通事故', '解释']],
  [/^人损解释$/, ['人身损害', '解释']],
  [/^民间借贷$|^民间借贷解释$/, ['民间借贷']],
  [/^劳动仲裁法$/, ['劳动争议调解仲裁']],
  [/^商标法$/, ['商标']],
  [/^著作权法$|^版权法$/, ['著作权']],
  [/^专利法$/, ['专利']],
  [/^个保法$/, ['个人信息保护']],
];

const INTERP_SERIES_NUM_RE = /(?:解释|规定)\s*([一二三四五六七八九十1-9])/;

export function matchLawHintAgainstItem(hint: string, item: SearchableStatuteItem): boolean {
  const clean = hint.trim();
  if (!clean) return true;
  const hay = `${item.lawTitle} ${item.fullLawTitle}`;

  const asksForInterp = /解释|规定|批复|纪要/.test(clean);
  const itemIsInterp = /解释|规定|批复|纪要/.test(hay);
  if (asksForInterp && !itemIsInterp) {
    // Prevent silent parent-statute substitution (e.g. "公司法解释三" MUST NOT match bare《公司法》!)
    return false;
  }

  const seriesMatch = clean.match(INTERP_SERIES_NUM_RE);
  if (seriesMatch) {
    const numToken = seriesMatch[1];
    if (!hay.includes(`（${numToken}）`) && !hay.includes(`(${numToken})`) && !hay.includes(clean)) {
      return false;
    }
  }

  if (hay.includes(clean)) return true;
  for (const [re, requiredParts] of LAW_SYNONYMS) {
    if (re.test(clean)) {
      if (!asksForInterp && itemIsInterp && clean.endsWith('法')) {
        // When user explicitly says "民诉法" or "公司法", prefer the statute itself unless full title matches
        return item.lawTitle.includes(requiredParts[0]) && !/解释|规定/.test(item.lawTitle);
      }
      return requiredParts.every((p) => hay.includes(p));
    }
  }
  return false;
}

export interface ParsedStatuteQuery {
  raw: string;
  exactNo: number | null;
  lawHint: string;
  clauseHint: string;
  keywords: string[];
}

export function parseStatuteQuery(rawInput: string): ParsedStatuteQuery {
  const cleaned = String(rawInput || '')
    .replace(/[《》<>「」『』【】()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return { raw: '', exactNo: null, lawHint: '', clauseHint: '', keywords: [] };
  }

  // Extract optional clause/item specifiers ("第2款", "第二款", "第1项") before article parsing
  const clauseParts: string[] = [];
  const withoutClause = cleaned
    .replace(/第\s*([0-9]{1,2}|[零〇一二两三四五六七八九十]{1,4})\s*([款项])/g, (_m, n, u) => {
      clauseParts.push(`第${n}${u}`);
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  const clauseHint = clauseParts.join('');
  const working = withoutClause || cleaned;

  // 1. Pure article number: "585", "第585条", "第五百八十五条", "585条"
  const pureMatch = working.match(/^第?\s*([0-9]{1,4}|[零〇一二两三四五六七八九十百千]{1,10})\s*条?$/);
  if (pureMatch) {
    const parsedNo = parseChineseArticleNumber(pureMatch[1]);
    if (parsedNo !== null) {
      return { raw: cleaned, exactNo: parsedNo, lawHint: '', clauseHint, keywords: [] };
    }
  }

  // 2. Law prefix + article number (with or without space / 第 / 条):
  //    e.g. "民法典第585条", "民法典 585", "公司法解释三第13条", "民法典 第1165条 第2款"
  const compoundMatch = working.match(
    /^([\u4e00-\u9fa5A-Za-z0-9]{2,24}?)\s*(?:第\s*([0-9]{1,4}|[零〇一二两三四五六七八九十百千]{1,10})\s*条?|([0-9]{1,4})\s*条?)$/
  );
  if (compoundMatch) {
    const lawPart = compoundMatch[1].trim();
    const numStr = compoundMatch[2] || compoundMatch[3] || '';
    const parsedNo = parseChineseArticleNumber(numStr);
    if (parsedNo !== null && /[\u4e00-\u9fa5]/.test(lawPart)) {
      return { raw: cleaned, exactNo: parsedNo, lawHint: lawPart, clauseHint, keywords: [] };
    }
  }

  // 3. Multi-token query that may include an article token alongside law/topic keywords
  const tokens = working.split(/\s+/).filter(Boolean);
  let exactNo: number | null = null;
  let extractedLawHint = '';
  const remaining: string[] = [];

  for (const tok of tokens) {
    const subCompound = tok.match(
      /^([\u4e00-\u9fa5]{2,20}?)第([0-9]{1,4}|[零〇一二两三四五六七八九十百千]{1,10})条?$/
    );
    if (subCompound && exactNo === null) {
      const n = parseChineseArticleNumber(subCompound[2]);
      if (n !== null) {
        exactNo = n;
        extractedLawHint = subCompound[1];
        continue;
      }
    }
    const artTok = tok.match(/^第?([0-9]{1,4}|[零〇一二两三四五六七八九十百千]{1,10})条$/);
    if (artTok && exactNo === null) {
      const n = parseChineseArticleNumber(artTok[1]);
      if (n !== null) {
        exactNo = n;
        continue;
      }
    }
    if (/^\d{1,4}$/.test(tok) && exactNo === null && tokens.length >= 2) {
      exactNo = Number(tok);
      continue;
    }
    remaining.push(tok);
  }

  if (
    !extractedLawHint &&
    exactNo !== null &&
    remaining.length === 1 &&
    /(?:法|典|条例|解释[一二三四五六七八九十1-9]?|规定|办法|纪要)$/.test(remaining[0])
  ) {
    extractedLawHint = remaining[0];
    remaining.length = 0;
  }

  return {
    raw: cleaned,
    exactNo,
    lawHint: extractedLawHint,
    clauseHint,
    keywords: remaining,
  };
}

export interface DetailedStatuteSearchResult<T extends SearchableStatuteItem> {
  parsed: ParsedStatuteQuery;
  hits: T[];
  uncollectedLawNotice: string;
  clauseNotice: string;
}

export function searchStatuteEntriesDetailed<T extends SearchableStatuteItem>(
  scopedEntries: T[],
  rawQuery: string,
  limit = 50
): DetailedStatuteSearchResult<T> {
  const parsed = parseStatuteQuery(rawQuery);
  if (!parsed.raw) {
    return {
      parsed,
      hits: scopedEntries.slice(0, limit),
      uncollectedLawNotice: '',
      clauseNotice: '',
    };
  }

  const lawExistsInCorpus = parsed.lawHint
    ? scopedEntries.some((x) => matchLawHintAgainstItem(parsed.lawHint, x))
    : true;

  if (parsed.lawHint && !lawExistsInCorpus) {
    return {
      parsed,
      hits: [],
      uncollectedLawNotice: `离线法规库暂未收录《${parsed.lawHint}》，系统已拒绝使用同名母法或其他条文静默替代；请切换上方「IMA案例法规库」或前往国家法律法规数据库（flk.npc.gov.cn）核对权威现行原文。`,
      clauseNotice: '',
    };
  }

  if (parsed.exactNo !== null && parsed.keywords.length === 0) {
    const byNo = scopedEntries
      .filter(
        (x) =>
          x.articleNo === parsed.exactNo &&
          (!parsed.lawHint || matchLawHintAgainstItem(parsed.lawHint, x))
      )
      .sort((a, b) => {
        if (parsed.lawHint) {
          const aExact = a.lawTitle === parsed.lawHint ? -1 : 0;
          const bExact = b.lawTitle === parsed.lawHint ? -1 : 0;
          if (aExact !== bExact) return aExact - bExact;
        }
        return a.lawTitle === '民法典' ? -1 : b.lawTitle === '民法典' ? 1 : 0;
      })
      .slice(0, limit);

    const clauseNotice =
      parsed.clauseHint && byNo.length > 0
        ? `离线法规库按“条”粒度索引，已定位至第 ${parsed.exactNo} 条全文，请人工核对正文中「${parsed.clauseHint}」对应段落。`
        : '';

    return {
      parsed,
      hits: byNo,
      uncollectedLawNotice: '',
      clauseNotice,
    };
  }

  const scored: Array<{ item: T; score: number }> = [];
  for (const item of scopedEntries) {
    if (parsed.exactNo !== null && item.articleNo !== parsed.exactNo) continue;
    if (parsed.lawHint && !matchLawHintAgainstItem(parsed.lawHint, item)) continue;

    const hay = `${item.lawTitle} ${item.fullLawTitle} ${item.articleLabel} 第${item.articleNo}条 ${item.summary || ''} ${item.text}`;
    const allMatch = parsed.keywords.every(
      (kw) => hay.includes(kw) || matchLawHintAgainstItem(kw, item)
    );
    if (!allMatch) continue;

    let score = 0;
    if (parsed.exactNo !== null && item.articleNo === parsed.exactNo) score += 60;
    if (item.summary && parsed.keywords.some((kw) => item.summary!.includes(kw))) score += 30;
    if (parsed.keywords.some((kw) => item.lawTitle.includes(kw))) score += 25;
    if (item.lawTitle === '民法典') score += 5;
    scored.push({ item, score });
    if (scored.length >= 300) break;
  }

  const hits = scored
    .sort((a, b) => b.score - a.score || a.item.articleNo - b.item.articleNo)
    .slice(0, limit)
    .map((s) => s.item);

  const clauseNotice =
    parsed.clauseHint && hits.length > 0
      ? `离线法规库按“条”粒度索引，已定位对应法条全文，请人工核对正文中「${parsed.clauseHint}」对应段落。`
      : '';

  return {
    parsed,
    hits,
    uncollectedLawNotice: '',
    clauseNotice,
  };
}

export function searchStatuteEntries<T extends SearchableStatuteItem>(
  scopedEntries: T[],
  rawQuery: string,
  limit = 50
): T[] {
  return searchStatuteEntriesDetailed(scopedEntries, rawQuery, limit).hits;
}

export interface GlobalQueryRouteHint {
  parsed: ParsedStatuteQuery;
  isArticleLookup: boolean;
  statuteQuery: string;
  displayTargetLabel: string;
}

/**
 * Shared parser for HomeTab & CommandSearchModal (⌘K) so "585", "民法典第585条",
 * "民法典 第1165条 第2款", and "公司法解释三第13条" route identically to the local offline statute corpus.
 */
export function classifyGlobalStatuteQuery(rawInput: string): GlobalQueryRouteHint {
  const parsed = parseStatuteQuery(rawInput);
  if (!parsed.raw) {
    return {
      parsed,
      isArticleLookup: false,
      statuteQuery: '',
      displayTargetLabel: '',
    };
  }

  if (parsed.exactNo !== null) {
    const lawPrefix = parsed.lawHint || parsed.keywords[0] || '';
    const clauseSuffix = parsed.clauseHint ? ` ${parsed.clauseHint}` : '';
    const canonical = lawPrefix
      ? `${lawPrefix}第${parsed.exactNo}条${clauseSuffix}`
      : `第${parsed.exactNo}条${clauseSuffix}`;
    const label = lawPrefix
      ? `《${lawPrefix}》第 ${parsed.exactNo} 条${parsed.clauseHint || ''}`
      : `第 ${parsed.exactNo} 条${parsed.clauseHint || ''}（优先《民法典》及常用单行法）`;
    return {
      parsed,
      isArticleLookup: true,
      statuteQuery: canonical,
      displayTargetLabel: label,
    };
  }

  return {
    parsed,
    isArticleLookup: false,
    statuteQuery: parsed.raw,
    displayTargetLabel: parsed.raw,
  };
}
