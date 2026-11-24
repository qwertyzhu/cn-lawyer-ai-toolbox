#!/usr/bin/env node
/**
 * Law Firm Team License Keypair Initializer (ECDSA P-256 + SHA-256)
 *
 * Run `npm run init-keys` to generate your own law firm's exclusive signing keypair:
 * - Writes private master key to gitignored `ops/.keys/firm-master-signing-key.json` (chmod 600)
 * - Injects ONLY the matching public verification key into `src/lib/licenseEngine.ts` and `server/index.mjs`
 * - After running this script, set `VITE_AUTH_MODE=license` and `AUTH_MODE=license` in `.env`
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KEYS_DIR = path.join(ROOT, 'ops', '.keys');
const KEY_FILE = path.join(KEYS_DIR, 'firm-master-signing-key.json');

const force = process.argv.includes('--force');
const issuer =
  process.argv.find((a) => a.startsWith('--firm='))?.slice('--firm='.length) ||
  '本所专属办案工具箱';

if (fs.existsSync(KEY_FILE) && !force) {
  console.error(`[init-keys] Key file already exists at ${KEY_FILE}. Pass --force to rotate.`);
  process.exit(1);
}

const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);

const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

const cleanPub = { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y };
const cleanPriv = { kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y, d: privateJwk.d };
const masterToken =
  'TR-MASTER-' + Buffer.from(JSON.stringify(cleanPriv), 'utf8').toString('base64url');

fs.mkdirSync(KEYS_DIR, { recursive: true });
fs.writeFileSync(
  KEY_FILE,
  JSON.stringify(
    {
      issuer,
      algorithm: 'ECDSA-P256-SHA256',
      createdAt: new Date().toISOString(),
      publicJwk: cleanPub,
      privateJwk: cleanPriv,
      masterToken,
    },
    null,
    2
  ),
  { mode: 0o600 }
);
fs.chmodSync(KEY_FILE, 0o600);

function patchPublicKeyInFile(filePath, constName) {
  let content = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp(`(${constName}[^=]*=\\s*\\{[\\s\\S]*?x:\\s*)'[^']*'([\\s\\S]*?y:\\s*)'[^']*'`);
  if (!re.test(content)) {
    throw new Error(`Could not locate ${constName} in ${filePath}`);
  }
  content = content.replace(re, `$1'${cleanPub.x}'$2'${cleanPub.y}'`);
  fs.writeFileSync(filePath, content, 'utf8');
}

patchPublicKeyInFile(path.join(ROOT, 'src', 'lib', 'licenseEngine.ts'), 'TIANRAN_PUBLIC_VERIFY_JWK');
patchPublicKeyInFile(path.join(ROOT, 'server', 'index.mjs'), 'PUBLIC_VERIFY_JWK');

console.log('✅ 已为本所生成全新 ECDSA P-256 专属密钥对！');
console.log(`   私钥文件（严禁上传 Git）：${KEY_FILE}`);
console.log('   公钥已自动注入 src/lib/licenseEngine.ts 与 server/index.mjs。');
console.log('   下一步：在 .env 中设置 VITE_AUTH_MODE=license 与 AUTH_MODE=license，然后运行 npm run keygen 发码。');
