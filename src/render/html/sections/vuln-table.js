// src/render/html/sections/vuln-table.js
// Renders sections/vuln-table.html using the Phase-2 view (strict). No JSON reads here.
// Adds client-side filter + sort (tables.js).

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
      <td data-key="severity" data-num="${SEV_ORDER[sev] ?? 999}">${sev}</td>
      <td data-key="id">${hyperlinkId(id)}</td>
      <td data-key="package"><code>${pkg}</code></td>
      <td data-key="branch">${branch}</td>
      <td data-key="state">${state}</td>
    </tr>`;
  }).join('');

  return `
<div class="card">
  <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
    <h2 id="section-title" style="margin:0">Vulnerability Diff Table</h2>
    <input type="search" class="tbl-filter" data-target="#vuln-table" placeholder="Filter…" />
  </div>
  <div class="tbl-wrap" style="overflow:auto; margin-top:8px;">
    <table id="vuln-table" class="tbl sortable filterable">
      <thead>
        <tr>
          <th data-sort="severity">Severity</th>
          <th data-sort="id">Vulnerability</th>
          <th data-sort="package">Package</th>
          <th data-sort="branch">Branch</th>
          <th data-sort="state">State</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

module.exports = { renderVulnTable };
