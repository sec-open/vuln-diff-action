// src/render/pdf/sections/summary.js
function safeNum(n) { const x = Number(n); return Number.isFinite(x) ? x : 0; }
function sevKey(s) { return String(s || 'UNKNOWN').toUpperCase(); }
function stateKey(s) { return String(s || '').toUpperCase(); }

function deriveBySeverityAndState(items = []) {
  const SEV = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
  const out = {}; SEV.forEach(k => out[k] = { NEW:0, REMOVED:0, UNCHANGED:0 });
  for (const it of items) {
    const sev = sevKey(it.severity);
    const st = stateKey(it.state);
    if (out[sev] && (st in out[sev])) out[sev][st] += 1;
  }
  return out;
}

function totalsByState(bySevState = {}) {
  const acc = { NEW:0, REMOVED:0, UNCHANGED:0 };
  for (const sev of Object.keys(bySevState || {})) {
    const row = bySevState[sev] || {};
    acc.NEW += safeNum(row.NEW);
    acc.REMOVED += safeNum(row.REMOVED);
    acc.UNCHANGED += safeNum(row.UNCHANGED);
  }
  return acc;
}

function aggregatesByModuleSeverityState(items = []) {
  const out = {};
  for (const it of items) {
    const sev = sevKey(it.severity);
    const st = stateKey(it.state);
    const mp = it.module_paths || {};
    const modules = Object.keys(mp);
    if (modules.length === 0 && it.module) modules.push(String(it.module));
    if (modules.length === 0) modules.push('—');
    for (const m of modules) {
      out[m] = out[m] || {};
      out[m][sev] = out[m][sev] || { NEW:0, REMOVED:0, UNCHANGED:0 };
      if (st in out[m][sev]) out[m][sev][st] += 1;
    }
  }
  return out;
}

function renderToolsTable(tools = {}, action = {}) {
  return `
<table class="compact">
  <thead><tr><th>Tool</th><th>Version</th></tr></thead>
  <tbody>
    <tr><td>Syft</td><td><code>${tools.syft || '-'}</code></td></tr>
    <tr><td>Grype</td><td><code>${tools.grype || '-'}</code></td></tr>
    <tr><td>CycloneDX Maven</td><td><code>${tools.cyclonedx_maven || '-'}</code></td></tr>
    <tr><td>Node.js</td><td><code>${tools.node || '-'}</code></td></tr>
    <tr><td>Action</td><td><code>sec-open/vuln-diff-action ${action.version || '-'}</code> (<code>${action.commit || '-'}</code>)</td></tr>
  </tbody>
</table>
`.trim();
}

function renderInputsTable(inputs = {}) {
  const rows = Object.entries(inputs || {}).map(([k, v]) =>
    `<tr><td>${k}</td><td><code>${String(v)}</code></td></tr>`).join('');
  return `
<table class="compact">
  <thead><tr><th>Input</th><th>Value</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="2">—</td></tr>'}</tbody>
</table>
`.trim();
}

function renderRefsTable({ baseRef, baseShaShort, headRef, headShaShort }) {
  return `
<table class="compact">
  <thead><tr><th>Side</th><th>Ref</th><th>SHA</th></tr></thead>
  <tbody>
    <tr><td>Head</td><td><code>${headRef || '-'}</code></td><td><code>${headShaShort || '-'}</code></td></tr>
    <tr><td>Base</td><td><code>${baseRef || '-'}</code></td><td><code>${baseShaShort || '-'}</code></td></tr>
  </tbody>
</table>
`.trim();
}

function renderTotalsByStateTable(totals) {
  return `
<table class="compact">
  <thead><tr><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>
  <tbody><tr><td><strong>${safeNum(totals.NEW)}</strong></td><td><strong>${safeNum(totals.REMOVED)}</strong></td><td><strong>${safeNum(totals.UNCHANGED)}</strong></td></tr></tbody>
</table>
`.trim();
}

function renderSevByStateTable(bySevState) {
  const order = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
  const rows = order.map(sev => {
    const r = bySevState[sev] || {};
    return `<tr><td>${sev}</td><td>${safeNum(r.NEW)}</td><td>${safeNum(r.REMOVED)}</td><td>${safeNum(r.UNCHANGED)}</td></tr>`;
  }).join('');
  return `
<table class="compact">
  <thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
`.trim();
}

function renderModuleMatrixTables(byModuleSevState) {
  const sevOrder = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
  const mods = Object.keys(byModuleSevState || {}).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  if (!mods.length) return '<p>No module-level data available.</p>';
  return mods.map(mod => {
    const rows = sevOrder.map(sev => {
      const r = (byModuleSevState[mod] || {})[sev] || { NEW:0, REMOVED:0, UNCHANGED:0 };
      return `<tr><td>${sev}</td><td>${safeNum(r.NEW)}</td><td>${safeNum(r.REMOVED)}</td><td>${safeNum(r.UNCHANGED)}</td></tr>`;
    }).join('');
    return `
<h4>${mod}</h4>
<table class="compact no-break">
  <thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
`.trim();
  }).join('\n');
}

function summaryHtml(view) {
  const repo = view?.repo || '';
  const baseRef = view?.inputs?.baseRef || view?.base?.ref || '';
  const headRef = view?.inputs?.headRef || view?.head?.ref || '';
  const baseShaShort = view?.base?.shaShort || '';
  const headShaShort = view?.head?.shaShort || '';
  const tools = view?.tools || {};
  const action = view?.action || {};
  const items = Array.isArray(view?.diff?.items) ? view.diff.items : (Array.isArray(view?.items) ? view.items : []);
  const bySevState = view?.diff?.summary?.by_severity_and_state || view?.summary?.by_severity_and_state || deriveBySeverityAndState(items);
  const totals = totalsByState(bySevState);
  const byModuleSevState = (view?.aggregates?.by_module_severity_state) ? view.aggregates.by_module_severity_state : aggregatesByModuleSeverityState(items);

  const refsTable = renderRefsTable({ baseRef, baseShaShort, headRef, headShaShort });
  const totalsTable = renderTotalsByStateTable(totals);
  const sevMatrix = renderSevByStateTable(bySevState);
  const toolsTable = renderToolsTable(tools, action);
  const inputsTable = renderInputsTable(view?.inputs || {});
  const modulesTables = renderModuleMatrixTables(byModuleSevState);

  return `
<section class="page" id="summary">
  <h2>2. Summary</h2>

  <h3>2.1 Overview</h3>
  <div class="no-break">
    <p><strong>Project</strong>: ${repo}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:8px 0;">
      <div>
        <h4>References compared</h4>
        ${refsTable}
      </div>
      <div>
        <h4>Tools &amp; environment</h4>
        ${toolsTable}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:8px 0;">
      <div>
        <h4>Action inputs</h4>
        ${inputsTable}
      </div>
      <div>
        <h4>Totals by state</h4>
        ${totalsTable}
        <h4 style="margin-top:10px;">Severity × State</h4>
        ${sevMatrix}
      </div>
    </div>
  </div>

  <h3>2.2 Modules vulnerabilities</h3>
  <div class="no-break">
    ${modulesTables}
  </div>
</section>
`.trim();
}

module.exports = { summaryHtml };
