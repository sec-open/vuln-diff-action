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

  return [intro, env, branches, sev].join('\n');
}

module.exports = { renderSummary };
