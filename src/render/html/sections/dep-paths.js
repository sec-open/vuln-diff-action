// src/render/html/sections/dep-paths.js
// Renders dependency path tables for Base and Head using the Phase-2 view.
// No JSON reads here; paths come from view.items[].paths (array of arrays).

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
  // chain is an array like [rootPurl, 'module:artifact:ver', 'group:artifact:ver', ...]
  // We display with arrows, wrapping each element in <code>
  if (!Array.isArray(chain) || !chain.length) return '<code>n/a</code>';
  return chain.map((seg) => `<code>${String(seg)}</code>`).join(' &rarr; ');
}

function tableFor(items, title) {
  const rows = items.map((v) => {
    const id = v.id || v.ids?.ghsa || v.ids?.cve || 'UNKNOWN';
    const pkg = asGav(v);
    const paths = Array.isArray(v.paths) && v.paths.length
      ? `<ul>${v.paths.map((p) => `<li>${formatPath(p)}</li>`).join('')}</ul>`
      : '<span class="small">No paths available</span>';
    const sev = String(v.severity || 'UNKNOWN').toUpperCase();
    return `<tr>
      <td>${sev}</td>
      <td>${hyperlinkId(id)}</td>
      <td><code>${pkg}</code></td>
      <td>${paths}</td>
    </tr>`;
  }).join('');

  return `
<div class="card">
  <h2 id="section-title">${title}</h2>
  <table>
    <thead>
      <tr>
        <th>Severity</th>
        <th>Vulnerability</th>
        <th>Package</th>
        <th>Dependency Path(s)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

/**
 * Base view: show vulnerabilities present in BASE (REMOVED or UNCHANGED).
 */
function renderDepPathsBase({ view } = {}) {
  if (!view) throw new Error('[render/html/dep-paths] Missing view');
  const items = (view.items || []).filter((v) => {
    const s = String(v.state || '').toUpperCase();
    return s === 'REMOVED' || s === 'UNCHANGED';
  });
  return tableFor(items, 'Dependency Paths — Base');
}

/**
 * Head view: show vulnerabilities present in HEAD (NEW or UNCHANGED).
 */
function renderDepPathsHead({ view } = {}) {
  if (!view) throw new Error('[render/html/dep-paths] Missing view');
  const items = (view.items || []).filter((v) => {
    const s = String(v.state || '').toUpperCase();
    return s === 'NEW' || s === 'UNCHANGED';
  });
  return tableFor(items, 'Dependency Paths — Head');
}

module.exports = { renderDepPathsBase, renderDepPathsHead };
