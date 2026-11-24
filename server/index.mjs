import http from 'node:http';
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
const ACCOUNT_REGISTRY_PATH = path.join(ROOT_DIR, '.account-registry.json');

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
let cachedPublicKey = null;

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

async function getVerifyPublicKey() {
  if (!cachedPublicKey) {
    cachedPublicKey = await crypto.subtle.importKey(
      'jwk',
      PUBLIC_VERIFY_JWK,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
  }
  return cachedPublicKey;
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
    if (sigBytes.length !== 64) {
      return { valid: false, active: false, reason: '激活凭证签名长度无效' };
    }

    const pubKey = await getVerifyPublicKey();
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      sigBytes,
      payloadBytes
    );
    if (!ok) {
      return { valid: false, active: false, reason: '激活凭证防伪签名未通过' };
    }

    const wire = JSON.parse(payloadBytes.toString('utf8'));
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
  const sigB64 = String(req.headers['x-toolbox-admin-sig'] || '').trim();
  const tsNum = Number(tsStr);
  if (!tsStr || !Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > 5 * 60 * 1000) {
    return { ok: false, status: 403, error: '管理请求时间戳已过期或无效，请核对设备时间后重试' };
  }
  if (!sigB64) {
    return { ok: false, status: 403, error: '缺少主任私钥签名，请先在管理端填入 TR-MASTER-... 主密钥' };
  }

  try {
    const sigBytes = Buffer.from(sigB64, 'base64url');
    if (sigBytes.length !== 64) {
      return { ok: false, status: 403, error: '管理端签名格式无效' };
    }
    const bodyHash = crypto.createHash('sha256').update(rawBodyText || '', 'utf8').digest('hex');
    const signingMsg = Buffer.from(`${req.method}:${pathname}:${tsStr}:${bodyHash}`, 'utf8');
    const pubKey = await getVerifyPublicKey();
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      sigBytes,
      signingMsg
    );
    if (!ok) {
      return { ok: false, status: 403, error: '主任私钥签名核验未通过，请确认 TR-MASTER-... 主密钥正确' };
    }
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

async function validatePublicHttpsUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('仅允许转发至外部 HTTPS 大模型接口');
  }
  const records = await dns.lookup(parsed.hostname, { all: true });
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw new Error('禁止访问内网或本机回环地址');
    }
  }
  return parsed.toString();
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
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
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    const fullUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = fullUrl.pathname;

    // =========================================================================
    // 0. Real-Time License Status & Director Account Enable/Disable Console API
    // =========================================================================
    if (pathname === '/api/license/status' && req.method === 'GET') {
      const licenseHeader = req.headers['x-toolbox-license'] || '';
      const result = await verifyTianranLicenseDetailed(String(licenseHeader));
      if (!result.valid) {
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

    if (pathname.startsWith('/api/admin/')) {
      const rawBody = req.method === 'POST' ? await readRawBody(req, 512 * 1024) : '';
      const auth = await verifyAdminSignedRequest(req, pathname, rawBody);
      if (!auth.ok) {
        return sendJson(res, auth.status, { ok: false, error: auth.error });
      }

      const body = rawBody ? JSON.parse(rawBody) : {};

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
      if (AUTH_MODE === 'license') {
        const licenseHeader =
          req.headers['x-toolbox-license'] || fullUrl.searchParams.get('lic') || '';
        const auth = await verifyTianranLicenseDetailed(String(licenseHeader));
        if (!auth.valid || !auth.active) {
          return sendJson(res, 403, {
            ok: false,
            error: auth.reason || '未检测到有效的团队激活凭证，拒绝访问云端法规案例网关',
          });
        }
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

      if (req.method === 'GET' && pathname === '/api/ima/file') {
        const itemKey = fullUrl.searchParams.get('itemKey') || '';
        const fileName = fullUrl.searchParams.get('name') || 'document';
        const download = fullUrl.searchParams.get('download') === '1';

        const realMediaId = fromOpaqueId(itemKey);
        if (!realMediaId) {
          return sendJson(res, 404, { ok: false, error: '文件索引已过期，请重新搜索后再点开' });
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
          'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodedName}`,
          'Cache-Control': 'private, max-age=600',
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        });
        Readable.fromWeb(cosResp.body).pipe(res);
        return;
      }

      return sendJson(res, 404, { ok: false, error: '未知的 IMA 网关接口' });
    }

    // =========================================================================
    // 2. Stateless Zero-Log CORS Pass-Through Relay for Custom BYOK LLMs
    // =========================================================================
    if (req.method === 'POST' && pathname === '/api/ai-relay') {
      if (!ENABLE_AI_RELAY) {
        return sendJson(res, 403, {
          ok: false,
          error: '当前站点已关闭服务端跨域中转（ENABLE_AI_RELAY=false），请直接使用支持浏览器直连的大模型厂商（如 DeepSeek、阿里云百炼、硅基流动等）',
        });
      }

      if (AUTH_MODE === 'license') {
        const licenseHeader = req.headers['x-toolbox-license'] || '';
        const auth = await verifyTianranLicenseDetailed(String(licenseHeader));
        if (!auth.valid || !auth.active) {
          return sendJson(res, 403, {
            ok: false,
            error: auth.reason || '未检测到有效的团队激活凭证，拒绝使用跨域转发通道',
          });
        }
      }

      if (!checkRelayRateLimit(req)) {
        return sendJson(res, 429, {
          ok: false,
          error: `请求过于频繁（单 IP 限流 ${AI_RELAY_RPM_LIMIT} 次/分钟），请稍后再试`,
        });
      }

      const payload = await readJsonBody(req, 8 * 1024 * 1024);
      const safeUrl = await validatePublicHttpsUrl(payload.targetUrl);

      const upstream = await fetch(safeUrl, {
        method: 'POST',
        headers: payload.headers || {},
        body: payload.body,
        redirect: 'error',
      });

      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });

      if (upstream.body) {
        Readable.fromWeb(upstream.body).pipe(res);
      } else {
        res.end();
      }
      return;
    }

    // Reject all unknown /api/* methods & paths with strict 404 JSON (never fall back to index.html)
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: '接口不存在或请求方法不受支持' });
    }

    // =========================================================================
    // 3. Static PWA File Serving
    // =========================================================================
    const safeRel = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, '');
    let filePath = path.join(DIST_DIR, safeRel === '/' ? 'index.html' : safeRel);

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
    sendJson(res, err.statusCode || 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Server error',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `[cn-lawyer-ai-toolbox] Ready at http://${HOST}:${PORT} (AUTH_MODE=${AUTH_MODE}, AI_RELAY=${ENABLE_AI_RELAY})`
  );
});
