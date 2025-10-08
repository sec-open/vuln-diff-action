// src/render/html/sections/vuln-table.js
// Renders sections/vuln-table.html using the Phase-2 view (strict). No JSON reads here.

const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };

function hyperlinkId(id) {
  if (!id) return 'UNKNOWN';
  const up = String(id).toUpperCase();
  if (up.startsWith('CVE-')) return `<a href="https://nvd.nist.gov/vuln/detail/${up}" target="_blank" rel="noopener">${id}</a>`;
  if (up.startsWith('GHSA-')) return `<a href="https://github.com/advisories/${up}" target="_blank" rel="noopener">${id}</a>`;
  return id;
}
function asGav(v) {
  const pkg = v?.package || {};
  const g = pkg.groupId ?? 'unknown';
  const a = pkg.artifactId ?? 'unknown';
  const ver = pkg.version ?? 'unknown';
  return `${g}:${a}:${ver}`;
}
function branchFromState(state) {
  const s = String(state || '').toUpperCase();
  if (s === 'NEW') return 'Head';
  if (s === 'REMOVED') return 'Base';
  if (s === 'UNCHANGED') return 'Base & Head';
  return 'UNKNOWN';
}

function renderVulnTable({ view } = {}) {
  if (!view) throw new Error('[render/html/vuln-table] Missing view');

  const items = (view.items || []).slice().sort((a, b) => {
    const sa = SEV_ORDER[String(a.severity || 'UNKNOWN').toUpperCase()] ?? 9;
    const sb = SEV_ORDER[String(b.severity || 'UNKNOWN').toUpperCase()] ?? 9;
    return sa - sb;
  });

  const rows = items.map((v) => {
    const sev = String(v.severity || 'UNKNOWN').toUpperCase();
    const id = v.id || v.ids?.ghsa || v.ids?.cve || 'UNKNOWN';
    const pkg = asGav(v);
    const state = String(v.state || 'UNKNOWN').toUpperCase();
    const branch = branchFromState(state);
    return `<tr>
      <td>${sev}</td>
      <td>${hyperlinkId(id)}</td>
      <td><code>${pkg}</code></td>
      <td>${branch}</td>
      <td>${state}</td>
    </tr>`;
  }).join('');

  return `
<div class="card">
  <h2 id="section-title">Vulnerability Diff Table</h2>
  <table>
    <thead>
      <tr>
        <th>Severity</th>
        <th>Vulnerability</th>
        <th>Package</th>
        <th>Branch</th>
        <th>State</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

module.exports = { renderVulnTable };
