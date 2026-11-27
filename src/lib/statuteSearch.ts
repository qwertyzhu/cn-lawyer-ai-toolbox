/**
 * Chinese Statute Search Parser & Matcher.
 *
 * Supports natural lawyer queries such as:
 * - "585", "第585条", "第五百八十五条"
 * - "民法典第585条", "《民法典》第 585 条", "民法典 585", "民法典585", "民法典 第五百八十五条"
 * - "民诉法第171条", "著作权法 54", "民间借贷 25", "民法典 违约金"
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

const LAW_SYNONYMS: Array<[RegExp, string[]]> = [
  [/^民诉法解释$|^民诉解释$/, ['民事诉讼法', '解释']],
  [/^民诉法$/, ['民事诉讼法']],
  [/^民诉证据|^证据规定$/, ['民事诉讼证据']],
  [/^反法$|^反不正当竞争$/, ['反不正当竞争']],
  [/^建工解释$/, ['建设工程']],
  [/^道交解释$/, ['道路交通事故']],
  [/^人损解释$/, ['人身损害']],
  [/^民间借贷$/, ['民间借贷']],
  [/^公司法解释/, ['公司法']],
  [/^劳动仲裁法$/, ['劳动争议调解仲裁']],
  [/^商标法$/, ['商标']],
  [/^著作权法$|^版权法$/, ['著作权']],
  [/^专利法$/, ['专利']],
  [/^个保法$/, ['个人信息保护']],
];

function matchLawHintAgainstItem(hint: string, item: SearchableStatuteItem): boolean {
  const clean = hint.trim();
  if (!clean) return true;
  const hay = `${item.lawTitle} ${item.fullLawTitle}`;
  if (hay.includes(clean)) return true;
  for (const [re, requiredParts] of LAW_SYNONYMS) {
    if (re.test(clean)) {
      return requiredParts.every((p) => hay.includes(p));
    }
  }
  return false;
}

export interface ParsedStatuteQuery {
  raw: string;
  exactNo: number | null;
  lawHint: string;
  keywords: string[];
}

export function parseStatuteQuery(rawInput: string): ParsedStatuteQuery {
  const cleaned = String(rawInput || '')
    .replace(/[《》<>「」『』【】()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return { raw: '', exactNo: null, lawHint: '', keywords: [] };
  }

  const pureMatch = cleaned.match(/^第?\s*([0-9]{1,4}|[零〇一二两三四五六七八九十百千]{1,10})\s*条?$/);
  if (pureMatch) {
    const parsedNo = parseChineseArticleNumber(pureMatch[1]);
    if (parsedNo !== null) {
      return { raw: cleaned, exactNo: parsedNo, lawHint: '', keywords: [] };
    }
  }

  const compoundMatch = cleaned.match(
    /^([\u4e00-\u9fa5A-Za-z]{2,24}?)\s*(?:第\s*([0-9]{1,4}|[零〇一二两三四五六七八九十百千]{1,10})\s*条?|([0-9]{1,4})\s*条?)$/
  );
  if (compoundMatch) {
    const lawPart = compoundMatch[1].trim();
    const numStr = compoundMatch[2] || compoundMatch[3] || '';
    const parsedNo = parseChineseArticleNumber(numStr);
    if (parsedNo !== null) {
      return { raw: cleaned, exactNo: parsedNo, lawHint: lawPart, keywords: [] };
    }
  }

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  let exactNo: number | null = null;
  const remaining: string[] = [];

  for (const tok of tokens) {
    const subCompound = tok.match(
      /^([\u4e00-\u9fa5]{2,20}?)第([0-9]{1,4}|[零〇一二两三四五六七八九十百千]{1,10})条?$/
    );
    if (subCompound && exactNo === null) {
      const n = parseChineseArticleNumber(subCompound[2]);
      if (n !== null) {
        exactNo = n;
        remaining.push(subCompound[1]);
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

  return {
    raw: cleaned,
    exactNo,
    lawHint: '',
    keywords: remaining,
  };
}

export function searchStatuteEntries<T extends SearchableStatuteItem>(
  scopedEntries: T[],
  rawQuery: string,
  limit = 50
): T[] {
  const parsed = parseStatuteQuery(rawQuery);
  if (!parsed.raw) return scopedEntries.slice(0, limit);

  if (parsed.exactNo !== null && parsed.keywords.length === 0) {
    const byNo = scopedEntries.filter(
      (x) =>
        x.articleNo === parsed.exactNo &&
        (!parsed.lawHint || matchLawHintAgainstItem(parsed.lawHint, x))
    );
    return byNo
      .sort((a, b) => {
        if (parsed.lawHint) {
          const aExact = a.lawTitle === parsed.lawHint ? -1 : 0;
          const bExact = b.lawTitle === parsed.lawHint ? -1 : 0;
          if (aExact !== bExact) return aExact - bExact;
        }
        return a.lawTitle === '民法典' ? -1 : b.lawTitle === '民法典' ? 1 : 0;
      })
      .slice(0, limit);
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

  return scored
    .sort((a, b) => b.score - a.score || a.item.articleNo - b.item.articleNo)
    .slice(0, limit)
    .map((s) => s.item);
}

export interface GlobalQueryRouteHint {
  parsed: ParsedStatuteQuery;
  isArticleLookup: boolean;
  statuteQuery: string;
  displayTargetLabel: string;
}

/**
 * Shared parser for HomeTab & CommandSearchModal (⌘K) so "585", "民法典第585条",
 * and "民法典第五百八十五条" route identically to the local offline statute corpus.
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
    const canonical = lawPrefix ? `${lawPrefix}第${parsed.exactNo}条` : String(parsed.exactNo);
    const label = lawPrefix
      ? `《${lawPrefix}》第 ${parsed.exactNo} 条`
      : `第 ${parsed.exactNo} 条（优先《民法典》及常用单行法）`;
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
