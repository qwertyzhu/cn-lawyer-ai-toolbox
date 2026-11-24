import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'vendor', 'lawyer-fee-workbench.source.html');
const OUT_PATH = path.join(ROOT, 'public', 'tool-assets', 'lawyer-fee-workbench.html');

if (!fs.existsSync(SOURCE_PATH)) {
  if (fs.existsSync(OUT_PATH)) {
    console.log('[prepare-lawyer-fee-workbench] Source missing, keeping existing public/tool-assets/lawyer-fee-workbench.html');
    process.exit(0);
  }
  console.error('[prepare-lawyer-fee-workbench] Missing vendor/lawyer-fee-workbench.source.html');
  process.exit(1);
}

let html = fs.readFileSync(SOURCE_PATH, 'utf8').replace(/\r\n/g, '\n');

// 0. Ensure open-source credit footer and zero personal info
html = html.replace(
  /<footer class="credit">[\s\S]*?<\/footer>/,
  '<footer class="credit">© 2026 CN Lawyer AI Toolbox · Apache-2.0 Open Source</footer>'
);

// 0b. Sync window.FIRM_PRESET with official Zhejiang DOJ standard (浙价服〔2011〕212号) and ZERO pre-populated personal members/phones
const ZHEJIANG_DOJ_PRESET = {
  type: 'lawyer-fee-mine',
  v: 4,
  members: [],
  draft: {
    name: '律师服务收费测算标准（默认参照浙江省司法厅标准，可切换全国 31 省）',
    firm: '',
    doc: '浙价服〔2011〕212号（范围依浙价服〔2015〕203号）',
    date: '2011-08-01',
    scope: '民商事诉讼与仲裁、知识产权及文化传媒法律服务、刑事辩护、行政诉讼、国家赔偿及常年专项非诉服务（参照浙江省物价局、浙江省司法厅《关于制定律师服务收费标准的通知》执行）。',
    segs: [
      { to: 10, type: 'rate', lo: 6, hi: 8 },
      { to: 50, type: 'rate', lo: 5, hi: 6 },
      { to: 100, type: 'rate', lo: 4, hi: 5 },
      { to: 500, type: 'rate', lo: 3, hi: 4 },
      { to: 1000, type: 'rate', lo: 2, hi: 3 },
      { to: '', type: 'rate', lo: 1, hi: 2 },
    ],
    base: ['', ''],
    min: 2500,
    stage: ['', 70],
    cx: 5,
    hr: [800, 3000],
    np: [
      ['民事诉讼、知识产权（不涉及财产，计件）', 2500, 10000],
      ['行政诉讼、国家赔偿（不涉及财产，计件）', 2500, 10000],
    ],
    crim: [
      ['侦查阶段', 1500, 8000],
      ['审查起诉阶段', 1500, 10000],
      ['一审审判阶段', 2500, 25000],
    ],
    notes:
      '依据浙江省物价局、浙江省司法厅《关于制定律师服务收费标准的通知》（浙价服〔2011〕212号）：曾代理前一阶段的，后一阶段按不高于前一阶段收费标准的 70% 执行；重大、疑难、复杂案件可在标准上限 5 倍内协商。\n计时收费依 212 号文件原则由律所与委托人按有效工作时间协商确定；影视版权及知识产权批量维权案件可采取阶梯计件加回款分成方式另行约定，各环节合计不超过司发通〔2021〕87号上限。',
  },
};
const firmPresetRe = /window\.FIRM_PRESET\s*=\s*\{[\s\S]*?\};/;
if (!firmPresetRe.test(html)) {
  throw new Error('Could not locate window.FIRM_PRESET in source HTML');
}
html = html.replace(firmPresetRe, `window.FIRM_PRESET = ${JSON.stringify(ZHEJIANG_DOJ_PRESET)};`);

// Open-source standalone workbench works directly in both open mode and embedded iframe
const headCharsetMarker = '<meta charset="utf-8">';
if (!html.includes(headCharsetMarker)) {
  throw new Error('Could not locate charset meta in source HTML');
}

// Auto-upgrade legacy placeholder draft in localStorage['lf-mine'] seamlessly to Zhejiang DOJ 212 standard
const presetInitMarker = `if (PRESET && PRESET.draft && !localStorage.getItem('lf-mine')) {
  localStorage.setItem('lf-mine', JSON.stringify(PRESET.draft));
}`;
if (html.includes(presetInitMarker)) {
  html = html.replace(
    presetInitMarker,
    `if (PRESET && PRESET.draft) {
  try {
    const existingMineRaw = localStorage.getItem('lf-mine');
    const existingMine = existingMineRaw ? JSON.parse(existingMineRaw) : null;
    if (!existingMine || (existingMine.name && String(existingMine.name).includes('待核改备案数字'))) {
      localStorage.setItem('lf-mine', JSON.stringify(PRESET.draft));
    }
  } catch (_) {
    localStorage.setItem('lf-mine', JSON.stringify(PRESET.draft));
  }
}`
  );
}

// 0c. Upgrade sheetCfg initialization: NEVER pre-fill personal author/phone, add showSign toggle, and auto-clean legacy pre-filled cache
const sheetCfgInitTarget = `const initMembers = (PRESET && Array.isArray(PRESET.members)) ? PRESET.members : [];
const sheetCfg = Object.assign({
  author: initMembers[0] ? initMembers[0].name : '',
  firm: (PRESET && PRESET.draft && PRESET.draft.firm) || (MINE && MINE.by !== '本所' ? MINE.by : ''),
  phone: initMembers[0] ? (initMembers[0].phone || '') : '',
  members: initMembers,
  valid: '30', semiBase: '5000', semiRate: '8', riskRate: '15',
  sr1: '6', sr2: '10', sr3: '15',
  hrRate: '', hrHours: '', hrCap: '', scen: '100,50,20', capOn: true,
  wlRate: '1500', wlText: ''
}, JSON.parse(localStorage.getItem('lf-sheet') || '{}'));
const saveSheetCfg = () => localStorage.setItem('lf-sheet', JSON.stringify(sheetCfg));`;

if (!html.includes(sheetCfgInitTarget)) {
  throw new Error('Could not locate sheetCfg init block in source HTML');
}
html = html.replace(
  sheetCfgInitTarget,
  `const initMembers = [];
const _savedSheetRaw = JSON.parse(localStorage.getItem('lf-sheet') || '{}');
const _needCleanLegacySign = !_savedSheetRaw.signCustomV2;
const sheetCfg = Object.assign({
  author: '',
  firm: (PRESET && PRESET.draft && PRESET.draft.firm) || '',
  phone: '',
  showSign: true,
  signCustomV2: true,
  members: initMembers,
  valid: '30', semiBase: '5000', semiRate: '8', riskRate: '15',
  sr1: '6', sr2: '10', sr3: '15',
  hrRate: '', hrHours: '', hrCap: '', scen: '100,50,20', capOn: true,
  wlRate: '1500', wlText: ''
}, _savedSheetRaw);
const saveSheetCfg = () => localStorage.setItem('lf-sheet', JSON.stringify(sheetCfg));
if (_needCleanLegacySign) {
  sheetCfg.members = [];
  sheetCfg.author = '';
  sheetCfg.phone = '';
  if (!sheetCfg.firm) sheetCfg.firm = '';
  if (typeof sheetCfg.showSign !== 'boolean') sheetCfg.showSign = true;
  sheetCfg.signCustomV2 = true;
  try { localStorage.removeItem('lf-sheet-author-manual'); } catch (_) {}
  saveSheetCfg();
}`
);

// 1. Disable dark-mode media override so embedded iframe always harmonizes with Tianran warm paper light UI
const darkMediaRe = /@media \(prefers-color-scheme: dark\)\{[\s\S]*?\n\}/;
if (!darkMediaRe.test(html)) {
  throw new Error('Could not locate dark-mode media query in source HTML');
}
html = html.replace(
  darkMediaRe,
  `/* Tianran Toolbox unified warm-paper theme override */
:root{
  --paper:#F6F4EF; --paper2:#EDE8DC; --card:#FFFFFF; --ink:#14181F; --ink2:#5A5347; --rule:#DED8CC;
  --seal:#b0301f; --seal-soft:#f7e5df; --ok:#2f6b3a; --bar:#0E223D; --warn:#9a6a10; --off:#7d756a;
}`
);

// 2. Inject Tianran embedded layout, custom sign-off card, & responsive CSS right before </style>
const embeddedCss = `
/* Tianran Toolbox Embedded, Custom Sign-off & Top 3-Tab Styles */
nav.tabs{display:none !important}
body{padding-bottom:24px}
body.tr-embed{
  background:#F6F4EF;
  background-image:none;
  padding-bottom:16px;
}
body.tr-embed header,
body.tr-embed footer.credit{display:none !important}
body.tr-embed .wrap{max-width:100%;padding:6px 14px 20px}
@media (min-width:640px){
  body.tr-embed .wrap{padding:10px 24px 28px}
}
.tr-top-tabs{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:6px;
  padding:5px;
  margin:4px 0 14px;
  background:#FFFFFF;
  border:1px solid #DED8CC;
  border-radius:12px;
  box-shadow:0 1px 2px rgba(14,34,61,.04);
}
.tr-top-tabs button{
  border:0;
  background:transparent;
  color:#4B5563;
  font:inherit;
  font-size:13px;
  font-weight:700;
  padding:9px 6px;
  border-radius:8px;
  cursor:pointer;
  white-space:nowrap;
  transition:background .15s,color .15s;
}
.tr-top-tabs button:hover{color:#0E223D;background:#F6F4EF}
.tr-top-tabs button.on{
  background:#0E223D;
  color:#F6F4EF;
  box-shadow:0 1px 3px rgba(14,34,61,.18);
}
body.sheet-mode .tr-top-tabs{display:none !important}
body:not(.tr-embed) .tr-bridge-only{display:none !important}
.btn.tr-navy{background:#0E223D;border-color:#0E223D;color:#F6F4EF;font-weight:600}
.btn.tr-gold{background:#B89254;border-color:#B89254;color:#11151C;font-weight:700}

/* Custom Sign-off Control Panel inside #v-sheet .toolbar */
.tr-sign-card{
  margin-top:12px;
  padding:12px 14px;
  border:1px solid #DED4C0;
  border-radius:10px;
  background:#FAF8F2;
}
.tr-sign-head{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:8px;
}
.tr-sign-title{
  font-size:13px;
  font-weight:700;
  color:#0E223D;
  display:inline-flex;
  align-items:center;
  gap:6px;
}
.tr-sign-actions{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px;
}
.tr-sign-mini-btn{
  border:1px solid #D6CCB8;
  background:#fff;
  color:#0E223D;
  font:inherit;
  font-size:11.5px;
  font-weight:600;
  padding:4px 9px;
  border-radius:6px;
  cursor:pointer;
}
.tr-sign-mini-btn:hover{border-color:#0E223D;background:#F3EFE6}
.tr-sign-grid{
  margin-top:10px;
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:8px;
}
.tr-sign-grid label{
  display:block;
  font-size:11.5px;
  font-weight:600;
  color:#5A5347;
  margin-bottom:4px;
}
.tr-sign-grid input{
  width:100%;
  box-sizing:border-box;
  border:1px solid #D8D1C3;
  border-radius:7px;
  background:#fff;
  color:#14181F;
  font:inherit;
  font-size:13px;
  padding:7px 9px;
}
.tr-sign-grid input:focus{outline:none;border-color:#0E223D}
.tr-sign-hint{
  margin-top:7px;
  font-size:11.5px;
  color:#6E6557;
  line-height:1.5;
}
.tr-sign-row{display:contents}
.paper .sign.tr-pulse{
  outline:2px solid #B89254;
  outline-offset:6px;
  border-radius:6px;
  background:#FCF8EE;
  transition:background .3s;
}

.amt input{min-width:0}
#cmpOut,#out{overflow-x:auto;-webkit-overflow-scrolling:touch}
@media (max-width:640px){
  .tr-sign-grid{grid-template-columns:1fr}
}
@media (max-width:480px){
  .tr-top-tabs button{font-size:12px;padding:8px 4px}
  .amt input{font-size:18px;padding:9px 10px}
  .unit button{padding:0 11px;font-size:13px}
  .seg button{font-size:13px;padding:6px 10px}
  .btn{font-size:13px;padding:7px 11px}
  .paper{padding:18px 14px 20px;font-size:13px}
  .paper h2{font-size:20px;letter-spacing:.22em}
  .paper .sign{max-width:100%;font-size:12.5px}
  .paper table{font-size:12px}
  #editor .grid{grid-template-columns:1fr}
  #editor .row4,#editor .row3{grid-template-columns:1fr 1fr;gap:6px}
  #editor .hd{display:none}
  #editor input,#editor select,#editor textarea{min-width:0;font-size:14px}
  table{font-size:12.5px}
}
@media print{
  .tr-top-tabs,.tr-bridge-only,.tr-sign-card{display:none !important}
  .tr-sign-row.is-empty{display:none !important}
  body,body.tr-embed{background:#fff !important;padding:0 !important}
  body.tr-embed .wrap{padding:0 !important;max-width:100% !important}
}
`;

const styleEndMarker = '</style>';
if (!html.includes(styleEndMarker)) {
  throw new Error('Could not locate </style> in source HTML');
}
html = html.replace(styleEndMarker, embeddedCss + '\n</style>');

// 3. Inject Top 3-Tab Switcher right after </header> (removes redundant 工具箱 tab cleanly)
const headerEndMarker = '  </header>';
if (!html.includes(headerEndMarker)) {
  throw new Error('Could not locate </header> in source HTML');
}
const topTabsHtml = `  </header>

  <nav class="tr-top-tabs" id="trTopTabs" aria-label="律师费工作台视图切换">
    <button type="button" data-v="calc" class="on">律师费与报价单</button>
    <button type="button" data-v="cmp">全国 31 省对比</button>
    <button type="button" data-v="info">收费规则与核验</button>
  </nav>`;
html = html.replace(headerEndMarker, topTabsHtml);

// 4. Add Toolbox Bridge buttons inside #v-sheet .toolbar .btns AND Custom Sign-off Panel right after #sheetModes
const sheetCopyWxMarker = `        <button class="btn" id="sheetCopyWx">复制微信报价文案</button>`;
if (!html.includes(sheetCopyWxMarker)) {
  throw new Error('Could not locate #sheetCopyWx in source HTML');
}
html = html.replace(
  sheetCopyWxMarker,
  `        <button class="btn" id="sheetCopyWx">复制微信报价文案</button>
        <button class="btn tr-navy tr-bridge-only" id="trSaveSheetHistory">存入本机记录</button>
        <button class="btn tr-gold tr-bridge-only" id="trSendSheetAi">送 AI 润色微信报价</button>`
);

const sheetModesEndMarker = `      <div class="seg" id="sheetModes" style="margin-top:12px">
        <button data-m="quote">给客户的报价单</button>
        <button data-m="calc">律师费测算单（附依据明细）</button>
      </div>`;
if (!html.includes(sheetModesEndMarker)) {
  throw new Error('Could not locate #sheetModes in source HTML');
}
html = html.replace(
  sheetModesEndMarker,
  `${sheetModesEndMarker}

      <!-- 报价单 / 测算单落款自定义面板（每位律师独立存本机，绝不预填他人信息） -->
      <div class="tr-sign-card" id="trSignCard">
        <div class="tr-sign-head">
          <label class="chk tr-sign-title" style="margin:0;cursor:pointer">
            <input type="checkbox" id="trSignOn">
            <span>底部显示落款信息（本机自定义）</span>
          </label>
          <div class="tr-sign-actions">
            <button type="button" class="tr-sign-mini-btn" id="trJumpSign">↓ 定位到底部落款</button>
            <button type="button" class="tr-sign-mini-btn" id="trClearSign">清空个人姓名/电话</button>
          </div>
        </div>
        <div class="tr-sign-grid" id="trSignFields">
          <div>
            <label for="trSignFirm">落款律所（可改或留空）</label>
            <input id="trSignFirm" type="text" placeholder="如：某某律师事务所">
          </div>
          <div>
            <label for="trSignAuthor">承办律师 / 落款人（选填）</label>
            <input id="trSignAuthor" type="text" placeholder="留空则打印时不显示该行">
          </div>
          <div>
            <label for="trSignPhone">联系电话 / 微信（选填）</label>
            <input id="trSignPhone" type="text" placeholder="留空则打印时不显示该行">
          </div>
        </div>
        <div class="tr-sign-hint">默认不含任何个人姓名与电话；您填写的落款信息仅保存在您本人设备本地，可直接点击下方报价单底部虚线同步修改。</div>
      </div>`
);

// 4b. Upgrade sign rendering inside renderPaper() so showSign toggle works & unfilled rows auto-hide when printing
const signRenderTarget = `  const sign = \`<div class="sign"><span>\${mode === 'quote' ? '承办律师' : '测算人'}：</span>\${ed('author', sheetCfg.author, '律师姓名')}
    <span>律师事务所：</span>\${ed('firm', sheetCfg.firm, '律所名称')}\${mode === 'quote' ? \`<span>联系电话：</span>\${ed('phone', sheetCfg.phone, '电话')}\` : ''}
    <span>日期：</span><span>\${todayCn()}</span></div>\`;`;
if (!html.includes(signRenderTarget)) {
  throw new Error('Could not locate sign HTML in renderPaper()');
}
html = html.replace(
  signRenderTarget,
  `  if (typeof syncSignCardInputs === 'function') syncSignCardInputs();
  const sign = sheetCfg.showSign === false ? '' : \`<div class="sign" id="trPaperSign">
    <div class="tr-sign-row\${!(sheetCfg.author || '').trim() ? ' is-empty' : ''}"><span>\${mode === 'quote' ? '承办律师' : '测算人'}：</span>\${ed('author', sheetCfg.author, '选填（点此或上方自定义）')}</div>
    <div class="tr-sign-row\${!(sheetCfg.firm || '').trim() ? ' is-empty' : ''}"><span>律师事务所：</span>\${ed('firm', sheetCfg.firm, '选填律所名称')}</div>
    \${mode === 'quote' ? \`<div class="tr-sign-row\${!(sheetCfg.phone || '').trim() ? ' is-empty' : ''}"><span>联系电话：</span>\${ed('phone', sheetCfg.phone, '选填电话/微信')}</div>\` : ''}
    <div class="tr-sign-row"><span>日期：</span><span>\${todayCn()}</span></div>
  </div>\`;`
);

// 4c. Respect showSign === false in buildWechatQuoteText()
const wxFooterTarget = `  const footer = [sheetCfg.firm, sheetCfg.author ? sheetCfg.author + '律师' : '', sheetCfg.phone].filter(Boolean).join(' · ');
  if (footer) lines.push(\`────────────────\\n\${footer}\`);`;
if (!html.includes(wxFooterTarget)) {
  throw new Error('Could not locate WeChat footer in buildWechatQuoteText()');
}
html = html.replace(
  wxFooterTarget,
  `  if (sheetCfg.showSign !== false) {
    const cleanAuthor = (sheetCfg.author || '').trim();
    const authorLabel = cleanAuthor ? (cleanAuthor.endsWith('律师') ? cleanAuthor : cleanAuthor + '律师') : '';
    const footer = [(sheetCfg.firm || '').trim(), authorLabel, (sheetCfg.phone || '').trim()].filter(Boolean).join(' · ');
    if (footer) lines.push(\`────────────────\\n\${footer}\`);
  }`
);

// 4d. Two-way sync when editing inline inside #paper .sign
const paperOnInputTarget = `  if (['author', 'firm', 'phone', 'valid'].includes(k)) { sheetCfg[k] = e.target.innerText.trim(); saveSheetCfg(); return; }`;
if (!html.includes(paperOnInputTarget)) {
  throw new Error('Could not locate #paper oninput handler');
}
html = html.replace(
  paperOnInputTarget,
  `  if (['author', 'firm', 'phone', 'valid'].includes(k)) {
    sheetCfg[k] = e.target.innerText.trim();
    saveSheetCfg();
    const row = e.target.closest('.tr-sign-row');
    if (row) row.classList.toggle('is-empty', !sheetCfg[k]);
    if (typeof syncSignCardInputs === 'function') syncSignCardInputs();
    return;
  }`
);

// 5. Make confirmScope() non-blocking in embedded mode (iOS PWA / WeChat WebView safe; #qWarn still shows prominently inside sheet)
const confirmScopeTarget = `function confirmScope() {
  const w = last && scopeWarning(last.s, state.type);
  if (!w) return true;
  return confirm(w + '\\n\\n报价单会写明适用范围。仍要生成吗？');
}`;
if (!html.includes(confirmScopeTarget)) {
  throw new Error('Could not locate confirmScope() in source HTML');
}
html = html.replace(
  confirmScopeTarget,
  `function confirmScope() {
  const w = last && scopeWarning(last.s, state.type);
  if (!w) return true;
  if (window.self !== window.top || new URLSearchParams(location.search).get('embed') === '1') {
    toast('提示：该标准适用范围受限，报价单已自动标注提示');
    return true;
  }
  return confirm(w + '\\n\\n报价单会写明适用范围。仍要生成吗？');
}`
);

// 6. Forward toast() to parent when embedded so toast never renders off-screen in tall auto-sized iframe
const toastTarget = `function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 1700); }`;
if (!html.includes(toastTarget)) {
  throw new Error('Could not locate toast() in source HTML');
}
html = html.replace(
  toastTarget,
  `function toast(m) {
  if (window.self !== window.top) {
    try { window.parent.postMessage({ type: 'tr-fee-toast', message: String(m || '') }, location.origin); return; } catch (_) {}
  }
  const t = $('#toast'); t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 1700);
}`
);

// 7. Wire top 3-tab switcher, custom sign-off controls, auto-resize ResizeObserver, and parent<->iframe postMessage bridge
const renderAllEndMarker = `function show(v) {
  document.body.classList.toggle('sheet-mode', v === 'sheet');
  document.querySelectorAll('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'cmp') { $('#amt2').value = state.amt; renderCmp(); }
  if (v === 'tools') renderTools();
  window.scrollTo(0, 0);
}
document.querySelector('nav.tabs').onclick = (e) => { const v = e.target.dataset.v; if (v) show(v); };

renderAll();`;

if (!html.includes(renderAllEndMarker)) {
  throw new Error('Could not locate show()/renderAll() tail in source HTML');
}

const bridgeScript = `const IS_EMBED = window.self !== window.top || new URLSearchParams(location.search).get('embed') === '1';
if (IS_EMBED) document.body.classList.add('tr-embed');
else document.querySelectorAll('.tr-bridge-only').forEach((el) => { el.hidden = true; });

function postToParent(payload) {
  if (window.self === window.top) return;
  try { window.parent.postMessage(payload, location.origin); } catch (_) {}
}

let lastPostedHeight = 0;
function reportHeight() {
  if (!IS_EMBED) return;
  const wrap = document.querySelector('.wrap');
  const h = Math.max(540, Math.ceil((wrap ? wrap.getBoundingClientRect().height : document.body.scrollHeight) + 28));
  if (Math.abs(h - lastPostedHeight) >= 4) {
    lastPostedHeight = h;
    postToParent({ type: 'tr-fee-height', height: h });
  }
}

function syncSignCardInputs() {
  const onChk = $('#trSignOn');
  const fieldsBox = $('#trSignFields');
  const jumpBtn = $('#trJumpSign');
  if (onChk) onChk.checked = sheetCfg.showSign !== false;
  if (fieldsBox) fieldsBox.hidden = sheetCfg.showSign === false;
  if (jumpBtn) jumpBtn.hidden = sheetCfg.showSign === false;
  const syncOne = (sel, val) => {
    const el = $(sel);
    if (el && document.activeElement !== el) el.value = val || '';
  };
  syncOne('#trSignFirm', sheetCfg.firm);
  syncOne('#trSignAuthor', sheetCfg.author);
  syncOne('#trSignPhone', sheetCfg.phone);
}

function bindSignCardEvents() {
  const onChk = $('#trSignOn');
  if (onChk) {
    onChk.onchange = () => {
      sheetCfg.showSign = onChk.checked;
      saveSheetCfg();
      renderPaper();
      requestAnimationFrame(reportHeight);
    };
  }
  const wireInput = (sel, field) => {
    const el = $(sel);
    if (!el) return;
    el.oninput = () => {
      sheetCfg[field] = el.value.trim();
      saveSheetCfg();
      const targetSpan = document.querySelector('#paper [data-k="' + field + '"]');
      if (targetSpan && document.activeElement !== targetSpan) {
        targetSpan.innerText = sheetCfg[field];
        const row = targetSpan.closest('.tr-sign-row');
        if (row) row.classList.toggle('is-empty', !sheetCfg[field]);
      } else {
        renderPaper();
      }
    };
  };
  wireInput('#trSignFirm', 'firm');
  wireInput('#trSignAuthor', 'author');
  wireInput('#trSignPhone', 'phone');

  const clearBtn = $('#trClearSign');
  if (clearBtn) {
    clearBtn.onclick = () => {
      sheetCfg.author = '';
      sheetCfg.phone = '';
      saveSheetCfg();
      syncSignCardInputs();
      renderPaper();
      toast('已清空个人姓名与电话（仅保留律所落款）');
    };
  }
  const jumpBtn = $('#trJumpSign');
  if (jumpBtn) {
    jumpBtn.onclick = () => {
      const signEl = $('#trPaperSign');
      if (!signEl) return;
      signEl.classList.remove('tr-pulse');
      void signEl.offsetWidth;
      signEl.classList.add('tr-pulse');
      setTimeout(() => signEl.classList.remove('tr-pulse'), 1800);
      if (IS_EMBED) {
        const rect = signEl.getBoundingClientRect();
        postToParent({ type: 'tr-fee-scroll-to', height: Math.max(0, Math.round(rect.top + window.scrollY)) });
      } else {
        signEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
  }
}
bindSignCardEvents();

function buildSheetArchivePayload() {
  if (!last) return null;
  if (state.sheetMode === 'quote') {
    const txt = buildWechatQuoteText();
    const firstAmt = last.kind === 'prop' ? \`标的 \${fmt(last.a)}元\` : last.kind === 'batch' ? \`批量\${last.batch.count}件\` : (last.kind === 'hr' ? \`计时\${fmt(last.hours)}小时\` : '计件报价');
    const summary = \`\${last.s.p === '本所' ? '自定义标准' : last.s.p} · \${firstAmt} · \${qMeta.caseName || '客户报价单'}\`;
    return { summary, detailText: txt, sourceTitle: '律师费客户报价单' };
  }
  const paperText = ($('#paper') && $('#paper').innerText ? $('#paper').innerText : '').trim();
  const summary = \`\${last.s.p === '本所' ? '自定义标准' : last.s.p} · 律师费测算单\${qMeta.caseName ? ' · ' + qMeta.caseName : ''}\`;
  return { summary, detailText: paperText, sourceTitle: '律师服务费测算单' };
}

if ($('#trSaveSheetHistory')) {
  $('#trSaveSheetHistory').onclick = () => {
    const p = buildSheetArchivePayload();
    if (!p) return;
    postToParent({ type: 'tr-fee-save-history', summary: p.summary, detailText: p.detailText });
  };
}
if ($('#trSendSheetAi')) {
  $('#trSendSheetAi').onclick = () => {
    const p = buildSheetArchivePayload();
    if (!p) return;
    const promptContext = state.sheetMode === 'quote'
      ? \`请基于以下律师服务费报价方案，帮我起草一段温和专业、条理清晰、打消客户顾虑并促成委托的微信沟通说明（不要出现“包赢”等违规承诺）：\\n\\n\${p.detailText}\`
      : \`请将以下律师服务费合理开支测算单核心依据提炼为可直接写入起诉状/代理词的规范法言法语说明：\\n\\n\${p.detailText}\`;
    postToParent({ type: 'tr-fee-send-ai', sourceTitle: p.sourceTitle, promptContext });
  };
}

function show(v) {
  if (v === 'tools') v = 'calc';
  document.body.classList.toggle('sheet-mode', v === 'sheet');
  document.querySelectorAll('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  document.querySelectorAll('nav.tabs button, #trTopTabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'cmp') { $('#amt2').value = state.amt; renderCmp(); }
  postToParent({ type: 'tr-fee-view', view: v, sheetMode: state.sheetMode });
  postToParent({ type: 'tr-fee-scroll-top' });
  window.scrollTo(0, 0);
  requestAnimationFrame(reportHeight);
}
document.querySelector('nav.tabs').onclick = (e) => { const v = e.target.dataset.v; if (v) show(v); };
if ($('#trTopTabs')) {
  $('#trTopTabs').onclick = (e) => { const btn = e.target.closest('button[data-v]'); if (btn) show(btn.dataset.v); };
}

function applyParentInit(data) {
  if (!data || typeof data !== 'object') return;
  if (data.amountYuan != null && Number(data.amountYuan) > 0) {
    const yuan = Number(data.amountYuan);
    if (state.type !== 'prop' && state.type !== 'risk') state.type = 'prop';
    if (yuan >= 1e4 && yuan % 100 === 0) {
      state.unit = 1e4;
      state.amt = String(Number((yuan / 1e4).toFixed(4)));
    } else {
      state.unit = 1;
      state.amt = String(yuan);
    }
    show('calc');
    renderAll();
  }
  requestAnimationFrame(reportHeight);
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'tr-fee-init') applyParentInit(msg);
  else if (msg.type === 'tr-fee-print') window.print();
  else if (msg.type === 'tr-fee-switch-view' && msg.view) show(msg.view);
});

renderAll();

// Support direct query params (e.g. standalone tab opened from Toolbox)
(() => {
  const qs = new URLSearchParams(location.search);
  const amt = qs.get('amountYuan');
  if (amt) applyParentInit({ amountYuan: Number(amt) });
  const initView = qs.get('view');
  if (initView === 'cmp' || initView === 'info') show(initView);
  else if (initView === 'sheet' && last) openSheet(qs.get('sheetMode') === 'calc' ? 'calc' : 'quote');
})();

if (IS_EMBED) {
  const wrap = document.querySelector('.wrap');
  if (typeof ResizeObserver !== 'undefined' && wrap) {
    new ResizeObserver(() => requestAnimationFrame(reportHeight)).observe(wrap);
  }
  if (typeof MutationObserver !== 'undefined' && wrap) {
    new MutationObserver(() => requestAnimationFrame(reportHeight)).observe(wrap, { childList: true, subtree: true, attributes: true });
  }
  window.addEventListener('resize', () => requestAnimationFrame(reportHeight));
  postToParent({ type: 'tr-fee-ready' });
  setTimeout(reportHeight, 80);
  setTimeout(reportHeight, 320);
}`;

html = html.replace(renderAllEndMarker, bridgeScript);

// 8. Also add quick "存入记录" button in #out for prop & batch results when embedded
const propBtnsMarker = `<div class="btns"><button class="btn primary" id="mkQuote">一键生成客户报价单</button><button class="btn" id="mkSheet">生成测算单（合理开支）</button><button class="btn" id="copy">复制引用语</button><button class="btn" id="copyNum">复制区间</button></div></div>\`;`;
if (html.includes(propBtnsMarker)) {
  html = html.replace(
    propBtnsMarker,
    `<div class="btns"><button class="btn primary" id="mkQuote">一键生成客户报价单</button><button class="btn" id="mkSheet">生成测算单（合理开支）</button><button class="btn" id="copy">复制引用语</button><button class="btn" id="copyNum">复制区间</button><button class="btn tr-navy tr-bridge-only" id="trSaveCalcOut">存入本机记录</button></div></div>\`;`
  );
  html = html.replace(
    `$('#mkQuote').onclick = () => { if (confirmScope()) openSheet('quote'); }; $('#mkSheet').onclick = () => openSheet('calc');`,
    `$('#mkQuote').onclick = () => { if (confirmScope()) openSheet('quote'); }; $('#mkSheet').onclick = () => openSheet('calc');
    if ($('#trSaveCalcOut')) $('#trSaveCalcOut').onclick = () => postToParent({ type: 'tr-fee-save-history', summary: \`\${s.p === '本所' ? '自定义标准' : s.p} · 标的 \${fmt(a)}元 · 区间 \${rng(r.lo, r.hi)}元\`, detailText: citeText(s, a, r) });`
  );
}

const batchBtnsMarker = `<div class="btns"><button class="btn primary" id="mkQuote">一键生成批量维权报价单</button><button class="btn" id="copyBatch">复制测算摘要</button></div></div>\`;`;
if (html.includes(batchBtnsMarker)) {
  html = html.replace(
    batchBtnsMarker,
    `<div class="btns"><button class="btn primary" id="mkQuote">一键生成批量维权报价单</button><button class="btn" id="copyBatch">复制测算摘要</button><button class="btn tr-navy tr-bridge-only" id="trSaveBatchOut">存入本机记录</button></div></div>\`;`
  );
  html = html.replace(
    `$('#mkQuote').onclick = () => openSheet('quote');`,
    `$('#mkQuote').onclick = () => openSheet('quote');
    if ($('#trSaveBatchOut')) $('#trSaveBatchOut').onclick = () => postToParent({ type: 'tr-fee-save-history', summary: \`批量维权 \${b.count}件 · 律师费 \${fmt(b.feeTotal)}元\`, detailText: \`批量维权测算（共 \${b.count} 件）：前期基础费 \${fmt(b.baseTotal)} 元（均 \${fmt(b.unitBase)} 元/件），回款提成 \${b.rate}% 计 \${fmt(b.commTotal)} 元，律师费合计 \${fmt(b.feeTotal)} 元，委托人预计净回款 \${fmt(b.clientNet)} 元。\` });`
  );
}

// 9. Update document title & standalone header subtitle cleanly
html = html.replace(
  '<title>诉讼与律师费工作台 · 31 省标准 · 报价单 · 诉讼工具箱</title>',
  '<title>中国律师费标准与客户报价工作台 · 全国31省标准 · A4多方案报价单</title>'
);
html = html.replace(
  '<p>31 省收费标准 · 多方案客户报价单 · 诉讼/执行/期限/利息工具箱</p>',
  '<p>全国 31 省核验标准 · 自定义本所标准 · 多方案 A4 客户报价单</p>'
);

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, html, 'utf8');
console.log(`[prepare-lawyer-fee-workbench] Generated ${path.relative(ROOT, OUT_PATH)} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`);
