// src/render/pdf/sections/summary.js
function summaryHtml(view) {
  const repo = view?.repo || '';
  const baseRef = view?.inputs?.baseRef || view?.base?.ref || '';
  const headRef = view?.inputs?.headRef || view?.head?.ref || '';
  const baseShaShort = view?.base?.shaShort || '';
  const headShaShort = view?.head?.shaShort || '';

  const totals = view?.summary?.totals || { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
  const bySev = view?.summary?.bySeverityAndState || {};

  const sevOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  const rows = sevOrder.map(sev => {
    const row = bySev[sev] || {};
    const n = Number(row.NEW || 0);
    const r = Number(row.REMOVED || 0);
    const u = Number(row.UNCHANGED || 0);
    return `<tr><td>${sev}</td><td>${n}</td><td>${r}</td><td>${u}</td></tr>`;
  }).join('');

  return `
## 2. Summary

Project
${repo}

Branches compared
- Head: \`${headRef}\` (\`${headShaShort}\`)
- Base: \`${baseRef}\` (\`${baseShaShort}\`)

Overview (by state)
<table class="compact">
  <thead><tr><th></th><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>
  <tbody>
    <tr><td><strong>Totals</strong></td><td><strong>${totals.NEW || 0}</strong></td><td><strong>${totals.REMOVED || 0}</strong></td><td><strong>${totals.UNCHANGED || 0}</strong></td></tr>
  </tbody>
</table>

Breakdown by severity × state
<table class="compact">
  <thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>
  <tbody>
    ${rows}
  </tbody>
</table>
`.trim();
}

module.exports = { summaryHtml };
