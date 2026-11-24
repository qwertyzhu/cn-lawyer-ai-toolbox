import { SITE_CONFIG } from '../config/siteConfig.ts';
import { decryptWithPassphrase, encryptWithPassphrase } from './cryptoVault.ts';

/**
 * 律所团队非对称数字签名专属激活码引擎 (ECDSA P-256 + SHA-256)
 *
 * 默认开源模式 (`VITE_AUTH_MODE=open`) 免激活码开箱即用。
 * 如需开启律所团队实名发码门禁 (`VITE_AUTH_MODE=license`)，请先运行 `npm run init-keys`
 * 生成本所专属 ECDSA P-256 密钥对（私钥仅留存本地 ops/.keys/，公钥自动写入此处）。
 *
 * 安全设计：
 * 1. 客户端仅内置【验签公钥表 (TIANRAN_VERIFY_KEYS，支持 kid 多版本平滑轮换)】，绝不含私钥；
 * 2. 强制通过浏览器原生 Web Crypto API 完成验签（移除手写曲线运算）；
 * 3. 主任主密钥 (TR-MASTER-...) 严禁明文写入 localStorage：仅保留在本次页面内存中，刷新即清；
 *    如需免重输，可选通过自设口令经 PBKDF2 + AES-256-GCM 加密后存储，并主动清理旧版明文遗留；
 * 4. 管理端签名请求内置一次性随机 Nonce (X-Toolbox-Admin-Nonce) + 时间戳防重放。
 */

export const TIANRAN_PUBLIC_VERIFY_JWK: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'REPLACE_VIA_NPM_RUN_INIT_KEYS_PUBLIC_X_COORDINATE',
  y: 'REPLACE_VIA_NPM_RUN_INIT_KEYS_PUBLIC_Y_COORDINATE',
};

export const CURRENT_VERIFY_KEY_ID = 'v1';

export const TIANRAN_VERIFY_KEYS: Record<string, JsonWebKey> = {
  v1: TIANRAN_PUBLIC_VERIFY_JWK,
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
    keyId: CURRENT_VERIFY_KEY_ID,
    fingerprint: 'APACHE20',
    activatedAt: new Date().toISOString(),
  };
}

const ACTIVATED_LICENSE_STORAGE_KEY = 'cn_lawyer_toolbox_license_v2';
const LEGACY_ADMIN_MASTER_PLAINTEXT_KEY = 'cn_lawyer_toolbox_admin_master_v1';
const ENCRYPTED_ADMIN_MASTER_KEY = 'cn_lawyer_toolbox_admin_master_vault_v2';

// Strict in-memory cache for Admin master token (cleared on refresh/tab close; NEVER persisted in plaintext!)
let inMemoryAdminMasterToken = '';

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
  k?: string; // Optional key version id (defaults to "v1")
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
  keyId: string;
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

function generateRandomNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return bytesToBase64Url(buf);
}

/**
 * Extracts a TR1-<payload>.<signature> token even if pasted inside a full WeChat invitation message.
 */
export function extractActivationToken(rawInput: string): string | null {
  if (!rawInput) return null;
  const match = rawInput.match(/TR1-[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{60,120}/);
  return match ? match[0] : null;
}

async function computeFingerprint(sigBytes: Uint8Array): Promise<string> {
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', sigBytes as BufferSource));
  const hex = Array.from(digestBytes.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

function getTodayChinaYmd(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function assertSubtleCryptoAvailable(): void {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      '当前为非加密 HTTP 环境，浏览器已限制密码学验签接口。请通过 HTTPS 安全地址或 localhost 访问。'
    );
  }
}

export async function verifyActivationCode(
  rawInput: string,
  overrideVerifyJwk?: JsonWebKey
): Promise<VerifiedLicenseInfo> {
  assertSubtleCryptoAvailable();

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

  let wire: LicenseWirePayload;
  try {
    wire = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicenseWirePayload;
  } catch {
    throw new Error('激活码载荷解析失败');
  }

  const keyId = wire.k || CURRENT_VERIFY_KEY_ID;
  const verifyJwk = overrideVerifyJwk || TIANRAN_VERIFY_KEYS[keyId];
  if (!verifyJwk) {
    throw new Error(`未知的验签公钥版本（${keyId}），请刷新工作台或联系律所管理端`);
  }

  const pubKey = await crypto.subtle.importKey(
    'jwk',
    verifyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pubKey,
    sigBytes as BufferSource,
    payloadBytes as BufferSource
  );

  if (!valid) {
    throw new Error('激活码防伪签名校验未通过（非本所官方签发或已被篡改）');
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
    keyId,
    fingerprint,
    activatedAt: new Date().toISOString(),
  };
}

/**
 * Signs a new genuine TR1-... activation code using the Admin's private Master Token ("TR-MASTER-...").
 */
export async function signActivationCodeWithMasterToken(
  masterToken: string,
  params: {
    holderName: string;
    role: string;
    serialNo: string;
    expiresAt?: string;
    issuedAt?: string;
    keyId?: string;
  },
  overrideVerifyJwk?: JsonWebKey
): Promise<{ code: string; info: VerifiedLicenseInfo }> {
  assertSubtleCryptoAvailable();

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

  const keyId = params.keyId || CURRENT_VERIFY_KEY_ID;
  const expectedPub = overrideVerifyJwk || TIANRAN_VERIFY_KEYS[keyId] || TIANRAN_PUBLIC_VERIFY_JWK;
  if (!privJwk.d || privJwk.x !== expectedPub.x) {
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
    k: keyId,
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
  const verified = await verifyActivationCode(code, overrideVerifyJwk);
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
    return {
      ...parsed,
      keyId: parsed.keyId || CURRENT_VERIFY_KEY_ID,
    };
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

export function purgeLegacyAdminMasterToken(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LEGACY_ADMIN_MASTER_PLAINTEXT_KEY);
    }
  } catch {
    // ignore
  }
}

export function getSavedAdminMasterToken(): string {
  purgeLegacyAdminMasterToken();
  return inMemoryAdminMasterToken;
}

export function saveAdminMasterToken(token: string): void {
  purgeLegacyAdminMasterToken();
  inMemoryAdminMasterToken = token.trim();
}

export function hasEncryptedAdminMasterVault(): boolean {
  try {
    return typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(ENCRYPTED_ADMIN_MASTER_KEY));
  } catch {
    return false;
  }
}

export async function saveEncryptedAdminMasterVault(
  masterToken: string,
  passphrase: string
): Promise<void> {
  const clean = masterToken.trim();
  const pass = passphrase.trim();
  if (!clean.startsWith('TR-MASTER-')) {
    throw new Error('请先输入合法的 TR-MASTER-... 主任主密钥');
  }
  if (pass.length < 6) {
    throw new Error('加密口令至少需要 6 位字符');
  }
  const cipher = await encryptWithPassphrase(clean, pass);
  purgeLegacyAdminMasterToken();
  localStorage.setItem(ENCRYPTED_ADMIN_MASTER_KEY, cipher);
  inMemoryAdminMasterToken = clean;
}

export async function unlockEncryptedAdminMasterVault(passphrase: string): Promise<string> {
  const cipher = localStorage.getItem(ENCRYPTED_ADMIN_MASTER_KEY) || '';
  if (!cipher) {
    throw new Error('当前浏览器尚未封存加密的主任主密钥');
  }
  const plain = await decryptWithPassphrase(cipher, passphrase.trim());
  if (!plain.startsWith('TR-MASTER-')) {
    throw new Error('解密结果格式异常，请核对口令');
  }
  inMemoryAdminMasterToken = plain;
  return plain;
}

export function clearEncryptedAdminMasterVault(): void {
  purgeLegacyAdminMasterToken();
  inMemoryAdminMasterToken = '';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(ENCRYPTED_ADMIN_MASTER_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Signs an authenticated Admin Console API request locally using the Admin's TR-MASTER-... private key.
 * Includes a cryptographic random Nonce (X-Toolbox-Admin-Nonce) + Timestamp (X-Toolbox-Admin-Ts) to prevent replay.
 */
export async function buildSignedAdminHeaders(
  masterToken: string,
  licenseRawCode: string,
  method: 'GET' | 'POST',
  pathname: string,
  rawBodyText = '',
  overrideVerifyJwk?: JsonWebKey
): Promise<Record<string, string>> {
  assertSubtleCryptoAvailable();

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
  const expectedPub = overrideVerifyJwk || TIANRAN_PUBLIC_VERIFY_JWK;
  if (!privJwk.d || privJwk.x !== expectedPub.x) {
    throw new Error('主任签发主密钥与当前系统公钥不匹配');
  }

  const ts = String(Date.now());
  const nonce = generateRandomNonce();
  const bodyBytes = new TextEncoder().encode(rawBodyText);
  const hashBuf = await crypto.subtle.digest('SHA-256', bodyBytes);
  const bodyHashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const signingBytes = new TextEncoder().encode(
    `${method}:${pathname}:${ts}:${nonce}:${bodyHashHex}`
  );

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
    'X-Toolbox-Admin-Nonce': nonce,
    'X-Toolbox-Admin-Sig': bytesToBase64Url(new Uint8Array(sigBuf)),
  };
}
