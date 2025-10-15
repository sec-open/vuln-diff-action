/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { fileURLToPath } = require('url');
const { buildView } = require('../common/view');
const { renderPdf } = require('./utils/exporter');
const { coverHtml } = require('./sections/cover');
const { makePrintCss } = require('./print.css'); // js
const { headerTemplate, footerTemplate, getLogoDataUri } = require('./sections/headerFooter');
const { tocHtml } = require('./sections/toc');
const { introHtml } = require('./sections/introduction');
const { buildResultsTablesHtml } = require('./sections/results');
const { summaryHtml } = require('./sections/summary');

const core = require('@actions/core');

// -------------------------------------------------------------
// Utils
// -------------------------------------------------------------
function stripVendorScripts(html = '') {
  // Elimina cualquier <script ... chart.umd.js> o <script ... mermaid*.js> embebido en secciones HTML
  return String(html)
    .replace(/<script[^>]+chart\.umd\.js[^>]*><\/script>/ig, '')
    .replace(/<script[^>]+mermaid(\.min)?\.js[^>]*><\/script>/ig, '');
}

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
  // Datos a usar por el script inline (serializamos lo mínimo)
  const dataJson = JSON.stringify({
    stateTotals: dash?.stateTotals || [],
    newVsRemoved: dash?.newVsRemoved || [],
    stacked: dash?.stacked || [],
  });

  // Tablas numéricas
  const states = ['NEW','REMOVED','UNCHANGED'];
  const stateTotalsRows = states.map((s, i) => {
    const v = (dash?.stateTotals && dash.stateTotals[i]) || 0;
    return `<tr><td>${s}</td><td>${v}</td></tr>`;
  }).join('');
  const stateTotalsTable = `
    <table>
      <thead><tr><th>State</th><th>Count</th></tr></thead>
      <tbody>${stateTotalsRows}</tbody>
    </table>
  `.trim();

  const nvrHeader = `<thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th></tr></thead>`;
  const nvrRows = (dash?.newVsRemoved || []).map(row => {
    const n = row.NEW || 0, r = row.REMOVED || 0;
    return `<tr><td>${row.sev}</td><td>${n}</td><td>${r}</td></tr>`;
  }).join('');
  const nvrTable = `<table>${nvrHeader}<tbody>${nvrRows}</tbody></table>`;

  const stkHeader = `<thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>`;
  const stkRows = (dash?.stacked || []).map(row => {
    const n = row.NEW || 0, r = row.REMOVED || 0, u = row.UNCHANGED || 0;
    return `<tr><td>${row.sev}</td><td>${n}</td><td>${r}</td><td>${u}</td></tr>`;
  }).join('');
  const stkTable = `<table>${stkHeader}<tbody>${stkRows}</tbody></table>`;

  // Per-module numeric tables (si tu precompute las expone así)
  let moduleTablesHtml = '';
  const byMod = view?.precomputed?.aggregates?.by_module_severity_state || {};
  const sevOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
  const sevOrderArr = Object.keys(sevOrder).sort((a,b)=>sevOrder[b]-sevOrder[a]);
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
        if (typeof Chart === 'undefined') {
          // Si no hay Chart.js, marcamos listo igualmente
          window.__chartsReady = true;
          window.__mermaidReady = true;
          return;
        }

        // Chart 1: Distribution by State
        try {
          var ctx1 = document.getElementById('chart-state-totals').getContext('2d');
          new Chart(ctx1, {
            type: 'bar',
            data: { labels: ['NEW','REMOVED','UNCHANGED'], datasets: [{ label: 'Count', data: DASH.stateTotals }] },
            options: { responsive:false, animation:false }
          });
        } catch(e){}

        // Chart 2: NEW vs REMOVED by Severity
        try {
          var labels2 = (DASH.newVsRemoved || []).map(function(x){ return x.sev; });
          var dataNew = (DASH.newVsRemoved || []).map(function(x){ return x.NEW || 0; });
          var dataRemoved = (DASH.newVsRemoved || []).map(function(x){ return x.REMOVED || 0; });
          var ctx2 = document.getElementById('chart-new-removed').getContext('2d');
          new Chart(ctx2, {
            type: 'bar',
            data: { labels: labels2, datasets: [{ label:'NEW', data:dataNew }, { label:'REMOVED', data:dataRemoved }] },
            options: { responsive:false, animation:false }
          });
        } catch(e){}

        // Chart 3: By Severity & State (stacked)
        try {
          var labels3 = (DASH.stacked || []).map(function(x){ return x.sev; });
          var dNew = (DASH.stacked || []).map(function(x){ return x.NEW || 0; });
          var dRem = (DASH.stacked || []).map(function(x){ return x.REMOVED || 0; });
          var dUnc = (DASH.stacked || []).map(function(x){ return x.UNCHANGED || 0; });
          var ctx3 = document.getElementById('chart-stacked').getContext('2d');
          new Chart(ctx3, {
            type: 'bar',
            data: { labels: labels3, datasets: [{ label:'NEW', data:dNew }, { label:'REMOVED', data:dRem }, { label:'UNCHANGED', data:dUnc }] },
            options: {
              responsive:false, animation:false,
              plugins:{ legend:{ position:'top' } },
              scales:{ x:{ stacked:true }, y:{ stacked:true } }
            }
          });
        } catch(e){}

        // Señales para el exportador
        setTimeout(function(){
          window.__chartsReady = true;
          window.__mermaidReady = true;
        }, 50);
      } catch(e){
        window.__chartsReady = true;
        window.__mermaidReady = true;
      }
    }

    if (typeof Chart !== 'undefined') {
      ready();
    } else {
      // Espera muy corta si Chart.js se inyecta en <head> con document.write
      var t = setInterval(function(){
        if (typeof Chart !== 'undefined') { clearInterval(t); ready(); }
      }, 50);
      setTimeout(function(){ clearInterval(t); window.__chartsReady = true; window.__mermaidReady = true; }, 5000);
    }
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
// -------------------------------------------------------------
// HTML completo para imprimir
// -------------------------------------------------------------
// -------------------------------------------------------------
// HTML completo para imprimir (reemplazo)
// -------------------------------------------------------------
async function buildPrintHtml({ distDir, view, inputs, logoDataUri }) {
  const htmlRoot = path.join(distDir, 'html');
  const sectionsDir = path.join(htmlRoot, 'sections');

  const vendorChartPath = path.join(htmlRoot, 'assets', 'js', 'vendor', 'chart.umd.js');
  const vendorMermaidPath = path.join(htmlRoot, 'assets', 'js', 'vendor', 'mermaid.min.js');
  const chartTag = exists(vendorChartPath) ? `<script src="file://${vendorChartPath}"></script>` : '';
  const mermaidTag = exists(vendorMermaidPath) ? `<script src="file://${vendorMermaidPath}"></script>` : '';

  let bodyInner = '';
  bodyInner += coverHtml({ repo: view?.repo, base: view?.base, head: view?.head, inputs: inputs || {}, generatedAt: view?.generatedAt, logoDataUri });

  bodyInner += '\n' + tocHtml();

  bodyInner += '\n' + introHtml(view);

  bodyInner += '\n' + summaryHtml(view);

  bodyInner += '\n' + (await buildResultsTablesHtml(distDir));

  const diff = await loadDiff(distDir);
  const dash = computeDashData((diff && Array.isArray(diff.items)) ? diff.items : []);
  let dashboardHtml = buildPdfDashboardHtml(dash, view);
  dashboardHtml += `${chartTag}${mermaidTag}`;
  bodyInner += '\n' + sectionWrapper({ id: 'dashboard', title: '4. Dashboard', num: 4, innerHtml: dashboardHtml });

  for (const s of sectionPlan().filter(x => x.id === 'dep-graph-base' || x.id === 'dep-graph-head')) {
    const file = s.file ? path.join(sectionsDir, s.file) : null;
    const inner = file ? await readTextSafe(file) : '';
    bodyInner += '\n' + sectionWrapper({ id: s.id, title: s.title, num: s.num, innerHtml: inner });
  }

  const items = Array.isArray(diff?.items) ? diff.items : [];
  const depBase = buildDependencyPathsSection(items, 'base');
  const depHead = buildDependencyPathsSection(items, 'head');
  bodyInner += '\n' + sectionWrapper({ id: 'dep-paths-base', title: '7. Dependency Paths — Base', num: 7, innerHtml: depBase });
  bodyInner += '\n' + sectionWrapper({ id: 'dep-paths-head', title: '8. Dependency Paths — Head', num: 8, innerHtml: depHead });

  if (exists(path.join(sectionsDir, 'fix-insights.html'))) {
    const fixHtml = await readTextSafe(path.join(sectionsDir, 'fix-insights.html'));
    bodyInner += '\n' + sectionWrapper({ id: 'fix-insights', title: '9. Fix Insights', num: 9, innerHtml: fixHtml });
  }

  const css = makePrintCss();
  const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Vulnerability Diff Report — ${view?.repo || ''}</title>
<style>${css}</style>
</head>
<body>
${bodyInner}
<script>document.documentElement.lang='en';</script>
</body>
</html>`.trim();

  return html;
}


async function pdf_init({ distDir = './dist', html_logo_url = '' } = {}) {
  console.log('[pdf/orch] start');
  const absDist = path.resolve(distDir);
  const pdfDir = path.join(absDist, 'pdf');
  const assetsDir = path.join(pdfDir, 'assets');
  await fsp.mkdir(assetsDir, { recursive: true });

  // Genera CSS de impresión en disco (ruta existente: ./dist/pdf/assets/print.css)
  await fsp.writeFile(path.join(assetsDir, 'print.css'), makePrintCss(), 'utf8');

  // View (Fase-3)
  // View (Fase-3)
  const view = buildView(absDist);
    if (!view) {
      console.error('[pdf/orch] buildView returned null/undefined');
    }
  // Inputs + logo (data URI)
  const inputs = (view && view.inputs) ? view.inputs : {};

  // lee el input del Action (y fallbacks), NO viene en view.inputs
  const logoSource =
    core.getInput('html_logo_url') ||           // ← LA CLAVE
    inputs.html_logo_url || inputs.htmlLogoUrl || // por si en el futuro lo añades al view
    process.env.INPUT_HTML_LOGO_URL ||          // GH Actions expone los "with:" como env
    '';

  const logoDataUri = await getLogoDataUri(logoSource, distDir);
  if (!logoDataUri) console.warn('[pdf/inputs] logoDataUri is empty (logo may be missing in cover/header/footer)');



  // HTML completo para imprimir
  const html = await buildPrintHtml({ distDir: absDist, view, inputs, logoDataUri });
  const printHtmlPath = path.join(pdfDir, 'print.html');
  await fsp.writeFile(printHtmlPath, html, 'utf8');

  // Exportación a PDF
  try {
    await renderPdf({
      printHtmlPath,
      pdfDir,
      headerHtml: headerTemplate({
        logoDataUri,
        repo: view?.repo,
        generatedAt: view?.generatedAt
      }),
      footerHtml: footerTemplate({
        logoDataUri,
        baseRef: inputs.baseRef || view?.base?.ref,
        headRef: inputs.headRef || view?.head?.ref,
        generatedAt: view?.generatedAt
      }),
      marginTop: '60px',
      marginBottom: '60px',
      marginLeft: '14mm',
      marginRight: '14mm',
      gotoTimeoutMs: 120000,
      visualsTimeoutMs: 60000
    });
    console.log('[pdf/orch] done');
  } catch (e) {
    console.error('[pdf/orch] renderPdf failed:', e && e.message ? e.message : e);
    throw new Error(`[vuln-diff] Render failed in pdf_init: ${e && e.message ? e.message : e}`);
  }
}


module.exports = { pdf_init };
