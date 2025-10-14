// src/render/html/sections/dep-paths.js
// Renders dependency path tables for Base and Head using the Phase-2 view.
// No JSON reads here; paths come from view.items[].paths (array of arrays).
// Adds client-side filter + sort (tables.js).

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
function formatPath(chain) {
  if (!Array.isArray(chain) || !chain.length) return '<code>n/a</code>';
  return chain.map((seg) => `<code>${String(seg)}</code>`).join(' &rarr; ');
}

function rowsFor(items) {
  return items.map((v) => {
    const id = v.id || v.ids?.ghsa || v.ids?.cve || 'UNKNOWN';
    const pkg = asGav(v);
    const sev = String(v.severity || 'UNKNOWN').toUpperCase();
    const paths = Array.isArray(v.paths) ? v.paths : [];
    const count = paths.length;
    const pathsHtml = count
      ? `<ul>${paths.map((p) => `<li>${formatPath(p)}</li>`).join('')}</ul>`
      : '<span class="small">No paths available</span>';
    return `<tr>
      <td data-key="severity">${sev}</td>
      <td data-key="id">${hyperlinkId(id)}</td>
      <td data-key="package"><code>${pkg}</code></td>
      <td data-key="paths" data-num="${count}">${count}</td>
      <td>${pathsHtml}</td>
    </tr>`;
  }).join('');
}

function renderTable(title, id, items) {
  return `
<div class="card">
  <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
    <h2 id="section-title" style="margin:0">${title}</h2>
    <input type="search" class="tbl-filter" data-target="#${id}" placeholder="Filter…" />
  </div>
  <div class="tbl-wrap" style="overflow:auto; margin-top:8px;">
    <table id="${id}" class="tbl sortable filterable">
      <thead>
        <tr>
          <th data-sort="severity">Severity</th>
          <th data-sort="id">Vulnerability</th>
          <th data-sort="package">Package</th>
          <th data-sort="paths">#Paths</th>
          <th>Dependency Path(s)</th>
        </tr>
      </thead>
      <tbody>${rowsFor(items)}</tbody>
    </table>
  </div>
</div>`;
}

/** Base: show vulnerabilities present in BASE (REMOVED or UNCHANGED). */
function renderDepPathsBase({ view } = {}) {
  if (!view) throw new Error('[render/html/dep-paths] Missing view');
  const items = (view.items || []).filter((v) => {
    const s = String(v.state || '').toUpperCase();
    return s === 'REMOVED' || s === 'UNCHANGED';
  });
  return renderTable('Dependency Paths — Base', 'dep-paths-base-tbl', items);
}

/** Head: show vulnerabilities present in HEAD (NEW or UNCHANGED). */
function renderDepPathsHead({ view } = {}) {
  if (!view) throw new Error('[render/html/dep-paths] Missing view');
  const items = (view.items || []).filter((v) => {
    const s = String(v.state || '').toUpperCase();
    return s === 'NEW' || s === 'UNCHANGED';
  });
  return renderTable('Dependency Paths — Head', 'dep-paths-head-tbl', items);
}

module.exports = { renderDepPathsBase, renderDepPathsHead };
