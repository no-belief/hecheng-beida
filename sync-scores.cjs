/* 排行榜同步: ntfy.sh -> scores.json
   GitHub Actions 每 5 分钟运行。用 curl 硬超时读 ntfy(SSE 流),与现有 scores.json 合并去重。
   任何失败都保留现有数据并正常退出,不阻断部署。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NTFY = 'https://ntfy.sh/hcbd-lb-r6xmd0cpmlgt/json?poll=0&since=all';

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
  let ntfyFailed = false;
  try {
    /* curl --max-time 15 硬超时,保证不会挂住 */
    const raw = execSync(`curl -sS --max-time 15 -H "User-Agent: hcbd-sync" "${NTFY}" || true`, { encoding: 'utf8', timeout: 20000 });
    if (raw && raw.includes('"event"')) {
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t || t[0] !== '{') continue;
        try {
          const ev = JSON.parse(t);
          if (ev && ev.event === 'message' && ev.message) {
            const s = JSON.parse(ev.message);
            if (s && s.name && (s.score | 0) > 0) {
              const entry = {
                name: String(s.name).slice(0, 12),
                score: s.score | 0,
                dev: String(s.dev || 'unknown').slice(0, 40),
                ts: s.ts || (ev.time ? ev.time * 1000 : Date.now())
              };
              const key = entry.dev + '|' + entry.ts + '|' + entry.score;
              if (!seen[key]) { seen[key] = 1; merged.push(entry); ntfyCount++; }
            }
          }
        } catch (e) { /* 跳过非消息行 */ }
      }
    } else {
      ntfyFailed = true;
    }
  } catch (e) {
    ntfyFailed = true;
    console.log('[sync] ntfy 读取失败(保留现有数据):', e.message);
  }
  if (ntfyFailed && merged.length === 0) {
    /* 读不到 ntfy 且本地无数据:保留原文件不动 */
    console.log('[sync] 无数据可写,跳过');
    return;
  }

  merged.sort((a, b) => (b.score - a.score) || ((a.ts || 0) - (b.ts || 0)));
  const out = { syncedAt: Date.now(), total: merged.length, scores: merged.slice(0, 200) };
  fs.writeFileSync(file, JSON.stringify(out), 'utf8');
  console.log('[sync] 总成绩', merged.length, '| ntfy 新增:', ntfyCount);
}

sync().then(() => process.exit(0)).catch(e => { console.error('[sync] fatal:', e.message); process.exit(0); });
