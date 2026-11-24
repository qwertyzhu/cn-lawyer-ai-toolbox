#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatWeChatInvitationCard,
  signActivationCodeWithMasterToken,
} from '../src/lib/licenseEngine.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KEY_FILE = path.join(ROOT, 'ops', '.keys', 'firm-master-signing-key.json');

if (!fs.existsSync(KEY_FILE)) {
  console.error('未找到签发私钥文件 ops/.keys/firm-master-signing-key.json');
  process.exit(1);
}

const { masterToken } = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));

const args = process.argv.slice(2);
function getArg(flag, fallback = '') {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const singleName = getArg('--name', '');
const role = getArg('--role', '专职律师');
const daysStr = getArg('--days', '0');
const batchList = getArg('--names', ''); // e.g. "张示范:主任,李示例:合伙人"
const baseOrigin = getArg('--origin', 'https://your-domain.com');

let entries = [];
if (batchList) {
  entries = batchList
    .split(/[,，\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [n, r] = pair.split(/[:：]/);
      return { name: n.trim(), role: (r || role).trim() };
    });
} else if (singleName) {
  entries = [{ name: singleName.trim(), role }];
} else {
  console.log(`用法示例:
  1) 单人长期激活码:
     npm run keygen -- --name "张律师" --role "专职律师"
  2) 指定有效天数 (如实习律师 365 天):
     npm run keygen -- --name "李实习" --role "实习律师" --days 365
  3) 多人批量签发:
     npm run keygen -- --names "张示范:主任,李示例:合伙人,王示例:专职律师"`);
  process.exit(0);
}

const days = Number(daysStr) || 0;
let expiresAt = '';
if (days > 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  expiresAt = d.toISOString().slice(0, 10);
}

const year = new Date().getFullYear();
for (let i = 0; i < entries.length; i++) {
  const serialNo = `TR-${year}-${String(i + 1).padStart(3, '0')}`;
  const { info } = await signActivationCodeWithMasterToken(masterToken, {
    holderName: entries[i].name,
    role: entries[i].role,
    serialNo,
    expiresAt,
  });
  console.log('============================================================');
  console.log(formatWeChatInvitationCard(info, baseOrigin));
}
console.log('============================================================');
