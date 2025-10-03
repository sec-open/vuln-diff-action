/**
 * PDF renderer (v2, compatible with v1 layout)
 * - Produce three separate PDFs:
 *   1) cover.pdf  (single page, no margins/header/footer)
 *   2) main.pdf   (A4 portrait content)
 *   3) landscape.pdf (A4 landscape content: graphs/paths)
 * - Merge them into report.pdf with pdf-lib
 * - Keep modular section builders (HTML strings) so we can evolve content per Chapter 8.
 * - Auto-install Chrome via @puppeteer/browsers when missing.
 *
 * All comments in English (project guideline).
 */

const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");
const os = require("os");
const puppeteer = require("puppeteer");
const {
  detectBrowserPlatform,
  resolveBuildId,
  computeExecutablePath,
  install: installBrowser,
} = require("@puppeteer/browsers");
const { PDFDocument } = require("pdf-lib");

/* -------------------------------------------------------------------------- */
/* Chrome bootstrap (self-sufficient)                                         */
/* -------------------------------------------------------------------------- */

async function ensureChromeExecutable() {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error("Unsupported platform for Puppeteer.");

  // Prefer Puppeteer's config cache directory, fallback to ~/.cache/puppeteer
  const pptrCfg = puppeteer.configuration?.();
  const cacheDir =
    process.env.PUPPETEER_CACHE_DIR ||
    (pptrCfg && pptrCfg.cache && pptrCfg.cache.directory) ||
    path.join(os.homedir(), ".cache", "puppeteer");

  const buildId = await resolveBuildId("chrome", platform, "stable");
  const execPath = computeExecutablePath({ browser: "chrome", cacheDir, platform, buildId });

  if (!(await fileExists(execPath))) {
    await installBrowser({
      browser: "chrome",
      cacheDir,
      platform,
      buildId,
      downloadProgressCallback(bytes, total) {
        if (total) {
          const pct = ((bytes / total) * 100).toFixed(1);
          console.log(`[puppeteer] Downloading Chrome ${buildId}… ${pct}%`);
        }
      },
    });
  }
  if (!(await fileExists(execPath))) throw new Error(`Chrome executable not found after install: ${execPath}`);
  return execPath;
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/* -------------------------------------------------------------------------- */
/* Public entrypoint                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Render the final report.pdf by composing three PDFs (cover/main/landscape).
 * @param {Object} opts
 * @param {string} opts.outDir
 * @param {Object} opts.baseJson
 * @param {Object} opts.headJson
 * @param {Object} opts.diffJson
 * @param {string} [opts.titleLogoUrl]
 * @param {string} [opts.baseLabel]
 * @param {string} [opts.headLabel]
 * @param {number} [opts.graphMaxNodes]
 * @returns {Promise<{ pdfPath: string, parts: {cover: string, main: string, landscape: string} }>}
 */
async function renderPdfReport(opts) {
  const {
    outDir,
    baseJson,
    headJson,
    diffJson,
    titleLogoUrl = "",
    baseLabel = "BASE",
    headLabel = "HEAD",
    graphMaxNodes = 150,
  } = opts || {};
  if (!outDir) throw new Error("renderPdfReport: 'outDir' is required");

  const pdfDir = path.join(outDir, "pdf");
  await fs.mkdir(pdfDir, { recursive: true });

  // Build HTML sections (as strings)
  const coverHtml = await buildCoverHtml({ titleLogoUrl, baseLabel, headLabel, baseJson, headJson });
  const mainHtml  = await buildMainHtml({ baseJson, headJson, diffJson });
  const landHtml  = await buildLandscapeHtml({ diffJson, graphMaxNodes });

  // Ensure Chrome and launch Puppeteer with explicit executablePath
  const executablePath = await ensureChromeExecutable();
  const browser = await puppeteer.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Render three separate PDFs
  const coverPdfPath = path.join(pdfDir, "cover.pdf");
  const mainPdfPath  = path.join(pdfDir, "main.pdf");
  const landPdfPath  = path.join(pdfDir, "landscape.pdf");

  try {
    // COVER: single page, no margins/background header/footer; center content
    await htmlToPdf(browser, wrapHtml(coverHtml, coverCss()), coverPdfPath, {
      format: "A4",
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
      landscape: false,
      preferCSSPageSize: true,
    });

    // MAIN: A4 portrait, standard margins
    await htmlToPdf(browser, wrapHtml(mainHtml, mainCss()), mainPdfPath, {
      format: "A4",
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      landscape: false,
      preferCSSPageSize: true,
    });

    // LANDSCAPE: A4 landscape, standard margins
    await htmlToPdf(browser, wrapHtml(landHtml, landscapeCss()), landPdfPath, {
      format: "A4",
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      landscape: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }

  // Merge PDFs (cover + main + landscape) into report.pdf
  const parts = [coverPdfPath, mainPdfPath, landPdfPath].filter(p => fssync.existsSync(p));
  const reportPdf = path.join(outDir, "report.pdf");
  await mergePdfs(parts, reportPdf);

  return { pdfPath: reportPdf, parts: { cover: coverPdfPath, main: mainPdfPath, landscape: landPdfPath } };
}

/* -------------------------------------------------------------------------- */
/* Section builders (initial; evolve per Chapter 8)                           */
/* -------------------------------------------------------------------------- */

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function buildCoverHtml({ titleLogoUrl = "", baseLabel = "BASE", headLabel = "HEAD", baseJson, headJson }) {
  const baseSha = baseJson?.git?.sha_short || "";
  const headSha = headJson?.git?.sha_short || "";
  const now = new Date().toISOString().replace("T", " ").replace("Z", " UTC");

  return `
<section class="cover">
  ${titleLogoUrl ? `<img class="logo" src="${esc(titleLogoUrl)}" alt="Logo" />` : ""}
  <h1>Security Report</h1>
  <p class="muted">${esc(now)}</p>
  <div class="kv">
    <div><strong>${esc(baseLabel)}:</strong> <code>${esc(baseJson?.git?.ref || "")}</code> @ <code>${esc(baseSha)}</code></div>
    <div><strong>${esc(headLabel)}:</strong> <code>${esc(headJson?.git?.ref || "")}</code> @ <code>${esc(headSha)}</code></div>
  </div>
</section>
`;
}

async function buildMainHtml({ baseJson, headJson, diffJson }) {
  const baseMsg = baseJson?.git?.commit_subject || "";
  const headMsg = headJson?.git?.commit_subject || "";

  const totals = diffJson?.summary?.totals || {};
  const bySevBase = baseJson?.summary?.by_severity || {};
  const bySevHead = headJson?.summary?.by_severity || {};

  return `
<section class="page">
  <div class="toc">
    <h2>Table of contents</h2>
    <ol>
      <li>Introduction</li>
      <li>Summary</li>
      <li>Overview</li>
      <li>Vulnerability diff table</li>
      <li>Graph</li>
      <li>Path</li>
    </ol>
  </div>

  <h2>1. Introduction</h2>
  <p>This report compares known vulnerabilities between two Git references and presents a reproducible, printable view to help reviewers assess risk, spot regressions (NEW), improvements (REMOVED) and unchanged areas.</p>

  <h2>2. Summary</h2>
  <ul class="bul">
    <li><strong>BASE:</strong> <code>${esc(baseJson?.git?.ref || "")}</code> @ <code>${esc(baseJson?.git?.sha_short || "")}</code> — ${esc(baseMsg)}</li>
    <li><strong>HEAD:</strong> <code>${esc(headJson?.git?.ref || "")}</code> @ <code>${esc(headJson?.git?.sha_short || "")}</code> — ${esc(headMsg)}</li>
  </ul>

  <div class="cards">
    <div class="card"><div class="k">NEW</div><div class="v">${totals.NEW ?? 0}</div></div>
    <div class="card"><div class="k">REMOVED</div><div class="v">${totals.REMOVED ?? 0}</div></div>
    <div class="card"><div class="k">UNCHANGED</div><div class="v">${totals.UNCHANGED ?? 0}</div></div>
  </div>

  <div class="row">
    <div class="panel">
      <h3>BASE severity</h3>
      ${sevRowTable(bySevBase)}
    </div>
    <div class="panel">
      <h3>HEAD severity</h3>
      ${sevRowTable(bySevHead)}
    </div>
  </div>

  <!-- 3. Overview & 4. Diff table will be expanded next iterations per Chapter 8 -->
</section>
`;
}

async function buildLandscapeHtml({ diffJson, graphMaxNodes = 150 }) {
  // Placeholder landscape sections; will be replaced by Mermaid and Path tables
  const note = `Graphs up to ${Number.isFinite(graphMaxNodes) ? graphMaxNodes : 150} nodes.`;
  return `
<section class="land">
  <h2>5. Graph</h2>
  <p class="muted">${esc(note)}</p>
  <div class="placeholder">Mermaid graphs (base/head) will be rendered here.</div>
</section>
<section class="land">
  <h2>6. Path</h2>
  <div class="placeholder">Dependency path tables (base/head) will be rendered here.</div>
</section>
`;
}

/* -------------------------------------------------------------------------- */
/* HTML → PDF helpers                                                         */
/* -------------------------------------------------------------------------- */

function wrapHtml(body, css) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>Vulnerability Diff Report</title><style>${css}</style></head>
<body>${body}</body>
</html>`;
}

async function htmlToPdf(browser, html, outPath, pdfOptions) {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: ["domcontentloaded"] });
    await page.emulateMediaType("screen");
    await page.pdf({ path: outPath, ...pdfOptions });
  } finally {
    await page.close();
  }
}

/* -------------------------------------------------------------------------- */
/* Merge PDFs with pdf-lib                                                    */
/* -------------------------------------------------------------------------- */

async function mergePdfs(paths, outPath) {
  const merged = await PDFDocument.create();

  for (const p of paths) {
    if (!p || !fssync.existsSync(p)) continue;
    const bytes = await fs.readFile(p);
    const src = await PDFDocument.load(bytes);
    const copied = await merged.copyPages(src, src.getPageIndices());
    copied.forEach(pg => merged.addPage(pg));
  }

  const outBytes = await merged.save();
  await fs.writeFile(outPath, outBytes);
}

/* -------------------------------------------------------------------------- */
/* Minimal CSS per block                                                      */
/* -------------------------------------------------------------------------- */

function baseVars() {
  return `
:root { --fg:#111; --muted:#666; --bd:#ddd; }
html,body { margin:0; padding:0; }
body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: var(--fg); }
h1,h2,h3 { margin: 0.2em 0 0.4em; }
.muted { color: var(--muted); }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--bd); padding: 6px 8px; }
.cards { display:flex; gap:12px; margin:14px 0 10px; }
.card { border:1px solid var(--bd); border-radius:8px; padding:10px 12px; min-width:110px; text-align:center; }
.card .k { font-weight: 600; }
.row { display:flex; gap:18px; flex-wrap:wrap; }
.panel { flex:1 1 320px; border:1px solid var(--bd); border-radius:8px; padding:12px; }
.placeholder { border:1px dashed #bbb; padding:16px; min-height:140px; }
  `;
}

function coverCss() {
  return `
${baseVars()}
.cover { display:flex; flex-direction:column; align-items:center; justify-content:center; height: 100vh; gap:12px; padding: 24px; }
.cover .logo { max-height: 72px; object-fit: contain; }
.kv { margin-top: 8px; text-align:center; }
@page { size: A4; margin: 0; }
  `;
}

function mainCss() {
  return `
${baseVars()}
.page { padding: 20mm 16mm; }
.toc { text-align:center; margin: 10mm 0 12mm; }
.toc ol { display:inline-block; text-align:left; }
@page { size: A4; margin: 12mm; }
  `;
}

function landscapeCss() {
  return `
${baseVars()}
.land { padding: 16mm; page-break-after: always; }
@page { size: A4 landscape; margin: 12mm; }
  `;
}

/* -------------------------------------------------------------------------- */

function sevRowTable(bySev) {
  const s = bySev || {};
  const headers = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
  const cells = headers.map(h => `<td>${s[h] ?? 0}</td>`).join("");
  return `<table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody><tr>${cells}</tr></tbody>
  </table>`;
}

module.exports = {
  renderPdfReport,
  // Section builders exposed for incremental development
  buildCoverHtml,
  buildMainHtml,
  buildLandscapeHtml,
  // Expose low-level helpers for tests (optional)
  _internal: { htmlToPdf, mergePdfs, ensureChromeExecutable, wrapHtml }
};
