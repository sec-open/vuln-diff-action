// src/render/html/sections/summary.js
const fs = require('fs');
const path = require('path');

function readDiffStrict(distDir) {
  const file = path.join(distDir, 'diff.json');
  if (!fs.existsSync(file)) throw new Error(`[html/summary] Missing file: ${file}`);
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const req = [
    'generated_at',
    'repo',
    'tools',
    'inputs.base_ref',
    'inputs.head_ref',
    'inputs.path',
    'base.ref', 'base.sha', 'base.sha_short', 'base.author', 'base.authored_at', 'base.commit_subject',
    'head.ref', 'head.sha', 'head.sha_short', 'head.author', 'head.authored_at', 'head.commit_subject',
    'summary.totals.NEW', 'summary.totals.REMOVED', 'summary.totals.UNCHANGED',
    'summary.by_severity_and_state',
  ];
  for (const p of req) {
    const ok = p.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), d);
    if (ok === undefined) throw new Error(`[html/summary] diff.json missing path: ${p}`);
  }
  return d;
}

function krow(k, v) {
  return `<tr><th style="width:220px">${k}</th><td>${v ?? 'n/a'}</td></tr>`;
}

function toolsTable(tools) {
  const rows = Object.entries(tools || {}).map(([n, v]) => krow(n, v)).join('');
  return rows || krow('Tools', 'n/a');
}

function inputsTable(inputs) {
  return [
    krow('base_ref', `<code>${inputs.base_ref}</code>`),
    krow('head_ref', `<code>${inputs.head_ref}</code>`),
    krow('path', `<code>${inputs.path}</code>`),
  ].join('');
}

function branchTable(title, b) {
  return `
<div class="card">
  <h3>${title}</h3>
  <table>
    ${krow('Ref', `<code>${b.ref}</code>`)}
    ${krow('SHA', `<code>${b.sha_short}</code> &nbsp; <code>${b.sha}</code>`)}
    ${krow('Author', b.author || 'n/a')}
    ${krow('Authored at', b.authored_at || 'n/a')}
    ${krow('Commit', b.commit_subject || 'n/a')}
  </table>
</div>`;
}

function totalsBlock(sum) {
  const t = sum.totals;
  return `<div><b>Totals</b> — <b>NEW:</b> ${t.NEW} · <b>REMOVED:</b> ${t.REMOVED} · <b>UNCHANGED:</b> ${t.UNCHANGED}</div>`;
}

function sevStateTable(by) {
  const order = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
  const rows = order.map(s => {
    const v = by[s] || { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
    return `<tr><td>${s}</td><td style="text-align:right">${v.NEW}</td><td style="text-align:right">${v.REMOVED}</td><td style="text-align:right">${v.UNCHANGED}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Severity</th><th style="text-align:right">NEW</th><th style="text-align:right">REMOVED</th><th style="text-align:right">UNCHANGED</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSummary(distDir) {
  const diff = readDiffStrict(distDir);

  const intro = `
<div class="card">
  <h2>Summary</h2>
  <p class="small">Generated at ${diff.generated_at}</p>
  ${totalsBlock(diff.summary)}
</div>`;

  const env = `
<div class="grid-2">
  <div class="card">
    <h3>Tools</h3>
    <table>${toolsTable(diff.tools)}</table>
  </div>
  <div class="card">
    <h3>Inputs</h3>
    <table>${inputsTable(diff.inputs)}</table>
  </div>
</div>`;

  const branches = `
<div class="grid-2">
  ${branchTable('Base', diff.base)}
  ${branchTable('Head', diff.head)}
</div>`;

  const sev = `
<div class="card">
  <h3>Totals by Severity and State</h3>
  ${sevStateTable(diff.summary.by_severity_and_state)}
</div>`;

  return [intro, env, branches, sev].join('\n');
}

module.exports = { renderSummary };
