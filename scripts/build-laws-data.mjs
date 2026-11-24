import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'laws-offline.json');
const OPTIONAL_SOURCE = process.env.LAWS_CORPUS_SOURCE || '';

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

if (!OPTIONAL_SOURCE || !fs.existsSync(OPTIONAL_SOURCE)) {
  if (fs.existsSync(OUT_FILE)) {
    const sizeKb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
    console.log(`[build-laws-data] Using bundled public/data/laws-offline.json (${sizeKb} KB)`);
    process.exit(0);
  }
  console.error('[build-laws-data] Missing public/data/laws-offline.json.');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(OPTIONAL_SOURCE, 'utf8'));
const civilArticles = (raw.articles || []).map((a) => ({
  no: a.articleNo,
  label: a.articleLabel,
  book: a.bookTitle || '',
  chapter: a.chapterTitle || '',
  section: a.sectionTitle || '',
  summary: a.summaryTitle || '',
  text: a.fullText || '',
  proviso: Boolean(a.hasProviso),
  defaultRule: Boolean(a.isDefaultRule),
  litTips: (a.autoLitigationTips || []).slice(0, 3),
  nonLitTips: (a.autoNonLitigationTips || []).slice(0, 3),
  interpRefs: (a.judicialInterpRefs || []).slice(0, 6).map((r) => ({
    docTitle: r.shortTitle || r.docTitle || '',
    label: r.articleLabel || '',
    snippet: r.snippet || r.content || '',
  })),
}));

const companionDocs = (raw.companionDocs || []).map((doc) => ({
  id: doc.docId,
  kind: doc.groupKind || doc.category || 'interp',
  shortTitle: doc.shortTitle || '',
  fullTitle: doc.fullTitle || doc.shortTitle || '',
  docNo: doc.docNo || '',
  count: doc.itemCount || (doc.items ? doc.items.length : 0),
  items: (doc.items || []).map((it) => ({
    no: it.itemNo,
    label: it.articleLabel || `第${it.itemNo}条`,
    section: it.sectionTitle || '',
    text: it.content || '',
    linkedCivil: it.linkedArticles || [],
  })),
}));

const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  civilCount: civilArticles.length,
  docCount: companionDocs.length,
  totalArticles:
    civilArticles.length + companionDocs.reduce((acc, d) => acc + d.items.length, 0),
  civilArticles,
  companionDocs,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
console.log(`[build-laws-data] Rebuilt laws-offline.json (${payload.totalArticles} articles)`);
