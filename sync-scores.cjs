/* 排行榜同步: restful-api.dev -> scores.json
   由 GitHub Actions 每 5 分钟运行,作为实时源的兜底镜像 */
'use strict';
const fs = require('fs');

const API = 'https://api.restful-api.dev/objects/ff808181a09d98f701a173c1fdc90911';

async function sync() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(API, { signal: ctrl.signal, cache: 'no-store' });
    const d = await r.json();
    clearTimeout(timer);
    if (!d || !d.data || !Array.isArray(d.data.scores)) throw new Error('bad data');
    const scores = d.data.scores
      .filter(s => s && s.name && (s.score | 0) > 0)
      .sort((a, b) => (b.score - a.score) || (a.ts - b.ts))
      .slice(0, 200);
    const out = { syncedAt: Date.now(), total: scores.length, scores };
    fs.writeFileSync('scores.json', JSON.stringify(out), 'utf8');
    console.log('[sync] ok,', scores.length, 'scores');
  } catch (e) {
    clearTimeout(timer);
    console.error('[sync] fail:', e.code || e.message);
    process.exit(1);
  }
}
sync();
