import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KEY_FILE = path.join(ROOT, 'ops', '.keys', 'firm-master-signing-key.json');
const OUT_HTML = path.join(ROOT, '团队专属激活码生成器（管理端本地双击即开）.html');

if (!fs.existsSync(KEY_FILE)) {
  console.error('Missing ops/.keys/firm-master-signing-key.json');
  process.exit(1);
}

const keyBundle = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));

// Convert JWK private scalar "d" (32-byte base64url) to hex for pure-JS BigInt P-256 signing (works even on file://!)
const dHex = Buffer.from(keyBundle.privateJwk.d, 'base64url').toString('hex');
const masterToken = keyBundle.masterToken;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>中国律师 AI 工具箱 · 主任专属无限激活码签发台（机密勿外传）</title>
  <style>
    :root {
      --navy: #0E223D;
      --obsidian: #11151C;
      --gold: #B89254;
      --gold-light: #D1B27A;
      --paper: #F6F4EF;
      --border: #DED8CC;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif;
      background: var(--paper);
      color: var(--obsidian);
      line-height: 1.6;
    }
    header {
      background: var(--navy);
      color: #fff;
      padding: 24px 28px;
      border-bottom: 3px solid var(--gold);
    }
    .wrap { max-width: 1060px; margin: 0 auto; }
    .badge {
      display: inline-block;
      font-size: 11px;
      color: var(--gold-light);
      border: 1px solid rgba(209,178,122,0.45);
      padding: 2px 10px;
      border-radius: 99px;
      letter-spacing: 0.12em;
    }
    h1 {
      margin: 8px 0 4px;
      font-family: "Source Han Serif SC", "Songti SC", Georgia, serif;
      font-size: 24px;
    }
    .sub { margin: 0; font-size: 13px; color: #cbd5e1; }
    main { padding: 24px 20px 60px; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
    @media (min-width: 860px) { .grid { grid-template-columns: 420px 1fr; } }
    .card {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(14,34,61,0.04);
    }
    label { display: block; font-size: 12px; font-weight: 700; margin-bottom: 6px; color: var(--navy); }
    input, select, textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #d4cdbf;
      border-radius: 8px;
      background: #faf9f6;
      font-size: 13px;
      margin-bottom: 14px;
      font-family: inherit;
    }
    textarea { resize: vertical; }
    button {
      cursor: pointer;
      border: none;
      border-radius: 8px;
      font-weight: 700;
      font-size: 13px;
      padding: 11px 16px;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.92; }
    .btn-primary { width: 100%; background: var(--navy); color: #fff; font-size: 14px; }
    .btn-gold { background: var(--gold); color: var(--obsidian); padding: 7px 12px; font-size: 12px; }
    .btn-outline { background: #faf9f6; border: 1px solid var(--border); color: var(--navy); padding: 7px 12px; font-size: 12px; }
    .result-item {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 12px;
      background: #faf9f6;
    }
    .result-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    pre {
      background: #fff;
      border: 1px solid #eae5da;
      padding: 10px;
      border-radius: 6px;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
      margin: 10px 0 0;
      font-family: inherit;
    }
    .warn {
      margin-top: 18px;
      padding: 12px 14px;
      border-radius: 8px;
      background: #fffbeb;
      border: 1px solid #fde68a;
      font-size: 12px;
      color: #78350f;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--obsidian);
      color: #fff;
      border: 1px solid var(--gold);
      padding: 8px 18px;
      border-radius: 99px;
      font-size: 12px;
      font-weight: 600;
      display: none;
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <span class="badge">CN LAWYER AI TOOLBOX · 律所团队发码主控台</span>
      <h1>中国律师 AI 工具箱 · 实名专属激活码无限签发器</h1>
      <p class="sub">100% 本地离线运行（ECDSA P-256 非对称私钥签名）· 双击即开 · 支持单人及全所名单无限批量生成</p>
    </div>
  </header>

  <main class="wrap">
    <div class="grid">
      <div class="card">
        <label>1. 线上工具箱部署域名（用于拼装微信一键免输激活链接）</label>
        <input id="originInput" type="text" value="https://your-domain.com" />

        <label>2. 授权职级身份标签（官网口径）</label>
        <select id="roleSelect">
          <option value="专职律师">专职律师</option>
          <option value="合伙人">合伙人</option>
          <option value="副主任 / 合伙人">副主任 / 合伙人</option>
          <option value="主任">主任</option>
          <option value="律师助理">律师助理</option>
          <option value="实习律师">实习律师</option>
          <option value="行政与顾问">行政与顾问</option>
        </select>

        <label>3. 授权有效期限</label>
        <select id="expirySelect" onchange="toggleCustomDate()">
          <option value="forever">长期有效（本所正式人员推荐）</option>
          <option value="365">1 年有效期（365天）</option>
          <option value="180">半年有效期（180天 · 实习/协作）</option>
          <option value="90">90 天临时体验</option>
          <option value="custom">手动指定截止日期</option>
        </select>

        <div id="customDateWrap" style="display:none;">
          <label>指定截止日期</label>
          <input id="customDateInput" type="date" />
        </div>

        <label>4. 授权起始流水号（自动递增，如 LAW-2026-001）</label>
        <input id="seqInput" type="number" min="1" value="1" />

        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <label style="margin:0;">5. 律师姓名名单（每行一个，支持「姓名:职级」）</label>
          <button type="button" class="btn-outline" style="padding:4px 10px;font-size:11px;" onclick="fillOfficialRoster()">一键填入示例 5 人名录</button>
        </div>
        <textarea id="namesInput" rows="6" placeholder="示例：&#10;张示范:主任&#10;李示例:合伙人&#10;王示例:专职律师&#10;赵示例:律师助理&#10;周示例:实习律师"></textarea>

        <button class="btn-primary" onclick="generateBatch()">立即签发实名专属激活码</button>

        <div class="warn">
          <strong>保密提醒：</strong>本 HTML 文件内置本所签发私钥，请仅保存在主任个人电脑本地，<strong>切勿将本发码器文件发送给他人或上传至公开网站</strong>（给律师发放时只复制右侧生成的激活码卡片即可）。
          <div style="margin-top:8px;">
            <button class="btn-outline" onclick="copyMasterToken()">复制手机端随身签发主密钥 (TR-MASTER-...)</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="result-head" style="border-bottom:1px solid #efece5; padding-bottom:12px; margin-bottom:14px;">
          <strong style="font-size:15px;">已签发的专属激活凭证列表（<span id="countSpan">0</span> 份）</strong>
          <div style="display:flex; gap:8px;">
            <button class="btn-outline" onclick="exportCsv()">导出台账 (.csv)</button>
            <button class="btn-gold" onclick="copyAllCards()">一键复制全部卡片</button>
          </div>
        </div>
        <div id="resultsContainer" style="font-size:13px; color:#64748b; text-align:center; padding:48px 0;">
          在左侧输入一位或多位律师姓名后点击签发，即可无限生成专属激活码与微信一键激活链接。
        </div>
      </div>
    </div>
  </main>

  <div id="toast" class="toast"></div>

  <script>
    // Pure-JS SHA-256 + NIST P-256 ECDSA (works 100% offline even on file:// where window.crypto.subtle is unavailable!)
    const PRIV_D = BigInt('0x${dHex}');
    const MASTER_TOKEN = ${JSON.stringify(masterToken)};

    const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
    const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    const A = P - 3n;
    const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
    const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

    function mod(a, m = P) { const r = a % m; return r >= 0n ? r : r + m; }
    function modInv(a, m = P) {
      let [t, newT] = [0n, 1n];
      let [r, newR] = [m, mod(a, m)];
      while (newR !== 0n) {
        const q = r / newR;
        [t, newT] = [newT, t - q * newT];
        [r, newR] = [newR, r - q * newR];
      }
      return mod(t, m);
    }
    function pointAdd(p1, p2) {
      if (!p1) return p2;
      if (!p2) return p1;
      const [x1, y1] = p1, [x2, y2] = p2;
      if (x1 === x2 && mod(y1 + y2) === 0n) return null;
      const lam = x1 === x2 && y1 === y2
        ? mod((3n * x1 * x1 + A) * modInv(2n * y1))
        : mod((y2 - y1) * modInv(x2 - x1));
      const x3 = mod(lam * lam - x1 - x2);
      const y3 = mod(lam * (x1 - x3) - y1);
      return [x3, y3];
    }
    function pointMul(k, pt = [GX, GY]) {
      let res = null, addend = pt, scalar = k;
      while (scalar > 0n) {
        if (scalar & 1n) res = pointAdd(res, addend);
        addend = pointAdd(addend, addend);
        scalar >>= 1n;
      }
      return res;
    }

    const K256 = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
    function sha256Bytes(msgBytes) {
      const l = msgBytes.length;
      const bitLen = l * 8;
      const padLen = ((l + 9 + 63) >> 6) << 6;
      const buf = new Uint8Array(padLen);
      buf.set(msgBytes);
      buf[l] = 0x80;
      const dv = new DataView(buf.buffer);
      dv.setUint32(padLen - 4, bitLen >>> 0, false);
      dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
      let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
      const w = new Uint32Array(64);
      for (let i = 0; i < padLen; i += 64) {
        for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
        for (let j = 16; j < 64; j++) {
          const s0 = rotr(7, w[j-15]) ^ rotr(18, w[j-15]) ^ (w[j-15] >>> 3);
          const s1 = rotr(17, w[j-2]) ^ rotr(19, w[j-2]) ^ (w[j-2] >>> 10);
          w[j] = (w[j-16] + s0 + w[j-7] + s1) >>> 0;
        }
        let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
        for (let j = 0; j < 64; j++) {
          const S1 = rotr(6,e) ^ rotr(11,e) ^ rotr(25,e);
          const ch = (e & f) ^ ((~e) & g);
          const temp1 = (h + S1 + ch + K256[j] + w[j]) >>> 0;
          const S0 = rotr(2,a) ^ rotr(13,a) ^ rotr(22,a);
          const maj = (a & b) ^ (a & c) ^ (b & c);
          const temp2 = (S0 + maj) >>> 0;
          h=g; g=f; f=e; e=(d + temp1) >>> 0; d=c; c=b; b=a; a=(temp1 + temp2) >>> 0;
        }
        h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
        h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
      }
      const out = new Uint8Array(32);
      const odv = new DataView(out.buffer);
      [h0,h1,h2,h3,h4,h5,h6,h7].forEach((v, idx) => odv.setUint32(idx * 4, v, false));
      return out;
    }

    function bytesToBigInt(bytes) {
      let hex = '';
      for (const b of bytes) hex += b.toString(16).padStart(2, '0');
      return BigInt('0x' + (hex || '0'));
    }
    function bigIntTo32Bytes(bn) {
      const hex = bn.toString(16).padStart(64, '0');
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i*2, i*2+2), 16);
      return out;
    }
    function toB64Url(bytes) {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
    }

    function ecdsaSignP256(payloadBytes) {
      const z = bytesToBigInt(sha256Bytes(payloadBytes));
      while (true) {
        const rand = new Uint8Array(32);
        crypto.getRandomValues(rand);
        const k = mod(bytesToBigInt(rand), N - 1n) + 1n;
        const pt = pointMul(k);
        if (!pt) continue;
        const r = mod(pt[0], N);
        if (r === 0n) continue;
        const s = mod(modInv(k, N) * (z + r * PRIV_D), N);
        if (s === 0n) continue;
        const sig = new Uint8Array(64);
        sig.set(bigIntTo32Bytes(r), 0);
        sig.set(bigIntTo32Bytes(s), 32);
        return sig;
      }
    }

    const OFFICIAL_ROSTER = [
      '张示范:主任',
      '李示例:合伙人',
      '王示例:专职律师',
      '赵示例:律师助理',
      '周示例:实习律师',
    ];

    function fillOfficialRoster() {
      document.getElementById('namesInput').value = OFFICIAL_ROSTER.join('\\n');
      showToast('已填入示例律所 5 位成员（请按本所实际名单修改）');
    }

    let lastGenerated = [];

    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 2400);
    }

    function toggleCustomDate() {
      const v = document.getElementById('expirySelect').value;
      document.getElementById('customDateWrap').style.display = v === 'custom' ? 'block' : 'none';
    }

    function generateBatch() {
      const rawNames = document.getElementById('namesInput').value;
      const defaultRole = document.getElementById('roleSelect').value;
      const expiryMode = document.getElementById('expirySelect').value;
      const origin = (document.getElementById('originInput').value || 'https://your-domain.com').replace(/\\/+$/, '');
      let seq = Math.max(1, parseInt(document.getElementById('seqInput').value || '1', 10));

      const entries = rawNames.split(/[\\n,，、;；]+/).map(s => s.trim()).filter(Boolean);
      if (entries.length === 0) {
        showToast('请至少输入一位律师姓名');
        return;
      }

      let expiresAt = '';
      if (expiryMode === 'custom') {
        expiresAt = document.getElementById('customDateInput').value || '';
      } else if (expiryMode !== 'forever') {
        const d = new Date();
        d.setDate(d.getDate() + parseInt(expiryMode, 10));
        expiresAt = d.toISOString().slice(0, 10);
      }

      const issuedAt = new Date().toISOString().slice(0, 10);
      const year = new Date().getFullYear();
      const batch = [];

      for (const item of entries) {
        const parts = item.split(/[:：]/);
        const holderName = parts[0].trim();
        const role = (parts[1] || defaultRole).trim();
        const serialNo = 'TR-' + year + '-' + String(seq++).padStart(3, '0');

        const wire = { i: 'TR', n: holderName, r: role, s: serialNo, t: issuedAt, e: expiresAt };
        const payloadBytes = new TextEncoder().encode(JSON.stringify(wire));
        const sigBytes = ecdsaSignP256(payloadBytes);
        const code = 'TR1-' + toB64Url(payloadBytes) + '.' + toB64Url(sigBytes);
        const quickUrl = origin + '/?activate=' + encodeURIComponent(code);

        const cardText = [
          '【中国律师 AI 工具箱 · 律所实名授权函】',
          '授权予：' + holderName + '（' + role + '）',
          '授权编号：' + serialNo + ' ｜ 有效期：' + (expiresAt ? '至 ' + expiresAt : '长期有效'),
          '',
          '▶ 一键免输激活入口（手机点开自动激活）：',
          quickUrl,
          '',
          '▶ 或在激活页直接粘贴以下专属激活码：',
          code
        ].join('\\n');

        batch.push({ holderName, role, serialNo, issuedAt, expiresAt: expiresAt || '长期有效', code, quickUrl, cardText });
      }

      document.getElementById('seqInput').value = String(seq);
      lastGenerated = batch.concat(lastGenerated);
      renderList();
      showToast('成功签发 ' + batch.length + ' 枚本所实名专属激活码！');
    }

    function renderList() {
      document.getElementById('countSpan').textContent = String(lastGenerated.length);
      const box = document.getElementById('resultsContainer');
      if (lastGenerated.length === 0) return;
      box.style.textAlign = 'left';
      box.style.padding = '0';
      box.innerHTML = lastGenerated.map((it, idx) => \`
        <div class="result-item">
          <div class="result-head">
            <div>
              <strong style="color:#0E223D;font-size:14px;">\${it.holderName}</strong>
              <span style="font-size:12px;color:#7A5922;margin-left:6px;">\${it.role} · \${it.serialNo}（\${it.expiresAt}）</span>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn-outline" onclick="copyTextIdx(\${idx}, 'code')">仅复制码</button>
              <button class="btn-gold" onclick="copyTextIdx(\${idx}, 'card')">复制微信发放函</button>
            </div>
          </div>
          <pre>\${it.cardText}</pre>
        </div>
      \`).join('');
    }

    function copyTextIdx(idx, kind) {
      const item = lastGenerated[idx];
      navigator.clipboard.writeText(kind === 'code' ? item.code : item.cardText);
      showToast('已复制「' + item.holderName + '」' + (kind === 'code' ? '激活码' : '微信授权函'));
    }

    function copyAllCards() {
      if (lastGenerated.length === 0) return showToast('请先生成激活码');
      navigator.clipboard.writeText(lastGenerated.map(x => x.cardText).join('\\n\\n----------------------------------------\\n\\n'));
      showToast('已复制全部 ' + lastGenerated.length + ' 份微信授权函');
    }

    function copyMasterToken() {
      navigator.clipboard.writeText(MASTER_TOKEN);
      showToast('已复制主任随身签发主密钥 (TR-MASTER-...)');
    }

    function exportCsv() {
      if (lastGenerated.length === 0) return showToast('暂无记录可导出');
      const rows = [['授权编号','持有人','职级','签发日期','有效期','专属激活码','一键激活链接']];
      for (const it of lastGenerated) {
        rows.push([it.serialNo, it.holderName, it.role, it.issuedAt, it.expiresAt, it.code, it.quickUrl]);
      }
      const csv = '\\uFEFF' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\\r\\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '中国律师 AI 工具箱_激活码发放台账_' + new Date().toISOString().slice(0,10) + '.csv';
      a.click();
    }
  </script>
</body>
</html>`;

fs.writeFileSync(OUT_HTML, html, { mode: 0o600 });
fs.chmodSync(OUT_HTML, 0o600);
console.log(`[build-admin-keygen-app] Generated standalone double-clickable generator: ${OUT_HTML}`);
