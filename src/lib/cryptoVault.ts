const VAULT_PREFIX = 'TRVAULT1:';
const SYNC_PREFIX = 'TRSYNC1:';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptWithPassphrase(plainText: string, passphrase: string, prefix = VAULT_PREFIX): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error('当前浏览器环境不支持 Web Crypto 硬件加密（请使用 HTTPS 或 localhost 访问）');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plainText)
  );
  const packed = `${prefix}${toBase64(salt)}.${toBase64(iv)}.${toBase64(new Uint8Array(cipherBuf))}`;
  return packed;
}

export async function decryptWithPassphrase(payload: string, passphrase: string, prefix = VAULT_PREFIX): Promise<string> {
  if (!payload.startsWith(prefix)) {
    throw new Error('加密数据格式不正确');
  }
  const body = payload.slice(prefix.length);
  const [saltB64, ivB64, cipherB64] = body.split('.');
  if (!saltB64 || !ivB64 || !cipherB64) {
    throw new Error('加密数据包损坏');
  }
  const salt = fromBase64(saltB64);
  const iv = fromBase64(ivB64);
  const cipher = fromBase64(cipherB64);
  const key = await deriveAesKey(passphrase, salt);
  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipher as BufferSource
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    throw new Error('PIN 码或迁移口令错误，无法解密');
  }
}

export async function exportEncryptedSyncCode(jsonPayload: string, transferPassword: string): Promise<string> {
  return encryptWithPassphrase(jsonPayload, transferPassword, SYNC_PREFIX);
}

export async function importEncryptedSyncCode(syncCode: string, transferPassword: string): Promise<string> {
  return decryptWithPassphrase(syncCode.trim(), transferPassword, SYNC_PREFIX);
}
