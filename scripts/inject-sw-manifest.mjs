import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const SW_PATH = path.join(DIST, 'sw.js');

if (!fs.existsSync(DIST) || !fs.existsSync(SW_PATH)) {
  process.exit(0);
}

const rawBase = (process.env.VITE_BASE_PATH || '/').trim() || '/';
const basePrefix = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, rel));
    } else if (entry.name !== 'sw.js' && !entry.name.endsWith('.map')) {
      out.push(`${basePrefix}${rel}`);
    }
  }
  return out;
}

const assets = [basePrefix, ...walk(DIST)];
const hash = crypto
  .createHash('sha256')
  .update(assets.join('|') + Date.now())
  .digest('hex')
  .slice(0, 10);

let sw = fs.readFileSync(SW_PATH, 'utf8');
sw = sw
  .replace('__CN_LAWYER_CACHE_VERSION__', `cn-lawyer-ai-toolbox-v1-${hash}`)
  .replace('/*__CN_LAWYER_PRECACHE_LIST__*/', assets.map((a) => JSON.stringify(a)).join(',\n  '));

fs.writeFileSync(SW_PATH, sw);
console.log(`[inject-sw-manifest] Injected ${assets.length} offline precache assets into dist/sw.js (version ${hash})`);
