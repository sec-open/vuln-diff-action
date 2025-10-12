// src/render/pdf/pdf.js
// PDF renderer that reuses the HTML bundle but prints with a dedicated layout:
// - Clean light theme for pages (dark only on cover)
// - PDF-only dashboard (fixed grid, no overlap)
// - Fix Insights section (always built from diff.json)
// - Cover without header/footer (merge cover + rest with pdf-lib)
// - Portable Chrome install via @puppeteer/browsers (no sudo)

const core = require('@actions/core');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const { buildView } = require('../common/view');

function exists(p){ try { fs.accessSync(p); return true; } catch { return false; } }
async function ensureDir(p){ await fsp.mkdir(p, { recursive: true }); }
async function readTextSafe(p){ try { return await fsp.readFile(p,'utf8'); } catch { return ''; } }
async function writeText(p, t){ await ensureDir(path.dirname(p)); await fsp.writeFile(p, t, 'utf8'); }

// ---------- logo as data-uri ----------
async function waitForCharts(page, { timeout = 45000 } = {}) {
  // Espera a que Chart.js esté cargado y haya instancias activas en los canvas del dashboard PDF
  try {
    await page.waitForFunction(() => {
      const hasChart = !!window.Chart;
      if (!hasChart) return false;
      const ids = ['pdf-dash-state','pdf-dash-nr','pdf-dash-stacked'];
      let ok = true;
      for (const id of ids) {
        const c = document.getElementById(id);
        if (!c) { ok = false; break; }
        const inst = (Chart.getChart ? Chart.getChart(c) : (c._chartjs ? true : null));
        if (!inst || c.width === 0 || c.height === 0) { ok = false; break; }
      }
      return ok;
    }, { timeout });
    // pequeña pausa para completar render
    await page.waitForTimeout(400);
  } catch {
    // No rompas el PDF si tarda demasiado; continúa y deja las tarjetas en blanco
  }
}

async function logoToDataUri(logoInput, distDir) {
  if (!logoInput) return '';
  const u = String(logoInput).trim();
  if (/^https?:\/\//i.test(u)) return u;
  let abs = u.startsWith('/') ? u : path.resolve(distDir, u.replace(/^\.\//,''));
  if (!exists(abs)) {
    const maybe = path.resolve(distDir, 'html', u.replace(/^\.\//,'').replace(/^html\//,''));
    if (exists(maybe)) abs = maybe;
  }
  try {
    const buf = await fsp.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
      : 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

// ---------- CSS (print) ----------
function makePrintCss() {
  return `
@page { size: A4; margin: 18mm 14mm 18mm 14mm; }
* { box-sizing: border-box !important; }
html, body {
  margin:0 !important; padding:0 !important;
  background:#ffffff !important; color:#0b0f16 !important;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
}

/* Neutralize dark UI from web bundle */
body, .card, .panel, .box, .bg, .bg-slate-900, .bg-slate-800, .bg-slate-700, .chart-card {
  background:#ffffff !important; color:#0b0f16 !important;
}
/* COVER (dark) */
.cover-page {
  page-break-after: always !important;
  background:#0b0f16 !important; color:#e5e7eb !important;
  min-height:100vh; padding:24mm 18mm !important;
  position: relative;
}
.cover-top{ display:flex; justify-content:space-between; align-items:flex-start; }
.cover-brand img{ max-height:52px; }
.cover-meta{ text-align:right; color:#9ca3af; font-size:12px; }
.cover-meta-ts{ font-weight:600; }

.cover-title{ margin-top:40mm; }
.cover-title .line1{ font-size:22px; font-weight:700; margin:0 0 6px 0; }
.cover-title .line2{ font-size:18px; color:#cbd5e1; }

.cover-cards{
  position:absolute; left:18mm; right:18mm; bottom:18mm;
  display:grid; grid-template-columns:1fr 1fr; gap:12px;
}
.card-dark{
  border:1px solid #1f2937; border-radius:10px; padding:10px; background:#111827;
}
.card-dark .card-title{ font-weight:700; margin-bottom:6px; color:#e5e7eb; }
.card-dark .kv{ display:grid; grid-template-columns:110px 1fr; gap:4px 10px; font-size:13px; line-height:1.35; }

/* PAGES */
.page { page-break-before: always !important; background:#fff !important; }
.section-wrap{ padding:6mm 0 !important; }
.section-title{ font-size:20px !important; margin:0 0 8px 0 !important; }

/* Subsections (Summary) */
.subsection-title{
  font-weight:700; margin:12px 0 4px 0; padding-bottom:4px;
  border-bottom:2px solid #0b0f16;
}

/* Tables */
table{ width:100% !important; border-collapse: collapse !important; }
th,td{ text-align:left !important; padding:6px 8px !important; border-bottom:1px solid #e5e7eb !important; }
thead th{ background:#f3f4f6 !important; font-weight:600 !important; }

/* Print Dashboard — PDF-only grid */
.print-dash-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.print-dash-card{ border:1px solid #e5e7eb; border-radius:10px; padding:8px; }
.print-dash-card h4{ margin:0 0 6px 0; font-size:14px; }
.print-dash-card canvas{ width:100% !important; height:200px !important; }
.print-dash-span2{ grid-column:1 / span 2; }

/* Hide interactive elements */
#app-menu, #app-header, nav, .controls, .filters, .btn, button{ display:none !important; }

/* Links / code */
a{ color:#1d4ed8 !important; text-decoration:none !important; }
a:hover{ text-decoration:underline !important; }
code{ background:#eef2ff !important; padding:2px 6px !important; border-radius:6px !important; }
`.trim();
}

// ---------- Sections plan ----------
function sectionPlan() {
  return [
    { num: 1, id: 'introduction',      title: 'Introduction',                 file: 'overview.html' },
    { num: 2, id: 'summary',           title: 'Summary',                      file: 'summary.html' },
    { num: 3, id: 'vuln-diff-table',   title: 'Vulnerability Diff Table',     file: 'vuln-diff-table.html' },
    { num: 4, id: 'dashboard',         title: 'Dashboard',                    file: null /* PDF-only dashboard */ },
    { num: 5, id: 'dep-graph-base',    title: 'Dependency Graph — Base',      file: 'dep-graph-base.html' },
    { num: 6, id: 'dep-graph-head',    title: 'Dependency Graph — Head',      file: 'dep-graph-head.html' },
    { num: 7, id: 'dep-paths-base',    title: 'Dependency Paths — Base',      file: 'dep-paths-base.html' },
    { num: 8, id: 'dep-paths-head',    title: 'Dependency Paths — Head',      file: 'dep-paths-head.html' },
    { num: 9, id: 'fix-insights',      title: 'Fix Insights',                 file: null /* always built */ },
  ];
}

// ---------- HTML helpers ----------
function coverHtml({ repo, base, head, generatedAt, logoDataUri }) {
  return `
<section class="cover-page" id="cover">
  <div class="cover-top">
    <div class="cover-brand">
      ${logoDataUri ? `<img src="${logoDataUri}" alt="Logo"/>` : ''}
    </div>
    <div class="cover-meta">
      <div>Generated at</div>
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
      <div class="kv">
        <div>Ref</div><div>${base.ref}</div>
        <div>Commit</div><div>${base.shaShort}<br/>(${base.sha})</div>
        <div>Author</div><div>${base.author}</div>
        <div>Authored at</div><div>${base.authoredAt}</div>
        <div>Subject</div><div>${base.commitSubject}</div>
      </div>
    </div>
    <div class="card-dark">
      <div class="card-title">Head</div>
      <div class="kv">
        <div>Ref</div><div>${head.ref}</div>
        <div>Commit</div><div>${head.shaShort}<br/>(${head.sha})</div>
        <div>Author</div><div>${head.author}</div>
        <div>Authored at</div><div>${head.authoredAt}</div>
        <div>Subject</div><div>${head.commitSubject}</div>
      </div>
    </div>
  </div>
</section>
`.trim();
}

function tocHtml(repo) {
  const items = sectionPlan().map(s => `<li><a href="#${s.id}">${s.title}</a></li>`).join('');
  return `
<section class="page toc" id="table-of-contents">
  <div class="section-wrap">
    <h2 class="section-title">Table of Contents — ${repo}</h2>
    <ol>${items}</ol>
  </div>
</section>
`.trim();
}
function sectionWrapper({ id, title, num, innerHtml }) {
  return `
<section class="page" id="${id}">
  <div class="section-wrap">
    <h2 class="section-title">${num}. ${title}</h2>
    ${innerHtml || '<div class="small">[empty]</div>'}
  </div>
</section>
`.trim();
}

// ---------- Load diff.json ----------
async function loadDiff(distDir) {
  const p = path.join(distDir, 'diff.json');
  try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return null; }
}
const pkgStr = (p) => p ? `${p.groupId ? p.groupId + ':' : ''}${p.artifactId || ''}${p.version ? ':' + p.version : ''}` : '—';

// ---------- Fallback: Vulnerability Diff Table ----------
async function buildVulnTableFromJson(distDir) {
  const diff = await loadDiff(distDir);
  if (!diff || !Array.isArray(diff.items)) return '<div class="small">[diff.json not found or empty]</div>';
  const rows = diff.items.map(o => {
    const sev = o.severity || 'UNKNOWN';
    const url = o.urls && o.urls[0] ? o.urls[0] : '';
    const id = url ? `<a href="${url}">${o.id}</a>` : o.id;
    return `<tr><td>${sev}</td><td>${id}</td><td>${pkgStr(o.package)}</td><td>${o.state || '—'}</td></tr>`;
  }).join('');
  return `
<table>
  <thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Status</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
`.trim();
}

// ---------- PDF-only Dashboard ----------
function computeDashData(items) {
  const states = ['NEW','REMOVED','UNCHANGED'];
  const severities = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
  const stateTotals = states.map(s => items.filter(x => x.state === s).length);
  const newVsRemoved = severities.map(sev => ({
    sev,
    NEW: items.filter(x => x.state==='NEW' && (x.severity||'UNKNOWN')===sev).length,
    REMOVED: items.filter(x => x.state==='REMOVED' && (x.severity||'UNKNOWN')===sev).length
  }));
  const stacked = severities.map(sev => ({
    sev,
    NEW: items.filter(x => x.state==='NEW' && (x.severity||'UNKNOWN')===sev).length,
    REMOVED: items.filter(x => x.state==='REMOVED' && (x.severity||'UNKNOWN')===sev).length,
    UNCHANGED: items.filter(x => x.state==='UNCHANGED' && (x.severity||'UNKNOWN')===sev).length
  }));
  return { states, severities, stateTotals, newVsRemoved, stacked };
}
function buildPdfDashboardHtml(dash) {
  return `
<div class="print-dash-grid">
  <div class="print-dash-card">
    <h4>Distribution by State</h4>
    <canvas id="pdf-dash-state"></canvas>
  </div>
  <div class="print-dash-card">
    <h4>NEW vs REMOVED by Severity</h4>
    <canvas id="pdf-dash-nr"></canvas>
  </div>
  <div class="print-dash-card print-dash-span2">
    <h4>By Severity & State (stacked)</h4>
    <canvas id="pdf-dash-stacked"></canvas>
  </div>
</div>
<script>
(function(){
  if (!window.Chart) return;
  var d = ${JSON.stringify(dash)};
  function mk(id, cfg){ var el=document.getElementById(id); if(!el) return; try{ new Chart(el, cfg); }catch(e){} }
  mk('pdf-dash-state', {
    type:'pie',
    data:{ labels:d.states, datasets:[{ data:d.stateTotals }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } }
  });
  mk('pdf-dash-nr', {
    type:'bar',
    data:{
      labels:d.severities,
      datasets:[
        { label:'NEW', data:d.newVsRemoved.map(x=>x.NEW) },
        { label:'REMOVED', data:d.newVsRemoved.map(x=>x.REMOVED) }
      ]
    },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' } }, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 }}} }
  });
  mk('pdf-dash-stacked', {
    type:'bar',
    data:{
      labels:d.severities,
      datasets:[
        { label:'NEW', data:d.stacked.map(x=>x.NEW) },
        { label:'REMOVED', data:d.stacked.map(x=>x.REMOVED) },
        { label:'UNCHANGED', data:d.stacked.map(x=>x.UNCHANGED) }
      ]
    },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' } }, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true, ticks:{ precision:0 }}} }
  });
})();
</script>
`.trim();
}

// ---------- Fix Insights (always built) ----------
async function buildFixInsightsFromJson(distDir) {
  const diff = await loadDiff(distDir);
  if (!diff || !Array.isArray(diff.items)) return '<div class="small">[diff.json not found or empty]</div>';

  const withFixAll = diff.items.filter(x => x.fix && x.fix.state === 'fixed');

  const groupByState = (arr) => {
    const g = { NEW:[], REMOVED:[], UNCHANGED:[] };
    for (const o of arr) (g[o.state] || (g[o.state]=[])).push(o);
    return g;
  };
  const G = groupByState(withFixAll);

  const mkRows = (arr) => arr.map(o=>{
    const url = o.urls && o.urls[0] ? o.urls[0] : '';
    const id = url ? `<a href="${url}">${o.id}</a>` : o.id;
    const tgt = o.fix && o.fix.versions && o.fix.versions[0] ? o.fix.versions[0] : '—';
    return `<tr><td>${o.severity||'UNKNOWN'}</td><td>${id}</td><td>${pkgStr(o.package)}</td><td>${o.state}</td><td>${tgt}</td></tr>`;
  }).join('');

  const section = (title, arr) => `
  <div class="subsection-title">${title}</div>
  <table>
    <thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>State</th><th>Target Version</th></tr></thead>
    <tbody>${mkRows(arr)}</tbody>
  </table>`.trim();

  return `
<div class="subsection-title">Overview</div>
<p class="small">Vulnerabilities with available fixes: <strong>${withFixAll.length}</strong> (NEW: ${G.NEW.length} · REMOVED: ${G.REMOVED.length} · UNCHANGED: ${G.UNCHANGED.length})</p>

${section('All with fix', withFixAll)}
`.trim();
}

// ---------- Assemble print.html ----------
async function buildPrintHtml({ distDir, view, logoDataUri }) {
  const htmlRoot = path.join(distDir,'html');
  const sectionsDir = path.join(htmlRoot,'sections');
  const vendor = path.join(htmlRoot,'assets','js','vendor');
  const chartTag   = exists(path.join(vendor,'chart.umd.js'))   ? `<script src="../html/assets/js/vendor/chart.umd.js"></script>` : '';
  const mermaidTag = exists(path.join(vendor,'mermaid.min.js')) ? `<script src="../html/assets/js/vendor/mermaid.min.js"></script>` : '';

  // Cover + ToC
  let out = coverHtml({ repo:view.repo, base:view.base, head:view.head, generatedAt:view.generatedAt, logoDataUri });
  out += '\n' + tocHtml(view.repo);

  const diff = await loadDiff(distDir);
  const items = diff?.items || [];

  for (const s of sectionPlan()) {
    let inner = '';
    if (s.id === 'dashboard') {
      const dash = computeDashData(items);
      inner = buildPdfDashboardHtml(dash);
    } else if (s.id === 'vuln-diff-table') {
      const file = path.join(sectionsDir, 'vuln-diff-table.html');
      const raw = await readTextSafe(file);
      const hasRows = /<tbody[^>]*>[\s\S]*?<tr[\s>]/i.test(raw);
      inner = (raw && hasRows) ? raw : await buildVulnTableFromJson(distDir);
    } else if (s.id === 'fix-insights') {
      inner = await buildFixInsightsFromJson(distDir);
    } else {
      const file = s.file ? path.join(sectionsDir, s.file) : null;
      inner = file ? await readTextSafe(file) : '';
      // Improve Summary subsections
      if (s.id === 'summary') {
        inner = inner
          .replace(/<h3>\s*Tools\s*<\/h3>/i, '<h3 class="subsection-title">Tools</h3>')
          .replace(/<h3>\s*Inputs\s*<\/h3>/i, '<h3 class="subsection-title">Inputs</h3>')
          .replace(/<h3>\s*Base\s*<\/h3>/i, '<h3 class="subsection-title">Base</h3>')
          .replace(/<h3>\s*Head\s*<\/h3>/i, '<h3 class="subsection-title">Head</h3>');
      }
    }
    out += '\n' + sectionWrapper({ id:s.id, title:s.title, num:s.num, innerHtml: inner });
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Vulnerability Diff Report — ${view.repo}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="./assets/print.css" />
</head>
<body>
${out}
${chartTag}
${mermaidTag}
</body>
</html>`;
}

// ---------- Portable Chrome ----------
async function ensurePortableChrome(cacheDir) {
  const { install, computeExecutablePath } = require('@puppeteer/browsers');
  const platformMap = { linux:'linux', darwin:(os.arch()==='arm64'?'mac-arm':'mac'), win32:'win64' };
  const platform = platformMap[os.platform()];
  if (!platform) throw new Error(`Unsupported platform: ${os.platform()}`);
  const buildId = 'stable';
  await install({ browser:'chrome', buildId, cacheDir, platform });
  return computeExecutablePath({ browser:'chrome', cacheDir, platform, buildId });
}
function knownBrowserCandidates() {
  return [
    process.env.CHROMIUM_PATH || '',
    '/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
  ].filter(Boolean);
}
async function resolveBrowserExecutable(outDir){
  for (const p of knownBrowserCandidates()) if (exists(p)) return p;
  const cacheDir = path.join(outDir,'.browsers'); await ensureDir(cacheDir);
  core.info('[render/pdf] no system browser found; downloading Chrome (stable) locally…');
  return await ensurePortableChrome(cacheDir);
}

// ---------- Header/Footer (with band + border) ----------
function headerTemplate({ logoDataUri, repo, generatedAt }) {
  return `
<style>
  .hdrbar{
    background:#0b0f16; color:#e5e7eb; width:100%;
    padding:6px 10px; border-bottom:1px solid #111827;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    font-size:10px;
  }
  .row{ display:flex; align-items:center; justify-content:space-between; }
  .brand{ display:flex; align-items:center; gap:6px; font-weight:600; }
  .brand img{ height:14px; display:inline-block; }
  .muted{ color:#cbd5e1; font-weight:500; }
</style>
<div class="hdrbar">
  <div class="row">
    <div class="brand">${logoDataUri ? `<img src="${logoDataUri}" />` : ''}<span>Vulnerability Diff Report</span><span class="muted">— ${repo}</span></div>
    <div class="muted">${generatedAt}</div>
  </div>
</div>`.trim();
}
function footerTemplate({ logoDataUri, baseRef, headRef, generatedAt }) {
  return `
<style>
  .ftrbar{
    background:#0b0f16; color:#e5e7eb; width:100%;
    padding:6px 10px; border-top:1px solid #111827;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    font-size:10px;
  }
  .row{ display:flex; align-items:center; justify-content:space-between; }
  .brand{ display:flex; align-items:center; gap:6px; font-weight:600; }
  .brand img{ height:14px; display:inline-block; }
  .muted{ color:#cbd5e1; font-weight:500; }
  .page{ color:#cbd5e1; }
</style>
<div class="ftrbar">
  <div class="row">
    <div class="brand">${logoDataUri ? `<img src="${logoDataUri}" />` : ''}<span>Vulnerability Diff Report</span><span class="muted">— BASE: ${baseRef} → HEAD: ${headRef}</span></div>
    <div class="muted">${generatedAt} — <span class="page"><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>
  </div>
</div>`.trim();
}

// ---------- Entry ----------
async function pdf_init({ distDir = './dist' } = {}) {
  core.startGroup('[render] PDF');
  try {
    const view = buildView(distDir);
    const outDir = path.join(path.resolve(distDir), 'pdf');
    const assetsDir = path.join(outDir, 'assets');
    await ensureDir(outDir); await ensureDir(assetsDir);

    // CSS
    await writeText(path.join(assetsDir,'print.css'), makePrintCss());

    // Logo
    const logoInput = core.getInput('html_logo_url') || '';
    const logoDataUri = await logoToDataUri(logoInput, path.resolve(distDir));

    // Assemble HTML (includes PDF-only dashboard & Fix Insights)
    const html = await buildPrintHtml({ distDir: path.resolve(distDir), view, logoDataUri });
    const htmlPath = path.join(outDir, 'print.html');
    await writeText(htmlPath, html);

    // Browser
    let pptr; try { pptr = require('puppeteer-core'); }
    catch { throw new Error('puppeteer-core is not installed. Please add "puppeteer-core" to your dependencies.'); }
    const executablePath = await resolveBrowserExecutable(outDir);
    const browser = await pptr.launch({ headless: 'new', executablePath, args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });

    // Export cover only (no header/footer)
    const coverPdf = path.join(outDir, 'cover.pdf');
    await waitForCharts(page);
    await page.pdf({ path: coverPdf, printBackground: true, displayHeaderFooter: false, margin:{top:'0mm',right:'0mm',bottom:'0mm',left:'0mm'}, format:'A4', pageRanges:'1' });

    // Export rest with header/footer (band + border; logo in data-uri)
    const restPdf = path.join(outDir, 'rest.pdf');
    await page.pdf({
      path: restPdf,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplate({ logoDataUri, repo: view.repo, generatedAt: view.generatedAt }),
      footerTemplate: footerTemplate({ logoDataUri, baseRef: view.base.ref, headRef: view.head.ref, generatedAt: view.generatedAt }),
      margin: { top:'20mm', right:'14mm', bottom:'16mm', left:'14mm' },
      format: 'A4',
      pageRanges: '2-'
    });

    await browser.close();

    // Merge cover + rest
    const finalPdf = path.join(outDir, 'report.pdf');
    const coverDoc = await PDFDocument.load(await fsp.readFile(coverPdf));
    const restDoc  = await PDFDocument.load(await fsp.readFile(restPdf));
    const dest = await PDFDocument.create();
    const [c] = await dest.copyPages(coverDoc,[0]); dest.addPage(c);
    const rp = await dest.copyPages(restDoc, restDoc.getPageIndices()); rp.forEach(p=>dest.addPage(p));
    await fsp.writeFile(finalPdf, await dest.save());

    core.info(`[render/pdf] exported: ${finalPdf}`);
  } catch (e) {
    core.setFailed(`[render] PDF failed: ${e?.message || e}`);
    throw e;
  } finally { core.endGroup(); }
}

module.exports = { pdf_init };
