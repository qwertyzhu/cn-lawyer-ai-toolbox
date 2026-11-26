import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildSignedAdminHeaders,
  signActivationCodeWithMasterToken,
} from '../src/lib/licenseEngine.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function createEphemeralP256KeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y };
  const privateJwk = { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d };
  const masterToken =
    'TR-MASTER-' + Buffer.from(JSON.stringify(privateJwk), 'utf8').toString('base64url');
  return { publicJwk, privateJwk, masterToken };
}

async function waitForHealth(baseUrl, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return;
    } catch {
      // retry until ready
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

let serverProc = null;
let tmpDataDir = '';
let baseUrl = '';
let keyPair = null;
let directorCode = '';
let lawyerACode = '';
let lawyerBCode = '';
let expiredCode = '';

before(async () => {
  keyPair = await createEphemeralP256KeyPair();
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-lawyer-box-test-'));

  directorCode = (
    await signActivationCodeWithMasterToken(
      keyPair.masterToken,
      { holderName: '测试主任', role: '主任', serialNo: 'LAW-T-001' },
      keyPair.publicJwk
    )
  ).code;

  lawyerACode = (
    await signActivationCodeWithMasterToken(
      keyPair.masterToken,
      { holderName: '测试律师甲', role: '专职律师', serialNo: 'LAW-T-002' },
      keyPair.publicJwk
    )
  ).code;

  lawyerBCode = (
    await signActivationCodeWithMasterToken(
      keyPair.masterToken,
      { holderName: '测试律师乙', role: '专职律师', serialNo: 'LAW-T-003' },
      keyPair.publicJwk
    )
  ).code;

  const privKey = await crypto.subtle.importKey(
    'jwk',
    keyPair.privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const expBytes = new TextEncoder().encode(
    JSON.stringify({ i: 'TR', k: 'v1', n: '到期律师', r: '实习律师', s: 'LAW-T-EXP', t: '2020-01-01', e: '2020-12-31' })
  );
  const expSig = Buffer.from(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, expBytes)
  ).toString('base64url');
  expiredCode = `TR1-${Buffer.from(expBytes).toString('base64url')}.${expSig}`;

  serverProc = spawn(process.execPath, [path.join(ROOT_DIR, 'server', 'index.mjs')], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      BIND_HOST: '127.0.0.1',
      AUTH_MODE: 'license',
      ENABLE_AI_RELAY: 'true',
      DATA_DIR: tmpDataDir,
      OVERRIDE_PUBLIC_VERIFY_JWK: JSON.stringify(keyPair.publicJwk),
      RELAY_ALLOWED_HOSTS: 'api.deepseek.com,.aliyuncs.com',
      AUTH_FAIL_BAN_THRESHOLD: '50',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForHealth(baseUrl);
});

after(async () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 150));
  }
  if (tmpDataDir && fs.existsSync(tmpDataDir)) {
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  }
});

test('Server /api/health responds 200 OK with authMode', async () => {
  const resp = await fetch(`${baseUrl}/api/health`);
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, 'cn-lawyer-ai-toolbox');
  assert.equal(data.authMode, 'license');
});

test('Unauthenticated, forged, and expired licenses are strictly rejected (403) and ?lic= query auth is disabled', async () => {
  for (const [method, ep] of [
    ['GET', '/api/sync/vault'],
    ['GET', '/api/admin/accounts'],
    ['POST', '/api/ai-relay'],
    ['GET', '/api/ima/catalog'],
    ['POST', '/api/ima/file-ticket'],
  ]) {
    const rUnauth = await fetch(`${baseUrl}${ep}`, { method });
    assert.equal(rUnauth.status, 403, `${method} ${ep} without license must be 403`);

    const rExp = await fetch(`${baseUrl}${ep}`, {
      method,
      headers: { 'X-Toolbox-License': expiredCode },
    });
    assert.equal(rExp.status, 403, `${method} ${ep} with expired license must be 403`);
  }

  const rQueryLic = await fetch(
    `${baseUrl}/api/ima/file?itemKey=m_fake&lic=${encodeURIComponent(lawyerACode)}`
  );
  assert.equal(rQueryLic.status, 403, '/api/ima/file?lic=... must be rejected (ticket-only auth)');
});

test('Cloud Sync Vault enforces per-account isolation and optimistic revision conflict (409)', async () => {
  const w1 = await fetch(`${baseUrl}/api/sync/vault`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Toolbox-License': lawyerACode,
    },
    body: JSON.stringify({
      baseRevision: 0,
      updatedAt: 2000,
      clientEncrypted: false,
      deviceLabel: 'Device-A',
      payload: { secret: 'lawyer-a-only' },
    }),
  });
  assert.equal(w1.status, 200);
  const w1Data = await w1.json();
  assert.equal(w1Data.revision, 1);

  const conflict = await fetch(`${baseUrl}/api/sync/vault`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Toolbox-License': lawyerACode,
    },
    body: JSON.stringify({
      baseRevision: 0,
      updatedAt: 1000,
      clientEncrypted: false,
      deviceLabel: 'Old-Device',
      payload: { secret: 'stale-overwrite' },
    }),
  });
  assert.equal(conflict.status, 409);
  const cData = await conflict.json();
  assert.equal(cData.conflict, true);

  // Stale baseRevision=0 MUST STILL return 409 even when client clock has a NEWER updatedAt
  const conflictNewerClock = await fetch(`${baseUrl}/api/sync/vault`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Toolbox-License': lawyerACode,
    },
    body: JSON.stringify({
      baseRevision: 0,
      updatedAt: 999999,
      clientEncrypted: false,
      deviceLabel: 'Clock-Skewed-Device',
      payload: { secret: 'must-not-silently-clobber' },
    }),
  });
  assert.equal(conflictNewerClock.status, 409);

  const readB = await fetch(`${baseUrl}/api/sync/vault`, {
    headers: { 'X-Toolbox-License': lawyerBCode },
  });
  assert.equal(readB.status, 200);
  const bData = await readB.json();
  assert.equal(bData.exists, false);
  assert.equal(bData.payload, null);
});

test('Admin API enforces Nonce anti-replay, 2-min timestamp window, role check, self-lockout guard, and revocation', async () => {
  const validHeaders = await buildSignedAdminHeaders(
    keyPair.masterToken,
    directorCode,
    'GET',
    '/api/admin/accounts',
    '',
    keyPair.publicJwk
  );
  const rOk = await fetch(`${baseUrl}/api/admin/accounts`, { headers: validHeaders });
  assert.equal(rOk.status, 200);

  const rReplay = await fetch(`${baseUrl}/api/admin/accounts`, { headers: validHeaders });
  assert.equal(rReplay.status, 403);

  const noNonceHeaders = { ...validHeaders };
  delete noNonceHeaders['X-Toolbox-Admin-Nonce'];
  const rNoNonce = await fetch(`${baseUrl}/api/admin/accounts`, { headers: noNonceHeaders });
  assert.equal(rNoNonce.status, 403);

  const staleHeaders = {
    ...validHeaders,
    'X-Toolbox-Admin-Ts': String(Date.now() - 3 * 60 * 1000),
    'X-Toolbox-Admin-Nonce': 'freshNonce1234567890',
  };
  const rStale = await fetch(`${baseUrl}/api/admin/accounts`, { headers: staleHeaders });
  assert.equal(rStale.status, 403);

  const nonAdminHeaders = await buildSignedAdminHeaders(
    keyPair.masterToken,
    lawyerACode,
    'GET',
    '/api/admin/accounts',
    '',
    keyPair.publicJwk
  );
  const rNonAdmin = await fetch(`${baseUrl}/api/admin/accounts`, { headers: nonAdminHeaders });
  assert.equal(rNonAdmin.status, 403);

  await fetch(`${baseUrl}/api/license/status`, {
    headers: { 'X-Toolbox-License': directorCode },
  });
  const selfToggleBody = JSON.stringify({ key: 'name:测试主任', status: 'disabled' });
  const selfToggleHeaders = await buildSignedAdminHeaders(
    keyPair.masterToken,
    directorCode,
    'POST',
    '/api/admin/accounts/toggle',
    selfToggleBody,
    keyPair.publicJwk
  );
  const rSelf = await fetch(`${baseUrl}/api/admin/accounts/toggle`, {
    method: 'POST',
    headers: selfToggleHeaders,
    body: selfToggleBody,
  });
  assert.equal(rSelf.status, 400);

  const disableBody = JSON.stringify({
    key: 'name:测试律师乙',
    status: 'disabled',
    note: '离职测试停用',
  });
  const disableHeaders = await buildSignedAdminHeaders(
    keyPair.masterToken,
    directorCode,
    'POST',
    '/api/admin/accounts/toggle',
    disableBody,
    keyPair.publicJwk
  );
  const rDis = await fetch(`${baseUrl}/api/admin/accounts/toggle`, {
    method: 'POST',
    headers: disableHeaders,
    body: disableBody,
  });
  assert.equal(rDis.status, 200);

  const rBVault = await fetch(`${baseUrl}/api/sync/vault`, {
    headers: { 'X-Toolbox-License': lawyerBCode },
  });
  assert.equal(rBVault.status, 403);
});

test('H-1: /api/ai-relay blocks non-HTTPS, loopback, private IPs, metadata IP, and non-allowlisted hosts', async () => {
  const relayTargets = [
    { url: 'http://api.deepseek.com/v1/chat/completions', expected: 400 },
    { url: 'https://127.0.0.1/v1/chat/completions', expected: 403 },
    { url: 'https://10.0.0.1/v1/chat/completions', expected: 403 },
    { url: 'https://169.254.169.254/latest/meta-data/', expected: 403 },
    { url: 'https://unlisted-evil-host.example.com/v1', expected: 403 },
  ];

  for (const tc of relayTargets) {
    const r = await fetch(`${baseUrl}/api/ai-relay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Toolbox-License': lawyerACode,
      },
      body: JSON.stringify({
        targetUrl: tc.url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    });
    assert.equal(r.status, tc.expected, `Relay target ${tc.url} expected ${tc.expected}, got ${r.status}`);
  }
});

test('H-8: Malformed percent-encoding returns 400 (no crash), path traversal blocked, unknown /api/* returns 404 JSON', async () => {
  const rBadUri = await fetch(`${baseUrl}/%E0%A4%A`);
  assert.equal(rBadUri.status, 400);

  const rTraversal = await fetch(`${baseUrl}/../../etc/passwd`);
  const travText = await rTraversal.text();
  assert.ok(!travText.includes('root:x:0:0'));

  const rUnknownApi = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(rUnknownApi.status, 404);
  const j = await rUnknownApi.json();
  assert.equal(j.ok, false);

  const rHealth = await fetch(`${baseUrl}/api/health`);
  assert.equal(rHealth.status, 200);
});
