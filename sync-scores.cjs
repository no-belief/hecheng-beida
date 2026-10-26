/* 排行榜同步: ntfy.sh -> scores.json
   GitHub Actions 每 5 分钟运行:拉 ntfy 消息,与现有 scores.json 合并去重。
   ntfy 读取失败不影响部署:保留现有数据并正常退出。 */
'use strict';
const fs = require('fs');
const path = require('path');

const NTFY = 'https://ntfy.sh/hcbd-lb-r6xmd0cpmlgt/json?since=all&poll=0';

function fetchAbort(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { cache: 'no-store', signal: ctrl.signal })
    .finally(() => clearTimeout(t));
}

async function sync() {
  const file = path.join(__dirname, 'scores.json');
  let existing = { scores: [] };
  try {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (old && Array.isArray(old.scores)) existing = old;
  } catch (e) { /* 首次运行 */ }

  const seen = {};
  const merged = [];
  for (const s of existing.scores) {
    if (!s || !s.name || (s.score | 0) <= 0) continue;
    const key = s.dev + '|' + s.ts + '|' + s.score;
    if (!seen[key]) { seen[key] = 1; merged.push(s); }
  }

  let ntfyCount = 0;
  try {
    const r = await fetchAbort(NTFY, 15000);
    if (r.ok) {
      const text = await r.text();
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t[0] !== '{') continue;
        try {
          const ev = JSON.parse(t);
          if (ev && ev.event === 'message' && ev.message) {
            const s = JSON.parse(ev.message);
            if (s && s.name && (s.score | 0) > 0) {
              const entry = { name: String(s.name).slice(0, 12), score: s.score | 0, dev: String(s.dev || 'unknown').slice(0, 40), ts: s.ts || (ev.time ? ev.time * 1000 : Date.now()) };
              const key = entry.dev + '|' + entry.ts + '|' + entry.score;
              if (!seen[key]) { seen[key] = 1; merged.push(entry); ntfyCount++; }
            }
          }
        } catch (e) { /* 跳过非消息行 */ }
      }
    }
  } catch (e) {
    console.log('[sync] ntfy 读取失败(保留现有数据):', e.code || e.name || e.message);
  }

  merged.sort((a, b) => (b.score - a.score) || ((a.ts || 0) - (b.ts || 0)));
  const out = { syncedAt: Date.now(), total: merged.length, scores: merged.slice(0, 200) };
  fs.writeFileSync(file, JSON.stringify(out), 'utf8');
  console.log('[sync] 总成绩', merged.length, '| ntfy 新增:', ntfyCount);
}

sync().then(() => process.exit(0)).catch(e => { console.error('[sync] fatal:', e.message); process.exit(0); });
