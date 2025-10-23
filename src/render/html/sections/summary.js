// Summary section renderer: shows generation timestamp, tool/input metadata, branch details,
// and severity/state totals derived from the unified view.

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

/**
 * Builds a table row (th + td) for a key/value pair.
 * @param {string} k
 * @param {string} v
 * @returns {string}
 */
function krow(k, v) {
  return `<tr><th style="width:220px">${k}</th><td>${v ?? 'n/a'}</td></tr>`;
}

/**
 * Generates table rows for tools metadata.
 * @param {Object} tools
 * @returns {string}
 */
function toolsTable(tools) {
  const rows = Object.entries(tools || {}).map(([n, v]) => krow(n, v)).join('');
  return rows || krow('Tools', 'n/a');
}

/**
 * Generates table rows for input parameters.
 * @param {Object} inputs
 * @returns {string}
 */
function inputsTable(inputs) {
  return [
    krow('base_ref', `<code>${inputs.baseRef}</code>`),
    krow('head_ref', `<code>${inputs.headRef}</code>`),
    krow('path', `<code>${inputs.path}</code>`),
  ].join('');
}

/**
 * Renders a card with branch commit metadata.
 * @param {string} title
 * @param {Object} b
 * @returns {string}
 */
function branchTable(title, b) {
  return `
<div class="card">
  <h3>${title}</h3>
  <table>
    ${krow('Ref', `<code>${b.ref}</code>`)}
    ${krow('SHA', `<code>${b.shaShort}</code> &nbsp; <code>${b.sha}</code>`)}
    ${krow('Author', b.author || 'n/a')}
    ${krow('Authored at', b.authoredAt || 'n/a')}
    ${krow('Commit', b.commitSubject || 'n/a')}
  </table>
</div>`;
}

/**
 * Displays aggregated totals (NEW / REMOVED / UNCHANGED).
 * @param {Object} sum
 * @returns {string}
 */
function totalsBlock(sum) {
  const t = sum.totals;
  return `<div><b>Totals</b> — <b>NEW:</b> ${t.NEW} · <b>REMOVED:</b> ${t.REMOVED} · <b>UNCHANGED:</b> ${t.UNCHANGED}</div>`;
}

/**
 * Builds severity/state breakdown table.
 * @param {Object} by
 * @returns {string}
 */
function sevStateTable(by) {
  const rows = SEVERITY_ORDER.map(s => {
    const v = by[s] || { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
    return `<tr><td>${s}</td><td style="text-align:right">${v.NEW}</td><td style="text-align:right">${v.REMOVED}</td><td style="text-align:right">${v.UNCHANGED}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Severity</th><th style="text-align:right">NEW</th><th style="text-align:right">REMOVED</th><th style="text-align:right">UNCHANGED</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Generates table rows for dependency changes.
 * @param {Object} dep
 * @returns {string}
 */
function dependencyDiffTable(dep) {
  if (!dep || !Array.isArray(dep.items) || dep.items.length === 0) {
    return '<p>No dependency changes detected.</p>';
  }
  const head = '<table><thead><tr><th>State</th><th>Group</th><th>Artifact</th><th>Base Versions</th><th>Head Versions</th><th>#NEW vulns</th><th>#REMOVED vulns</th><th>NEW IDs</th><th>REMOVED IDs</th></tr></thead><tbody>';
  const rows = dep.items.map(it => {
    const newIds = (it.new_vulns||[]).map(v=>v.id).join(', ');
    const removedIds = (it.removed_vulns||[]).map(v=>v.id).join(', ');
    return `<tr>
      <td>${it.state}</td>
      <td>${it.groupId}</td>
      <td>${it.artifactId}</td>
      <td>${(it.baseVersions||[]).join(', ')}</td>
      <td>${(it.headVersions||[]).join(', ')}</td>
      <td style="text-align:right">${it.new_vulns_count||0}</td>
      <td style="text-align:right">${it.removed_vulns_count||0}</td>
      <td>${newIds || '—'}</td>
      <td>${removedIds || '—'}</td>
    </tr>`;}).join('');
  return head + rows + '</tbody></table>';
}

/**
 * Formats the heading for each direct dependency change subsection.
 * @param {number} idx - The index of the change in the list.
 * @param {Object} change - The change object containing details of the dependency change.
 * @returns {string} - Formatted heading string.
 */
function formatDirectDepHeading(idx, change) {
  const base = change.baseVersions || []; const head = change.headVersions || [];
  const ga = `${change.groupId}:${change.artifactId}`;
  if (change.change_type === 'UPDATED') {
    return `2.3.${idx} ${ga} updated (${base.join(', ') || '—'} -> ${head.join(', ') || '—'})`;
  } else if (change.change_type === 'ADDED') {
    return `2.3.${idx} ${ga} added (${head.join(', ') || '—'})`;
  } else if (change.change_type === 'REMOVED') {
    return `2.3.${idx} ${ga} removed (${base.join(', ') || '—'})`;
  }
  return `2.3.${idx} ${ga}`;
}

/**
 * Renders a vulnerability table for a given set of vulnerabilities.
 * @param {string} title - The title for the vulnerability table.
 * @param {Array} vulns - The list of vulnerabilities to display.
 * @returns {string} - HTML string for the vulnerability table.
 */
function renderVulnTable(title, vulns) {
  if (!vulns || !vulns.length) return '';
  const rows = vulns.map(v => `<tr><td>${v.id}</td><td>${v.version}</td><td>${String(v.severity||'UNKNOWN').toUpperCase()}</td><td>${v.state}</td></tr>`).join('');
  return `<div class="vuln-block"><h5>${title} (${vulns.length})</h5><table><thead><tr><th>ID</th><th>Version</th><th>Severity</th><th>State</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/**
 * Renders the direct dependency changes section.
 * @param {Object} view - The view object containing directDependencyChanges data.
 * @returns {string} - HTML string for the direct dependency changes section.
 */
function renderDirectDependencyChangesSection(view) {
  const dc = view.directDependencyChanges || { changes:[] };
  const changes = Array.isArray(dc.changes) ? dc.changes : [];
  const header = `<h3>Dependency Changes</h3>`;
  if (!changes.length) return `<div class="card">${header}<p>No direct dependency changes detected.</p></div>`;
  const blocks = changes.map((ch, i) => {
    const heading = formatDirectDepHeading(i+1, ch);
    const NEW = renderVulnTable('NEW vulnerabilities', ch.vulnerabilities?.NEW);
    const REMOVED = renderVulnTable('REMOVED vulnerabilities', ch.vulnerabilities?.REMOVED);
    const UNCHANGED = renderVulnTable('UNCHANGED vulnerabilities', ch.vulnerabilities?.UNCHANGED);
    const hasContent = NEW || REMOVED || UNCHANGED;
    return `<div class="direct-dep-change"><h4>${heading}</h4>${hasContent || '<p>No related vulnerabilities.</p>'}${NEW}${REMOVED}${UNCHANGED}</div>`;
  }).join('');
  return `<div class="card">${header}${blocks}</div>`;
}

/**
 * Produces full summary section HTML.
 * @param {{view:Object}} param0
 * @returns {string}
 */
function renderSummary({ view } = {}) {
  if (!view) throw new Error('[render/html/summary] Missing view');

  const intro = `
<div class="card">
  <h2 id="section-title">Summary</h2>
  <p class="small">Generated at ${view.generatedAt}</p>
  ${totalsBlock(view.summary)}
</div>`;

  const env = `
<div class="grid-2">
  <div class="card">
    <h3>Tools</h3>
    <table>${toolsTable(view.tools)}</table>
  </div>
  <div class="card">
    <h3>Inputs</h3>
    <table>${inputsTable(view.inputs)}</table>
  </div>
</div>`;

  const branches = `
<div class="grid-2">
  ${branchTable('Base', view.base)}
  ${branchTable('Head', view.head)}
</div>`;

  const sev = `
<div class="card">
  <h3>Totals by Severity and State</h3>
  ${sevStateTable(view.summary.bySeverityAndState)}
</div>`;

  const dep = view.dependencyDiff || { totals:{}, items:[] };
  // Reemplazamos depCard por subsecciones detalladas usando directDependencyChanges
  const depCard = renderDirectDependencyChangesSection(view);

  return [intro, env, branches, sev, depCard].join('\n');
}

module.exports = { renderSummary };
