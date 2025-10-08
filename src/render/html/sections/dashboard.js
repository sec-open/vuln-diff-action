// src/render/html/sections/dashboard.js
// Dashboard section — charts + three filterable/sortable tables.
// No JSON reads; receives a strict "view" from the HTML orchestrator.

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

function rowsFor(items) {
  return items.map((v) => {
    const id = v.id || v.ids?.ghsa || v.ids?.cve || 'UNKNOWN';
    const pkg = asGav(v);
    const sev = String(v.severity || 'UNKNOWN').toUpperCase();
    const state = String(v.state || 'UNKNOWN').toUpperCase();
    return `<tr>
      <td data-key="severity">${sev}</td>
      <td data-key="id">${hyperlinkId(id)}</td>
      <td data-key="package"><code>${pkg}</code></td>
      <td data-key="state">${state}</td>
    </tr>`;
  }).join('');
}

function renderTable(title, id, items) {
  return `
<div class="card">
  <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
    <h3 style="margin:0">${title}</h3>
    <input type="search" class="tbl-filter" data-target="#${id}" placeholder="Filter…" />
  </div>
  <div class="tbl-wrap" style="overflow:auto; margin-top:8px;">
    <table id="${id}" class="tbl sortable filterable">
      <thead>
        <tr>
          <th data-sort="severity">Severity</th>
          <th data-sort="id">Vulnerability</th>
          <th data-sort="package">Package</th>
          <th data-sort="state">State</th>
        </tr>
      </thead>
      <tbody>
        ${rowsFor(items)}
      </tbody>
    </table>
  </div>
</div>`;
}

// ... helpers intactos ...

function renderDashboard({ view } = {}) {
  if (!view) throw new Error('[render/html/dashboard] Missing view');

  const items = Array.isArray(view.items) ? view.items : [];
  const newItems = items.filter(i => String(i.state).toUpperCase() === 'NEW');
  const removedItems = items.filter(i => String(i.state).toUpperCase() === 'REMOVED');
  const unchangedItems = items.filter(i => String(i.state).toUpperCase() === 'UNCHANGED');

  return `
<div class="card">
  <h2 id="section-title">Dashboard</h2>
  <p class="small">High-level visual summary of the diff (no extra calculations; all data comes from Phase 2).</p>
</div>

<!-- 3 charts in a single row -->
<div class="grid-3">
  <div class="card chart-card">
    <h3>Distribution by State</h3>
    <div class="chart-wrap"><canvas id="chart-state-pie" aria-label="State distribution pie"></canvas></div>
  </div>
  <div class="card chart-card">
    <h3>NEW vs REMOVED by Severity</h3>
    <div class="chart-wrap"><canvas id="chart-new-removed" aria-label="NEW vs REMOVED bar"></canvas></div>
  </div>
  <div class="card chart-card">
    <h3>By Severity &amp; State (stacked)</h3>
    <div class="chart-wrap"><canvas id="chart-severity-stacked" aria-label="Severity stacked bar"></canvas></div>
  </div>
</div>

<!-- Tables with filter + sort -->
<div class="grid-2" style="margin-top:12px;">
  ${renderTable('NEW Vulnerabilities', 'tbl-new', newItems)}
  ${renderTable('REMOVED Vulnerabilities', 'tbl-removed', removedItems)}
</div>
<div style="margin-top:12px;">
  ${renderTable('UNCHANGED Vulnerabilities', 'tbl-unchanged', unchangedItems)}
</div>`;
}

module.exports = { renderDashboard };

