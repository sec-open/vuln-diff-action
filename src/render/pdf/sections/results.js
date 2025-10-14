// src/render/pdf/sections/results.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SEV_ORDER = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 1 };
const STATE_ORDER = { NEW: 3, REMOVED: 2, UNCHANGED: 1 };

function safeGAV(pkg = {}) {
  const g = pkg.groupId || '';
  const a = pkg.artifactId || pkg.name || '';
  const v = pkg.version ? `:${pkg.version}` : '';
  return g ? `${g}:${a}${v}` : `${a}${v}`;
}

function linkCell(item) {
  const id = item?.id || item?.vulnId || '';
  const url = item?.url || '';
  return url ? `<a href="${url}">${id}</a>` : id;
}

function tableHtml(title, rows) {
  const head = `
    <thead>
      <tr>
        <th>Severity</th>
        <th>Vulnerability</th>
        <th>Package</th>
        <th>State</th>
      </tr>
    </thead>`;
  const body = rows.map(r => `
      <tr>
        <td>${r.severity}</td>
        <td>${linkCell(r)}</td>
        <td>${safeGAV(r.package || {})}</td>
        <td>${r.state}</td>
      </tr>`).join('');
  return `
    <h3 class="subsection-title">${title}</h3>
    <table>${head}<tbody>${body || '<tr><td colspan="4">No vulnerabilities to display</td></tr>'}</tbody></table>
  `.trim();
}

async function loadDiff(distDir) {
  try {
    const p = path.join(distDir, 'diff.json');
    const raw = await fsp.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

function sortItems(items = []) {
  return [...items].sort((a, b) => {
    const sa = SEV_ORDER[a.severity] || 0;
    const sb = SEV_ORDER[b.severity] || 0;
    if (sa !== sb) return sb - sa; // desc severity
    const ca = STATE_ORDER[a.state] || 0;
    const cb = STATE_ORDER[b.state] || 0;
    if (ca !== cb) return cb - ca; // NEW > REMOVED > UNCHANGED
    const pa = safeGAV(a.package || {}).toLowerCase();
    const pb = safeGAV(b.package || {}).toLowerCase();
    return pa.localeCompare(pb);
  });
}

async function buildResultsTablesHtml(distDir) {
  const diff = await loadDiff(distDir);
  const all = sortItems(diff?.items || []);

  const diffRows = all; // 3.1: todos (diff)
  const baseRows = all.filter(x => x.state === 'UNCHANGED' || x.state === 'REMOVED'); // 3.2
  const headRows = all.filter(x => x.state === 'UNCHANGED' || x.state === 'NEW');     // 3.3

  const sec31 = `
<section class="page">
  <h2 class="section-title">3.1 Vulnerability Diff Table</h2>
  ${tableHtml('Vulnerability Diff Table', diffRows)}
</section>`.trim();

  const sec32 = `
<section class="page page-break-before">
  <h2 class="section-title">3.2 Vulnerability Base Table</h2>
  ${tableHtml('Vulnerability Base Table', baseRows)}
</section>`.trim();

  const sec33 = `
<section class="page page-break-before">
  <h2 class="section-title">3.3 Vulnerability Head Table</h2>
  ${tableHtml('Vulnerability Head Table', headRows)}
</section>`.trim();

  return [sec31, sec32, sec33].join('\n');
}

module.exports = { buildResultsTablesHtml };
