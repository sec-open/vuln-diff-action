/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { fileURLToPath } = require('url');
const { install, computeExecutablePath } = require('@puppeteer/browsers');
const puppeteer = require('puppeteer-core');
const { buildView } = require('../common/view');

// -------------------------------------------------------------
// Utils
// -------------------------------------------------------------
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readTextSafe = async (p) => { try { return await fsp.readFile(p, 'utf8'); } catch { return ''; } };
const loadDiff = async (distDir) => {
  try { return JSON.parse(await fsp.readFile(path.join(distDir, 'diff.json'), 'utf8')); }
  catch { return null; }
};

const SEV_ORDER = { CRITICAL:5, HIGH:4, MEDIUM:3, LOW:2, UNKNOWN:1 };
const STATE_ORDER = { NEW:3, REMOVED:2, UNCHANGED:1 };

// GAV string
const pkgStr = (p) => {
  if (!p) return '—';
  const g = p.groupId || ''; const a = p.artifactId || ''; const v = p.version || '';
  if (g && a && v) return `${g}:${a}:${v}`;
  if (a && v) return `${a}:${v}`;
  return a || v || '—';
};
const vulnLink = (it) => {
  const url = Array.isArray(it.urls) && it.urls[0] ? it.urls[0] : (it.url || '');
  const id = it.id || it.vulnerabilityId || '—';
  return url ? `<a href="${url}">${id}</a>` : id;
};

// -------------------------------------------------------------
// CSS (impresión)
// -------------------------------------------------------------
function makePrintCss() {
  return `
@page { size: A4; margin: 18mm 14mm 18mm 14mm; }
* { box-sizing: border-box !important; }
html, body {
  margin:0 !important; padding:0 !important;
  background:#ffffff !important; color:#0b0f16 !important;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
}
body, .card, .panel, .box, .bg, .bg-slate-900, .bg-slate-800, .bg-slate-700, .chart-card {
  background:#ffffff !important; color:#0b0f16 !important;
}

/* ===== PORTADA ===== */
.cover-page {
  page-break-after: always !important;
  background:#0b0f16 !important; color:#e5e7eb !important;
  min-height:100vh; padding:24mm 18mm !important; position: relative;
}
.cover-top{ display:flex; justify-content:space-between; align-items:flex-start; }
.cover-brand img{ max-height:52px; }
.cover-meta{ text-align:right; color:#9ca3af; font-size:12px; }
.cover-meta-ts{ font-weight:600; }
.cover-title{ margin-top:40mm; }
.cover-title .line1{ font-size:22px; font-weight:700; margin:0 0 6px 0; }
.cover-title .line2{ font-size:18px; color:#cbd5e1; }

/* Tarjetas Base/Head: corregir corte y wrap de SHA largo */
.cover-cards{
  position:absolute; left:18mm; right:18mm; bottom:18mm;
  display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px;
}
.card-dark{ border:1px solid #1f2937; border-radius:10px; padding:12px; background:#111827; width:100%; }
.card-dark .card-title{ font-weight:700; margin-bottom:6px; color:#e5e7eb; }
.card-dark .kv{ display:grid; grid-template-columns:120px 1fr; gap:6px 12px; font-size:13px; line-height:1.38; }
.wrap { word-break: break-word; overflow-wrap: anywhere; }

/* ===== PÁGINAS ===== */
.page { page-break-before: always !important; background:#fff !important; }
.section-wrap{ padding:6mm 0 !important; }
.section-title{ font-size:20px !important; margin:0 0 8px 0 !important; }

/* TOC muy amplio */
.toc h2{ font-size:22px !important; margin-bottom:14px !important; }
.toc ol{ font-size:15px !important; line-height:1.9 !important; padding-left:20px !important; }
.toc li{ margin:6px 0 !important; }

/* Subtítulos */
.subsection-title{ font-weight:700; margin:12px 0 4px 0; padding-bottom:4px; border-bottom:2px solid #0b0f16; }

/* Tablas */
table{ width:100% !important; border-collapse: collapse !important; }
th,td{ text-align:left !important; padding:6px 8px !important; border-bottom:1px solid #e5e7eb !important; vertical-align: top; }
thead th{ background:#f3f4f6 !important; font-weight:600 !important; }

/* Dashboard */
.print-dash-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.print-dash-card{ border:1px solid #e5e7eb; border-radius:10px; padding:8px; }
.print-dash-card h4{ margin:0 0 6px 0; font-size:14px; }
.print-dash-card canvas{ width:100% !important; height:200px !important; }
.print-dash-span2{ grid-column:1 / span 2; }

/* Tablas por módulo en Dashboard */
.module-tables { margin-top:10px; }
.module-tables h4 { margin:12px 0 6px 0; }
.module-tables table { margin-bottom:8px; }

/* Ocultar elementos interactivos del bundle */
#app-menu, #app-header, nav, .controls, .filters, .btn, button{ display:none !important; }

/* Enlaces / código */
a{ color:#1d4ed8 !important; text-decoration:none !important; }
a:hover{ text-decoration:underline !important; }
code{ background:#eef2ff !important; padding:2px 6px !important; border-radius:6px !important; }

/* Dependency Paths */
#Paths, .paths-filter, .filter, .filter-box, .search, .search-box, input[type="search"] {
  display: none !important;
}
.dep-paths-table, .dep-paths-table thead, .dep-paths-table tbody, .dep-paths-table tr, .dep-paths-table td, .dep-paths-table th {
  page-break-inside: avoid !important;
}
.dep-paths .subsection-title { margin-top: 10px; }
.dep-paths-table th, .dep-paths-table td { font-size: 13px; }

/* Fix Insights totals box */
.fix-totals { border:1px solid #e5e7eb; border-radius:8px; padding:8px; margin:8px 0 12px; }
`.trim();
}

// -------------------------------------------------------------
// Header / Footer
// (sin cambios visuales: solo se aseguran refs desde inputs.*_ref)
// -------------------------------------------------------------
function headerTemplate({ logoDataUri, repo, generatedAt }) {
  const band = '#0b0f16';
  const img = logoDataUri
    ? `<img src="${logoDataUri}" style="height:12px;vertical-align:middle;margin-right:6px"/>`
    : '';
  return `
<style>
  html, body { margin:0; padding:0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 6px 12px; }
  .bg { background-color: ${band}; color: #ffffff; }
  .txt { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:10px; }
  .left { display: inline-flex; align-items: center; gap: 6px; }
  .right { opacity: 0.9; float: right; }
</style>
<table class="txt bg">
  <tr>
    <td>
      <span class="left">${img}<span>Vulnerability Diff Report — ${repo}</span></span>
      <span class="right">${generatedAt}</span>
    </td>
  </tr>
</table>
`.trim();
}

function footerTemplate({ logoDataUri, baseRef, headRef, generatedAt }) {
  const band = '#0b0f16';
  const img = logoDataUri
    ? `<img src="${logoDataUri}" style="height:10px;vertical-align:middle;margin-right:6px"/>`
    : '';
  return `
<style>
  html, body { margin:0; padding:0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 6px 12px; }
  .bg { background-color: ${band}; color: #ffffff; }
  .txt { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:10px; }
  .left { display: inline-flex; align-items: center; gap: 6px; }
  .right { opacity: 0.9; float: right; }
</style>
<table class="txt bg">
  <tr>
    <td>
      <span class="left">${img}BASE: ${baseRef} → HEAD: ${headRef}</span>
      <span class="right">${generatedAt} — <span class="pageNumber"></span>/<span class="totalPages"></span></span>
    </td>
  </tr>
</table>
`.trim();
}

// -------------------------------------------------------------
// Cover & TOC
// -------------------------------------------------------------
function coverHtml({ repo, base, head, inputs, generatedAt, logoDataUri }) {
  const baseRef = inputs?.baseRef || base.ref;
  const headRef = inputs?.headRef || head.ref;

  return `
<div class="cover-page">
  <div class="cover-top">
    <div class="cover-brand">${logoDataUri ? `<img src="${logoDataUri}" alt="logo"/>` : ''}</div>
    <div class="cover-meta">
      <div class="cover-meta-ts">${generatedAt}</div>
    </div>
  </div>

  <div class="cover-title">
    <div class="line1">Vulnerability Diff Report</div>
    <div class="line2">${repo}</div>
  </div>

  <div class="cover-cards">
    <div class="card-dark">
      <div class="card-title">Base</div>
      <div class="kv"><div>Ref</div><div class="wrap">${baseRef || '—'}</div></div>
      <div class="kv"><div>Commit</div><div>${base.shaShort} <span class="wrap">(${base.sha})</span></div></div>
      <div class="kv"><div>Author</div><div>${base.author}</div></div>
      <div class="kv"><div>Authored at</div><div>${base.authoredAt}</div></div>
      <div class="kv"><div>Subject</div><div class="wrap">${base.commitSubject}</div></div>
    </div>

    <div class="card-dark">
      <div class="card-title">Head</div>
      <div class="kv"><div>Ref</div><div class="wrap">${headRef || '—'}</div></div>
      <div class="kv"><div>Commit</div><div>${head.shaShort} <span class="wrap">(${head.sha})</span></div></div>
      <div class="kv"><div>Author</div><div>${head.author}</div></div>
      <div class="kv"><div>Authored at</div><div>${head.authoredAt}</div></div>
      <div class="kv"><div>Subject</div><div class="wrap">${head.commitSubject}</div></div>
    </div>
  </div>
</div>
`.trim();
}

// TOC — títulos actualizados (3 = Results tables)
function tocHtml(repo) {
  return `
<div class="page section-wrap toc">
  <h2>Table of Contents — ${repo}</h2>
  <ol>
    <li>1. Introduction</li>
    <li>2. Summary</li>
    <li>3. Results tables</li>
    <li>4. Dashboard</li>
    <li>5. Dependency Graph — Base</li>
    <li>6. Dependency Graph — Head</li>
    <li>7. Dependency Paths — Base</li>
    <li>8. Dependency Paths — Head</li>
    <li>9. Fix Insights</li>
  </ol>
</div>
`.trim();
}

// -------------------------------------------------------------
// Secciones
// -------------------------------------------------------------
function sectionPlan() {
  return [
    { id: 'intro', title: 'Introduction', num: 1, file: 'intro.html' },
    { id: 'summary', title: 'Summary', num: 2, file: 'summary.html' },
    // id 3 se genera custom (diff/base/head tables)
    { id: 'dashboard', title: 'Dashboard', num: 4, file: null },
    { id: 'dep-graph-base', title: 'Dependency Graph — Base', num: 5, file: 'dep-graph-base.html' },
    { id: 'dep-graph-head', title: 'Dependency Graph — Head', num: 6, file: 'dep-graph-head.html' },
    { id: 'dep-paths-base', title: 'Dependency Paths — Base', num: 7, file: null },
    { id: 'dep-paths-head', title: 'Dependency Paths — Head', num: 8, file: null },
    { id: 'fix-insights', title: 'Fix Insights', num: 9, file: null },
  ];
}

function sectionWrapper({ id, title, num, innerHtml }) {
  return `
<div class="page section-wrap" id="${id}">
  <h2 class="section-title">${num}. ${title}</h2>
  ${innerHtml}
</div>
`.trim();
}

// -------------------------------------------------------------
// Vulnerability tables (Diff/Base/Head)
// -------------------------------------------------------------
async function buildVulnTableDiffOrFallback(distDir) {
  const htmlRoot = path.join(distDir, 'html');
  const file = path.join(htmlRoot, 'sections', 'vuln-diff-table.html');
  const raw = await readTextSafe(file);
  const hasRows = /<tbody[^>]*>\s*<tr[\s\S]*<\/tr>\s*<\/tbody>/i.test(raw);
  if (raw && hasRows) return raw;
  // fallback desde JSON (ordenar por severidad desc + estado + package)
  const diff = await loadDiff(distDir);
  const items = Array.isArray(diff?.items) ? diff.items : [];
  return buildVulnTableGeneric(items, () => true, 'Vulnerability Diff Table');
}

function buildVulnTableGeneric(items, filterFn, title) {
  const filtered = items.filter(filterFn);
  if (!filtered.length) {
    return `<h3 class="subsection-title">${title}</h3><p>No vulnerabilities to display.</p>`;
  }
  // group by severity
  const groups = new Map();
  for (const it of filtered) {
    const sev = String(it.severity || 'UNKNOWN').toUpperCase();
    if (!groups.has(sev)) groups.set(sev, []);
    groups.get(sev).push(it);
  }
  // render
  const sevOrder = Object.keys(SEV_ORDER).sort((a,b)=>SEV_ORDER[b]-SEV_ORDER[a]);
  const stateRank = (s) => STATE_ORDER[s] || 0;

  const blocks = [];
  for (const sev of sevOrder) {
    const arr = groups.get(sev);
    if (!arr || !arr.length) continue;
    arr.sort((a,b)=>{
      const sa = String(a.state||'').toUpperCase(), sb = String(b.state||'').toUpperCase();
      const ra = stateRank(sa), rb = stateRank(sb);
      if (ra !== rb) return rb - ra; // NEW > REMOVED > UNCHANGED
      const pa = pkgStr(a.package), pb = pkgStr(b.package);
      return pa.localeCompare(pb, 'en', { sensitivity:'base' });
    });
    const rows = arr.map(it => `
      <tr>
        <td>${sev}</td>
        <td>${vulnLink(it)}</td>
        <td>${pkgStr(it.package)}</td>
        <td>${it.state}</td>
      </tr>
    `).join('');
    blocks.push(`
      <h4 class="subsection-title">${sev}</h4>
      <table>
        <thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `);
  }

  return `
    <h3 class="subsection-title">${title}</h3>
    ${blocks.join('\n')}
  `;
}

// -------------------------------------------------------------
// Dashboard (añade tablas por módulo)
// -------------------------------------------------------------
function buildPdfDashboardHtml(dash, view) {
  const dataJson = JSON.stringify(dash);

  // Tablas numéricas (sin filas/cols de totales “extra”)
  const states = ['NEW','REMOVED','UNCHANGED'];
  const stateTotalsRows = states.map((s, i) => {
    const v = (dash.stateTotals && dash.stateTotals[i]) || 0;
    return `<tr><td>${s}</td><td>${v}</td></tr>`;
  }).join('');
  const stateTotalsTable = `
    <table>
      <thead><tr><th>State</th><th>Count</th></tr></thead>
      <tbody>${stateTotalsRows}</tbody>
    </table>
  `.trim();

  const nvrHeader = `<thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th></tr></thead>`;
  const nvrRows = (dash.newVsRemoved || []).map(row => {
    const n = row.NEW || 0, r = row.REMOVED || 0;
    return `<tr><td>${row.sev}</td><td>${n}</td><td>${r}</td></tr>`;
  }).join('');
  const nvrTable = `<table>${nvrHeader}<tbody>${nvrRows}</tbody></table>`;

  const stkHeader = `<thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>`;
  const stkRows = (dash.stacked || []).map(row => {
    const n = row.NEW || 0, r = row.REMOVED || 0, u = row.UNCHANGED || 0;
    return `<tr><td>${row.sev}</td><td>${n}</td><td>${r}</td><td>${u}</td></tr>`;
  }).join('');
  const stkTable = `<table>${stkHeader}<tbody>${stkRows}</tbody></table>`;

  // --- Tablas por módulo (view.precomputed.aggregates.by_module_severity_state) ---
  let moduleTablesHtml = '';
  const byMod = view?.precomputed?.aggregates?.by_module_severity_state || {};
  const sevOrderArr = Object.keys(SEV_ORDER).sort((a,b)=>SEV_ORDER[b]-SEV_ORDER[a]);

  const modNames = Object.keys(byMod).sort((a,b)=>a.localeCompare(b, 'en', {sensitivity:'base'}));
  if (modNames.length) {
    const tables = modNames.map(mod => {
      const map = byMod[mod] || {};
      const rows = sevOrderArr.map(s => {
        const row = map[s] || { NEW:0, REMOVED:0, UNCHANGED:0 };
        return `<tr><td>${s}</td><td>${row.NEW||0}</td><td>${row.REMOVED||0}</td><td>${row.UNCHANGED||0}</td></tr>`;
      }).join('');
      return `
        <h4>${mod}</h4>
        <table>
          <thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }).join('');
    moduleTablesHtml = `<div class="module-tables"><h3 class="subsection-title">Per-module counts</h3>${tables}</div>`;
  }

  return `
<div class="print-dash-grid">
  <div class="print-dash-card">
    <h4>Distribution by State</h4>
    <canvas id="chart-state-totals" width="800" height="200"></canvas>
    <div class="dash-table">
      <h5 style="margin:8px 0 4px 0;">Data</h5>
      ${stateTotalsTable}
    </div>
  </div>

  <div class="print-dash-card">
    <h4>NEW vs REMOVED by Severity</h4>
    <canvas id="chart-new-removed" width="800" height="200"></canvas>
    <div class="dash-table">
      <h5 style="margin:8px 0 4px 0;">Data</h5>
      ${nvrTable}
    </div>
  </div>

  <div class="print-dash-card print-dash-span2">
    <h4>By Severity & State (stacked)</h4>
    <canvas id="chart-stacked" width="800" height="220"></canvas>
    <div class="dash-table">
      <h5 style="margin:8px 0 4px 0;">Data</h5>
      ${stkTable}
    </div>
  </div>
</div>

${moduleTablesHtml}

<script>
  (function(){
    var DASH = ${dataJson};
    function ready(){
      try{
        if (typeof Chart === 'undefined') { window.__chartsReady = true; return; }
        var ctx1 = document.getElementById('chart-state-totals').getContext('2d');
        new Chart(ctx1, { type: 'bar',
          data: { labels: ['NEW','REMOVED','UNCHANGED'], datasets: [{ label: 'Count', data: DASH.stateTotals }] },
          options: { responsive:false, animation:false }
        });

        var labels2 = (DASH.newVsRemoved || []).map(function(x){ return x.sev; });
        var dataNew = (DASH.newVsRemoved || []).map(function(x){ return x.NEW || 0; });
        var dataRemoved = (DASH.newVsRemoved || []).map(function(x){ return x.REMOVED || 0; });
        var ctx2 = document.getElementById('chart-new-removed').getContext('2d');
        new Chart(ctx2, {
          type: 'bar',
          data: { labels: labels2, datasets: [{ label: 'NEW', data: dataNew }, { label: 'REMOVED', data: dataRemoved }] },
          options: { responsive:false, animation:false }
        });

        var labels3 = (DASH.stacked || []).map(function(x){ return x.sev; });
        var dNew = (DASH.stacked || []).map(function(x){ return x.NEW || 0; });
        var dRem = (DASH.stacked || []).map(function(x){ return x.REMOVED || 0; });
        var dUnc = (DASH.stacked || []).map(function(x){ return x.UNCHANGED || 0; });
        var ctx3 = document.getElementById('chart-stacked').getContext('2d');
        new Chart(ctx3, {
          type: 'bar',
          data: { labels: labels3, datasets: [{ label:'NEW', data:dNew }, { label:'REMOVED', data:dRem }, { label:'UNCHANGED', data:dUnc }] },
          options: { responsive:false, animation:false, plugins:{ legend:{ position:'top' } }, scales:{ x:{ stacked:true }, y:{ stacked:true } } }
        });
        setTimeout(function(){ window.__chartsReady = true; }, 50);
      } catch(e){ window.__chartsReady = true; }
    }
    if (typeof Chart !== 'undefined') { ready(); }
    else { var t=setInterval(function(){ if (typeof Chart !== 'undefined'){clearInterval(t); ready();}},50); setTimeout(function(){clearInterval(t); window.__chartsReady=true;},5000); }
  })();
</script>
`.trim();
}

// -------------------------------------------------------------
// Dependency Paths (column order: Vulnerability - Package - Module → tail)
// -------------------------------------------------------------
function buildDependencyPathsSection(items, side) {
  const keep = (it) => {
    const st = String(it.state || '').toUpperCase();
    if (side === 'base') return st === 'REMOVED' || st === 'UNCHANGED';
    if (side === 'head') return st === 'NEW' || st === 'UNCHANGED';
    return true;
  };

  const triples = [];
  for (const it of (items || [])) {
    if (!keep(it)) continue;
    const sev = String(it.severity || 'UNKNOWN').toUpperCase();
    const gav = pkgStr(it.package);
    const vhtml = vulnLink(it);
    const vid = it.id || it.vulnerabilityId || '';
    const mp = it.module_paths || {};
    const mods = Object.keys(mp);
    if (!mods.length) {
      triples.push({ sev, module:'', tail:'', gav, vhtml, vid });
      continue;
    }
    for (const mod of mods) {
      const tails = Array.isArray(mp[mod]) ? mp[mod] : [];
      if (!tails.length) triples.push({ sev, module:mod, tail:'', gav, vhtml, vid });
      else for (const t of tails) triples.push({ sev, module:mod, tail:t||'', gav, vhtml, vid });
    }
  }
  // dedupe intra-vuln
  const uniq = new Map();
  for (const r of triples) {
    const key = `${r.vid}||${r.module}||${r.tail}`;
    if (!uniq.has(key)) uniq.set(key, r);
  }
  const rows = Array.from(uniq.values());
  if (!rows.length) return `<p>No dependency paths to display for ${side === 'base' ? 'Base' : 'Head'}.</p>`;

  rows.sort((a, b) => {
    const ra = SEV_ORDER[a.sev] || 0, rb = SEV_ORDER[b.sev] || 0;
    if (ra !== rb) return rb - ra;
    const ia = a.vid||'', ib = b.vid||''; if (ia!==ib) return ia.localeCompare(ib,'en',{sensitivity:'base'});
    const pa = a.gav||'', pb = b.gav||''; if (pa!==pb) return pa.localeCompare(pb,'en',{sensitivity:'base'});
    const ma = a.module||'', mb = b.module||''; if (ma!==mb) return ma.localeCompare(mb,'en',{sensitivity:'base'});
    return (a.tail||'').localeCompare(b.tail||'','en',{sensitivity:'base'});
  });

  const groups = rows.reduce((acc, r) => ((acc[r.sev] ||= []).push(r), acc), {});
  const sevOrderArr = Object.keys(SEV_ORDER).sort((s1, s2) => (SEV_ORDER[s2] - SEV_ORDER[s1]));
  const sections = sevOrderArr
    .filter(sev => Array.isArray(groups[sev]) && groups[sev].length)
    .map(sev => {
      const trs = groups[sev].map(r => {
        const right = r.tail ? `${r.module} -> ${r.tail}` : (r.module || '—');
        return `<tr>
          <td>${r.vhtml}</td>
          <td>${r.gav}</td>
          <td>${right}</td>
        </tr>`;
      }).join('');
      return `
        <h4 class="subsection-title">${sev}</h4>
        <table class="dep-paths-table">
          <thead><tr><th>Vulnerability</th><th>Package</th><th>Module → Path tail</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      `;
    }).join('\n');

  return `<div class="dep-paths">${sections}</div>`;
}

// -------------------------------------------------------------
// Fix Insights (manteniendo tu lógica + sin REMOVED)
// -------------------------------------------------------------
async function buildFixInsightsFromJson(distDir) {
  const diff = await loadDiff(distDir);
  if (!diff || !Array.isArray(diff.items)) {
    return '<p>[diff.json not found or empty]</p>';
  }
  const headItems = diff.items.filter(x => {
    const st = String(x.state || '').toUpperCase();
    return st === 'NEW' || st === 'UNCHANGED';
  });
  const hasFix = (o) => Boolean(o && o.fix && (
    (Array.isArray(o.fix.versions) && o.fix.versions.length) ||
    o.fix.state === 'fixed'
  ));
  const withFix = headItems.filter(hasFix);
  const withoutFix = headItems.filter(x => !hasFix(x));
  const totalVulns = headItems.length;
  const totalWithFix = withFix.length;

  const sev = (s) => (String(s || 'UNKNOWN').toUpperCase());
  const tgt = (o) => (o.fix && Array.isArray(o.fix.versions) && o.fix.versions[0]) ? o.fix.versions[0] : '—';
  const mkRows = (arr) => arr.map(o => `
    <tr>
      <td>${sev(o.severity)}</td>
      <td>${vulnLink(o)}</td>
      <td>${pkgStr(o.package)}</td>
      <td>${o.state}</td>
      <td>${tgt(o)}</td>
    </tr>
  `).join('');
  const section = (title, arr) => `
    <h4 class="subsection-title">${title}</h4>
    <table>
      <thead>
        <tr>
          <th>Severity</th>
          <th>Vulnerability</th>
          <th>Package</th>
          <th>State</th>
          <th>Target Version</th>
        </tr>
      </thead>
      <tbody>${mkRows(arr)}</tbody>
    </table>
  `.trim();

  const totalsTable = `
<div class="fix-totals">
  <table>
    <thead>
      <tr>
        <th>TOTAL Vulnerabilities</th>
        <th>Total with Fix</th>
        <th>NEW</th>
        <th>UNCHANGED</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${totalVulns}</td>
        <td>${totalWithFix}</td>
        <td>${withFix.filter(x => x.state === 'NEW').length}</td>
        <td>${withFix.filter(x => x.state === 'UNCHANGED').length}</td>
      </tr>
    </tbody>
  </table>
</div>
`.trim();

  return `
    ${totalsTable}
    ${section('With fix (NEW/UNCHANGED)', withFix)}
    ${section('Without fix (NEW/UNCHANGED)', withoutFix)}
  `.trim();
}

// -------------------------------------------------------------
// Sección 3 (Results tables): 3.1 Diff, 3.2 Base, 3.3 Head
// -------------------------------------------------------------
async function buildResultsTablesHtml(distDir) {
  const diff = await loadDiff(distDir);
  const items = Array.isArray(diff?.items) ? diff.items : [];

  const diffHtml = await buildVulnTableDiffOrFallback(distDir);

  const baseHtml = buildVulnTableGeneric(
    items,
    (it) => {
      const st = String(it.state || '').toUpperCase();
      return st === 'REMOVED' || st === 'UNCHANGED';
    },
    '3.2 Vulnerability Base Table'
  );

  const headHtml = buildVulnTableGeneric(
    items,
    (it) => {
      const st = String(it.state || '').toUpperCase();
      return st === 'NEW' || st === 'UNCHANGED';
    },
    '3.3 Vulnerability Head Table'
  );

  // Encabezado de la sección 3
  return `
    <h3 class="subsection-title">3.1 Vulnerability Diff Table</h3>
    ${diffHtml}
    ${baseHtml}
    ${headHtml}
  `.trim();
}

// -------------------------------------------------------------
// Dashboard data (igual que tu lógica actual)
// -------------------------------------------------------------
function computeDashData(items = []) {
  const sevList = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
  const bySev = {}; sevList.forEach(s => bySev[s] = { NEW:0, REMOVED:0, UNCHANGED:0 });
  for (const it of items) {
    const sev = String(it.severity || 'UNKNOWN').toUpperCase();
    const st  = String(it.state || '').toUpperCase();
    if (bySev[sev] && (st in bySev[sev])) bySev[sev][st]++;
  }
  const stateTotals = [
    items.filter(x => String(x.state||'').toUpperCase()==='NEW').length,
    items.filter(x => String(x.state||'').toUpperCase()==='REMOVED').length,
    items.filter(x => String(x.state||'').toUpperCase()==='UNCHANGED').length,
  ];
  const newVsRemoved = Object.keys(bySev).map(sev => ({ sev, NEW: bySev[sev].NEW, REMOVED: bySev[sev].REMOVED }));
  const stacked = Object.keys(bySev).map(sev => ({ sev, ...bySev[sev] }));
  return { stateTotals, newVsRemoved, stacked };
}

// -------------------------------------------------------------
// HTML completo para imprimir
// -------------------------------------------------------------
async function buildPrintHtml({ distDir, view, logoDataUri }) {
  const htmlRoot = path.join(distDir, 'html');
  const sectionsDir = path.join(htmlRoot, 'sections');

  const vendorChartPath   = path.join(htmlRoot, 'assets', 'js', 'vendor', 'chart.umd.js');
  const vendorMermaidPath = path.join(htmlRoot, 'assets', 'js', 'vendor', 'mermaid.min.js');
  const chartTag   = exists(vendorChartPath)   ? `<script src="file://${vendorChartPath}"></script>`   : '';
  const mermaidTag = exists(vendorMermaidPath) ? `<script src="file://${vendorMermaidPath}"></script>` : '';

  // Cover + TOC
  let bodyInner = coverHtml({
    repo: view.repo,
    base: view.base,
    head: view.head,
    inputs: view.inputs, // <-- usa inputs.baseRef / inputs.headRef
    generatedAt: view.generatedAt,
    logoDataUri
  });
  bodyInner += '\n' + tocHtml(view.repo);

  const diff = await loadDiff(distDir);
  const items = (view && Array.isArray(view.items)) ? view.items : (diff?.items || []);

  // ==== Sección 3: Results tables (Diff/Base/Head) ====
  bodyInner += '\n' + sectionWrapper({
    id: 'results-tables',
    title: 'Results tables',
    num: 3,
    innerHtml: await buildResultsTablesHtml(distDir),
  });

  // Resto de secciones plan
  for (const s of sectionPlan().filter(x => x.num !== 3)) {
    let inner = '';
    if (s.id === 'dashboard') {
      const dash = computeDashData(diff?.items || []);
      inner = buildPdfDashboardHtml(dash, view);
    } else if (s.id === 'dep-paths-base') {
      inner = buildDependencyPathsSection(items, 'base');
    } else if (s.id === 'dep-paths-head') {
      inner = buildDependencyPathsSection(items, 'head');
    } else if (s.id === 'fix-insights') {
      inner = await buildFixInsightsFromJson(distDir);
    } else {
      const file = s.file ? path.join(sectionsDir, s.file) : null;
      inner = file ? await readTextSafe(file) : '';
      if (s.id === 'summary') {
        // quita "Generated at ..." redundante
        inner = inner
          .replace(/<h3[^>]*>\s*Tools\s*<\/h3>/i, '<h3 class="subsection-title">Tools</h3>')
          .replace(/<h3[^>]*>\s*Inputs\s*<\/h3>/i, '<h3 class="subsection-title">Inputs</h3>')
          .replace(/<h3[^>]*>\s*Base\s*<\/h3>/i, '<h3 class="subsection-title">Base</h3>')
          .replace(/<h3[^>]*>\s*Head\s*<\/h3>/i, '<h3 class="subsection-title">Head</h3>')
          .replace(/<p>\s*Generated at\s+[^<]*<\/p>/i, '');
      }
    }
    bodyInner += '\n' + sectionWrapper({ id: s.id, title: s.title, num: s.num, innerHtml: inner });
  }

  const printCssHref = './assets/print.css';

  const mermaidInit = `
<script>
  (function(){
    function bootstrapMermaid() {
      try {
        if (!window.mermaid) { window.__mermaidReady = true; return; }
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
        var blocks = Array.from(document.querySelectorAll('.mermaid, pre code.language-mermaid'));
        blocks.forEach(function(el){
          if (el.tagName && el.tagName.toLowerCase() === 'code') {
            var code = el.textContent;
            var host = document.createElement('div');
            host.className = 'mermaid';
            host.textContent = code;
            el.parentElement.replaceWith(host);
          }
        });
        window.mermaid.run().then(function(){ window.__mermaidReady = true; })
                           .catch(function(){ window.__mermaidReady = true; });
      } catch(e) { window.__mermaidReady = true; }
    }
    if (window.mermaid) { bootstrapMermaid(); }
    else {
      var tries = 0, max = 100, t = setInterval(function(){
        if (window.mermaid) { clearInterval(t); bootstrapMermaid(); }
        else if (++tries >= max) { clearInterval(t); window.__mermaidReady = true; }
      }, 50);
    }
  })();
</script>`.trim();

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <link rel="stylesheet" href="${printCssHref}">
  ${chartTag}
  ${mermaidTag}
  <title>Vulnerability Diff Report — ${view.repo}</title>
</head>
<body>
${bodyInner}
${mermaidInit}
</body>
</html>
`.trim();
}

// -------------------------------------------------------------
// Chromium launcher (igual que antes)
// -------------------------------------------------------------
// -------------------------------------------------------------
// Chrome for Testing launcher (con cache) — recomendado
// -------------------------------------------------------------
async function ensureChromium() {
  // Carpeta cache local del repo (se puede cachear en CI)
  const cacheDir = path.join(process.cwd(), '.chromium-cache');

  // Permitir overrides por variables de entorno si alguna vez las necesitas
  const browser   = process.env.PUPPETEER_BROWSER || 'chrome';          // 'chrome' | 'chromium'
  const buildId   = process.env.PUPPETEER_BUILD_ID || 'stable';         // 'stable' | 'beta' | 'canary' | versión exacta
  const dlCb      = () => {}; // silenciar progreso en CI

  // Descarga si no existe y devuelve la ruta del ejecutable
  await install({ cacheDir, browser, buildId, downloadProgressCallback: dlCb });

  const executablePath = computeExecutablePath({ cacheDir, browser, buildId });
  if (!executablePath) {
    throw new Error(`[pdf] No executablePath found for ${browser}@${buildId} in ${cacheDir}`);
  }
  return executablePath;
}


// -------------------------------------------------------------
// Orquestador PDF
// -------------------------------------------------------------
async function pdf_init({ distDir = './dist', html_logo_url = '' } = {}) {
  const absDist = path.resolve(distDir);
  const pdfDir = path.join(absDist, 'pdf');
  const assetsDir = path.join(pdfDir, 'assets');
  await fsp.mkdir(assetsDir, { recursive: true });

  // Genera CSS de impresión en disco (no se inyecta inline para mantener tu ruta existente)
  await fsp.writeFile(path.join(assetsDir, 'print.css'), makePrintCss(), 'utf8');

  // Logo -> data URI
  let logoDataUri = '';
  try {
    if (html_logo_url) {
      const isHttp = /^https?:\/\//i.test(html_logo_url);
      if (isHttp) {
        const res = await fetch(html_logo_url);
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get('content-type') || 'image/png';
        logoDataUri = `data:${mime};base64,${buf.toString('base64')}`;
      } else {
        const p = path.isAbsolute(html_logo_url) ? html_logo_url : path.join(absDist, 'html', html_logo_url.replace(/^\.?\//,''));
        const mime = (p.endsWith('.svg') ? 'image/svg+xml'
                    : p.endsWith('.jpg') || p.endsWith('.jpeg') ? 'image/jpeg'
                    : 'image/png');
        const buf = await fsp.readFile(p);
        logoDataUri = `data:${mime};base64,${buf.toString('base64')}`;
      }
    }
  } catch { /* sin logo */ }

  // View (Fase-3)
  const view = buildView(absDist);

  // HTML completo para imprimir
  const html = await buildPrintHtml({ distDir: absDist, view, logoDataUri });
  const printHtmlPath = path.join(pdfDir, 'print.html');
  await fsp.writeFile(printHtmlPath, html, 'utf8');

  // Puppeteer (Chromium portable)
  const executablePath = await ensureChromium();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.goto(`file://${printHtmlPath}`, { waitUntil: 'load', timeout: 120000 });

  // Esperar gráficos/mermaid
  try {
    await page.waitForFunction(() => (window.__chartsReady === true) && (window.__mermaidReady === true), { timeout: 60000 });
    await page.waitForTimeout(250);
  } catch { /* continuar */ }

  // Primera página sin header/footer
  const coverPdf = await page.pdf({
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    pageRanges: '1',
    path: path.join(pdfDir, 'cover.tmp.pdf'),
  });

  // Resto con header/footer (refs desde inputs)
  const header = headerTemplate({ logoDataUri, repo: view.repo, generatedAt: view.generatedAt });
  const footer = footerTemplate({
    logoDataUri,
    baseRef: view.inputs?.baseRef || view.base.ref,
    headRef: view.inputs?.headRef || view.head.ref,
    generatedAt: view.generatedAt
  });

  const restPdf = await page.pdf({
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: header,
    footerTemplate: footer,
    margin: { top: '60px', bottom: '60px', left: '14mm', right: '14mm' },
    pageRanges: '2-',
    path: path.join(pdfDir, 'rest.tmp.pdf'),
  });

  await browser.close();

  // Unir PDFs (portada + resto) con pdf-lib
  const { PDFDocument } = require('pdf-lib');
  const coverDoc = await PDFDocument.load(await fsp.readFile(path.join(pdfDir, 'cover.tmp.pdf')));
  const restDoc  = await PDFDocument.load(await fsp.readFile(path.join(pdfDir, 'rest.tmp.pdf')));
  const out = await PDFDocument.create();
  const [coverPage] = await out.copyPages(coverDoc, [0]);
  out.addPage(coverPage);
  const restPages = await out.copyPages(restDoc, restDoc.getPageIndices());
  restPages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  const outPath = path.join(pdfDir, 'report.pdf');
  await fsp.writeFile(outPath, bytes);

  // limpiar temporales
  await Promise.allSettled([
    fsp.unlink(path.join(pdfDir, 'cover.tmp.pdf')),
    fsp.unlink(path.join(pdfDir, 'rest.tmp.pdf')),
  ]);

  console.log(`[pdf] written: ${outPath}`);
}

module.exports = { pdf_init };
