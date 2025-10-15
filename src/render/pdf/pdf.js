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
const { resultsHtml } = require('./sections/results');
const { summaryHtml } = require('./sections/summary');
const { dashboardHtml } = require('./sections/dashboard');
const { dependencyGraphsHtml } = require('./sections/dependencyGraphs');
const { dependencyPathsHtml } = require('./sections/depPaths');
const core = require('@actions/core');
const { fixHtml } = require('./sections/fix');

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

async function buildPrintHtml({ distDir, view, inputs, logoDataUri }) {
  const htmlRoot = path.join(distDir, 'html');
  const sectionsDir = path.join(htmlRoot, 'sections');

  function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
  async function readTextSafe(p) { try { return await fs.promises.readFile(p, 'utf8'); } catch { return ''; } }

  let bodyInner = '';

  const readyBoot =
`<script>(function(){
  var need = new Set();
  var done = new Set();
  window.__requireReady = function(id){ try{ need.add(id); window.__ALL_SECTIONS_READY = (need.size===0); }catch(e){} };
  window.__markSectionReady = function(id){ try{ done.add(id); if ([].slice.call(need).every(function(x){return done.has(x);})){ window.__ALL_SECTIONS_READY = true; } }catch(e){} };
  window.__ALL_SECTIONS_READY = (need.size===0);
})();</script>`;

  bodyInner += readyBoot + '\n';
  const vendorDir = path.join(distDir, 'html', 'assets', 'js', 'vendor');
  const chartJs = path.join(vendorDir, 'chart.umd.js');
  const datalabelsJs = path.join(vendorDir, 'chartjs-plugin-datalabels.min.js');
  const fileUrl = p => 'file://' + p.replace(/\\/g, '/');

  let vendorTags = '';
  try { if (fs.existsSync(chartJs))       vendorTags += `<script src="${fileUrl(chartJs)}"></script>\n`; } catch {}
  try { if (fs.existsSync(datalabelsJs))  vendorTags += `<script src="${fileUrl(datalabelsJs)}"></script>\n`; } catch {}

  bodyInner += vendorTags;
  bodyInner += coverHtml({ repo: view?.repo, base: view?.base, head: view?.head, inputs: inputs || {}, generatedAt: view?.generatedAt, logoDataUri });

  bodyInner += '\n' + tocHtml();

  bodyInner += '\n' + introHtml(view);

  bodyInner += '\n' + summaryHtml(view);

  bodyInner += '\n' + (await resultsHtml(distDir, view));

  bodyInner += '\n' + dashboardHtml(view);

  bodyInner += '\n' + (await dependencyGraphsHtml(distDir));

  const diffOnce = await loadDiff(distDir);
  const items = Array.isArray(diffOnce?.items) ? diffOnce.items : [];

  const depBaseInner = dependencyPathsHtml(items, 'base');
  const depHeadInner = dependencyPathsHtml(items, 'head');
  bodyInner += '\n' + sectionWrapper({ id: 'dep-paths-base', title: '7. Dependency Paths — Base', num: 7, innerHtml: depBaseInner });
  bodyInner += '\n' + sectionWrapper({ id: 'dep-paths-head', title: '8. Dependency Paths — Head', num: 8, innerHtml: depHeadInner });

  const fixSection = await fixHtml(distDir);
  bodyInner += '\n' + fixSection;

  const css = makePrintCss();
  const html =
`<!doctype html>
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
</html>`;

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
