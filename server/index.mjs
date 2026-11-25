import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import {
  dedupeNearDuplicateImaItems,
  extractDocxTextFromBuffer,
  extractLegalSearchTerms,
  extractPdfTextFromBuffer,
  normalizeExtractedText,
  scoreImaSearchItem,
} from './imaHelpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT_DIR;
fs.mkdirSync(DATA_DIR, { recursive: true });
const ACCOUNT_REGISTRY_PATH = path.join(DATA_DIR, '.account-registry.json');
const TELEMETRY_COUNTS_PATH = path.join(DATA_DIR, '.telemetry-counts.json');
const USER_VAULTS_DIR = path.join(DATA_DIR, '.user-vaults');
const VAULT_MASTER_KEY_PATH = path.join(DATA_DIR, '.vault-master.key');

const ALLOWED_TELEMETRY_TOOL_IDS = new Set([
  'elements-complaint',
  'litigation-fee-calculator',
  'lpr-interest-calculator',
  'date-calculator',
  'labor-compensation',
  'injury-compensation',
  'evidence-pdf-toolkit',
  'local-redactor',
  'lawyer-fee-quote',
  'preservation-deadline',
  'rmb-debt-offset',
  'meeting-scratchpad',
  'ai:contract-review',
  'ai:de-ai-polish',
  'ai:timeline-elements',
  'ai:cross-exam-questions',
  'ai:client-wechat-reply',
  'ai:legal-sandbox',
  'ima-cloud-qa',
]);

function loadTelemetryCounts() {
  try {
    if (fs.existsSync(TELEMETRY_COUNTS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(TELEMETRY_COUNTS_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return {
          updatedAt: String(parsed.updatedAt || ''),
          totals: parsed.totals && typeof parsed.totals === 'object' ? parsed.totals : {},
          daily: parsed.daily && typeof parsed.daily === 'object' ? parsed.daily : {},
        };
      }
    }
  } catch {
    // ignore corrupt cache
  }
  return { updatedAt: '', totals: {}, daily: {} };
}

let telemetryCache = loadTelemetryCounts();

function recordAnonymousToolHit(toolId) {
  if (!ALLOWED_TELEMETRY_TOOL_IDS.has(toolId)) return false;
  const today = getTodayChinaYmd();
  const nextTotals = { ...telemetryCache.totals, [toolId]: (Number(telemetryCache.totals[toolId]) || 0) + 1 };
  const todayBucket = { ...(telemetryCache.daily[today] || {}) };
  todayBucket[toolId] = (Number(todayBucket[toolId]) || 0) + 1;
  const nextDaily = { ...telemetryCache.daily, [today]: todayBucket };
  const sortedDays = Object.keys(nextDaily).sort();
  while (sortedDays.length > 60) {
    const oldest = sortedDays.shift();
    if (oldest) delete nextDaily[oldest];
  }
  telemetryCache = {
    updatedAt: new Date().toISOString(),
    totals: nextTotals,
    daily: nextDaily,
  };
  try {
    const tmp = `${TELEMETRY_COUNTS_PATH}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(telemetryCache, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, TELEMETRY_COUNTS_PATH);
    fs.chmodSync(TELEMETRY_COUNTS_PATH, 0o600);
  } catch {
    // best-effort persistence
  }
  return true;
}

function summarizeTelemetryStats() {
  const todayMs = Date.now() + 8 * 3600 * 1000;
  const cutoffYmd = new Date(todayMs - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const last30Days = {};
  let last30Total = 0;
  for (const [ymd, bucket] of Object.entries(telemetryCache.daily || {})) {
    if (ymd < cutoffYmd || !bucket || typeof bucket !== 'object') continue;
    for (const [id, count] of Object.entries(bucket)) {
      const n = Number(count) || 0;
      if (n <= 0) continue;
      last30Days[id] = (last30Days[id] || 0) + n;
      last30Total += n;
    }
  }
  const totals = { ...(telemetryCache.totals || {}) };
  const totalHits = Object.values(totals).reduce((sum, v) => sum + (Number(v) || 0), 0);
  return {
    updatedAt: telemetryCache.updatedAt || '',
    totalHits,
    last30Total,
    totals,
    last30Days,
  };
}

// Lightweight built-in .env loader (zero external dependencies; existing process.env takes precedence)
try {
  const envPath = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      if (k && process.env[k] === undefined) {
        process.env[k] = v;
      }
    }
  }
} catch {
  // ignore malformed .env
}

const PORT = Number(process.env.PORT || 3681);
const HOST = process.env.BIND_HOST || '127.0.0.1';
const AUTH_MODE = process.env.AUTH_MODE === 'license' ? 'license' : 'open';
const ENABLE_AI_RELAY = process.env.ENABLE_AI_RELAY !== 'false';
const AI_RELAY_RPM_LIMIT = Math.max(5, Number(process.env.AI_RELAY_RPM_LIMIT || 60));

// Team License Public Verification JWK (generated via `npm run init-keys`; ZERO private keys on server)
const PUBLIC_VERIFY_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'REPLACE_VIA_NPM_RUN_INIT_KEYS_PUBLIC_X_COORDINATE',
  y: 'REPLACE_VIA_NPM_RUN_INIT_KEYS_PUBLIC_Y_COORDINATE',
};

function loadVerifyKeyRegistry() {
  const overrideRaw = String(process.env.OVERRIDE_PUBLIC_VERIFY_JWK || '').trim();
  if (overrideRaw) {
    try {
      const parsed = JSON.parse(overrideRaw);
      if (parsed && parsed.kty === 'EC' && parsed.x && parsed.y) {
        return { v1: parsed };
      }
    } catch {
      console.error('[license] Invalid OVERRIDE_PUBLIC_VERIFY_JWK JSON ignored');
    }
  }
  return { v1: PUBLIC_VERIFY_JWK };
}

const VERIFY_KEYS = loadVerifyKeyRegistry();

// Optional comma-separated upstream hostname / suffix allowlist for /api/ai-relay
// e.g. RELAY_ALLOWED_HOSTS="api.deepseek.com,.aliyuncs.com" (empty = allow any public HTTPS host)
const RELAY_ALLOWED_HOSTS = String(process.env.RELAY_ALLOWED_HOSTS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const MAX_CONCURRENT_RELAYS_PER_ACCOUNT = Math.max(
  1,
  Number(process.env.MAX_CONCURRENT_RELAYS_PER_ACCOUNT || 3)
);
const RELAY_CONNECT_TIMEOUT_MS = 15 * 1000;
const RELAY_IDLE_TIMEOUT_MS = 120 * 1000;
const ACTIVE_RELAY_COUNTS = new Map();

// H-2: In-memory per-endpoint rate limiter + auth-failure IP temporary ban
const RATE_LIMIT_BUCKETS = new Map();
const AUTH_FAILURE_TRACKER = new Map();
const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000;
const AUTH_FAIL_BAN_MS = 10 * 60 * 1000;
const AUTH_FAIL_BAN_THRESHOLD = Math.max(5, Number(process.env.AUTH_FAIL_BAN_THRESHOLD || 20));

// H-3: Admin Nonce anti-replay cache (10-min TTL) & 2-min timestamp window
const SEEN_ADMIN_NONCES = new Map();
const ADMIN_NONCE_TTL_MS = 10 * 60 * 1000;
const ADMIN_TS_WINDOW_MS = 2 * 60 * 1000;

// S-4: Short-lived opaque download/preview tickets for /api/ima/file (replaces ?lic= query param)
const IMA_FILE_TICKETS = new Map();
const IMA_FILE_TICKET_TTL_MS = 60 * 1000;

function getClientIp(req) {
  const remote = String(req.socket?.remoteAddress || 'unknown');
  const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (isLoopback) {
    const forwarded = String(req.headers['x-real-ip'] || '').trim();
    if (forwarded && forwarded.length <= 64) return forwarded;
  }
  return remote;
}

function checkRateLimit(bucketName, key, limitPerMin, windowMs = 60 * 1000) {
  const now = Date.now();
  if (RATE_LIMIT_BUCKETS.size > 4000) {
    for (const [k, v] of RATE_LIMIT_BUCKETS) {
      if (now >= v.resetAt) RATE_LIMIT_BUCKETS.delete(k);
    }
  }
  const mapKey = `${bucketName}:${key}`;
  const entry = RATE_LIMIT_BUCKETS.get(mapKey);
  if (!entry || now >= entry.resetAt) {
    RATE_LIMIT_BUCKETS.set(mapKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count > limitPerMin) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function getIpBanRemainingSec(ip) {
  const rec = AUTH_FAILURE_TRACKER.get(ip);
  if (!rec) return 0;
  const now = Date.now();
  if (rec.bannedUntil && now < rec.bannedUntil) {
    return Math.max(1, Math.ceil((rec.bannedUntil - now) / 1000));
  }
  if (rec.bannedUntil && now >= rec.bannedUntil) {
    AUTH_FAILURE_TRACKER.delete(ip);
  }
  return 0;
}

function recordAuthFailure(ip) {
  const now = Date.now();
  if (AUTH_FAILURE_TRACKER.size > 2000) {
    for (const [k, v] of AUTH_FAILURE_TRACKER) {
      if (now - v.windowStart > AUTH_FAIL_WINDOW_MS && (!v.bannedUntil || now >= v.bannedUntil)) {
        AUTH_FAILURE_TRACKER.delete(k);
      }
    }
  }
  const rec = AUTH_FAILURE_TRACKER.get(ip);
  if (!rec || now - rec.windowStart > AUTH_FAIL_WINDOW_MS) {
    AUTH_FAILURE_TRACKER.set(ip, { count: 1, windowStart: now, bannedUntil: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= AUTH_FAIL_BAN_THRESHOLD) {
    rec.bannedUntil = now + AUTH_FAIL_BAN_MS;
  }
}

function pruneExpiredTickets() {
  const now = Date.now();
  for (const [t, rec] of IMA_FILE_TICKETS) {
    if (now > rec.expiresAt || rec.uses >= rec.maxUses) {
      IMA_FILE_TICKETS.delete(t);
    }
  }
}

function issueImaFileTicket({ realMediaId, fileName, download, accountKey }) {
  if (IMA_FILE_TICKETS.size > 1000) pruneExpiredTickets();
  const ticket = crypto.randomBytes(24).toString('base64url');
  IMA_FILE_TICKETS.set(ticket, {
    realMediaId,
    fileName,
    download: Boolean(download),
    accountKey,
    uses: 0,
    maxUses: download ? 1 : 3,
    expiresAt: Date.now() + IMA_FILE_TICKET_TTL_MS,
  });
  return ticket;
}

function consumeImaFileTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const rec = IMA_FILE_TICKETS.get(ticket);
  if (!rec) return null;
  if (Date.now() > rec.expiresAt || rec.uses >= rec.maxUses) {
    IMA_FILE_TICKETS.delete(ticket);
    return null;
  }
  rec.uses += 1;
  if (rec.uses >= rec.maxUses) {
    IMA_FILE_TICKETS.delete(ticket);
  }
  return rec;
}

// Demo team roster seed (only used when AUTH_MODE=license; customize or manage in Admin Console)
const OFFICIAL_ROSTER_SEED = [
  { holderName: '张示范', role: '主任', serialNo: 'LAW-2026-001' },
  { holderName: '李示例', role: '合伙人', serialNo: '' },
  { holderName: '王示例', role: '专职律师', serialNo: '' },
];

// STRICT ALLOWLIST: Only expose explicitly configured public statutory/case libraries!
const IMA_LAW_CASES_SHARE_URL =
  process.env.IMA_KB_SHARE_URL ||
  'https://ima.qq.com/wiki/?shareId=a5d4993fac94797dc3892f0157c5a4011efd105c495d2b0e45ac311dc7dda91b';
const IMA_PRIMARY_KB_NAME = process.env.IMA_PRIMARY_KB_NAME || '法律法规案例库（持续更新）';

const PUBLIC_KB_CATALOG = [
  {
    alias: 'law_cases',
    targetName: IMA_PRIMARY_KB_NAME,
    badge: '开源推荐公开库 · 4.48万份 · 支持原文与AI问答',
    subtitle:
      '含人民法院案例库参考案例、2026最新法律与司法解释、法答网精选、各省高院指导文件、规章、国标及AI合规文件',
    canReadOriginal: true,
    externalOnly: false,
    shareUrl: IMA_LAW_CASES_SHARE_URL,
  },
  {
    alias: 'national_laws',
    targetName: '国家法律知识库',
    badge: '外部订阅全文库 · 39.6万条 · 需去IMA官方端查阅',
    subtitle:
      '收录现行法律、行政法规、司法解释、地方性法规 Markdown 文本（腾讯接口限制第三方读取订阅库原文，请直达 IMA 客户端/网页版免费语义问答）',
    canReadOriginal: false,
    externalOnly: true,
    shareUrl: 'https://ima.qq.com/',
  },
];

// Per-IP sliding window rate limiter for /api/ai-relay (prevents public proxy abuse)
const RELAY_RATE_BUCKETS = new Map();
function checkRelayRateLimit(req) {
  const ip =
    String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local')
      .split(',')[0]
      .trim();
  const now = Date.now();
  const windowMs = 60 * 1000;
  let hits = RELAY_RATE_BUCKETS.get(ip) || [];
  hits = hits.filter((ts) => now - ts < windowMs);
  if (hits.length >= AI_RELAY_RPM_LIMIT) {
    RELAY_RATE_BUCKETS.set(ip, hits);
    return false;
  }
  hits.push(now);
  RELAY_RATE_BUCKETS.set(ip, hits);
  if (RELAY_RATE_BUCKETS.size > 1000) {
    const oldest = RELAY_RATE_BUCKETS.keys().next().value;
    if (oldest) RELAY_RATE_BUCKETS.delete(oldest);
  }
  return true;
}

// In-memory LRU text extraction cache (15 min TTL, max 40 docs) for fast PDF/DOCX reading & AI RAG
const EXTRACT_CACHE = new Map();
const EXTRACT_CACHE_TTL_MS = 15 * 60 * 1000;
const EXTRACT_CACHE_MAX = 40;

function getCachedExtract(key) {
  const hit = EXTRACT_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > EXTRACT_CACHE_TTL_MS) {
    EXTRACT_CACHE.delete(key);
    return null;
  }
  return hit.data;
}

function setCachedExtract(key, data) {
  if (EXTRACT_CACHE.size >= EXTRACT_CACHE_MAX) {
    const oldestKey = EXTRACT_CACHE.keys().next().value;
    if (oldestKey) EXTRACT_CACHE.delete(oldestKey);
  }
  EXTRACT_CACHE.set(key, { at: Date.now(), data });
}

let resolvedKbIdCache = null;
let cachedAtMs = 0;
const cachedPublicKeys = new Map();

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function readTrimmedSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
}

function getTodayChinaYmd() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function isFirmAdminRole(role) {
  return role === '主任' || role === '主任律师';
}

async function getVerifyPublicKey(keyId = 'v1') {
  const resolvedId = String(keyId || 'v1');
  const jwk = VERIFY_KEYS[resolvedId];
  if (!jwk) return null;
  if (!cachedPublicKeys.has(resolvedId)) {
    const imported = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    cachedPublicKeys.set(resolvedId, imported);
  }
  return cachedPublicKeys.get(resolvedId);
}

// =========================================================================
// Lightweight Atomic Account Registry (Enable / Disable Lawyer Accounts)
// Canonical key is `name:<holderName>` so one lawyer = one row, re-issuing codes
// never collides across colleagues, and disabling a lawyer blocks ALL their codes.
// =========================================================================
function makeAccountKey(serialNo, holderName) {
  const n = String(holderName || '').trim();
  const s = String(serialNo || '').trim();
  return n ? `name:${n}` : s;
}

function loadAccountRegistry() {
  try {
    if (fs.existsSync(ACCOUNT_REGISTRY_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(ACCOUNT_REGISTRY_PATH, 'utf8'));
      if (parsed && typeof parsed.accounts === 'object' && parsed.accounts !== null) {
        // Normalize & deduplicate any legacy serialNo-keyed entries into canonical name:<holderName>
        const normalized = {};
        let migrated = false;
        for (const [oldKey, rawRec] of Object.entries(parsed.accounts)) {
          if (!rawRec || typeof rawRec !== 'object') continue;
          const holderName = String(rawRec.holderName || '').trim();
          const serialNo = String(rawRec.serialNo || '').trim();
          const canonKey = makeAccountKey(serialNo, holderName);
          if (!canonKey) continue;
          if (canonKey !== oldKey || rawRec.key !== canonKey) migrated = true;
          const prev = normalized[canonKey];
          const hasExplicitActivated = Object.prototype.hasOwnProperty.call(rawRec, 'activatedAt');
          const resolvedActivatedAt = hasExplicitActivated
            ? String(rawRec.activatedAt || '')
            : String(rawRec.lastSeenAt || '');
          const resolvedCode = String(rawRec.activationCode || '').trim();
          if (!prev) {
            normalized[canonKey] = {
              key: canonKey,
              serialNo,
              holderName: holderName || serialNo,
              role: String(rawRec.role || '专职律师').trim(),
              status: rawRec.status === 'disabled' ? 'disabled' : 'active',
              expiresAt: String(rawRec.expiresAt || ''),
              issuedAt: String(rawRec.issuedAt || ''),
              activatedAt: resolvedActivatedAt,
              lastSeenAt: String(rawRec.lastSeenAt || ''),
              activationCode: resolvedCode.startsWith('TR1-') ? resolvedCode : '',
              updatedAt: String(rawRec.updatedAt || new Date().toISOString()),
              note: String(rawRec.note || ''),
            };
          } else {
            migrated = true;
            prev.status = prev.status === 'disabled' || rawRec.status === 'disabled' ? 'disabled' : 'active';
            if (serialNo && (!prev.serialNo || (rawRec.updatedAt || '') >= (prev.updatedAt || ''))) {
              prev.serialNo = serialNo;
            }
            if (resolvedActivatedAt && (!prev.activatedAt || resolvedActivatedAt < prev.activatedAt)) {
              prev.activatedAt = resolvedActivatedAt;
            }
            if ((rawRec.lastSeenAt || '') > (prev.lastSeenAt || '')) prev.lastSeenAt = rawRec.lastSeenAt;
            if (resolvedCode.startsWith('TR1-') && !prev.activationCode) prev.activationCode = resolvedCode;
            if ((rawRec.updatedAt || '') > (prev.updatedAt || '')) prev.updatedAt = rawRec.updatedAt;
          }
        }
        const reg = { version: 3, accounts: normalized };
        if (migrated || parsed.version !== 3) {
          try {
            const tmp = `${ACCOUNT_REGISTRY_PATH}.tmp.${process.pid}`;
            fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), { mode: 0o600 });
            fs.renameSync(tmp, ACCOUNT_REGISTRY_PATH);
            fs.chmodSync(ACCOUNT_REGISTRY_PATH, 0o600);
          } catch {
            // ignore startup migration write failure
          }
        }
        return reg;
      }
    }
  } catch {
    // fallback to seed
  }
  const now = new Date().toISOString();
  const accounts = {};
  for (const m of OFFICIAL_ROSTER_SEED) {
    const key = makeAccountKey(m.serialNo, m.holderName);
    accounts[key] = {
      key,
      serialNo: m.serialNo,
      holderName: m.holderName,
      role: m.role,
      status: 'active',
      expiresAt: '',
      issuedAt: '',
      activatedAt: '',
      lastSeenAt: '',
      activationCode: '',
      updatedAt: now,
      note: '',
    };
  }
  return { version: 3, accounts };
}

let accountRegistryCache = loadAccountRegistry();

function saveAccountRegistry(reg) {
  accountRegistryCache = reg;
  try {
    const tmp = `${ACCOUNT_REGISTRY_PATH}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, ACCOUNT_REGISTRY_PATH);
    fs.chmodSync(ACCOUNT_REGISTRY_PATH, 0o600);
  } catch (err) {
    console.error('[account-registry] Failed to persist:', err instanceof Error ? err.message : err);
  }
}

function checkAndTouchAccount(wire, rawToken = '') {
  const accounts = accountRegistryCache.accounts || {};
  const serialNo = String(wire.s || '').trim();
  const holderName = String(wire.n || '').trim();
  const role = String(wire.r || '专职律师').trim();
  const cleanToken = String(rawToken || '').trim().startsWith('TR1-') ? String(rawToken || '').trim() : '';

  const key = makeAccountKey(serialNo, holderName);
  const entry = accounts[key] || null;
  const legacySerialEntry = !entry && serialNo ? accounts[serialNo] : null;
  const matched = entry || legacySerialEntry;

  if (matched && matched.status === 'disabled') {
    return {
      active: false,
      reason: matched.note
        ? `该律师账号已被律所管理端停用（${matched.note}），请联系主任`
        : '该律师账号已被律所管理端停用，请联系主任恢复授权',
    };
  }

  // Auto-discover & touch activatedAt/lastSeenAt (one canonical row per lawyer)
  const now = new Date().toISOString();
  let dirty = false;

  if (!entry) {
    accounts[key] = {
      key,
      serialNo,
      holderName: holderName || serialNo,
      role: legacySerialEntry?.role || role,
      status: 'active',
      expiresAt: wire.e || '',
      issuedAt: wire.t || '',
      activatedAt: now,
      lastSeenAt: now,
      activationCode: cleanToken || legacySerialEntry?.activationCode || '',
      updatedAt: now,
      note: legacySerialEntry?.note || '',
    };
    if (legacySerialEntry && serialNo !== key) {
      delete accounts[serialNo];
    }
    dirty = true;
  } else {
    if (serialNo && entry.serialNo !== serialNo) {
      entry.serialNo = serialNo;
      dirty = true;
    }
    if (!entry.activatedAt) {
      entry.activatedAt = now;
      dirty = true;
    }
    if (cleanToken && entry.activationCode !== cleanToken) {
      entry.activationCode = cleanToken;
      dirty = true;
    }
    const prevSeen = entry.lastSeenAt ? Date.parse(entry.lastSeenAt) : 0;
    if (!prevSeen || Date.now() - prevSeen > 5 * 60 * 1000) {
      entry.lastSeenAt = now;
      if (wire.e) entry.expiresAt = wire.e;
      if (wire.t) entry.issuedAt = wire.t;
      dirty = true;
    }
  }

  if (dirty) {
    saveAccountRegistry({ version: 3, accounts });
  }
  return { active: true };
}

function getSyncVaultMasterKey() {
  if (process.env.SYNC_VAULT_SECRET && process.env.SYNC_VAULT_SECRET.trim()) {
    return crypto.createHash('sha256').update(process.env.SYNC_VAULT_SECRET.trim()).digest();
  }
  try {
    if (fs.existsSync(VAULT_MASTER_KEY_PATH)) {
      const raw = fs.readFileSync(VAULT_MASTER_KEY_PATH, 'utf8').trim();
      if (raw.length >= 32) {
        return crypto.createHash('sha256').update(raw).digest();
      }
    }
  } catch {
    // regenerate if unreadable
  }
  const secret = crypto.randomBytes(32).toString('base64url');
  try {
    const tmp = `${VAULT_MASTER_KEY_PATH}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, `${secret}\n`, { mode: 0o600 });
    fs.renameSync(tmp, VAULT_MASTER_KEY_PATH);
    fs.chmodSync(VAULT_MASTER_KEY_PATH, 0o600);
  } catch (err) {
    console.error('[sync-vault] Failed to persist master key:', err instanceof Error ? err.message : err);
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function getUserVaultFilePath(canonicalAccountKey) {
  const hash = crypto.createHash('sha256').update(`vault-v1:${canonicalAccountKey}`).digest('hex');
  return path.join(USER_VAULTS_DIR, `${hash}.json`);
}

function readEncryptedUserVault(canonicalAccountKey) {
  const fp = getUserVaultFilePath(canonicalAccountKey);
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!raw || !raw.iv || !raw.tag || !raw.ciphertext) return null;
    const key = getSyncVaultMasterKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(raw.iv, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(raw.tag, 'base64url'));
    const plainStr = Buffer.concat([
      decipher.update(Buffer.from(raw.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plainStr);
    return {
      revision: Number(raw.revision) || 1,
      updatedAt: Number(raw.updatedAt) || 0,
      clientEncrypted: Boolean(raw.clientEncrypted),
      deviceLabel: String(raw.deviceLabel || ''),
      payload: parsed,
    };
  } catch {
    return null;
  }
}

function writeEncryptedUserVault(canonicalAccountKey, record) {
  fs.mkdirSync(USER_VAULTS_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(USER_VAULTS_DIR, 0o700);
  } catch {
    // ignore
  }
  const key = getSyncVaultMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plainBytes = Buffer.from(JSON.stringify(record.payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope = {
    version: 1,
    revision: record.revision,
    updatedAt: record.updatedAt,
    clientEncrypted: Boolean(record.clientEncrypted),
    deviceLabel: String(record.deviceLabel || '').slice(0, 64),
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ciphertext: enc.toString('base64url'),
  };

  const fp = getUserVaultFilePath(canonicalAccountKey);
  const tmp = `${fp}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
  fs.renameSync(tmp, fp);
  fs.chmodSync(fp, 0o600);
}

function deleteEncryptedUserVault(canonicalAccountKey) {
  const fp = getUserVaultFilePath(canonicalAccountKey);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
    return true;
  }
  return false;
}

function loadImaCredentials() {
  let clientId = process.env.IMA_OPENAPI_CLIENTID || process.env.IMA_CLIENT_ID || '';
  let apiKey = process.env.IMA_OPENAPI_APIKEY || process.env.IMA_API_KEY || '';

  if (!clientId || !apiKey) {
    const serverCredPath = path.join(ROOT_DIR, '.ima-credentials.json');
    if (fs.existsSync(serverCredPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(serverCredPath, 'utf8'));
        clientId = clientId || parsed.clientId || '';
        apiKey = apiKey || parsed.apiKey || '';
      } catch {
        // ignore
      }
    }
  }

  if (!clientId || !apiKey) {
    const homeIma = path.join(os.homedir(), '.config', 'ima');
    clientId = clientId || readTrimmedSafe(path.join(homeIma, 'client_id'));
    apiKey = apiKey || readTrimmedSafe(path.join(homeIma, 'api_key'));
  }

  if (!clientId || !apiKey) return null;
  return { clientId, apiKey };
}

async function verifyTianranLicenseDetailed(rawToken, opts = {}) {
  const shouldTouch = opts.touch !== false;
  if (!rawToken || !rawToken.startsWith('TR1-')) {
    return { valid: false, active: false, reason: '未检测到有效的团队专属激活凭证' };
  }
  const body = rawToken.slice(4);
  const dot = body.indexOf('.');
  if (dot <= 0) {
    return { valid: false, active: false, reason: '激活凭证格式不完整' };
  }
  try {
    const payloadBytes = Buffer.from(body.slice(0, dot), 'base64url');
    const sigBytes = Buffer.from(body.slice(dot + 1), 'base64url');
    if (sigBytes.length !== 64 || payloadBytes.length === 0 || payloadBytes.length > 4096) {
      return { valid: false, active: false, reason: '激活凭证签名或载荷长度无效' };
    }

    const wire = JSON.parse(payloadBytes.toString('utf8'));
    const keyId = String(wire?.k || 'v1');
    const pubKey = await getVerifyPublicKey(keyId);
    if (!pubKey) {
      return { valid: false, active: false, reason: `未知的验签公钥版本（${keyId}）` };
    }

    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      sigBytes,
      payloadBytes
    );
    if (!ok) {
      return { valid: false, active: false, reason: '激活凭证防伪签名未通过' };
    }

    if (wire.i !== 'TR' || !wire.n) {
      return { valid: false, active: false, reason: '激活凭证缺少律所标识或持有人信息' };
    }
    const todayCn = getTodayChinaYmd();
    if (wire.e && todayCn > wire.e) {
      return { valid: true, active: false, wire, reason: `该专属激活码已于 ${wire.e} 到期，请联系主任续期` };
    }

    const accountState = shouldTouch
      ? checkAndTouchAccount(wire, rawToken)
      : (() => {
          const accounts = accountRegistryCache.accounts || {};
          const key = makeAccountKey(String(wire.s || '').trim(), String(wire.n || '').trim());
          const matched = accounts[key] || (wire.s ? accounts[String(wire.s).trim()] : null);
          if (matched && matched.status === 'disabled') {
            return { active: false, reason: '该律师账号已被律所管理端停用' };
          }
          return { active: true };
        })();
    if (!accountState.active) {
      return { valid: true, active: false, wire, reason: accountState.reason };
    }
    return { valid: true, active: true, wire };
  } catch {
    return { valid: false, active: false, reason: '激活凭证解析失败' };
  }
}

async function verifyAdminSignedRequest(req, pathname, rawBodyText) {
  const lic = await verifyTianranLicenseDetailed(String(req.headers['x-toolbox-license'] || ''), {
    touch: false,
  });
  if (!lic.valid || !lic.active || !lic.wire || !isFirmAdminRole(lic.wire.r)) {
    return { ok: false, status: 403, error: '仅限启用状态的主任律师账号访问管理端接口' };
  }

  const tsStr = String(req.headers['x-toolbox-admin-ts'] || '').trim();
  const nonce = String(req.headers['x-toolbox-admin-nonce'] || '').trim();
  const sigB64 = String(req.headers['x-toolbox-admin-sig'] || '').trim();
  const tsNum = Number(tsStr);
  const now = Date.now();
  if (!tsStr || !Number.isFinite(tsNum) || Math.abs(now - tsNum) > ADMIN_TS_WINDOW_MS) {
    return { ok: false, status: 403, error: '管理请求时间戳已过期（超过2分钟窗口）或无效，请核对设备时间后重试' };
  }
  if (!nonce || nonce.length < 12 || nonce.length > 128 || !/^[A-Za-z0-9_-]+$/.test(nonce)) {
    return { ok: false, status: 403, error: '缺少有效的防重放 Nonce，请刷新工作台页面后重试' };
  }
  if (!sigB64) {
    return { ok: false, status: 403, error: '缺少主任私钥签名，请先在管理端填入 TR-MASTER-... 主密钥' };
  }

  if (SEEN_ADMIN_NONCES.size > 1000) {
    for (const [k, exp] of SEEN_ADMIN_NONCES) {
      if (now >= exp) SEEN_ADMIN_NONCES.delete(k);
    }
  }
  const seenExp = SEEN_ADMIN_NONCES.get(nonce);
  if (seenExp && now < seenExp) {
    return { ok: false, status: 403, error: '管理请求 Nonce 已被使用（防重放拦截），请重新发起操作' };
  }

  try {
    const sigBytes = Buffer.from(sigB64, 'base64url');
    if (sigBytes.length !== 64) {
      return { ok: false, status: 403, error: '管理端签名格式无效' };
    }
    const bodyHash = crypto.createHash('sha256').update(rawBodyText || '', 'utf8').digest('hex');
    const signingMsg = Buffer.from(`${req.method}:${pathname}:${tsStr}:${nonce}:${bodyHash}`, 'utf8');
    const pubKey = await getVerifyPublicKey(lic.wire.k || 'v1');
    if (!pubKey) {
      return { ok: false, status: 403, error: '无法定位对应的验签公钥版本' };
    }
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      sigBytes,
      signingMsg
    );
    if (!ok) {
      return { ok: false, status: 403, error: '主任私钥签名核验未通过，请确认 TR-MASTER-... 主密钥正确' };
    }
    SEEN_ADMIN_NONCES.set(nonce, now + ADMIN_NONCE_TTL_MS);
    return { ok: true, adminWire: lic.wire };
  } catch {
    return { ok: false, status: 403, error: '管理端签名校验失败' };
  }
}

async function callImaOpenApi(apiPath, bodyObj) {
  const creds = loadImaCredentials();
  if (!creds) {
    const err = new Error('服务器尚未配置腾讯 IMA OpenAPI 凭证');
    err.statusCode = 503;
    throw err;
  }
  const resp = await fetch(`https://ima.qq.com/${apiPath}`, {
    method: 'POST',
    headers: {
      'ima-openapi-clientid': creds.clientId,
      'ima-openapi-apikey': creds.apiKey,
      'ima-openapi-ctx': 'skill_version=1.1.9',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyObj || {}),
  });
  const parsed = await resp.json();
  if (parsed.code !== 0 && parsed.code !== undefined) {
    const err = new Error(parsed.msg || `IMA 接口返回错误 (${parsed.code})`);
    err.imaCode = parsed.code;
    err.statusCode = parsed.code === 220030 || parsed.code === 110030 ? 403 : 502;
    throw err;
  }
  return parsed.data || {};
}

async function getAllowlistedKbMap() {
  if (resolvedKbIdCache && Date.now() - cachedAtMs < 30 * 60 * 1000) {
    return resolvedKbIdCache;
  }
  const data = await callImaOpenApi('openapi/wiki/v1/search_knowledge_base', {
    query: '',
    cursor: '',
    limit: 20,
  });
  const list = data.info_list || [];
  const map = new Map();
  const matchedIds = [];

  for (const allowed of PUBLIC_KB_CATALOG) {
    const found = list.find((item) => (item.kb_name || item.name) === allowed.targetName);
    if (found) {
      const kbId = found.kb_id || found.id;
      matchedIds.push(kbId);
      map.set(allowed.alias, {
        alias: allowed.alias,
        name: allowed.targetName,
        badge: allowed.badge,
        subtitle: allowed.subtitle,
        canReadOriginal: allowed.canReadOriginal,
        externalOnly: allowed.externalOnly,
        shareUrl: allowed.shareUrl,
        contentCount: found.content_count || '',
        memberCount: found.member_count || '',
        recommendedQuestions: [],
        kbId,
      });
    }
  }

  // Enrich with official recommended_questions from get_knowledge_base (best-effort)
  if (matchedIds.length > 0) {
    try {
      const detail = await callImaOpenApi('openapi/wiki/v1/get_knowledge_base', {
        ids: matchedIds,
      });
      const infos = detail.infos || {};
      for (const entry of map.values()) {
        const info = infos[entry.kbId];
        if (info && Array.isArray(info.recommended_questions)) {
          entry.recommendedQuestions = info.recommended_questions.slice(0, 5);
        }
      }
    } catch {
      // ignore metadata enrichment failure
    }
  }

  resolvedKbIdCache = map;
  cachedAtMs = Date.now();
  return map;
}

function getSealKey() {
  const creds = loadImaCredentials();
  const seed = creds
    ? `${creds.clientId}:${creds.apiKey}:cn-lawyer-ima-seal-v1`
    : 'cn-lawyer-fallback-dev-seal-v1';
  return crypto.createHash('sha256').update(seed).digest();
}

function toOpaqueId(realId, prefix = 'm') {
  if (!realId) return '';
  const key = getSealKey();
  const iv = crypto.createHmac('sha256', key).update(realId).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(realId, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, enc]).toString('base64url');
  return `${prefix}_${packed}`;
}

function fromOpaqueId(token) {
  if (!token || typeof token !== 'string') return '';
  const sep = token.indexOf('_');
  if (sep <= 0) return '';
  try {
    const buf = Buffer.from(token.slice(sep + 1), 'base64url');
    if (buf.length <= 28) return '';
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const key = getSealKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function detectItemKind(mediaId, title, mediaType) {
  if (mediaType === 99 || String(mediaId).startsWith('folder_')) return 'folder';
  const lower = String(title || '').toLowerCase();
  if (lower.endsWith('.pdf') || String(mediaId).startsWith('pdf_')) return 'pdf';
  if (lower.endsWith('.docx') || lower.endsWith('.doc') || String(mediaId).startsWith('word_')) return 'word';
  if (lower.endsWith('.md') || lower.endsWith('.txt') || String(mediaId).startsWith('txt_')) return 'text';
  return 'file';
}

function isPrivateIp(ip) {
  const lower = String(ip || '').toLowerCase();
  if (lower.startsWith('::ffff:')) {
    return isPrivateIp(lower.slice(7));
  }
  if (net.isIPv4(lower)) {
    const parts = lower.split('.').map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    );
  }
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80')
  );
}

function isRelayHostAllowed(hostname) {
  if (RELAY_ALLOWED_HOSTS.length === 0) return true;
  const host = String(hostname || '').toLowerCase();
  return RELAY_ALLOWED_HOSTS.some((rule) => {
    if (rule.startsWith('.')) {
      return host === rule.slice(1) || host.endsWith(rule);
    }
    return host === rule;
  });
}

async function resolveAndValidatePublicHttpsUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    const err = new Error('目标大模型接口地址格式无效');
    err.statusCode = 400;
    throw err;
  }
  if (parsed.protocol !== 'https:') {
    const err = new Error('仅允许转发至外部 HTTPS 大模型接口');
    err.statusCode = 400;
    throw err;
  }
  if (parsed.username || parsed.password) {
    const err = new Error('目标地址不得包含内嵌认证凭据');
    err.statusCode = 400;
    throw err;
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!isRelayHostAllowed(hostname)) {
    const err = new Error(`目标域名 ${hostname} 不在服务器允许的中转域名白名单中`);
    err.statusCode = 403;
    throw err;
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion) {
    if (isPrivateIp(hostname)) {
      const err = new Error('禁止访问内网或本机回环地址');
      err.statusCode = 403;
      throw err;
    }
    return { parsed, pinnedAddress: hostname, pinnedFamily: ipVersion };
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    const err = new Error(`无法解析目标大模型域名：${hostname}`);
    err.statusCode = 502;
    err.publicMessage = err.message;
    throw err;
  }
  if (!records || records.length === 0) {
    const err = new Error(`目标域名无可用解析记录：${hostname}`);
    err.statusCode = 502;
    err.publicMessage = err.message;
    throw err;
  }
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      const err = new Error('禁止访问内网或本机回环地址');
      err.statusCode = 403;
      throw err;
    }
  }
  const preferred = records.find((r) => r.family === 4) || records[0];
  return {
    parsed,
    pinnedAddress: preferred.address,
    pinnedFamily: preferred.family,
  };
}

function sendJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    ...extraHeaders,
  });
  res.end(JSON.stringify(obj));
}

async function readRawBody(req, maxBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('请求体过大');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
}

async function readJsonBody(req, maxBytes = 256 * 1024) {
  const raw = await readRawBody(req, maxBytes);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('请求体不是合法的 JSON 格式');
    err.statusCode = 400;
    throw err;
  }
}

function sanitizeRelayHeaders(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const blocked = new Set([
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'keep-alive',
    'upgrade',
    'cookie',
    'x-toolbox-license',
    'x-toolbox-admin-ts',
    'x-toolbox-admin-nonce',
    'x-toolbox-admin-sig',
    'x-forwarded-for',
    'x-real-ip',
  ]);
  for (const [k, v] of Object.entries(raw)) {
    if (!k || blocked.has(k.toLowerCase())) continue;
    if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
  }
  return out;
}

function pipeWebStreamSafely(webBody, res) {
  const nodeStream = Readable.fromWeb(webBody);
  nodeStream.on('error', () => {
    if (!res.writableEnded) res.end();
  });
  res.on('close', () => {
    if (!nodeStream.destroyed) nodeStream.destroy();
  });
  nodeStream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const fullUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = fullUrl.pathname;
    const clientIp = getClientIp(req);

    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        service: 'cn-lawyer-ai-toolbox',
        authMode: AUTH_MODE,
        uptimeSec: Math.floor(process.uptime()),
      });
    }

    if (pathname.startsWith('/api/')) {
      const banSec = getIpBanRemainingSec(clientIp);
      if (banSec > 0) {
        return sendJson(
          res,
          429,
          { ok: false, error: `鉴权失败次数过多，当前 IP 已临时封禁，请 ${banSec} 秒后重试` },
          { 'Retry-After': String(banSec) }
        );
      }
    }

    // =========================================================================
    // 0. Real-Time License Status & Director Account Enable/Disable Console API
    // =========================================================================
    if (pathname === '/api/license/status' && req.method === 'GET') {
      const rl = checkRateLimit('license-status', clientIp, 30);
      if (!rl.allowed) {
        return sendJson(
          res,
          429,
          { ok: false, error: '状态校验请求过于频繁，请稍后再试' },
          { 'Retry-After': String(rl.retryAfterSec) }
        );
      }
      const licenseHeader = req.headers['x-toolbox-license'] || '';
      const result = await verifyTianranLicenseDetailed(String(licenseHeader));
      if (!result.valid) {
        recordAuthFailure(clientIp);
        return sendJson(res, 403, { ok: false, active: false, error: result.reason });
      }
      return sendJson(res, 200, {
        ok: true,
        active: result.active,
        holderName: result.wire?.n || '',
        role: result.wire?.r || '',
        serialNo: result.wire?.s || '',
        reason: result.active ? '' : result.reason || '账号已停用',
      });
    }

    // =========================================================================
    // 0b. Per-License Encrypted Cross-Device Cloud Sync Vault API (AUTH_MODE=license)
    // =========================================================================
    if (pathname === '/api/sync/vault') {
      if (AUTH_MODE !== 'license') {
        return sendJson(res, 200, {
          ok: true,
          supported: false,
          exists: false,
          revision: 0,
          updatedAt: 0,
          clientEncrypted: false,
          deviceLabel: '',
          payload: null,
        });
      }

      const licenseHeader = req.headers['x-toolbox-license'] || '';
      const auth = await verifyTianranLicenseDetailed(String(licenseHeader));
      if (!auth.valid || !auth.active || !auth.wire) {
        recordAuthFailure(clientIp);
        return sendJson(res, 403, {
          ok: false,
          error: auth.reason || '未检测到有效的团队激活凭证，无法使用跨端云同步',
        });
      }

      const canonKey = makeAccountKey(String(auth.wire.s || '').trim(), String(auth.wire.n || '').trim());
      if (!canonKey) {
        return sendJson(res, 400, { ok: false, error: '无法识别当前激活码所属账户标识' });
      }
      const rl = checkRateLimit('sync-vault', canonKey, 20);
      if (!rl.allowed) {
        return sendJson(
          res,
          429,
          { ok: false, error: '云端配置同步过于频繁，请稍后再试' },
          { 'Retry-After': String(rl.retryAfterSec) }
        );
      }

      if (req.method === 'GET') {
        const existing = readEncryptedUserVault(canonKey);
        if (!existing) {
          return sendJson(res, 200, {
            ok: true,
            supported: true,
            exists: false,
            revision: 0,
            updatedAt: 0,
            clientEncrypted: false,
            deviceLabel: '',
            payload: null,
          });
        }
        return sendJson(res, 200, {
          ok: true,
          supported: true,
          exists: true,
          revision: existing.revision,
          updatedAt: existing.updatedAt,
          clientEncrypted: existing.clientEncrypted,
          deviceLabel: existing.deviceLabel,
          payload: existing.payload,
        });
      }

      if (req.method === 'POST' || req.method === 'PUT') {
        const body = await readJsonBody(req, 2 * 1024 * 1024);
        if (!body || body.payload === undefined || body.payload === null) {
          return sendJson(res, 400, { ok: false, error: '缺少同步配置载荷 payload' });
        }
        const incomingUpdatedAt = Number(body.updatedAt) || Date.now();
        const baseRevision = Number(body.baseRevision) || 0;
        const force = Boolean(body.force);
        const clientEncrypted = Boolean(body.clientEncrypted);
        const deviceLabel = String(body.deviceLabel || '').slice(0, 64);

        const existing = readEncryptedUserVault(canonKey);
        if (
          !force &&
          existing &&
          existing.revision > baseRevision &&
          existing.updatedAt > incomingUpdatedAt
        ) {
          return sendJson(res, 409, {
            ok: false,
            conflict: true,
            error: '云端存在更新版本的配置，请先拉取合并或选择强制覆盖',
            serverRevision: existing.revision,
            serverUpdatedAt: existing.updatedAt,
            clientEncrypted: existing.clientEncrypted,
            deviceLabel: existing.deviceLabel,
            payload: existing.payload,
          });
        }

        const nextRevision = (existing?.revision || 0) + 1;
        writeEncryptedUserVault(canonKey, {
          revision: nextRevision,
          updatedAt: incomingUpdatedAt,
          clientEncrypted,
          deviceLabel,
          payload: body.payload,
        });

        return sendJson(res, 200, {
          ok: true,
          revision: nextRevision,
          updatedAt: incomingUpdatedAt,
        });
      }

      if (req.method === 'DELETE') {
        const deleted = deleteEncryptedUserVault(canonKey);
        return sendJson(res, 200, { ok: true, deleted });
      }

      return sendJson(res, 405, { ok: false, error: '不支持的请求方法' });
    }

    // =========================================================================
    // 0c. Privacy-Preserving Anonymous Tool-Open Counter (AUTH_MODE=license only)
    // =========================================================================
    if (pathname === '/api/telemetry/tool-hit' && req.method === 'POST') {
      if (AUTH_MODE !== 'license') {
        return sendJson(res, 200, { ok: true, skipped: true });
      }
      const licenseHeader = req.headers['x-toolbox-license'] || '';
      const auth = await verifyTianranLicenseDetailed(String(licenseHeader));
      if (!auth.valid || !auth.active) {
        recordAuthFailure(clientIp);
        return sendJson(res, 403, { ok: false, error: '无效激活凭证' });
      }
      const rlKey = makeAccountKey(String(auth.wire?.s || ''), String(auth.wire?.n || '')) || clientIp;
      const rl = checkRateLimit('telemetry', rlKey, 60);
      if (!rl.allowed) {
        return sendJson(res, 429, { ok: false, error: '请求过于频繁' }, { 'Retry-After': String(rl.retryAfterSec) });
      }
      const body = await readJsonBody(req, 4096);
      const toolId = String(body?.toolId || '').trim();
      if (!ALLOWED_TELEMETRY_TOOL_IDS.has(toolId)) {
        return sendJson(res, 400, { ok: false, error: '不支持的统计模块标识' });
      }
      recordAnonymousToolHit(toolId);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/admin/')) {
      const rl = checkRateLimit('admin', clientIp, 30);
      if (!rl.allowed) {
        return sendJson(
          res,
          429,
          { ok: false, error: '管理端请求过于频繁，请稍后再试' },
          { 'Retry-After': String(rl.retryAfterSec) }
        );
      }
      const rawBody = req.method === 'POST' ? await readRawBody(req, 512 * 1024) : '';
      const auth = await verifyAdminSignedRequest(req, pathname, rawBody);
      if (!auth.ok) {
        recordAuthFailure(clientIp);
        return sendJson(res, auth.status, { ok: false, error: auth.error });
      }

      let body = {};
      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          return sendJson(res, 400, { ok: false, error: '请求体不是合法的 JSON 格式' });
        }
      }

      if (req.method === 'GET' && pathname === '/api/admin/telemetry') {
        return sendJson(res, 200, { ok: true, ...summarizeTelemetryStats() });
      }

      if (req.method === 'GET' && pathname === '/api/admin/accounts') {
        const list = Object.values(accountRegistryCache.accounts || {}).sort((a, b) => {
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          if (a.serialNo && b.serialNo) return a.serialNo.localeCompare(b.serialNo);
          if (a.serialNo) return -1;
          if (b.serialNo) return 1;
          return a.holderName.localeCompare(b.holderName, 'zh-CN');
        });
        return sendJson(res, 200, { ok: true, accounts: list });
      }

      if (req.method === 'POST' && pathname === '/api/admin/accounts/upsert') {
        const items = Array.isArray(body.accounts) ? body.accounts : [body];
        const accounts = { ...(accountRegistryCache.accounts || {}) };
        const now = new Date().toISOString();
        let count = 0;

        for (const it of items) {
          const holderName = String(it?.holderName || '').trim();
          const serialNo = String(it?.serialNo || '').trim();
          if (!holderName && !serialNo) continue;
          const key = makeAccountKey(serialNo, holderName);
          const prev = accounts[key] || null;

          const incomingCode = String(it?.activationCode || '').trim();
          accounts[key] = {
            key,
            serialNo: serialNo || prev?.serialNo || '',
            holderName: holderName || prev?.holderName || serialNo,
            role: String(it?.role || prev?.role || '专职律师').trim(),
            status: it?.status === 'disabled' ? 'disabled' : prev?.status || 'active',
            expiresAt: String(it?.expiresAt ?? prev?.expiresAt ?? '').trim(),
            issuedAt: String(it?.issuedAt ?? prev?.issuedAt ?? '').trim(),
            activatedAt: prev?.activatedAt || '',
            lastSeenAt: prev?.lastSeenAt || '',
            activationCode: incomingCode.startsWith('TR1-')
              ? incomingCode
              : prev?.activationCode || '',
            updatedAt: now,
            note: String(it?.note ?? prev?.note ?? '').trim(),
          };
          count++;
        }

        saveAccountRegistry({ version: 3, accounts });
        return sendJson(res, 200, {
          ok: true,
          updated: count,
          accounts: Object.values(accounts),
        });
      }

      if (req.method === 'POST' && pathname === '/api/admin/accounts/toggle') {
        const key = String(body.key || '').trim();
        const nextStatus = body.status === 'disabled' ? 'disabled' : 'active';
        const note = typeof body.note === 'string' ? body.note.trim() : undefined;
        const accounts = { ...(accountRegistryCache.accounts || {}) };
        const target = accounts[key];
        if (!target) {
          return sendJson(res, 404, { ok: false, error: '未找到对应的律师账户记录' });
        }

        // Prevent self-lockout of the currently authenticated Managing Partner account (match by holderName)
        const adminSerial = String(auth.adminWire.s || '').trim();
        const adminName = String(auth.adminWire.n || '').trim();
        const isSelfTarget = adminName
          ? target.holderName === adminName
          : Boolean(adminSerial && target.serialNo === adminSerial);
        if (nextStatus === 'disabled' && isSelfTarget) {
          return sendJson(res, 400, { ok: false, error: '为防误锁管理端，不可停用您当前登录的主任账号' });
        }

        target.status = nextStatus;
        target.updatedAt = new Date().toISOString();
        if (note !== undefined) target.note = note;
        saveAccountRegistry({ version: 3, accounts });

        return sendJson(res, 200, { ok: true, account: target });
      }

      if (req.method === 'POST' && pathname === '/api/admin/accounts/delete') {
        const key = String(body.key || '').trim();
        const accounts = { ...(accountRegistryCache.accounts || {}) };
        const target = accounts[key];
        if (!target) {
          return sendJson(res, 404, { ok: false, error: '未找到该账户记录' });
        }
        const adminSerial = String(auth.adminWire.s || '').trim();
        const adminName = String(auth.adminWire.n || '').trim();
        const isSelfTarget = adminName
          ? target.holderName === adminName
          : Boolean(adminSerial && target.serialNo === adminSerial);
        if (isSelfTarget) {
          return sendJson(res, 400, { ok: false, error: '不可删除当前登录的主任账号' });
        }
        delete accounts[key];
        saveAccountRegistry({ version: 3, accounts });
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { ok: false, error: '未知的管理端接口' });
    }

    // =========================================================================
    // 1. Read-Only Allowlisted Tencent IMA Public Law & Case Library Gateway
    // =========================================================================
    if (pathname.startsWith('/api/ima/')) {
      // S-4: GET /api/ima/file authenticates exclusively via short-lived opaque ticket (NEVER ?lic= in URL!)
      if (req.method === 'GET' && pathname === '/api/ima/file') {
        const rl = checkRateLimit('ima-file', clientIp, 60);
        if (!rl.allowed) {
          return sendJson(
            res,
            429,
            { ok: false, error: '文献下载请求过于频繁，请稍后再试' },
            { 'Retry-After': String(rl.retryAfterSec) }
          );
        }
        const ticketParam = fullUrl.searchParams.get('ticket') || '';
        const ticketRec = consumeImaFileTicket(ticketParam);
        if (!ticketRec) {
          recordAuthFailure(clientIp);
          return sendJson(res, 403, {
            ok: false,
            error: '临时文件凭据无效或已过期（60秒单次有效），请回到页面重新点击查看或下载',
          });
        }
        if (AUTH_MODE === 'license') {
          const acct = (accountRegistryCache.accounts || {})[ticketRec.accountKey];
          if (acct && acct.status === 'disabled') {
            return sendJson(res, 403, { ok: false, error: '该律师账号已被停用，拒绝下载文献' });
          }
        }

        let mediaData;
        try {
          mediaData = await callImaOpenApi('openapi/wiki/v1/get_media_info', {
            media_id: ticketRec.realMediaId,
          });
        } catch (err) {
          if (err && err.imaCode === 220030) {
            return sendJson(res, 403, {
              ok: false,
              imaCode: 220030,
              error:
                '该外部订阅知识库受腾讯 IMA 接口权限限制，暂不支持直接下载原件，请点击「去 IMA 客户端/网页版打开」查阅。',
            });
          }
          throw err;
        }

        const urlInfo = mediaData.url_info;
        if (!urlInfo || !urlInfo.url) {
          return sendJson(res, 404, { ok: false, error: '该条目暂不支持直接读取原文' });
        }

        const targetHost = new URL(urlInfo.url).hostname.toLowerCase();
        if (!targetHost.endsWith('.myqcloud.com') && !targetHost.endsWith('.qq.com')) {
          return sendJson(res, 403, { ok: false, error: '非受信任的媒体存储源' });
        }

        const cosResp = await fetch(urlInfo.url, {
          headers: urlInfo.headers || {},
        });

        if (!cosResp.ok || !cosResp.body) {
          return sendJson(res, 502, { ok: false, error: `读取云端文件失败 (${cosResp.status})` });
        }

        const fileName = ticketRec.fileName || 'document';
        const lowerName = fileName.toLowerCase();
        let contentType = cosResp.headers.get('content-type') || 'application/octet-stream';
        if (lowerName.endsWith('.pdf')) contentType = 'application/pdf';
        else if (lowerName.endsWith('.md') || lowerName.endsWith('.txt'))
          contentType = 'text/plain; charset=utf-8';
        else if (lowerName.endsWith('.docx'))
          contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        const encodedName = encodeURIComponent(fileName);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `${ticketRec.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodedName}`,
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        });
        pipeWebStreamSafely(cosResp.body, res);
        return;
      }

      let imaAccountKey = clientIp;
      if (AUTH_MODE === 'license') {
        const licenseHeader = req.headers['x-toolbox-license'] || '';
        const auth = await verifyTianranLicenseDetailed(String(licenseHeader));
        if (!auth.valid || !auth.active) {
          recordAuthFailure(clientIp);
          return sendJson(res, 403, {
            ok: false,
            error: auth.reason || '未检测到有效的团队激活凭证，拒绝访问云端法规案例网关',
          });
        }
        imaAccountKey = makeAccountKey(String(auth.wire?.s || ''), String(auth.wire?.n || '')) || clientIp;
      }

      const rl = checkRateLimit('ima', imaAccountKey, 60);
      if (!rl.allowed) {
        return sendJson(
          res,
          429,
          { ok: false, error: '云端法规检索过于频繁，请稍后再试' },
          { 'Retry-After': String(rl.retryAfterSec) }
        );
      }

      if (req.method === 'POST' && pathname === '/api/ima/file-ticket') {
        const body = await readJsonBody(req, 16 * 1024);
        const itemKey = String(body.itemKey || '').trim();
        const fileName = String(body.name || 'document').trim().slice(0, 180) || 'document';
        const download = Boolean(body.download);
        const realMediaId = fromOpaqueId(itemKey);
        if (!realMediaId) {
          return sendJson(res, 404, { ok: false, error: '文件索引已过期，请重新检索后再点开' });
        }
        const ticket = issueImaFileTicket({
          realMediaId,
          fileName,
          download,
          accountKey: imaAccountKey,
        });
        return sendJson(res, 200, {
          ok: true,
          ticket,
          expiresInSec: Math.floor(IMA_FILE_TICKET_TTL_MS / 1000),
          url: `/api/ima/file?ticket=${encodeURIComponent(ticket)}`,
        });
      }

      if (req.method === 'GET' && pathname === '/api/ima/catalog') {
        const creds = loadImaCredentials();
        if (!creds) {
          return sendJson(res, 200, {
            ok: true,
            configured: false,
            libraries: PUBLIC_KB_CATALOG.map(({ targetName, ...rest }) => ({
              ...rest,
              name: targetName,
              contentCount: '',
              memberCount: '',
              recommendedQuestions: [],
            })),
          });
        }
        const kbMap = await getAllowlistedKbMap();
        const libraries = Array.from(kbMap.values()).map(({ kbId, ...pub }) => pub);
        return sendJson(res, 200, { ok: true, configured: true, libraries });
      }

      if (req.method === 'POST' && pathname === '/api/ima/search') {
        const body = await readJsonBody(req);
        const kbAlias = String(body.kb || 'law_cases');
        const query = String(body.query || '').trim();
        const cursor = String(body.cursor || '');
        const filesOnly = Boolean(body.filesOnly);
        const smart = body.smart !== false;

        if (!query) {
          return sendJson(res, 400, { ok: false, error: '请输入检索关键词或法律问题' });
        }

        const kbMap = await getAllowlistedKbMap();
        const targetKb = kbMap.get(kbAlias);
        if (!targetKb) {
          return sendJson(res, 403, { ok: false, error: '仅允许检索公开授权的法律法规案例库' });
        }

        // Paginated continuation on single cursor
        if (cursor) {
          const data = await callImaOpenApi('openapi/wiki/v1/search_knowledge', {
            knowledge_base_id: targetKb.kbId,
            query,
            cursor,
          });
          const items = (data.info_list || [])
            .map((it) => {
              const kind = detectItemKind(it.media_id, it.title, it.media_type);
              return {
                itemKey: toOpaqueId(it.media_id, kind === 'folder' ? 'f' : 'm'),
                title: it.title || '',
                kind,
                highlight: it.highlight_content || '',
                canReadOriginal: targetKb.canReadOriginal,
              };
            })
            .filter((it) => !filesOnly || it.kind !== 'folder');

          return sendJson(res, 200, {
            ok: true,
            kbName: targetKb.name,
            canReadOriginal: targetKb.canReadOriginal,
            shareUrl: targetKb.shareUrl,
            query,
            usedTerms: [query],
            items,
            isEnd: Boolean(data.is_end),
            nextCursor: data.next_cursor || '',
          });
        }

        // First page: smart multi-term expansion + legal authority re-ranking
        const terms = smart ? extractLegalSearchTerms(query) : [query];
        const queryList = terms.length > 0 ? terms : [query];

        const settled = await Promise.allSettled(
          queryList.map((term) =>
            callImaOpenApi('openapi/wiki/v1/search_knowledge', {
              knowledge_base_id: targetKb.kbId,
              query: term,
              cursor: '',
            }).then((data) => ({ term, data }))
          )
        );

        const dedupMap = new Map();
        let singleTermCursor = '';
        let singleTermIsEnd = true;

        for (const resItem of settled) {
          if (resItem.status !== 'fulfilled') continue;
          const { term, data } = resItem.value;
          if (queryList.length === 1 && term === queryList[0]) {
            singleTermCursor = data.next_cursor || '';
            singleTermIsEnd = data.is_end === undefined ? !singleTermCursor : Boolean(data.is_end);
          }
          for (const it of data.info_list || []) {
            if (!it?.media_id) continue;
            if (!dedupMap.has(it.media_id)) {
              const kind = detectItemKind(it.media_id, it.title, it.media_type);
              if (filesOnly && kind === 'folder') continue;
              const entry = {
                itemKey: toOpaqueId(it.media_id, kind === 'folder' ? 'f' : 'm'),
                title: it.title || '',
                kind,
                highlight: it.highlight_content || '',
                canReadOriginal: targetKb.canReadOriginal,
              };
              entry.relevanceScore = scoreImaSearchItem(entry, query, queryList);
              dedupMap.set(it.media_id, entry);
            }
          }
        }

        const sortedAll = Array.from(dedupMap.values()).sort(
          (a, b) => b.relevanceScore - a.relevanceScore
        );
        const ranked = dedupeNearDuplicateImaItems(sortedAll)
          .slice(0, 60)
          .map(({ relevanceScore, ...clean }) => clean);

        return sendJson(res, 200, {
          ok: true,
          kbName: targetKb.name,
          canReadOriginal: targetKb.canReadOriginal,
          shareUrl: targetKb.shareUrl,
          query,
          usedTerms: queryList,
          items: ranked,
          isEnd: queryList.length === 1 ? singleTermIsEnd : true,
          nextCursor: queryList.length === 1 ? singleTermCursor : '',
        });
      }

      if (req.method === 'POST' && pathname === '/api/ima/extract') {
        const body = await readJsonBody(req);
        const itemKey = String(body.itemKey || '').trim();
        const title = String(body.title || 'document').trim();
        const kind = String(body.kind || 'file').trim();
        const maxChars = Math.min(Math.max(Number(body.maxChars) || 36000, 1500), 60000);

        const realMediaId = fromOpaqueId(itemKey);
        if (!realMediaId) {
          return sendJson(res, 404, { ok: false, error: '文件索引已过期，请重新检索后再点开' });
        }

        const cached = getCachedExtract(realMediaId);
        if (cached) {
          const text = cached.fullText.slice(0, maxChars);
          return sendJson(res, 200, {
            ok: true,
            cached: true,
            title: title || cached.title,
            kind: cached.kind,
            text,
            charCount: text.length,
            fullCharCount: cached.fullText.length,
            truncated: cached.fullText.length > maxChars,
            pageCount: cached.pageCount,
            isScannedPdf: cached.isScannedPdf,
          });
        }

        let mediaData;
        try {
          mediaData = await callImaOpenApi('openapi/wiki/v1/get_media_info', {
            media_id: realMediaId,
          });
        } catch (err) {
          if (err && err.imaCode === 220030) {
            return sendJson(res, 403, {
              ok: false,
              imaCode: 220030,
              error:
                '该文献所属外部订阅库受腾讯 IMA 权限限制，暂不支持第三方接口直读原文，请点击「去 IMA 客户端/网页版打开」查阅与免费问答。',
            });
          }
          throw err;
        }

        // Branch 1: IMA Note (media_type === 11)
        if (mediaData.media_type === 11 && mediaData.notebook_ext_info?.notebook_id) {
          const noteRes = await callImaOpenApi('openapi/note/v1/get_doc_content', {
            note_id: mediaData.notebook_ext_info.notebook_id,
            target_content_format: 0,
          });
          const fullText = normalizeExtractedText(noteRes.content || '');
          const record = {
            title,
            kind: 'text',
            fullText,
            pageCount: 1,
            isScannedPdf: false,
          };
          setCachedExtract(realMediaId, record);
          const text = fullText.slice(0, maxChars);
          return sendJson(res, 200, {
            ok: true,
            title,
            kind: 'text',
            text,
            charCount: text.length,
            fullCharCount: fullText.length,
            truncated: fullText.length > maxChars,
            pageCount: 1,
            isScannedPdf: false,
          });
        }

        const urlInfo = mediaData.url_info;
        if (!urlInfo || !urlInfo.url) {
          return sendJson(res, 404, {
            ok: false,
            error: '该条目暂不支持接口直读原文，请前往腾讯 IMA 官方知识库查看。',
          });
        }

        const targetHost = new URL(urlInfo.url).hostname.toLowerCase();
        if (!targetHost.endsWith('.myqcloud.com') && !targetHost.endsWith('.qq.com')) {
          return sendJson(res, 403, { ok: false, error: '非受信任的媒体存储源' });
        }

        const cosResp = await fetch(urlInfo.url, {
          headers: urlInfo.headers || {},
        });
        if (!cosResp.ok) {
          return sendJson(res, 502, { ok: false, error: `读取云端原件失败 (${cosResp.status})` });
        }

        const contentLen = Number(cosResp.headers.get('content-length') || 0);
        const MAX_DOC_BYTES = 25 * 1024 * 1024;
        if (contentLen > MAX_DOC_BYTES) {
          return sendJson(res, 413, {
            ok: false,
            error: `该文献原件超过 25MB (${(contentLen / 1024 / 1024).toFixed(1)}MB)，请点击「下载原件」或前往 IMA 官方端阅读。`,
          });
        }

        const arrBuf = await cosResp.arrayBuffer();
        if (arrBuf.byteLength > MAX_DOC_BYTES) {
          return sendJson(res, 413, {
            ok: false,
            error: '该文献原件体积过大，请直接下载原件查看。',
          });
        }

        const buf = Buffer.from(arrBuf);
        const lowerTitle = title.toLowerCase();
        const isPdf =
          kind === 'pdf' ||
          lowerTitle.endsWith('.pdf') ||
          buf.subarray(0, 5).toString('ascii') === '%PDF-';
        const isDocx = lowerTitle.endsWith('.docx');
        const isLegacyDoc = lowerTitle.endsWith('.doc') && !isDocx;

        let fullText = '';
        let pageCount = 1;
        let isScannedPdf = false;
        let resolvedKind = kind;

        if (isPdf) {
          resolvedKind = 'pdf';
          const extracted = await extractPdfTextFromBuffer(buf);
          fullText = extracted.text;
          pageCount = extracted.pageCount || 1;
          if (fullText.length < 24) {
            isScannedPdf = true;
          }
        } else if (isDocx) {
          resolvedKind = 'word';
          fullText = extractDocxTextFromBuffer(buf);
        } else if (isLegacyDoc) {
          return sendJson(res, 200, {
            ok: true,
            title,
            kind: 'word',
            text: '',
            charCount: 0,
            fullCharCount: 0,
            truncated: false,
            pageCount: 1,
            isScannedPdf: false,
            legacyDoc: true,
            notice: '该文件为旧版二进制 .doc 格式，请点击「下载原件」或前往腾讯 IMA 客户端查看完整排版。',
          });
        } else {
          resolvedKind = 'text';
          fullText = normalizeExtractedText(buf.toString('utf8'));
        }

        setCachedExtract(realMediaId, {
          title,
          kind: resolvedKind,
          fullText,
          pageCount,
          isScannedPdf,
        });

        const text = fullText.slice(0, maxChars);
        return sendJson(res, 200, {
          ok: true,
          title,
          kind: resolvedKind,
          text,
          charCount: text.length,
          fullCharCount: fullText.length,
          truncated: fullText.length > maxChars,
          pageCount,
          isScannedPdf,
        });
      }

      if (req.method === 'POST' && pathname === '/api/ima/browse') {
        const body = await readJsonBody(req);
        const kbAlias = String(body.kb || 'law_cases');
        const folderKey = String(body.folderKey || '');
        const cursor = String(body.cursor || '');

        const kbMap = await getAllowlistedKbMap();
        const targetKb = kbMap.get(kbAlias);
        if (!targetKb) {
          return sendJson(res, 403, { ok: false, error: '仅允许浏览公开授权的法律法规案例库' });
        }

        const realFolderId = folderKey ? fromOpaqueId(folderKey) : '';
        if (folderKey && !realFolderId) {
          return sendJson(res, 400, { ok: false, error: '目录会话已刷新，请返回根目录重新点入' });
        }

        const reqPayload = {
          knowledge_base_id: targetKb.kbId,
          cursor,
          limit: 30,
          ...(realFolderId ? { folder_id: realFolderId } : {}),
        };

        const data = await callImaOpenApi('openapi/wiki/v1/get_knowledge_list', reqPayload);
        const breadcrumbs = (data.current_path || []).map((p, idx) => ({
          folderKey: idx === 0 || p.folder_id === targetKb.kbId ? '' : toOpaqueId(p.folder_id, 'f'),
          name: idx === 0 ? targetKb.name : p.name,
        }));

        const items = (data.knowledge_list || []).map((it) => {
          const kind = detectItemKind(it.media_id, it.title, it.media_type);
          return {
            itemKey: toOpaqueId(it.media_id, kind === 'folder' ? 'f' : 'm'),
            title: it.title || '',
            kind,
          };
        });

        return sendJson(res, 200, {
          ok: true,
          kbName: targetKb.name,
          breadcrumbs,
          items,
          isEnd: Boolean(data.is_end),
          nextCursor: data.next_cursor || '',
        });
      }

      return sendJson(res, 404, { ok: false, error: '未知的 IMA 网关接口' });
    }

    // =========================================================================
    // 2. Stateless Zero-Log CORS Pass-Through Relay for Custom BYOK LLMs
    //    H-1: DNS-rebinding-proof pinned-IP https.request + timeouts + concurrency cap
    // =========================================================================
    if (req.method === 'POST' && pathname === '/api/ai-relay') {
      if (!ENABLE_AI_RELAY) {
        return sendJson(res, 403, {
          ok: false,
          error: '当前站点已关闭服务端跨域中转（ENABLE_AI_RELAY=false），请直接使用支持浏览器直连的大模型厂商（如 DeepSeek、阿里云百炼、硅基流动等）',
        });
      }

      let accountKey = clientIp;
      if (AUTH_MODE === 'license') {
        const licenseHeader = req.headers['x-toolbox-license'] || '';
        const auth = await verifyTianranLicenseDetailed(String(licenseHeader));
        if (!auth.valid || !auth.active) {
          recordAuthFailure(clientIp);
          return sendJson(res, 403, {
            ok: false,
            error: auth.reason || '未检测到有效的团队激活凭证，拒绝使用跨域转发通道',
          });
        }
        accountKey = makeAccountKey(String(auth.wire?.s || ''), String(auth.wire?.n || '')) || clientIp;
      }

      const rl = checkRateLimit('ai-relay', accountKey, AI_RELAY_RPM_LIMIT);
      if (!rl.allowed) {
        return sendJson(
          res,
          429,
          { ok: false, error: `AI 中转请求过于频繁（限流 ${AI_RELAY_RPM_LIMIT} 次/分钟），请稍后再试` },
          { 'Retry-After': String(rl.retryAfterSec) }
        );
      }

      const activeCount = ACTIVE_RELAY_COUNTS.get(accountKey) || 0;
      if (activeCount >= MAX_CONCURRENT_RELAYS_PER_ACCOUNT) {
        return sendJson(
          res,
          429,
          {
            ok: false,
            error: `当前账户已有 ${MAX_CONCURRENT_RELAYS_PER_ACCOUNT} 路 AI 流式中转正在进行，请等待完成后再发起新请求`,
          },
          { 'Retry-After': '5' }
        );
      }

      const payload = await readJsonBody(req, 8 * 1024 * 1024);
      const { parsed, pinnedAddress, pinnedFamily } = await resolveAndValidatePublicHttpsUrl(
        payload.targetUrl
      );
      const upstreamMethod = String(payload.method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
      const sanitized = sanitizeRelayHeaders(payload.headers);
      const hasUserAgent = Object.keys(sanitized).some((k) => k.toLowerCase() === 'user-agent');
      const upstreamHeaders = {
        ...sanitized,
        ...(hasUserAgent ? {} : { 'User-Agent': 'cn-lawyer-ai-toolbox/1.6' }),
        Host: parsed.host,
      };
      const bodyStr =
        upstreamMethod === 'GET' || payload.body === undefined || payload.body === null
          ? ''
          : typeof payload.body === 'string'
            ? payload.body
            : JSON.stringify(payload.body);
      if (upstreamMethod !== 'GET' && bodyStr) {
        upstreamHeaders['Content-Length'] = String(Buffer.byteLength(bodyStr, 'utf8'));
      }

      ACTIVE_RELAY_COUNTS.set(accountKey, activeCount + 1);
      let slotReleased = false;
      const releaseSlot = () => {
        if (slotReleased) return;
        slotReleased = true;
        const cur = ACTIVE_RELAY_COUNTS.get(accountKey) || 0;
        if (cur <= 1) ACTIVE_RELAY_COUNTS.delete(accountKey);
        else ACTIVE_RELAY_COUNTS.set(accountKey, cur - 1);
      };

      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(connectTimer);
          releaseSlot();
          resolve();
        };

        const upstreamReq = https.request(
          {
            protocol: 'https:',
            hostname: parsed.hostname,
            port: parsed.port ? Number(parsed.port) : 443,
            path: `${parsed.pathname}${parsed.search}`,
            method: upstreamMethod,
            headers: upstreamHeaders,
            servername: parsed.hostname,
            autoSelectFamily: false,
            lookup: (_host, opts, cb) => {
              if (typeof opts === 'function') {
                opts(null, pinnedAddress, pinnedFamily);
                return;
              }
              if (opts && opts.all) {
                cb(null, [{ address: pinnedAddress, family: pinnedFamily }]);
              } else {
                cb(null, pinnedAddress, pinnedFamily);
              }
            },
          },
          (upstreamRes) => {
            clearTimeout(connectTimer);
            const status = upstreamRes.statusCode || 502;
            if (status >= 300 && status < 400 && upstreamRes.headers.location) {
              upstreamRes.resume();
              if (!res.headersSent) {
                sendJson(res, 502, {
                  ok: false,
                  error: '上游大模型接口返回跳转重定向，出于防 SSRF 安全策略已拒绝跟随',
                });
              }
              done();
              return;
            }

            if (!res.headersSent) {
              res.writeHead(status, {
                'Content-Type':
                  upstreamRes.headers['content-type'] ||
                  (upstreamMethod === 'GET'
                    ? 'application/json; charset=utf-8'
                    : 'text/event-stream; charset=utf-8'),
                'Cache-Control': 'no-cache, no-transform',
                'X-Robots-Tag': 'noindex, nofollow, noarchive',
                ...(upstreamMethod === 'GET' ? {} : { Connection: 'keep-alive' }),
              });
            }

            upstreamRes.on('error', () => {
              if (!res.writableEnded) res.end();
              done();
            });
            upstreamRes.on('end', done);
            upstreamRes.pipe(res);
          }
        );

        const connectTimer = setTimeout(() => {
          upstreamReq.destroy(new Error('CONNECT_TIMEOUT'));
        }, RELAY_CONNECT_TIMEOUT_MS);

        upstreamReq.setTimeout(RELAY_IDLE_TIMEOUT_MS, () => {
          upstreamReq.destroy(new Error('IDLE_TIMEOUT'));
        });

        upstreamReq.on('error', (err) => {
          const code = err instanceof Error ? err.message : '';
          if (!res.headersSent) {
            if (code === 'CONNECT_TIMEOUT' || code === 'IDLE_TIMEOUT') {
              sendJson(res, 504, {
                ok: false,
                error:
                  code === 'CONNECT_TIMEOUT'
                    ? '上游大模型接口连接超时（15 秒），请检查服务商地址或网络状态'
                    : '上游大模型流式输出空闲超时（120 秒），连接已自动断开',
              });
            } else {
              console.error('[ai-relay] Upstream request failed:', err instanceof Error ? err.message : err);
              sendJson(res, 502, {
                ok: false,
                error: '连接外部大模型接口失败，请确认 API 地址有效且支持标准 HTTPS 证书',
              });
            }
          } else if (!res.writableEnded) {
            res.end();
          }
          done();
        });

        res.on('close', () => {
          if (!res.writableEnded) {
            upstreamReq.destroy();
          }
          done();
        });

        if (upstreamMethod !== 'GET' && bodyStr) {
          upstreamReq.write(bodyStr);
        }
        upstreamReq.end();
      });
      return;
    }

    // Reject all unknown /api/* methods & paths with strict 404 JSON (never fall back to index.html)
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: '接口不存在或请求方法不受支持' });
    }

    // =========================================================================
    // 3. Static PWA File Serving (H-8: strict decodeURIComponent & DIST_DIR boundary)
    // =========================================================================
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      return sendJson(res, 400, { ok: false, error: '请求路径编码格式无效' });
    }
    const safeRel = path.normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '');
    let filePath = path.resolve(DIST_DIR, safeRel || 'index.html');
    if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) {
      return sendJson(res, 403, { ok: false, error: '禁止访问站点根目录以外的路径' });
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    const isImmutable = pathname.startsWith('/assets/');

    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Cache-Control': isImmutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache, must-revalidate',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[cn-lawyer-ai-toolbox] Request error:', req.method, req.url, err);
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    const status = Number(err?.statusCode) || 500;
    const isSafeClientErr = status >= 400 && status < 500;
    const clientMessage = isSafeClientErr
      ? err instanceof Error
        ? err.message
        : '请求参数有误'
      : err?.publicMessage || '服务暂时不可用，请稍后重试';
    sendJson(res, status, {
      ok: false,
      error: clientMessage,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `[cn-lawyer-ai-toolbox] Ready at http://${HOST}:${PORT} (AUTH_MODE=${AUTH_MODE}, AI_RELAY=${ENABLE_AI_RELAY})`
  );
});
