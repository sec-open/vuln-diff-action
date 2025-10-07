// src/render/html/sections/header.js
const fs = require('fs');
const path = require('path');

function readDiffStrict(distDir) {
  const file = path.join(distDir, 'diff.json');
  if (!fs.existsSync(file)) throw new Error(`[html/header] Missing file: ${file}`);
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const req = ['repo', 'base.ref', 'base.sha_short', 'head.ref', 'head.sha_short', 'generated_at'];
  for (const p of req) {
    const ok = p.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), d);
    if (ok === undefined) throw new Error(`[html/header] diff.json missing path: ${p}`);
  }
  return d;
}

function renderHeader(distDir, logoUrl) {
  const diff = readDiffStrict(distDir);
  const repo = diff.repo;
  const base = `${diff.base.ref} <span class="small">→ ${diff.base.sha_short}</span>`;
  const head = `${diff.head.ref} <span class="small">→ ${diff.head.sha_short}</span>`;
  const stamped = diff.generated_at;

  return `
<div class="grid-2">
  <div style="display:flex;align-items:center;gap:12px;">
    ${logoUrl ? `<img src="${logoUrl}" alt="logo" style="height:22px">` : ''}
    <h1>Vulnerability Diff Report</h1>
    <span class="tag">${repo}</span>
  </div>
  <div style="text-align:right;">
    <div><b>Base:</b> ${base}</div>
    <div><b>Head:</b> ${head}</div>
    <div class="small">Generated at ${stamped}</div>
  </div>
</div>`;
}

module.exports = { renderHeader };
