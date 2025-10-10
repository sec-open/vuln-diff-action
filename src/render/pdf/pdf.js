// src/render/pdf/pdf.js
// Build PDF reusing the already-built HTML bundle (no changes to HTML).
// - Cover (dark, no header/footer), ToC, sections (light)
// - Strong print CSS to neutralize dark theme in fragments
// - Fallback builders: vuln-diff-table, fix-insights (from dist/diff.json)
// - Charts/mermaid re-rendered with fixed heights
// - Portable Chrome download if none available (no sudo)
// - Final PDF = cover.pdf (page 1, no header/footer) + rest.pdf (2..N with header/footer) merged via pdf-lib

const actionsCore = require('@actions/core');
const fsp = require('fs/promises');
const fs = require('fs');
const pth = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const { buildView } = require('../common/view');

async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); }
async function readTextSafe(file) { try { return await fsp.readFile(file, 'utf8'); } catch { return ''; } }
async function writeText(file, text) { await ensureDir(pth.dirname(file)); await fsp.writeFile(file, text, 'utf8'); }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

async function logoToDataUri(logoInput, distDir) {
  if (!logoInput) return '';
  const u = String(logoInput).trim();
  if (/^https?:\/\//i.test(u)) return u;
  let abs = u.startsWith('/') ? u : pth.resolve(distDir, u.replace(/^\.\//, ''));
  if (!exists(abs)) {
    const maybe = pth.resolve(distDir, 'html', u.replace(/^\.\//, '').replace(/^html\//, ''));
    if (exists(maybe)) abs = maybe;
  }
  try {
    const buf = await fsp.readFile(abs);
    const ext = pth.extname(abs).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

function makePrintCss() {
  return `
@page { size: A4; margin: 18mm 14mm 18mm 14mm; }
* { box-sizing: border-box !important; }

html, body {
  margin:0 !important; padding:0 !important;
  background:#ffffff !important; color:#0b0f16 !important;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
}

/* Neutralize dark backgrounds from fragments */
body, .card, .panel, .box, .app-panel, .bg, .bg-dark, .bg-slate, .bg-slate-900, .bg-slate-800, .bg-slate-700,
.section, .content, .container, .grid, .grid > *, .chart-card {
  background: #ffffff !important; color: #0b0f16 !important;
}

/* ---------- COVER (DARK) ---------- */
.cover-page {
  page-break-after: always !important;
  color:#e5e7eb !important; background:#0b0f16 !important;
  min-height: 100vh; padding: 24mm 18mm !important;
}
.cover-title-block { margin-bottom: 16mm !important; }
.cover-logo-line { display:flex; align-items:center; gap:12px; }
.cover-logo-line img { max-height: 48px; }
.cover-line-1 { font-size: 28px !important; font-weight: 700 !important; }
.cover-line-2 { font-size: 22px !important; margin-top: 6px !important; color:#cbd5e1 !important; }
.cover-side { color:#9ca3af !important; font-size: 12px !important; }
.columns-2 { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card-dark { border:1px solid #1f2937; border-radius:10px; padding:10px; background:#111827; }
.card-dark .kv { display:grid; grid-template-columns: 110px 1fr; gap:4px 10px; font-size:13px; line-height: 1.35; }
.card-dark h3 { margin-bottom:6px; color:#e5e7eb !important; }

/* ---------- REGULAR PAGES (LIGHT) ---------- */
.page { page-break-before: always !important; background:#ffffff !important; }
.section-wrap { padding: 6mm 0 !important; }
.section-title { font-size: 20px !important; margin: 0 0 8px 0 !important; }

/* TOC */
.toc ol { margin: 0 0 0 18px !important; padding: 0 !important; }
.toc li { margin: 6px 0 !important; }

/* Subsection titles inside Summary */
.subsection-title {
  font-weight: 700; margin: 12px 0 4px 0; padding-bottom: 4px;
  border-bottom: 2px solid #0b0f16;
}

/* Tables */
table { width:100% !important; border-collapse: collapse !important; }
th, td { text-align: left !important; padding: 6px 8px !important; border-bottom: 1px solid #e5e7eb !important; }
thead th { background:#f3f4f6 !important; font-weight:600 !important; }

/* Hide interactive-only elements from fragments */
#app-menu, #app-header, nav, .controls, .filters, .btn, button { display: none !important; }

/* Charts layout in print */
.chart-card, .chart-wrap, canvas { width:100% !important; height:220px !important; }
.chart-card { margin-bottom: 10px !important; border: 1px solid #e5e7eb !important; border-radius: 10px !important; padding: 8px !important; background:#ffffff !important; }

/* Dependency Paths: hide "#Paths" (4th column) to avoid width issues */
#dep-paths-base table thead th:nth-child(4),
#dep-paths-base table tbody td:nth-child(4),
#dep-paths-head table thead th:nth-child(4),
#dep-paths-head table tbody td:nth-child(4) { display:none !important; }

/* Code / links */
code { background:#eef2ff !important; padding:2px 6px !important; border-radius:6px !important; }
a { color:#1d4ed8 !important; text-decoration:none !important; }
a:hover { text-decoration:underline !important; }
  `.trim();
}

function sectionPlan() {
  return [
    { num: 1, id: 'introduction',      title: 'Introduction',                 file: 'overview.html' },
    { num: 2, id: 'summary',           title: 'Summary',                      file: 'summary.html' },
    { num: 3, id: 'vuln-diff-table',   title: 'Vulnerability Diff Table',     file: 'vuln-diff-table.html' },
    { num: 4, id: 'dashboard',         title: 'Dashboard',                    file: 'dashboard.html' },
    { num: 5, id: 'dep-graph-base',    title: 'Dependency Graph — Base',      file: 'dep-graph-base.html' },
    { num: 6, id: 'dep-graph-head',    title: 'Dependency Graph — Head',      file: 'dep-graph-head.html' },
    { num: 7, id: 'dep-paths-base',    title: 'Dependency Paths — Base',      file: 'dep-paths-base.html' },
    { num: 8, id: 'dep-paths-head',    title: 'Dependency Paths — Head',      file: 'dep-paths-head.html' },
    { num: 9, id: 'fix-insights',      title: 'Fix Insights',                 file: 'fix-insights.html' },
  ];
}

function coverHtml({ repo, base, head, generatedAt, logoDataUri }) {
  return `
<section class="cover-page" id="cover">
  <div class="cover-title-block" style="display:flex; align-items:flex-start; justify-content:space-between;">
    <div>
      <div class="cover-logo-line">${logoDataUri ? `<img src="${logoDataUri}" alt="Logo"/>` : ''}</div>
      <div class="cover-line-1">Vulnerability Diff Report</div>
      <div class="cover-line-2">${repo}</div>
    </div>
    <div class="cover-side">Generated at<br/><strong>${generatedAt}</strong></div>
  </div>
  <div class="columns-2">
    <div class="card-dark">
      <h3>Base</h3>
      <div class="kv">
        <div>Ref</div><div>${base.ref}</div>
        <div>Commit</div><div>${base.shaShort} (${base.sha})</div>
        <div>Author</div><div>${base.author}</div>
        <div>Authored at</div><div>${base.authoredAt}</div>
        <div>Subject</div><div>${base.commitSubject}</div>
      </div>
    </div>
    <div class="card-dark">
      <h3>Head</h3>
      <div class="kv">
        <div>Ref</div><div>${head.ref}</div>
        <div>Commit</div><div>${head.shaShort} (${head.sha})</div>
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

function sectionWrapperHtml({ id, title, num, innerHtml }) {
  return `
<section class="page" id="${id}">
  <div class="section-wrap">
    <h2 class="section-title">${num}. ${title}</h2>
    ${innerHtml || '<div class="small">[empty]</div>'}
  </div>
</section>
`.trim();
}

// -------- Fallbacks from dist/diff.json --------
async function loadDiff(distDir) {
  const p = pth.join(distDir, 'diff.json');
  try { return JSON.parse(await fsp.readFile(p, 'utf8')); }
  catch { return null; }
}

function formatPkg(pkg) {
  if (!pkg) return '—';
  const g = pkg.groupId || '';
  const a = pkg.artifactId || '';
  const v = pkg.version || '';
  return `${g ? g + ':' : ''}${a}${v ? ':' + v : ''}` || '—';
}

async function buildDiffTableFromJson(distDir) {
  const diff = await loadDiff(distDir);
  if (!diff || !Array.isArray(diff.items)) {
    return '<div class="small">[diff.json not found or empty]</div>';
  }
  const rows = diff.items.map(o => {
    const sev = o.severity || 'UNKNOWN';
    const vuln = o.id || '—';
    const pkg = formatPkg(o.package);
    const state = o.state || '—';
    const url = (Array.isArray(o.urls) && o.urls[0]) ? o.urls[0] : '';
    const vulnCell = url ? `<a href="${url}">${vuln}</a>` : vuln;
    return `<tr><td>${sev}</td><td>${vulnCell}</td><td>${pkg}</td><td>${state}</td></tr>`;
  }).join('');
  return `
<table>
  <thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Status</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
`.trim();
}

async function buildFixInsightsFromJson(distDir) {
  const diff = await loadDiff(distDir);
  if (!diff || !Array.isArray(diff.items)) {
    return '<div class="small">[diff.json not found or empty]</div>';
  }
  const newItems = diff.items.filter(x => x.state === 'NEW');
  const withFix = newItems.filter(x => x.fix && x.fix.state === 'fixed');
  const withoutFix = newItems.filter(x => !x.fix || x.fix.state !== 'fixed');

  const mkRows = arr => arr.slice(0, 50).map(o => {
    const pkg = formatPkg(o.package);
    const url = (o.urls && o.urls[0]) ? o.urls[0] : '';
    const vuln = url ? `<a href="${url}">${o.id}</a>` : o.id;
    const tgt = (o.fix && o.fix.versions && o.fix.versions[0]) ? o.fix.versions[0] : '—';
    return `<tr><td>${o.severity || 'UNKNOWN'}</td><td>${vuln}</td><td>${pkg}</td><td>${tgt}</td></tr>`;
  }).join('');

  return `
<div class="subsection-title">Overview</div>
<p class="small">NEW items: <strong>${newItems.length}</strong> — with fix: <strong>${withFix.length}</strong> · without fix: <strong>${withoutFix.length}</strong></p>

<div class="subsection-title">NEW with available fix (top 50)</div>
<table>
  <thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Target Version</th></tr></thead>
  <tbody>${mkRows(withFix)}</tbody>
</table>

<div class="subsection-title">NEW without fix (top 50)</div>
<table>
  <thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Target Version</th></tr></thead>
  <tbody>${mkRows(withoutFix)}</tbody>
</table>
`.trim();
}

// -------- Assemble print.html --------
async function buildPrintHtml({ distDir, view, logoDataUri }) {
  const htmlRoot = pth.join(distDir, 'html');
  const sectionsDir = pth.join(htmlRoot, 'sections');
  const assetsVendor = pth.join(htmlRoot, 'assets', 'js', 'vendor');

  const dashDataPath = pth.join(sectionsDir, 'dashboard-data.json');
  let dashPayloadJs = '';
  try { dashPayloadJs = `<script>window.__DASHBOARD_DATA__=${await fsp.readFile(dashDataPath, 'utf8')}</script>`; }
  catch { dashPayloadJs = ''; }

  const chartTag   = exists(pth.join(assetsVendor, 'chart.umd.js'))   ? `<script src="../html/assets/js/vendor/chart.umd.js"></script>` : '';
  const mermaidTag = exists(pth.join(assetsVendor, 'mermaid.min.js')) ? `<script src="../html/assets/js/vendor/mermaid.min.js"></script>` : '';

  const plan = sectionPlan();
  const rendered = [];
  for (const s of plan) {
    const file = pth.join(sectionsDir, s.file);
    let inner = await readTextSafe(file);

    if (s.id === 'vuln-diff-table') {
      const hasRows = /<tbody[^>]*>[\s\S]*?<tr[\s>]/i.test(inner);
      if (!inner.trim() || !hasRows) inner = await buildDiffTableFromJson(distDir);
    }
    if (s.id === 'summary') {
      // Add visual subsection separators if not present
      inner = inner
        .replace(/<h3>\s*Tools\s*<\/h3>/i, '<h3 class="subsection-title">Tools</h3>')
        .replace(/<h3>\s*Inputs\s*<\/h3>/i, '<h3 class="subsection-title">Inputs</h3>')
        .replace(/<h3>\s*Base\s*<\/h3>/i, '<h3 class="subsection-title">Base</h3>')
        .replace(/<h3>\s*Head\s*<\/h3>/i, '<h3 class="subsection-title">Head</h3>');
    }
    if (s.id === 'fix-insights') {
      const hasTable = /<table[\s>]/i.test(inner);
      if (!inner.trim() || !hasTable) inner = await buildFixInsightsFromJson(distDir);
    }

    rendered.push(sectionWrapperHtml({ id: s.id, title: s.title, num: s.num, innerHtml: inner }));
  }

  const runtime = `
<script>
(function(){
  if (window.mermaid) { try { mermaid.initialize({ startOnLoad: true, theme: 'default' }); } catch(e){} }
  if (window.Chart && window.__DASHBOARD_DATA__) {
    try {
      var d = window.__DASHBOARD_DATA__;
      function mk(id, cfg){ var el=document.getElementById(id); if(!el) return; try{ new Chart(el, cfg); }catch(e){} }
      if (d.stateTotals && document.getElementById('chart-state-pie')) {
        mk('chart-state-pie', { type:'pie', data:{ labels:d.stateTotals.labels, datasets:[{ data:d.stateTotals.values }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } } });
      }
      if (d.newVsRemovedBySeverity && document.getElementById('chart-new-removed')) {
        mk('chart-new-removed', { type:'bar', data:{ labels:d.newVsRemovedBySeverity.labels, datasets:[{ label:'NEW', data:d.newVsRemovedBySeverity.NEW },{ label:'REMOVED', data:d.newVsRemovedBySeverity.REMOVED }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' } }, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 }}} } });
      }
      if (d.severityStacked && document.getElementById('chart-severity-stacked')) {
        mk('chart-severity-stacked', { type:'bar', data:{ labels:d.severityStacked.labels, datasets:[{ label:'NEW', data:d.severityStacked.NEW },{ label:'REMOVED', data:d.severityStacked.REMOVED },{ label:'UNCHANGED', data:d.severityStacked.UNCHANGED }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' } }, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true, ticks:{ precision:0 }}} } });
      }
    } catch(e){}
  }
})();
</script>
`.trim();

  const cssLink = `<link rel="stylesheet" href="./assets/print.css" />`;
  const cover = coverHtml({ repo: view.repo, base: view.base, head: view.head, generatedAt: view.generatedAt, logoDataUri });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Vulnerability Diff Report — ${view.repo}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
${cssLink}
</head>
<body>
${cover}
${tocHtml(view.repo)}
${rendered.join('\n')}
${dashPayloadJs}
${chartTag}
${mermaidTag}
${runtime}
</body>
</html>`;
}

// -------- Portable Chrome (no sudo) --------
async function ensurePortableChrome(cacheDir) {
  const { install, computeExecutablePath } = require('@puppeteer/browsers');
  const platformMap = { linux:'linux', darwin:(os.arch()==='arm64'?'mac-arm':'mac'), win32:'win64' };
  const platform = platformMap[os.platform()];
  if (!platform) throw new Error(`Unsupported platform: ${os.platform()}`);
  const buildId = 'stable';
  await install({ browser:'chrome', buildId, cacheDir, platform });
  const execPath = computeExecutablePath({ browser:'chrome', cacheDir, platform, buildId });
  if (!execPath || !exists(execPath)) throw new Error('Chrome executable not found after download.');
  return execPath;
}
function knownBrowserCandidates() {
  return [
    process.env.CHROMIUM_PATH || '',
    '/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
  ].filter(Boolean);
}
async function resolveBrowserExecutable(outDir) {
  for (const p of knownBrowserCandidates()) if (exists(p)) return { path:p, portableDir:null };
  const cacheDir = pth.join(outDir, '.browsers'); await ensureDir(cacheDir);
  actionsCore.info('[render/pdf] no system browser found; downloading Chrome (stable) locally…');
  const execPath = await ensurePortableChrome(cacheDir);
  return { path: execPath, portableDir: cacheDir };
}

// -------- Header/Footer templates --------
function headerTemplate({ logoDataUri, repo, generatedAt }) {
  return `
<style>
  .hdr { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:10px; width:100%; padding:4px 10px; color:#111; }
  .hdr .row { display:flex; align-items:center; justify-content:space-between; }
  .hdr .brand { display:flex; align-items:center; gap:6px; font-weight:600; }
  .hdr img { height:14px; }
  .muted { color:#6b7280; font-weight:500; }
</style>
<div class="hdr">
  <div class="row">
    <div class="brand">
      ${logoDataUri ? `<img src="${logoDataUri}" />` : ''}
      <span>Vulnerability Diff Report</span>
      <span class="muted">— ${repo}</span>
    </div>
    <div class="muted">${generatedAt}</div>
  </div>
</div>`.trim();
}
function footerTemplate({ logoDataUri, baseRef, headRef, generatedAt }) {
  return `
<style>
  .ftr { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:10px; width:100%; padding:4px 10px; color:#111; }
  .ftr .row { display:flex; align-items:center; justify-content:space-between; }
  .brand { display:flex; align-items:center; gap:6px; font-weight:600; }
  .ftr img { height:14px; }
  .muted { color:#6b7280; font-weight:500; }
  .page { color:#6b7280; }
</style>
<div class="ftr">
  <div class="row">
    <div class="brand">
      ${logoDataUri ? `<img src="${logoDataUri}" />` : ''}
      <span>Vulnerability Diff Report</span>
      <span class="muted">— BASE: ${baseRef} → HEAD: ${headRef}</span>
    </div>
    <div class="muted">${generatedAt} — <span class="page"><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>
  </div>
</div>`.trim();
}

// -------- Entry point: build, split, merge --------
async function pdf_init({ distDir = './dist' } = {}) {
  actionsCore.startGroup('[render] PDF');
  try {
    const view = buildView(distDir);
    const outDir = pth.join(pth.resolve(distDir), 'pdf');
    const assetsDir = pth.join(outDir, 'assets');
    await ensureDir(outDir); await ensureDir(assetsDir);

    // CSS
    await writeText(pth.join(assetsDir, 'print.css'), makePrintCss());

    // Logo -> data URI
    const logoInput = actionsCore.getInput('html_logo_url') || '';
    const logoDataUri = await logoToDataUri(logoInput, pth.resolve(distDir));

    // HTML (single document with cover + sections)
    const html = await buildPrintHtml({ distDir: pth.resolve(distDir), view, logoDataUri });
    const htmlPath = pth.join(outDir, 'print.html');
    await writeText(htmlPath, html);
    actionsCore.info(`[render/pdf] written: ${htmlPath}`);

    // Puppeteer-core + browser
    let pptr; try { pptr = require('puppeteer-core'); }
    catch { throw new Error('puppeteer-core is not installed. Please add "puppeteer-core" to your dependencies.'); }
    const { path: executablePath } = await resolveBrowserExecutable(outDir);
    const browser = await pptr.launch({ headless: 'new', executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });

    // Export page 1 (cover) without header/footer
    const coverPdf = pth.join(outDir, 'cover.pdf');
    await page.pdf({
      path: coverPdf,
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      format: 'A4',
      pageRanges: '1',
    });

    // Export the rest (2..N) with header/footer
    const restPdf = pth.join(outDir, 'rest.pdf');
    await page.pdf({
      path: restPdf,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplate({ logoDataUri, repo: view.repo, generatedAt: view.generatedAt }),
      footerTemplate: footerTemplate({ logoDataUri, baseRef: view.base.ref, headRef: view.head.ref, generatedAt: view.generatedAt }),
      margin: { top: '20mm', right: '14mm', bottom: '16mm', left: '14mm' },
      format: 'A4',
      pageRanges: '2-',
    });

    await browser.close();

    // Merge cover + rest
    const finalPdf = pth.join(outDir, 'report.pdf');
    const coverDoc = await PDFDocument.load(await fsp.readFile(coverPdf));
    const restDoc  = await PDFDocument.load(await fsp.readFile(restPdf));
    const merged   = await PDFDocument.create();
    const [coverPage] = await merged.copyPages(coverDoc, [0]);
    merged.addPage(coverPage);
    const restPages = await merged.copyPages(restDoc, restDoc.getPageIndices());
    restPages.forEach(p => merged.addPage(p));
    const finalBytes = await merged.save();
    await fsp.writeFile(finalPdf, finalBytes);

    actionsCore.info(`[render/pdf] exported: ${finalPdf}`);
  } catch (e) {
    actionsCore.setFailed(`[render] PDF failed: ${e?.message || e}`);
    throw e;
  } finally {
    actionsCore.endGroup();
  }
}

module.exports = { pdf_init };
