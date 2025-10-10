// src/render/pdf/pdf.js
// Phase 3.3 (PDF) — Cover + TOC + Intro, export to PDF using puppeteer-core.
// Self-contained: downloads a portable Chrome-for-Testing (stable) with @puppeteer/browsers if no browser is found.

const actionsCore = require('@actions/core');
const fsp = require('fs/promises');
const pth = require('path');
const os = require('os');
const { buildView } = require('../common/view');

async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); }
async function writeText(file, text) { await ensureDir(pth.dirname(file)); await fsp.writeFile(file, text, 'utf8'); }
function fileExistsSync(p) { try { require('fs').accessSync(p); return true; } catch { return false; } }

function rewriteLogoForPdf(logoUrl) {
  if (!logoUrl) return '';
  const u = String(logoUrl).trim();
  if (/^https?:\/\//i.test(u)) return u;          // absolute URL
  const htmlRel = u.replace(/^\.\//, '');
  if (htmlRel.startsWith('html/')) return '../' + htmlRel; // from dist/pdf -> dist/html/...
  return u; // relative to dist/pdf
}

function makeCss() {
  return `
@page { size: A4; margin: 18mm 14mm; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0b0f16; }
main { padding: 0; }
h1, h2, h3 { margin: 0 0 12px 0; }
p { margin: 0 0 10px 0; }
.small { color: #6b7280; font-size: 12px; }
.section { page-break-inside: avoid; margin-bottom: 18mm; }
.cover { page-break-after: always; display:flex; flex-direction:column; gap:16px; }
.cover .header { display:flex; align-items:center; justify-content:space-between; }
.cover .brand { display:flex; align-items:center; gap:12px; }
.cover .brand img { max-height: 40px; }
.cover h1 { font-size: 28px; margin: 18px 0 6px; }
.kv { display:grid; grid-template-columns: 140px 1fr; gap: 4px 12px; margin: 4px 0; }
.card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
.columns-2 { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.toc ol { margin: 0 0 0 18px; padding: 0; }
.toc li { margin: 6px 0; }
hr.sep { border: 0; border-top: 1px solid #e5e7eb; margin: 12px 0; }
  `.trim();
}

function makeIntroductionHtml({ repo, base, head }) {
  return `
<h2 id="introduction">Introduction</h2>
<p class="small">What you’re looking at</p>
<p>
  This report compares the security posture of <strong>${repo}</strong> between
  <strong>HEAD</strong> (<code>${head.ref}</code>, ${head.shaShort}) and
  <strong>BASE</strong> (<code>${base.ref}</code>, ${base.shaShort}).
  It highlights how known vulnerabilities differ across these two references so reviewers can quickly
  assess newly introduced risks, confirm improvements, and verify areas that remain unchanged.
</p>
<p class="small">How it was produced</p>
<ol>
  <li><strong>SBOM generation</strong> — via CycloneDX Maven (when a Maven reactor is detected) or Syft fallback.</li>
  <li><strong>Vulnerability scanning</strong> — SBOM analyzed with Grype to produce machine-readable findings (IDs, severities, CVSS, affected packages, locations, and fix data).</li>
  <li><strong>Normalization &amp; diff</strong> — findings normalized into a unified schema and compared using <code>vulnerability_id::groupId:artifactId:version</code>. Final states are: <em>NEW</em> (head only), <em>REMOVED</em> (base only), <em>UNCHANGED</em> (in both).</li>
  <li><strong>Rendering</strong> — interactive HTML dashboard plus a printable PDF and Markdown summary for CI/PR reviews.</li>
</ol>
<p class="small">Why this matters</p>
<p>
  The goal is to provide a transparent, reproducible view of changes in known vulnerabilities as the code evolves—supporting risk assessment,
  remediation prioritization, and merge decisions.
</p>
`.trim();
}

function makePrintHtml({ repo, base, head, generatedAt, logoUrl }) {
  const intro = makeIntroductionHtml({ repo, base, head });
  const srcLogo = rewriteLogoForPdf(logoUrl);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>Vulnerability Diff Report — ${repo}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="./assets/print.css" />
</head><body><main>
<section class="section cover" id="cover">
  <div class="header">
    <div class="brand">
      ${srcLogo ? `<img src="${srcLogo}" alt="Logo" />` : ``}
      <div><div class="small">Vulnerability Diff Report</div><h1>${repo}</h1></div>
    </div>
    <div class="small">Generated at<br/><strong>${generatedAt}</strong></div>
  </div>
  <div class="columns-2">
    <div class="card">
      <h3>Base</h3>
      <div class="kv"><div>Ref</div><div><code>${base.ref}</code></div></div>
      <div class="kv"><div>Commit</div><div><code>${base.shaShort}</code> (${base.sha})</div></div>
      <div class="kv"><div>Author</div><div>${base.author}</div></div>
      <div class="kv"><div>Authored at</div><div>${base.authoredAt}</div></div>
      <div class="kv"><div>Subject</div><div>${base.commitSubject}</div></div>
    </div>
    <div class="card">
      <h3>Head</h3>
      <div class="kv"><div>Ref</div><div><code>${head.ref}</code></div></div>
      <div class="kv"><div>Commit</div><div><code>${head.shaShort}</code> (${head.sha})</div></div>
      <div class="kv"><div>Author</div><div>${head.author}</div></div>
      <div class="kv"><div>Authored at</div><div>${head.authoredAt}</div></div>
      <div class="kv"><div>Subject</div><div>${head.commitSubject}</div></div>
    </div>
  </div>
</section>
<section class="section toc" id="table-of-contents">
  <h2>Table of Contents</h2>
  <ol>
    <li><a href="#cover">Cover</a></li>
    <li><a href="#table-of-contents">Table of Contents</a></li>
    <li><a href="#introduction">Introduction</a></li>
  </ol>
  <hr class="sep"/>
</section>
<section class="section">${intro}</section>
</main></body></html>`;
}

// ------------- Portable browser resolution / download (no sudo) -------------
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

async function ensurePortableChrome(cacheDir) {
  // Downloads Chrome for Testing (stable channel) to cacheDir using @puppeteer/browsers
  const { install, computeExecutablePath } = require('@puppeteer/browsers');
  // Map Node platform/arch to @puppeteer/browsers platform string
  const platformMap = {
    linux: 'linux',
    darwin: (os.arch() === 'arm64' ? 'mac-arm' : 'mac'),
    win32: 'win64'
  };
  const platform = platformMap[os.platform()];
  if (!platform) throw new Error(`Unsupported platform for portable Chrome: ${os.platform()}`);

  const buildId = 'stable'; // Chrome for Testing (stable channel)
  await install({
    browser: 'chrome',
    buildId,
    cacheDir,
    platform,
  });

  const execPath = computeExecutablePath({
    browser: 'chrome',
    cacheDir,
    platform,
    buildId,
  });
  if (!execPath || !fileExistsSync(execPath)) {
    throw new Error('Downloaded Chrome executable not found after install.');
  }
  return execPath;
}

async function resolveBrowserExecutable(outDir) {
  // 1) env / system
  for (const p of knownBrowserCandidates()) {
    if (fileExistsSync(p)) return p;
  }
  // 2) portable download into dist/pdf/.browsers
  const cacheDir = pth.join(outDir, '.browsers');
  await ensureDir(cacheDir);
  actionsCore.info('[render/pdf] no system browser found; downloading Chrome (stable) locally…');
  const execPath = await ensurePortableChrome(cacheDir);
  actionsCore.info(`[render/pdf] portable Chrome ready at: ${execPath}`);
  return execPath;
}

// ---------------------------- Main entrypoint -------------------------------
async function pdf_init({ distDir = './dist' } = {}) {
  actionsCore.startGroup('[render] PDF');
  try {
    const view = buildView(distDir);

    const outDir = pth.join(pth.resolve(distDir), 'pdf');
    const assetsDir = pth.join(outDir, 'assets');
    await ensureDir(outDir);
    await ensureDir(assetsDir);

    // CSS + HTML
    await writeText(pth.join(assetsDir, 'print.css'), makeCss());
    const logo = actionsCore.getInput('html_logo_url') || '';
    const html = makePrintHtml({
      repo: view.repo, generatedAt: view.generatedAt, base: view.base, head: view.head, logoUrl: logo,
    });
    const htmlPath = pth.join(outDir, 'print.html');
    await writeText(htmlPath, html);
    actionsCore.info(`[render/pdf] written: ${htmlPath}`);

    // puppeteer-core + browser (system or portable)
    let pptr;
    try { pptr = require('puppeteer-core'); }
    catch { throw new Error('puppeteer-core is not installed. Please add "puppeteer-core" to your dependencies.'); }

    const executablePath = await resolveBrowserExecutable(outDir);

    const browser = await pptr.launch({
      headless: 'new',
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });

    const pdfPath = pth.join(outDir, 'report.pdf');
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      format: 'A4',
      margin: { top: '18mm', right: '14mm', bottom: '18mm', left: '14mm' },
      preferCSSPageSize: false,
    });
    await browser.close();

    actionsCore.info(`[render/pdf] exported: ${pdfPath}`);
  } catch (e) {
    actionsCore.setFailed(`[render] PDF failed: ${e?.message || e}`);
    throw e;
  } finally {
    try { await fsp.rm(pth.join(outDir, '.browsers'), { recursive: true, force: true }); }
    catch (e) { actionsCore.warning(`[render/pdf] cannot remove portable browser: ${e.message}`); }

    actionsCore.endGroup();
  }
}

module.exports = { pdf_init };
