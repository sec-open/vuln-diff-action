// src/render/pdf/pdf.js
// Phase 3.3 (PDF) — Assemble PDF from existing HTML bundle (NO changes to HTML).
// - Builds dist/pdf/print.html using dist/html/sections/*.html fragments
// - Fixed, hardcoded ToC numbering; each section starts on a new page
// - Dark cover; light pages for the rest
// - Page header/footer (except cover) with logo, repo, refs, timestamp
// - Uses puppeteer-core; downloads a portable Chrome if none is present

const actionsCore = require('@actions/core');
const fsp = require('fs/promises');
const pth = require('path');
const os = require('os');
const { buildView } = require('../common/view');

async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); }
async function readTextSafe(file) { try { return await fsp.readFile(file, 'utf8'); } catch { return ''; } }
async function writeText(file, text) { await ensureDir(pth.dirname(file)); await fsp.writeFile(file, text, 'utf8'); }
function fileExistsSync(p) { try { require('fs').accessSync(p); return true; } catch { return false; } }

function nowIsoLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function rewriteLogoForPdf(logoUrl) {
  if (!logoUrl) return '';
  const u = String(logoUrl).trim();
  if (/^https?:\/\//i.test(u)) return u; // absolute URL
  const htmlRel = u.replace(/^\.\//, '');
  if (htmlRel.startsWith('html/')) return '../' + htmlRel; // from dist/pdf -> dist/html/...
  return u; // relative to dist/pdf
}

function makePrintCss() {
  return `
@page { size: A4; margin: 14mm 14mm 16mm 14mm; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#0b0f16; background:#fff; }
h1,h2,h3 { margin:0 0 10px 0; }
p { margin:0 0 8px 0; }
small, .small { color:#6b7280; font-size:12px; }
code { background:#eef2ff; padding:2px 6px; border-radius:6px; }
a { color:#1d4ed8; text-decoration:none; }
a:hover { text-decoration:underline; }
table { width:100%; border-collapse:collapse; }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #e5e7eb; }

/* Cover (dark) */
.cover-page { page-break-after: always; color:#e5e7eb; background:#0b0f16; min-height: 100vh; padding: 24mm 18mm; }
.cover-header { display:flex; align-items:center; justify-content:space-between; margin-bottom: 16mm; }
.cover-brand { display:flex; align-items:center; gap:12px; }
.cover-brand img { max-height: 40px; }
.cover-title { font-size: 28px; margin: 8px 0 0; }
.columns-2 { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { border:1px solid #1f2937; border-radius:10px; padding:10px; background:#111827; }
.card .kv { display:grid; grid-template-columns: 120px 1fr; gap:4px 10px; font-size:13px; }
.card h3 { margin-bottom:6px; }

/* Regular pages */
.page { page-break-before: always; padding: 0; background:#fff; }
.section-wrap { padding: 6mm 0; }
.section-title { font-size: 20px; margin-bottom: 6px; }

/* TOC */
.toc { }
.toc ol { margin: 0 0 0 18px; padding: 0; }
.toc li { margin: 6px 0; }

/* Hide interactive-only elements possibly present in fragments */
#app-menu, #app-header, nav, .controls, .filters, .btn, button { display: none !important; }

/* Charts sizing in print */
.chart-card, .chart-wrap, canvas { width:100% !important; height:220px !important; }

/* Header/Footer placeholders (Puppeteer templates) */
.header-space, .footer-space { height: 0; }
  `.trim();
}

// Fixed ToC (hardcoded numbers & order)
function sectionPlan() {
  // Map: id, title, source file (under dist/html/sections/)
  return [
    { num: 1, id: 'introduction', title: 'Introduction', file: 'overview.html' },
    { num: 2, id: 'summary', title: 'Summary', file: 'summary.html' },
    { num: 3, id: 'vuln-diff-table', title: 'Vulnerability Diff Table', file: 'vuln-diff-table.html' },
    { num: 4, id: 'dashboard', title: 'Dashboard', file: 'dashboard.html' },
    { num: 5, id: 'dep-graph-base', title: 'Dependency Graph — Base', file: 'dep-graph-base.html' },
    { num: 6, id: 'dep-graph-head', title: 'Dependency Graph — Head', file: 'dep-graph-head.html' },
    { num: 7, id: 'dep-paths-base', title: 'Dependency Paths — Base', file: 'dep-paths-base.html' },
    { num: 8, id: 'dep-paths-head', title: 'Dependency Paths — Head', file: 'dep-paths-head.html' },
  ];
}

function coverHtml({ repo, base, head, generatedAt, logoUrl }) {
  const lg = rewriteLogoForPdf(logoUrl);
  return `
<section class="cover-page" id="cover">
  <div class="cover-header">
    <div class="cover-brand">
      ${lg ? `<img src="${lg}" alt="Logo"/>` : ''}
      <div>
        <div class="small">Vulnerability Diff Report</div>
        <div class="cover-title">${repo}</div>
      </div>
    </div>
    <div class="small">Generated at<br/><strong>${generatedAt}</strong></div>
  </div>
  <div class="columns-2">
    <div class="card">
      <h3>Base</h3>
      <div class="kv">
        <div>Ref</div><div><code>${base.ref}</code></div>
        <div>Commit</div><div><code>${base.shaShort}</code> (${base.sha})</div>
        <div>Author</div><div>${base.author}</div>
        <div>Authored at</div><div>${base.authoredAt}</div>
        <div>Subject</div><div>${base.commitSubject}</div>
      </div>
    </div>
    <div class="card">
      <h3>Head</h3>
      <div class="kv">
        <div>Ref</div><div><code>${head.ref}</code></div>
        <div>Commit</div><div><code>${head.shaShort}</code> (${head.sha})</div>
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
  const plan = sectionPlan();
  const items = plan.map(s => `<li>${s.num}. <a href="#${s.id}">${s.title}</a></li>`).join('');
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

async function buildPrintHtml({ distDir, view, logoUrl }) {
  const htmlRoot = pth.join(distDir, 'html');
  const sectionsDir = pth.join(htmlRoot, 'sections');
  const assetsVendor = pth.join(htmlRoot, 'assets', 'js', 'vendor');

  // Try to load dashboard data and embed as JS (avoids file:// fetch issues)
  const dashDataPath = pth.join(sectionsDir, 'dashboard-data.json');
  let dashPayloadJs = '';
  try {
    const dashJson = JSON.parse(await fsp.readFile(dashDataPath, 'utf8'));
    dashPayloadJs = `<script>window.__DASHBOARD_DATA__=${JSON.stringify(dashJson)};</script>`;
  } catch {
    dashPayloadJs = '';
  }

  // Load vendor libs if present
  const haveChart = fileExistsSync(pth.join(assetsVendor, 'chart.umd.js'));
  const haveMermaid = fileExistsSync(pth.join(assetsVendor, 'mermaid.min.js'));
  const chartTag = haveChart ? `<script src="../html/assets/js/vendor/chart.umd.js"></script>` : '';
  const mermaidTag = haveMermaid ? `<script src="../html/assets/js/vendor/mermaid.min.js"></script>` : '';

  // Load section fragments
  const plan = sectionPlan();
  const renderedSections = [];
  for (const s of plan) {
    const file = pth.join(sectionsDir, s.file);
    const inner = await readTextSafe(file); // empty if missing
    renderedSections.push(sectionWrapperHtml({ id: s.id, title: s.title, num: s.num, innerHtml: inner }));
  }

  // Minimal runtime to re-render charts/mermaid if present
  const runtime = `
<script>
(function(){
  // Mermaid: render any <pre class="mermaid"> found in fragments
  if (window.mermaid) {
    try { mermaid.initialize({ startOnLoad: true, theme: 'default' }); } catch (e) {}
  }
  // Charts: if dashboard provides known canvases and we have data
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
      if (d.fixability && document.getElementById('chart-fix-new')) {
        mk('chart-fix-new', { type:'doughnut', data:{ labels:d.fixability.labels, datasets:[{ data:d.fixability.NEW }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } } });
      }
      if (d.riskKpis && document.getElementById('kpi-net-risk')) {
        var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=String(v); };
        set('kpi-net-risk', d.riskKpis.kpis?.netRisk ?? '—');
        set('kpi-base-stock', d.riskKpis.kpis?.baseStockRisk ?? '—');
        set('kpi-head-stock', d.riskKpis.kpis?.headStockRisk ?? '—');
      }
    } catch(e){}
  }
})();
</script>
`.trim();

  const cssLink = `<link rel="stylesheet" href="./assets/print.css" />`;
  const cover = coverHtml({
    repo: view.repo, base: view.base, head: view.head,
    generatedAt: view.generatedAt, logoUrl,
  });
  const toc = tocHtml(view.repo);

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
${toc}
${renderedSections.join('\n')}
${dashPayloadJs}
${chartTag}
${mermaidTag}
${runtime}
</body>
</html>`;
}

// ---------------- Portable browser (no sudo) ----------------
async function ensurePortableChrome(cacheDir) {
  const { install, computeExecutablePath } = require('@puppeteer/browsers');
  const platformMap = { linux:'linux', darwin:(os.arch()==='arm64'?'mac-arm':'mac'), win32:'win64' };
  const platform = platformMap[os.platform()];
  if (!platform) throw new Error(`Unsupported platform: ${os.platform()}`);
  const buildId = 'stable';
  await install({ browser:'chrome', buildId, cacheDir, platform });
  const execPath = computeExecutablePath({ browser:'chrome', cacheDir, platform, buildId });
  if (!execPath || !fileExistsSync(execPath)) throw new Error('Chrome executable not found after download.');
  return execPath;
}

function knownBrowserCandidates() {
  return [
    process.env.CHROMIUM_PATH || '',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
}

async function resolveBrowserExecutable(outDir) {
  for (const p of knownBrowserCandidates()) { if (fileExistsSync(p)) return { path:p, portableDir:null }; }
  const cacheDir = pth.join(outDir, '.browsers');
  await ensureDir(cacheDir);
  actionsCore.info('[render/pdf] no system browser found; downloading Chrome (stable) locally…');
  const execPath = await ensurePortableChrome(cacheDir);
  actionsCore.info(`[render/pdf] portable Chrome ready at: ${execPath}`);
  return { path: execPath, portableDir: cacheDir };
}

// --------------- Header/Footer templates (Puppeteer) ---------------
function headerTemplate({ logoUrl, repo, generatedAt }) {
  const lg = rewriteLogoForPdf(logoUrl);
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
      ${lg ? `<img src="${lg}" />` : ''}
      <span>Vulnerability Diff Report</span>
      <span class="muted">— ${repo}</span>
    </div>
    <div class="muted">${generatedAt}</div>
  </div>
</div>
`.trim();
}

function footerTemplate({ logoUrl, baseRef, headRef, generatedAt }) {
  const lg = rewriteLogoForPdf(logoUrl);
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
      ${lg ? `<img src="${lg}" />` : ''}
      <span>Vulnerability Diff Report</span>
      <span class="muted">— BASE: ${baseRef} → HEAD: ${headRef}</span>
    </div>
    <div class="muted">${generatedAt} — <span class="page"><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>
  </div>
</div>
`.trim();
}

// ----------------------------- Main -----------------------------
async function pdf_init({ distDir = './dist' } = {}) {
  actionsCore.startGroup('[render] PDF');
  try {
    // View model (repo, base, head, generatedAt, etc.)
    const view = buildView(distDir);
    const outDir = pth.join(pth.resolve(distDir), 'pdf');
    const assetsDir = pth.join(outDir, 'assets');
    await ensureDir(outDir);
    await ensureDir(assetsDir);

    // Write print.css
    await writeText(pth.join(assetsDir, 'print.css'), makePrintCss());

    // Build print.html by assembling fragments from dist/html/sections
    const html = await buildPrintHtml({
      distDir: pth.resolve(distDir),
      view,
      logoUrl: (actionsCore.getInput('html_logo_url') || ''),
    });
    const htmlPath = pth.join(outDir, 'print.html');
    await writeText(htmlPath, html);
    actionsCore.info(`[render/pdf] written: ${htmlPath}`);

    // puppeteer-core + browser (system or portable)
    let pptr;
    try { pptr = require('puppeteer-core'); }
    catch { throw new Error('puppeteer-core is not installed. Please add "puppeteer-core" to your dependencies.'); }

    const resolved = await resolveBrowserExecutable(outDir);
    const executablePath = resolved.path;

    const browser = await pptr.launch({
      headless: 'new',
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });

    // Export to PDF with header/footer (cover excluded by CSS background only)
    const pdfPath = pth.join(outDir, 'report.pdf');
    const logoForTpl = (actionsCore.getInput('html_logo_url') || '');
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplate({ logoUrl: logoForTpl, repo: view.repo, generatedAt: view.generatedAt }),
      footerTemplate: footerTemplate({ logoUrl: logoForTpl, baseRef: view.base.ref, headRef: view.head.ref, generatedAt: view.generatedAt }),
      margin: { top: '20mm', right: '14mm', bottom: '16mm', left: '14mm' },
      format: 'A4',
      preferCSSPageSize: false,
      pageRanges: '', // all
    });
    await browser.close();

    actionsCore.info(`[render/pdf] exported: ${pdfPath}`);

    // OPTIONAL: remove portable browser to keep artifact small
    // if (resolved.portableDir) { await fsp.rm(resolved.portableDir, { recursive:true, force:true }); }
  } catch (e) {
    actionsCore.setFailed(`[render] PDF failed: ${e?.message || e}`);
    throw e;
  } finally {
    actionsCore.endGroup();
  }
}

module.exports = { pdf_init };
