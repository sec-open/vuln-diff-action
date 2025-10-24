// PDF summary section: aggregates counts by severity/state, inputs, tools, refs, and per-module matrices.

/** Safe numeric conversion with fallback to 0. */
function safeNum(n) { const x = Number(n); return Number.isFinite(x) ? x : 0; }
/** Normalizes severity string. */
function sevKey(s) { return String(s || 'UNKNOWN').toUpperCase(); }
/** Normalizes state string. */
function stateKey(s) { return String(s || '').toUpperCase(); }

/** Aggregates counts by severity and state. */
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

/** Sums totals across severity rows. */
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

/** Builds module→severity→state matrix. */
function aggregatesByModuleSeverityState(items = []) {
  const out = {};
  for (const it of items) {
    const sev = sevKey(it.severity);
    const st = stateKey(it.state);
    const mp = it.module_paths || {};
    const modules = Object.keys(mp).length ? Object.keys(mp) : (it.module ? [String(it.module)] : ['—']);
    for (const m of modules) {
      out[m] = out[m] || {};
      out[m][sev] = out[m][sev] || { NEW:0, REMOVED:0, UNCHANGED:0 };
      if (st in out[m][sev]) out[m][sev][st] += 1;
    }
  }
  return out;
}

/** Renders tools table (versions). */
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
</table>`.trim();
}

/** Renders action inputs table. */
function renderInputsTable(inputs = {}) {
  const rows = Object.entries(inputs || {}).map(([k, v]) =>
    `<tr><td>${k}</td><td><code>${String(v)}</code></td></tr>`).join('');
  return `
<table class="compact">
  <thead><tr><th>Input</th><th>Value</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="2">—</td></tr>'}</tbody>
</table>`.trim();
}

/** Renders refs comparison table. */
function renderRefsTable({ baseRef, baseShaShort, headRef, headShaShort }) {
  return `
<table class="compact">
  <thead><tr><th>Side</th><th>Ref</th><th>SHA</th></tr></thead>
  <tbody>
    <tr><td>Head</td><td><code>${headRef || '-'}</code></td><td><code>${headShaShort || '-'}</code></td></tr>
    <tr><td>Base</td><td><code>${baseRef || '-'}</code></td><td><code>${baseShaShort || '-'}</code></td></tr>
  </tbody>
</table>`.trim();
}

/** Renders totals by state table. */
function renderTotalsByStateTable(totals) {
  return `
<table class="compact">
  <thead><tr><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>
  <tbody><tr><td><strong>${safeNum(totals.NEW)}</strong></td><td><strong>${safeNum(totals.REMOVED)}</strong></td><td><strong>${safeNum(totals.UNCHANGED)}</strong></td></tr></tbody>
</table>`.trim();
}

/** Renders severity × state matrix table. */
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
</table>`.trim();
}

/** Renders per-module severity/state matrix table (number injected externally). */
function renderModuleMatrixTable(num, mod, mData) {
  const sevOrder = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
  const rows = sevOrder.map(sev => {
    const r = (mData || {})[sev] || { NEW:0, REMOVED:0, UNCHANGED:0 };
    return `<tr><td>${sev}</td><td>${safeNum(r.NEW)}</td><td>${safeNum(r.REMOVED)}</td><td>${safeNum(r.UNCHANGED)}</td></tr>`;
  }).join('');
  return `
<h4>2.2.${num} ${mod}</h4>
<table class="compact no-break">
  <thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`.trim();
}

// --- POM dependency changes helpers (clean) ---
function dependencyPomChangesTable(pomDiff) {
  if (!pomDiff || !Array.isArray(pomDiff.items)) return '<p>No POM dependency changes detected.</p>';
  const interesting = pomDiff.items.filter(it => ['NEW','UPDATED','REMOVED'].includes(it.state));
  if (!interesting.length) return '<p>No POM dependency changes detected.</p>';
  const head = '<table class="compact no-break"><thead><tr><th>State</th><th>Group:Artifact</th><th>Base Version</th><th>Head Version</th></tr></thead><tbody>';
  const rows = interesting.map(it => `\n<tr><td>${it.state}</td><td>${it.groupId}:${it.artifactId}</td><td>${it.baseVersion || '—'}</td><td>${it.headVersion || '—'}</td></tr>`).join('');
  return head + rows + '</tbody></table>';
}
function renderPomDependencyChangeSubsections(pomDiff) {
  const items = Array.isArray(pomDiff?.items) ? pomDiff.items : [];
  const interesting = items.filter(it => ['NEW','UPDATED','REMOVED'].includes(it.state));
  if (!interesting.length) return '<p>No POM dependency changes detected.</p>';
  return interesting
    .sort((a,b)=>`${a.groupId}:${a.artifactId}`.localeCompare(`${b.groupId}:${b.artifactId}`,'en',{sensitivity:'base'}))
    .map((it, idx) => {
      const ga = `${it.groupId}:${it.artifactId}`;
      let title;
      if (it.state === 'UPDATED') title = `2.3.${idx+1} ${ga} UPDATED (${it.baseVersion || '—'} → ${it.headVersion || '—'})`;
      else if (it.state === 'NEW') title = `2.3.${idx+1} ${ga} NEW (${it.headVersion || '—'})`;
      else if (it.state === 'REMOVED') title = `2.3.${idx+1} ${ga} REMOVED (${it.baseVersion || '—'})`;
      else title = `2.3.${idx+1} ${ga}`;
      return `<div class="pom-dep-change"><h4>${title}</h4></div>`;
    }).join('\n');
}

function summaryHtml(view) {
  const repo = view?.repo || '';
  const baseRef = view?.inputs?.baseRef || view?.base?.ref || '';
  const headRef = view?.inputs?.headRef || view?.head?.ref || '';
  const baseShaShort = view?.base?.shaShort || '';
  const headShaShort = view?.head?.shaShort || '';
  const items = Array.isArray(view?.diff?.items) ? view.diff.items : (Array.isArray(view?.items) ? view.items : []);
  const bySevState = view?.diff?.summary?.by_severity_and_state || view?.summary?.by_severity_and_state || deriveBySeverityAndState(items);
  const totals = totalsByState(bySevState);
  const byModuleSevState = (view?.aggregates?.by_module_severity_state) ? view.aggregates.by_module_severity_state : aggregatesByModuleSeverityState(items);

  const refsTable = renderRefsTable({ baseRef, baseShaShort, headRef, headShaShort });
  const totalsTable = renderTotalsByStateTable(totals);
  const sevMatrix = renderSevByStateTable(bySevState);
  const modules = Object.keys(byModuleSevState || {}).sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));

  const sec2_and_2_1 = `
<section class="page" id="summary">
  <h2>2. Summary</h2>
  <h3>2.1 Overview</h3>
  <div class="no-break">
    <h4>Project</h4>
    <p><code>${repo}</code></p>
    <h4>References compared</h4>
    ${refsTable}
    <h4>Totals by state</h4>
    ${totalsTable}
    <h4>Severity × State</h4>
    ${sevMatrix}
  </div>
</section>`.trim();

  let moduleSections;
  if (!modules.length) {
    moduleSections = `
<section class="page" id="summary-modules">
  <h3>2.2 Modules vulnerabilities</h3>
  <p>No module-level data available.</p>
</section>`.trim();
  } else {
    const chunks = [];
    for (let i = 0; i < modules.length; i += 3) chunks.push(modules.slice(i, i + 3));
    moduleSections = chunks.map((chunk, chunkIdx) => {
      const inner = chunk.map((mod, idxInChunk) => {
        const globalNum = (chunkIdx * 3) + idxInChunk + 1;
        return renderModuleMatrixTable(globalNum, mod, byModuleSevState[mod]);
      }).join('\n');
      return `
<section class="page" id="summary-mod-group-${chunkIdx+1}">
  <h3>${chunkIdx === 0 ? '2.2 Modules vulnerabilities' : '2.2 (cont.) Modules vulnerabilities'}</h3>
  ${inner}
</section>`.trim();
    }).join('\n');
  }

  const pomDiff = view?.dependencyPomDiff || { totals:{}, items:[] };
  const depSection = `\n<section class="page" id="summary-dependency-changes">\n  <h3>2.3 POM Dependency Changes</h3>\n  ${dependencyPomChangesTable(pomDiff)}\n  ${renderPomDependencyChangeSubsections(pomDiff)}\n</section>`;

  return [sec2_and_2_1, moduleSections, depSection].join('\n');
}

module.exports = { summaryHtml };
