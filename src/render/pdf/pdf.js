// src/render/pdf/pdf.js
// Build a printable PDF by reusing the HTML bundle (no changes to HTML bundle needed).
// - Cover: custom dark layout (logo + title + repo + Base/Head cards)
// - Header/Footer: dark band with logo rendered via CSS background-image
// - Dashboard: Chart.js inlined + canvases with fixed size + wait until rendered
// - Fix Insights: show ALL vulns with fixes (not only NEW)
// - All other sections are read from dist/html/sections/*.html as-is

const core = require('@actions/core');
const fs = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');

// ------------------------------ small fs helpers
async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}
async function readTextSafe(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return ''; }
}
async function writeText(p, content) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf8');
}

// ------------------------------ data loaders (only Phase-2 outputs)
async function loadJson(p) {
  const raw = await readTextSafe(p);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function loadDiff(distDir) {
  return await loadJson(path.join(distDir, 'diff.json'));
}

// ------------------------------ view minimal model (subset used here)
function buildView(metaLike) {
  // meta-like is derived from diff.json metadata fields
  return {
    repo: metaLike?.repo || 'owner/repo',
    generatedAt: metaLike?.generated_at || new Date().toISOString(),
    base: {
      ref: metaLike?.git?.base?.ref || 'base',
      sha: metaLike?.git?.base?.sha || metaLike?.git?.base?.commit || '',
      shaShort: metaLike?.git?.base?.sha_short || (metaLike?.git?.base?.sha || '').slice(0,7),
      author: metaLike?.git?.base?.author || 'n/a',
      authoredAt: metaLike?.git?.base?.authored_at || 'n/a',
      commitSubject: metaLike?.git?.base?.subject || 'n/a'
    },
    head: {
      ref: metaLike?.git?.head?.ref || 'head',
      sha: metaLike?.git?.head?.sha || metaLike?.git?.head?.commit || '',
      shaShort: metaLike?.git?.head?.sha_short || (metaLike?.git?.head?.sha || '').slice(0,7),
      author: metaLike?.git?.head?.author || 'n/a',
      authoredAt: metaLike?.git?.head?.authored_at || 'n/a',
      commitSubject: metaLike?.git?.head?.subject || 'n/a'
    }
  };
}

function pkgStr(p) {
  if (!p) return '';
  const g = p.group || p.namespace || p.org || '';
  const a = p.name || p.artifact || '';
  const v = p.version || '';
  return [g,a].filter(Boolean).join('.') + (v ? `:${v}` : '');
}

// ------------------------------ DASH data (no extra calc)
function computeDashData(items) {
  const severities = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
  const states = ['NEW','REMOVED','UNCHANGED'];

  // states pie
  const stateTotals = states.map(s => items.filter(x => x.state === s).length);

  // new vs removed by severity
  const newVsRemoved = severities.map(sev => ({
    NEW: items.filter(x => x.state==='NEW' && (x.severity||'UNKNOWN')===sev).length,
    REMOVED: items.filter(x => x.state==='REMOVED' && (x.severity||'UNKNOWN')===sev).length
  }));

  // stacked bars by severity & state
  const stacked = severities.map(sev => ({
    NEW: items.filter(x => x.state==='NEW' && (x.severity||'UNKNOWN')===sev).length,
    REMOVED: items.filter(x => x.state==='REMOVED' && (x.severity||'UNKNOWN')===sev).length,
    UNCHANGED: items.filter(x => x.state==='UNCHANGED' && (x.severity||'UNKNOWN')===sev).length
  }));

  return { severities, states, stateTotals, newVsRemoved, stacked };
}

// ------------------------------ sections plan (order and titles)
function sectionPlan() {
  return [
    // 1 is cover (handled outside)
    { num: 2, id: 'summary', title: 'Summary', file: 'summary.html' },
    { num: 3, id: 'vuln-diff-table', title: 'Vulnerability Diff Table', file: 'vuln-diff-table.html' },
    { num: 4, id: 'dashboard', title: 'Dashboard', file: null }, // custom build for PDF
    { num: 5, id: 'dep-graph-base', title: 'Dependency Graph — Base', file: 'dependency-graph-base.html' },
    { num: 6, id: 'dep-graph-head', title: 'Dependency Graph — Head', file: 'dependency-graph-head.html' },
    { num: 7, id: 'dep-paths-base', title: 'Dependency Paths — Base', file: 'dependency-paths-base.html' },
    { num: 8, id: 'dep-paths-head', title: 'Dependency Paths — Head', file: 'dependency-paths-head.html' },
    { num: 9, id: 'fix-insights', title: 'Fix Insights', file: null }
  ];
}

// ------------------------------ COVER (HTML + CSS fragments)
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
  const lines = sectionPlan().map(s =>
    `<li>${s.num}. <a href="#${s.id}">${s.title}</a></li>`
  ).join('\n');
  return `
<section class="page" id="toc">
  <h1>Table of Contents — ${repo}</h1>
  <ol class="toc-list">
    ${lines}
  </ol>
</section>
`.trim();
}

function sectionWrapper({ id, title, num, innerHtml }) {
  return `
<section class="page" id="${id}">
  <h1>${num}. ${title}</h1>
  ${innerHtml || ''}
</section>
`.trim();
}

// ------------------------------ PDF-only dashboard
function buildPdfDashboardHtml(dash, { chartJsInline }) {
  return `
<div class="print-dash-grid">
  <div class="print-dash-card">
    <h4>Distribution by State</h4>
    <canvas id="pdf-dash-state" width="720" height="220"></canvas>
  </div>
  <div class="print-dash-card">
    <h4>NEW vs REMOVED by Severity</h4>
    <canvas id="pdf-dash-nr" width="720" height="220"></canvas>
  </div>
  <div class="print-dash-card print-dash-span2">
    <h4>By Severity & State (stacked)</h4>
    <canvas id="pdf-dash-stacked" width="1480" height="260"></canvas>
  </div>
</div>

<!-- Inline Chart.js for PDF (no external <script src=...>) -->
<script>(function(){${chartJsInline || ''}})();</script>

<script>
(function(){
  if (!window.Chart) { window.__chartsReady = false; return; }
  var d = ${JSON.stringify(dash)};
  function mk(id, cfg){
    var el = document.getElementById(id);
    if(!el) return null;
    try{ return new Chart(el.getContext('2d'), cfg); }catch(e){ return null; }
  }

  var c1 = mk('pdf-dash-state', {
    type:'pie',
    data:{ labels:d.states, datasets:[{ data:d.stateTotals }] },
    options:{ responsive:false, plugins:{ legend:{ position:'bottom' } } }
  });

  var c2 = mk('pdf-dash-nr', {
    type:'bar',
    data:{ labels:d.severities,
      datasets:[
        { label:'NEW', data:d.newVsRemoved.map(x=>x.NEW) },
        { label:'REMOVED', data:d.newVsRemoved.map(x=>x.REMOVED) }
      ]},
    options:{ responsive:false, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } }, plugins:{ legend:{ position:'top' } } }
  });

  var c3 = mk('pdf-dash-stacked', {
    type:'bar',
    data:{ labels:d.severities,
      datasets:[
        { label:'NEW', data:d.stacked.map(x=>x.NEW) },
        { label:'REMOVED', data:d.stacked.map(x=>x.REMOVED) },
        { label:'UNCHANGED', data:d.stacked.map(x=>x.UNCHANGED) }
      ]},
    options:{ responsive:false, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true, ticks:{ precision:0 } } }, plugins:{ legend:{ position:'top' } } }
  });

  setTimeout(function(){ window.__chartsReady = !!(c1 && c2 && c3); }, 300);
})();
</script>
`.trim();
}

async function waitForCharts(page, { timeout = 60000 } = {}) {
  try {
    await page.waitForFunction(() => window.__chartsReady === true, { timeout });
    await page.waitForTimeout(300);
  } catch {
    // continue without charts
  }
}

// ------------------------------ Fix Insights (ALL with fix)
async function buildFixInsightsFromJson(distDir) {
  const diff = await loadDiff(distDir);
  if (!diff || !Array.isArray(diff.items)) {
    return '<div class="small">[diff.json not found or empty]</div>';
  }
  const withFixAll = diff.items.filter(x => x.fix && x.fix.state === 'fixed');

  const mkRows = (arr) => arr.map(o=>{
    const url = o.urls && o.urls[0] ? o.urls[0] : '';
    const id = url ? `<a href="${url}">${o.id}</a>` : o.id;
    const tgt = o.fix && o.fix.versions && o.fix.versions[0] ? o.fix.versions[0] : '—';
    return `<tr><td>${o.severity||'UNKNOWN'}</td><td>${id}</td><td>${pkgStr(o.package)}</td><td>${o.state}</td><td>${tgt}</td></tr>`;
  }).join('');

  return `
<div class="subsection-title">Overview</div>
<p class="small">Vulnerabilities with available fixes: <strong>${withFixAll.length}</strong></p>
<table>
  <thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>State</th><th>Target Version</th></tr></thead>
  <tbody>${mkRows(withFixAll)}</tbody>
</table>
`.trim();
}

// ------------------------------ Build printable HTML (reuses bundle content)
async function buildPrintHtml({ distDir, view, logoDataUri }) {
  const htmlRoot = path.join(distDir,'html');
  const sectionsDir = path.join(htmlRoot,'sections');
  const vendor = path.join(htmlRoot,'assets','js','vendor');

  // Inline Chart.js for dashboard PDF
  const chartPathCandidates = [
    path.join(vendor,'chart.umd.js'),
    path.join(htmlRoot, 'assets', 'js', 'vendor', 'chart.umd.js'),
    path.join(distDir, 'html', 'assets', 'js', 'vendor', 'chart.umd.js')
  ];
  let chartJsInline = '';
  for (const p of chartPathCandidates) {
    if (await exists(p)) { chartJsInline = await readTextSafe(p); break; }
  }

  // Compose
  let out = coverHtml({ repo:view.repo, base:view.base, head:view.head, generatedAt:view.generatedAt, logoDataUri });
  out += '\n' + tocHtml(view.repo);

  const diff = await loadDiff(distDir);
  const items = diff?.items || [];

  for (const s of sectionPlan()) {
    let inner = '';
    if (s.id === 'dashboard') {
      const dash = computeDashData(items);
      inner = buildPdfDashboardHtml(dash, { chartJsInline });
    } else if (s.id === 'vuln-diff-table') {
      // try to reuse HTML section if it has rows; otherwise build from JSON
      const file = path.join(sectionsDir, 'vuln-diff-table.html');
      const raw = await readTextSafe(file);
      const hasRows = /<tbody[^>]*>[\s\S]*?<tr[\s>]/i.test(raw);
      inner = (raw && hasRows) ? raw : await buildVulnTableFromJson(distDir);
    } else if (s.id === 'fix-insights') {
      inner = await buildFixInsightsFromJson(distDir);
    } else {
      const file = s.file ? path.join(sectionsDir, s.file) : null;
      inner = file ? await readTextSafe(file) : '';
      if (s.id === 'summary') {
        // strengthen subsection headings visually (no structural changes)
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
</body>
</html>`;
}

// Fallback table (if HTML section has no rows)
async function buildVulnTableFromJson(distDir) {
  const diff = await loadDiff(distDir);
  if (!diff || !Array.isArray(diff.items)) return '<div class="small">No diff items</div>';
  const rows = diff.items.map(o=>{
    const url = o.urls && o.urls[0] ? o.urls[0] : '';
    const id = url ? `<a href="${url}">${o.id}</a>` : o.id;
    return `<tr><td>${o.severity||'UNKNOWN'}</td><td>${id}</td><td>${pkgStr(o.package)}</td><td>${o.state}</td></tr>`;
  }).join('');
  return `
<p class="small">Auto-generated from <code>dist/diff.json</code> (fallback)</p>
<table>
  <thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Status</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
`.trim();
}

// ------------------------------ Header/Footer templates (robust logo)
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
  .logo{ width:14px; height:14px; display:inline-block; background-size:contain; background-repeat:no-repeat; background-position:center; }
  .muted{ color:#cbd5e1; font-weight:500; }
</style>
<div class="hdrbar">
  <div class="row">
    <div class="brand">
      ${logoDataUri ? `<span class="logo" style="background-image:url('${logoDataUri}')"></span>` : ''}
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
  .ftrbar{
    background:#0b0f16; color:#e5e7eb; width:100%;
    padding:6px 10px; border-top:1px solid #111827;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    font-size:10px;
  }
  .row{ display:flex; align-items:center; justify-content:space-between; }
  .brand{ display:flex; align-items:center; gap:6px; font-weight:600; }
  .logo{ width:14px; height:14px; display:inline-block; background-size:contain; background-repeat:no-repeat; background-position:center; }
  .muted{ color:#cbd5e1; font-weight:500; }
  .page{ color:#cbd5e1; }
</style>
<div class="ftrbar">
  <div class="row">
    <div class="brand">
      ${logoDataUri ? `<span class="logo" style="background-image:url('${logoDataUri}')"></span>` : ''}
      <span>Vulnerability Diff Report</span>
      <span class="muted">— BASE: ${baseRef} → HEAD: ${headRef}</span>
    </div>
    <div class="muted">${generatedAt} — <span class="page"><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>
  </div>
</div>`.trim();
}

// ------------------------------ Print CSS writer
function makePrintCss() {
  return `/* print.css — neutral light style for PDF (only charts are colored) */
:root { --text:#111827; --muted:#6b7280; --panel:#f3f4f6; --border:#e5e7eb; --dark:#0b0f16; }
@page { size: A4; margin: 20mm 14mm 16mm 14mm; }
* { box-sizing:border-box; }
html, body { margin:0; padding:0; color:var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
a { color:#0ea5e9; text-decoration:none; }
a:hover { text-decoration:underline; }

h1 { font-size:22px; margin:0 0 10px 0; }
h2 { font-size:18px; margin:18px 0 8px 0; }
h3 { font-size:16px; margin:14px 0 8px 0; }
h4 { font-size:14px; margin:10px 0 6px 0; }
.small { color:var(--muted); font-size:12px; }

.page { page-break-before: always; padding: 8mm 0; }
#cover { page-break-before: auto; }

table { width:100%; border-collapse: collapse; margin:8px 0 12px; }
th, td { padding:8px; border-bottom: 1px solid var(--border); }
thead th { background:#f8fafc; font-weight:700; }

/* Subsection headings in Summary */
.subsection-title { font-weight:700; border-bottom:2px solid var(--border); padding-bottom:4px; margin:16px 0 6px; }

/* COVER (dark) */
.cover-page {
  background:var(--dark) !important; color:#e5e7eb !important;
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

/* Dashboard grid for PDF */
.print-dash-grid {
  display:grid; grid-template-columns: 1fr 1fr; grid-auto-rows: auto; gap:10px;
}
.print-dash-card { border:1px solid var(--border); border-radius:10px; padding:10px; background:#fff; }
.print-dash-span2 { grid-column: 1 / span 2; }
canvas { display:block; }

/* Dependency Paths: avoid last-row truncation */
tr:last-child td { border-bottom: 1px solid var(--border); }
`;
}

// ------------------------------ Browser launching (robust)
async function launchBrowser(pptr, executablePath) {
  const common = {
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--font-render-hinting=medium',
      '--no-first-run',
      '--no-default-browser-check'
    ],
    timeout: 120000,
    dumpio: true
  };
  try {
    return await pptr.launch({ ...common, headless: 'new' });
  } catch (e1) {
    core.warning(`[render/pdf] headless:"new" failed (${e1?.message || e1}). Retrying with headless:true…`);
    return await pptr.launch({ ...common, headless: true });
  }
}

function resolveExecutablePathHint() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch {}
  }
  return null;
}

// ------------------------------ main
async function buildPdfReport({ distDir, logoUrl }) {
  const outDir = path.join(distDir, 'pdf');
  await fs.mkdir(path.join(outDir, 'assets'), { recursive: true });

  // Load diff.json metadata for view
  const diff = await loadDiff(distDir);
  const view = buildView({
    repo: diff?.meta?.repo || diff?.repo || 'owner/repo',
    generated_at: diff?.generated_at || new Date().toISOString(),
    git: {
      base: diff?.git?.base || diff?.meta?.git?.base || {},
      head: diff?.git?.head || diff?.meta?.git?.head || {}
    }
  });

  // Convert logo to data URI if local path inside bundle; otherwise keep URL
  let logoDataUri = '';
  try {
    if (logoUrl && /^https?:\/\//i.test(logoUrl)) {
      // external URL: keep as is (will work in header/footer background)
      logoDataUri = logoUrl;
    } else if (logoUrl) {
      const logoAbs = path.isAbsolute(logoUrl) ? logoUrl : path.join(distDir, 'html', logoUrl);
      if (await exists(logoAbs)) {
        const buf = await fs.readFile(logoAbs);
        const b64 = buf.toString('base64');
        const ext = path.extname(logoAbs).toLowerCase().replace('.', '') || 'png';
        logoDataUri = `data:image/${ext};base64,${b64}`;
      }
    }
  } catch {}

  // Write print.css for the PDF HTML
  await writeText(path.join(outDir, 'assets', 'print.css'), makePrintCss());

  // Build print.html (reusing sections from bundle)
  const html = await buildPrintHtml({ distDir, view, logoDataUri });
  const printHtmlPath = path.join(outDir, 'report.html');
  await writeText(printHtmlPath, html);

  // Puppeteer-core
  let pptr;
  try {
    pptr = require('puppeteer-core');
  } catch {
    throw new Error('Puppeteer is not installed. Please add "puppeteer-core" to dependencies or vendor a portable Chrome.');
  }

  const executablePath = resolveExecutablePathHint();
  if (!executablePath) {
    throw new Error('No Chrome/Chromium found and PUPPETEER_EXECUTABLE_PATH not set.');
  }

  try {
    const ver = execFileSync(executablePath, ['--version'], { encoding: 'utf8' }).trim();
    core.info(`[render/pdf] Chrome: ${ver} @ ${executablePath}`);
  } catch {}

  const browser = await launchBrowser(pptr, executablePath);
  const page = await browser.newPage();

  // Load the generated HTML
  await page.goto('file://' + printHtmlPath, { waitUntil: 'load', timeout: 120000 });

  // Wait for charts (dashboard) to render
  await waitForCharts(page);

  // Export: cover (page 1) without header/footer; rest with header/footer
  const coverPdf = path.join(outDir, 'cover.pdf');
  const restPdf = path.join(outDir, 'rest.pdf');
  const finalPdf = path.join(outDir, 'vulnerability-diff-report.pdf');

  // Cover only
  await page.pdf({
    path: coverPdf,
    printBackground: true,
    displayHeaderFooter: false,
    format: 'A4',
    pageRanges: '1'
  });

  // Rest (2-)
  await page.pdf({
    path: restPdf,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerTemplate({ logoDataUri, repo: view.repo, generatedAt: view.generatedAt }),
    footerTemplate: footerTemplate({ logoDataUri, baseRef: view.base.ref, headRef: view.head.ref, generatedAt: view.generatedAt }),
    margin: { top: '20mm', right: '14mm', bottom: '16mm', left: '14mm' },
    format: 'A4',
    pageRanges: '2-'
  });

  await browser.close();

  // Concatenate PDFs (no external lib; minimal join via pdf-lib if available)
  try {
    const { PDFDocument } = require('pdf-lib');
    const c = await PDFDocument.create();
    const a = await PDFDocument.load(await fs.readFile(coverPdf));
    const b = await PDFDocument.load(await fs.readFile(restPdf));
    const aPages = await c.copyPages(a, a.getPageIndices());
    aPages.forEach(p => c.addPage(p));
    const bPages = await c.copyPages(b, b.getPageIndices());
    bPages.forEach(p => c.addPage(p));
    const bytes = await c.save();
    await fs.writeFile(finalPdf, bytes);
  } catch {
    // Fallback: deliver 'rest.pdf' if merge not possible (still useful)
    await fs.copyFile(restPdf, finalPdf);
  }

  core.info(`[render/pdf] PDF generated: ${finalPdf}`);
  return { pdfPath: finalPdf, htmlPath: printHtmlPath };
}

module.exports = {
  buildPdfReport
};
