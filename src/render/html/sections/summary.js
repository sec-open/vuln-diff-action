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
function dependencyPomChangesTable(dep) {
  if (!dep || !Array.isArray(dep.items)) return '<p>No dependency changes detected.</p>';
  const interesting = dep.items.filter(it => ['NEW','UPDATED','REMOVED'].includes(it.state));
  if (!interesting.length) return '<p>No dependency changes detected.</p>';
  const head = '<table><thead><tr><th>State</th><th>Group:Artifact</th><th>Base Version</th><th>Head Version</th></tr></thead><tbody>';
  const rows = interesting.map(it => `<tr><td>${it.state}</td><td>${it.groupId}:${it.artifactId}</td><td>${it.baseVersion || '—'}</td><td>${it.headVersion || '—'}</td></tr>`).join('');
  return head + rows + '</tbody></table>';
}

/**
 * Renders the POM dependency change subsections.
 * @returns {string} - HTML string listing each changed dependency (NEW / UPDATED / REMOVED).
 */
function renderPomDependencyChangeSubsections(dep) {
  const items = Array.isArray(dep?.items) ? dep.items : [];
  const interesting = items.filter(it => ['NEW','UPDATED','REMOVED'].includes(it.state));
  if (!interesting.length) return '<p>No dependency changes detected.</p>';
  return interesting
    .sort((a,b)=>`${a.groupId}:${a.artifactId}`.localeCompare(`${b.groupId}:${b.artifactId}`,'en',{sensitivity:'base'}))
    .map((it, idx) => {
      const ga = `${it.groupId}:${it.artifactId}`;
      let heading;
      if (it.state === 'UPDATED') heading = `2.3.${idx+1} ${ga} UPDATED (${it.baseVersion || '—'} → ${it.headVersion || '—'})`;
      else if (it.state === 'NEW') heading = `2.3.${idx+1} ${ga} NEW (${it.headVersion || '—'})`;
      else if (it.state === 'REMOVED') heading = `2.3.${idx+1} ${ga} REMOVED (${it.baseVersion || '—'})`;
      else heading = `2.3.${idx+1} ${ga}`;
      return `<div class="pom-dep-change"><h4>${heading}</h4></div>`;
    }).join('\n');
}

/**
 * Genera cambios de dependencias para ecosistemas.
 * @param {Object} view
 * @returns {string}
 */
function dependencyChangesGeneric(view) {
  const changes = view.dependencyChanges || {};
  const ecos = Object.keys(changes);
  if (!ecos.length) return '<p>No dependency changes detected.</p>';
  return ecos.map(eco => {
    const dep = changes[eco];
    const interesting = Array.isArray(dep.items) ? dep.items.filter(it => ['NEW','UPDATED','REMOVED'].includes(it.state)) : [];
    const titleEco = eco === 'maven' ? 'Maven' : (eco === 'npm' ? 'npm' : eco);
    if (!interesting.length) return `<div class="card"><h3>${titleEco} Dependency Changes</h3><p>No dependency changes detected.</p></div>`;
    const head = `<table><thead><tr><th>State</th><th>Package</th><th>Base Version</th><th>Head Version</th></tr></thead><tbody>`;
    const rows = interesting
      .sort((a,b)=>{
        const na = `${a.groupId || a.group || ''}:${a.artifactId || a.name || ''}`;
        const nb = `${b.groupId || b.group || ''}:${b.artifactId || b.name || ''}`;
        return na.localeCompare(nb,'en',{sensitivity:'base'});
      })
      .map(it => {
        const pkgLabel = (it.groupId && it.artifactId) ? `${it.groupId}:${it.artifactId}` : (it.group ? `${it.group}/${it.name}` : (it.name || 'unknown'));
        return `<tr><td>${it.state}</td><td>${pkgLabel}</td><td>${it.baseVersion || '—'}</td><td>${it.headVersion || '—'}</td></tr>`;
      }).join('');
    return `<div class="card"><h3>${titleEco} Dependency Changes</h3>${head + rows + '</tbody></table>'}</div>`;
  }).join('\n');
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
  // Nueva sección de dependencias POM
  const pom = view.dependencyPomDiff || { totals:{}, items:[] };
  // LEGACY card mantenido (solo se muestra si hay items interesantes y ecosistema maven presente únicamente)
  const showLegacyPom = view.dependencyChanges && Object.keys(view.dependencyChanges).length === 1 && view.dependencyChanges.maven;
  const depGeneric = `<div class="card"><h3>Dependency Changes (Multi-ecosystem)</h3><p class="small">Shows NEW / UPDATED / REMOVED direct dependencies per ecosystem.</p></div>` + dependencyChangesGeneric(view);
  return [intro, env, branches, sev, showLegacyPom ? (`<div class="card"><h3>POM Dependency Changes (Legacy)</h3>${dependencyPomChangesTable(pom)}${renderPomDependencyChangeSubsections(pom)}</div>`) : '', depGeneric].filter(Boolean).join('\n');
}

module.exports = { renderSummary };
