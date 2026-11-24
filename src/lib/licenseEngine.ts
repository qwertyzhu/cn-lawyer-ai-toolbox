import { SITE_CONFIG } from '../config/siteConfig.ts';

/**
 * 律所团队非对称数字签名专属激活码引擎 (ECDSA P-256 + SHA-256)
 *
 * 默认开源模式 (`VITE_AUTH_MODE=open`) 免激活码开箱即用。
 * 如需开启律所团队实名发码门禁 (`VITE_AUTH_MODE=license`)，请先运行 `npm run init-keys`
 * 生成本所专属 ECDSA P-256 密钥对（私钥仅留存本地 ops/.keys/，公钥自动写入此处）。
 */

export const TIANRAN_PUBLIC_VERIFY_JWK: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'REPLACE_VIA_NPM_RUN_INIT_KEYS_PUBLIC_X_COORDINATE',
  y: 'REPLACE_VIA_NPM_RUN_INIT_KEYS_PUBLIC_Y_COORDINATE',
};

export function createOpenModeLicense(): VerifiedLicenseInfo {
  const today = getTodayChinaYmd();
  return {
    rawCode: 'OPEN-MODE-LOCAL',
    holderName: '执业律师',
    role: '开源本机模式',
    serialNo: 'OSS-LOCAL',
    issuedAt: today,
    expiresAt: null,
    fingerprint: 'APACHE20',
    activatedAt: new Date().toISOString(),
  };
}

const ACTIVATED_LICENSE_STORAGE_KEY = 'cn_lawyer_toolbox_license_v2';
const ADMIN_MASTER_TOKEN_STORAGE_KEY = 'cn_lawyer_toolbox_admin_master_v1';

export type LawyerRoleLabel =
  | '主任'
  | '副主任 / 合伙人'
  | '合伙人'
  | '专职律师'
  | '律师助理'
  | '实习律师'
  | '行政与顾问'
  | '主任律师'
  | '合伙人律师'
  | '兼职律师';

export function isFirmAdminRole(role?: string): boolean {
  return role === '主任' || role === '主任律师';
}

export interface LicenseWirePayload {
  i: 'TR'; // Issuer code
  n: string; // Holder name, e.g. "张示例"
  r: LawyerRoleLabel | string; // Role
  s: string; // Serial number, e.g. "LAW-2026-001"
  t: string; // Issued date YYYY-MM-DD
  e: string; // Expiry date YYYY-MM-DD or "" for permanent
}

export interface VerifiedLicenseInfo {
  rawCode: string;
  holderName: string;
  role: string;
  serialNo: string;
  issuedAt: string;
  expiresAt: string | null; // null = permanent
  fingerprint: string;
  activatedAt: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Extracts a TR1-<payload>.<signature> token even if pasted inside a full WeChat invitation message.
 */
export function extractActivationToken(rawInput: string): string | null {
  if (!rawInput) return null;
  const match = rawInput.match(/TR1-[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{60,120}/);
  return match ? match[0] : null;
}

// Pure-JS NIST P-256 ECDSA Public-Key Verification fallback (only used when opened over plain HTTP LAN IP like http://192.168.x.x where mobile browsers hide crypto.subtle)
const P256_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_A = P256_P - 3n;
const P256_GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const P256_GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

function modP(a: bigint, m = P256_P): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}
function modInvP(a: bigint, m = P256_P): bigint {
  let [t, newT] = [0n, 1n];
  let [r, newR] = [m, modP(a, m)];
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  return modP(t, m);
}
function ecAdd(p1: [bigint, bigint] | null, p2: [bigint, bigint] | null): [bigint, bigint] | null {
  if (!p1) return p2;
  if (!p2) return p1;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (x1 === x2 && modP(y1 + y2) === 0n) return null;
  const lam =
    x1 === x2 && y1 === y2
      ? modP((3n * x1 * x1 + P256_A) * modInvP(2n * y1))
      : modP((y2 - y1) * modInvP(x2 - x1));
  const x3 = modP(lam * lam - x1 - x2);
  const y3 = modP(lam * (x1 - x3) - y1);
  return [x3, y3];
}
function ecMul(k: bigint, pt: [bigint, bigint]): [bigint, bigint] | null {
  let res: [bigint, bigint] | null = null;
  let addend: [bigint, bigint] | null = pt;
  let s = k;
  while (s > 0n) {
    if (s & 1n) res = ecAdd(res, addend);
    addend = ecAdd(addend, addend);
    s >>= 1n;
  }
  return res;
}
const SHA256_K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
];
function sha256Pure(msg: Uint8Array): Uint8Array {
  const l = msg.length;
  const bitLen = l * 8;
  const padLen = ((l + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(padLen);
  buf.set(msg);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  let [h0,h1,h2,h3,h4,h5,h6,h7] = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < padLen; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(7, w[j-15]) ^ rotr(18, w[j-15]) ^ (w[j-15] >>> 3);
      const s1 = rotr(17, w[j-2]) ^ rotr(19, w[j-2]) ^ (w[j-2] >>> 10);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = [h0,h1,h2,h3,h4,h5,h6,h7];
    for (let j = 0; j < 64; j++) {
      const t1 = (h + (rotr(6,e)^rotr(11,e)^rotr(25,e)) + ((e&f)^((~e)&g)) + SHA256_K[j] + w[j]) >>> 0;
      const t2 = ((rotr(2,a)^rotr(13,a)^rotr(22,a)) + ((a&b)^(a&c)^(b&c))) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
    h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0,h1,h2,h3,h4,h5,h6,h7].forEach((v, idx) => odv.setUint32(idx * 4, v, false));
  return out;
}
function toBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return BigInt('0x' + (hex || '0'));
}
function verifyEcdsaPureP256(
  payloadBytes: Uint8Array,
  sigBytes: Uint8Array,
  pubJwk: JsonWebKey = TIANRAN_PUBLIC_VERIFY_JWK
): boolean {
  const r = toBigInt(sigBytes.subarray(0, 32));
  const s = toBigInt(sigBytes.subarray(32, 64));
  if (r <= 0n || r >= P256_N || s <= 0n || s >= P256_N) return false;
  const z = toBigInt(sha256Pure(payloadBytes));
  const w = modInvP(s, P256_N);
  const u1 = modP(z * w, P256_N);
  const u2 = modP(r * w, P256_N);
  const qx = toBigInt(base64UrlToBytes(pubJwk.x!));
  const qy = toBigInt(base64UrlToBytes(pubJwk.y!));
  const pt = ecAdd(ecMul(u1, [P256_GX, P256_GY]), ecMul(u2, [qx, qy]));
  if (!pt) return false;
  return modP(pt[0], P256_N) === r;
}

async function computeFingerprint(sigBytes: Uint8Array): Promise<string> {
  const digestBytes = crypto?.subtle
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', sigBytes as BufferSource))
    : sha256Pure(sigBytes);
  const hex = Array.from(digestBytes.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

function getTodayChinaYmd(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function verifyActivationCode(
  rawInput: string,
  pubJwk: JsonWebKey = TIANRAN_PUBLIC_VERIFY_JWK
): Promise<VerifiedLicenseInfo> {
  const token = extractActivationToken(rawInput);
  if (!token) {
    throw new Error('未识别到有效的激活码格式（应以 TR1- 开头，可直接整段粘贴微信授权消息）');
  }

  const body = token.slice(4); // strip "TR1-"
  const dotIdx = body.indexOf('.');
  if (dotIdx <= 0) {
    throw new Error('激活码结构不完整，请检查是否复制完整');
  }

  const payloadB64 = body.slice(0, dotIdx);
  const sigB64 = body.slice(dotIdx + 1);

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = base64UrlToBytes(payloadB64);
    sigBytes = base64UrlToBytes(sigB64);
  } catch {
    throw new Error('激活码编码损坏，请重新复制');
  }

  if (sigBytes.length !== 64) {
    throw new Error('激活码防伪数字签名长度无效');
  }

  let valid = false;
  if (crypto?.subtle) {
    const pubKey = await crypto.subtle.importKey(
      'jwk',
      pubJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      sigBytes as BufferSource,
      payloadBytes as BufferSource
    );
  } else {
    valid = verifyEcdsaPureP256(payloadBytes, sigBytes, pubJwk);
  }

  if (!valid) {
    throw new Error('激活码防伪签名校验未通过（非本所官方签发或已被篡改）');
  }

  let wire: LicenseWirePayload;
  try {
    wire = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicenseWirePayload;
  } catch {
    throw new Error('激活码载荷解析失败');
  }

  if (wire.i !== 'TR' || !wire.n) {
    throw new Error('激活码缺少律所标识或持有人信息');
  }

  if (wire.e) {
    const today = getTodayChinaYmd();
    if (today > wire.e) {
      throw new Error(`该专属激活码已于 ${wire.e} 到期，请联系律所管理端重新签发`);
    }
  }

  const fingerprint = await computeFingerprint(sigBytes);

  return {
    rawCode: token,
    holderName: wire.n,
    role: wire.r || '执业律师',
    serialNo: wire.s || 'TR-VIP',
    issuedAt: wire.t || '',
    expiresAt: wire.e || null,
    fingerprint,
    activatedAt: new Date().toISOString(),
  };
}

/**
 * Signs a new genuine TR1-... activation code using the Admin's private Master Token ("TR-MASTER-...").
 * Used by the standalone local generator & optional mobile Admin Issuer Drawer.
 */
export async function signActivationCodeWithMasterToken(
  masterToken: string,
  params: {
    holderName: string;
    role: string;
    serialNo: string;
    expiresAt?: string; // YYYY-MM-DD or "" for permanent
    issuedAt?: string;
  },
  pubJwk: JsonWebKey = TIANRAN_PUBLIC_VERIFY_JWK
): Promise<{ code: string; info: VerifiedLicenseInfo }> {
  const cleanMaster = masterToken.trim();
  if (!cleanMaster.startsWith('TR-MASTER-')) {
    throw new Error('主任签发主密钥格式不正确（应以 TR-MASTER- 开头）');
  }

  let privJwk: JsonWebKey;
  try {
    const jsonBytes = base64UrlToBytes(cleanMaster.slice('TR-MASTER-'.length));
    privJwk = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    throw new Error('无法解析签发主密钥');
  }

  if (!privJwk.d || privJwk.x !== pubJwk.x) {
    throw new Error('签发主密钥与当前系统公钥不匹配（请确认已运行 npm run init-keys）');
  }

  const privKey = await crypto.subtle.importKey(
    'jwk',
    privJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const wire: LicenseWirePayload = {
    i: 'TR',
    n: params.holderName.trim(),
    r: params.role.trim() || '专职律师',
    s: params.serialNo.trim() || `LAW-${new Date().getFullYear()}-001`,
    t: params.issuedAt || new Date().toISOString().slice(0, 10),
    e: params.expiresAt?.trim() || '',
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(wire));
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    payloadBytes
  );
  const sigBytes = new Uint8Array(sigBuf);

  const code = `TR1-${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(sigBytes)}`;
  const verified = await verifyActivationCode(code, pubJwk);
  return { code, info: verified };
}

export function formatWeChatInvitationCard(
  info: VerifiedLicenseInfo,
  baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'
): string {
  const originClean = baseOrigin.replace(/\/+$/, '');
  const quickUrl = `${originClean}/?activate=${encodeURIComponent(info.rawCode)}`;
  const issuerName = SITE_CONFIG.firmName || SITE_CONFIG.appName;
  return [
    `【${issuerName} · 专属办案工具箱授权函】`,
    `授权予：${info.holderName}（${info.role}）`,
    `授权编号：${info.serialNo} ｜ 有效期：${info.expiresAt ? `至 ${info.expiresAt}` : '长期有效'}`,
    ``,
    `▶ 一键免输激活入口（手机点开自动激活）：`,
    quickUrl,
    ``,
    `▶ 或在激活页直接粘贴以下专属激活码：`,
    info.rawCode,
  ].join('\n');
}

export function getSavedLicense(): VerifiedLicenseInfo | null {
  try {
    const raw = localStorage.getItem(ACTIVATED_LICENSE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VerifiedLicenseInfo;
    if (!parsed?.rawCode || !parsed?.holderName) return null;
    if (parsed.expiresAt) {
      const today = getTodayChinaYmd();
      if (today > parsed.expiresAt) {
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveVerifiedLicense(info: VerifiedLicenseInfo): void {
  try {
    localStorage.setItem(ACTIVATED_LICENSE_STORAGE_KEY, JSON.stringify(info));
  } catch {
    // ignore
  }
}

export function clearSavedLicense(): void {
  try {
    localStorage.removeItem(ACTIVATED_LICENSE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getSavedAdminMasterToken(): string {
  try {
    return localStorage.getItem(ADMIN_MASTER_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveAdminMasterToken(token: string): void {
  try {
    if (!token.trim()) {
      localStorage.removeItem(ADMIN_MASTER_TOKEN_STORAGE_KEY);
    } else {
      localStorage.setItem(ADMIN_MASTER_TOKEN_STORAGE_KEY, token.trim());
    }
  } catch {
    // ignore
  }
}

/**
 * Signs an authenticated Admin Console API request locally using the Director's TR-MASTER-... private key.
 * The private key NEVER leaves the Director's browser; the server verifies using ONLY the public key.
 */
export async function buildSignedAdminHeaders(
  masterToken: string,
  licenseRawCode: string,
  method: 'GET' | 'POST',
  pathname: string,
  rawBodyText = '',
  pubJwk: JsonWebKey = TIANRAN_PUBLIC_VERIFY_JWK
): Promise<Record<string, string>> {
  const cleanMaster = masterToken.trim();
  if (!cleanMaster.startsWith('TR-MASTER-')) {
    throw new Error('请先在上方填入主任签发主密钥（TR-MASTER-...）以操作云端账户开关');
  }

  let privJwk: JsonWebKey;
  try {
    const jsonBytes = base64UrlToBytes(cleanMaster.slice('TR-MASTER-'.length));
    privJwk = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    throw new Error('无法解析主任签发主密钥');
  }
  if (!privJwk.d || privJwk.x !== pubJwk.x) {
    throw new Error('主任签发主密钥与当前系统公钥不匹配');
  }

  const ts = String(Date.now());
  const bodyBytes = new TextEncoder().encode(rawBodyText);
  const hashBuf = await crypto.subtle.digest('SHA-256', bodyBytes);
  const bodyHashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const signingBytes = new TextEncoder().encode(`${method}:${pathname}:${ts}:${bodyHashHex}`);

  const privKey = await crypto.subtle.importKey(
    'jwk',
    privJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    signingBytes
  );

  return {
    'Content-Type': 'application/json',
    'X-Toolbox-License': licenseRawCode,
    'X-Toolbox-Admin-Ts': ts,
    'X-Toolbox-Admin-Sig': bytesToBase64Url(new Uint8Array(sigBuf)),
  };
}
