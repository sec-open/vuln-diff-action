// src/render/pdf.js
// Focused PDF renderer: Cover + Main (TOC, Introduction, Summary).
// Keeps the module SELF-CONTAINED and independent of Markdown/HTML renderers.
//
// Exports:
// - buildCoverHtml({ repository, baseLabel, headLabel, titleLogoUrl, generatedAt, coverBg, coverFg })
// - buildMainHtml({ repository, base, head, counts, minSeverity, diff, tooling, logo })
// - htmlToPdf(html, outPath, opts)
// - (safe stubs) buildDiffTableHtml, buildLandscapeHtml, buildPathsTableHtml, buildMermaidGraphForPdf, mergePdfs
//
// Notes:
// - Cover is a single A4 page with zero margins and a fixed-size container to avoid cuts.
// - Main pages use standard A4 margins; TOC is centered with increased line-height.
// - Introduction uses provided `tooling` versions; fallback placeholder "v?.?.?" when missing.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { PDFDocument } = require("pdf-lib");

/* -------------------------- Puppeteer resolution -------------------------- */
/** Try to require puppeteer first, then puppeteer-core. */
function resolvePuppeteerModule() {
  try { return require("puppeteer"); } catch (_) { /* ignore */ }
  try { return require("puppeteer-core"); } catch (_) { /* ignore */ }
  return null;
}

/** which(1) helper. */
function which(bin) {
  try {
    const out = execSync(`which ${bin}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Resolve Chrome/Chromium executable path. */
function resolveChromeExecutablePath(puppeteer) {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;

  try {
    if (puppeteer && typeof puppeteer.executablePath === "function") {
      const xp = puppeteer.executablePath();
      if (xp && fs.existsSync(xp)) return xp;
    }
  } catch { /* ignore */ }

  const candidates = ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium"];
  for (const name of candidates) {
    const found = which(name);
    if (found && fs.existsSync(found)) return found;
  }

  const hardcoded = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const p of hardcoded) if (fs.existsSync(p)) return p;

  return null;
}

/** Install browser at runtime via npx so consumer workflows don't change. */
function tryInstallBrowser(product = "chrome") {
  const cmd = `npx --yes puppeteer browsers install ${product}`;
  try {
    execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------- Theme --------------------------------- */
const COVER_BG = "#0b2239";
const COVER_FG = "#ffffff";

/* --------------------------------- Utils --------------------------------- */
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleLine(repository, baseLabel, headLabel) {
  return `Security Report — ${repository} — ${baseLabel} vs ${headLabel}`;
}

function nowEU() {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date()).replace(",", "");
  } catch {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(
      d.getHours()
    )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
}

function short(s, n = 80) {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function severityCountsToString(obj = {}) {
  // Order by typical criticality
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
  return order.map(k => `${k}:${obj[k] ?? 0}`).join(" · ");
}

function fmtSha(sha) {
  return (sha || "").slice(0, 12);
}

function safeVersion(v) {
  return v ? `v${String(v).replace(/^v/i, "")}` : "v?.?.?";
}

/* ---------------------------------- CSS ---------------------------------- */
// COVER: single page, zero margins, fixed A4 container to avoid cut-offs.
const COVER_CSS = `
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; }
.cover {
  width: 210mm;
  height: 297mm;
  background: VAR_BG;
  color: VAR_FG;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  box-sizing: border-box;
  padding: 18mm 12mm;
}
.cover .repo {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
  font-size: 18px;
  opacity: .9;
  margin-bottom: 4mm;
}
.cover h1 {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
  font-size: 26px;
  line-height: 1.25;
  margin: 0 0 6mm 0;
}
.cover .date {
  font-size: 13px;
  opacity: .9;
}
.cover .logo-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 14mm;
  width: 100%;
}
.cover .logo-wrap img {
  display: block;
  max-width: 140mm;
  max-height: 40mm;
  width: auto;
  height: auto;
  object-fit: contain;
}
`;

// MAIN: normal A4 margins; TOC centered and airy.
const MAIN_CSS = `
@page { size: A4; margin: 14mm 12mm 14mm 12mm; }
html, body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
  color:#111;
}
h1, h2, h3 { margin: 0 0 8px 0; line-height: 1.3; }
h1 { font-size: 20px; }
h2 { font-size: 17px; }
h3 { font-size: 15px; }
p { margin: 0 0 10px 0; line-height: 1.5; }
.small { font-size: 12px; color:#555; }
.muted { color:#666; }
.nowrap { white-space: nowrap; }

section { page-break-inside: avoid; margin: 0 0 14mm 0; }

/* Header/Footer injected by Puppeteer templates (if used later) */
.header, .footer { font-size: 10px; color:#444; }

/* TOC centered with larger line spacing */
.toc {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220mm; /* center vertically on page */
}
.toc-inner {
  text-align: left;
  width: 120mm;         /* narrower column in the center */
  line-height: 2.0;     /* airy */
}
.toc-title {
  font-size: 22px;
  text-align: center;
  margin-bottom: 10mm;
}
.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 14px;
}

/* Tables used in Summary */
table { border-collapse: collapse; width: 100%; font-size: 12px; table-layout: fixed; }
th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
th { background:#f6f8fa; text-align:left; }
.break { word-break: break-word; overflow-wrap: anywhere; }
`;

/* --------------------------------- Cover --------------------------------- */
function buildCoverHtml({
  repository,
  baseLabel,
  headLabel,
  titleLogoUrl,
  generatedAt,
  coverBg = COVER_BG,
  coverFg = COVER_FG,
}) {
  const title = titleLine(repository, baseLabel, headLabel);
  const css = COVER_CSS.replace("VAR_BG", escHtml(coverBg)).replace("VAR_FG", escHtml(coverFg));

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${css}</style>
<title>${escHtml(title)}</title>
</head>
<body>
  <section class="cover">
    <div class="repo">${escHtml(repository)}</div>
    <h1>${escHtml(title)}</h1>
    <div class="date">${escHtml(generatedAt || nowEU())}</div>
    ${
      titleLogoUrl
        ? `<div class="logo-wrap"><img src="${escHtml(titleLogoUrl)}" alt="logo"></div>`
        : ""
    }
  </section>
</body>
</html>
`.trim();
}

/* ------------------------------ Main document ---------------------------- */
/**
 * Build the MAIN document with: Table of Contents, Introduction, Summary.
 * Other sections (charts, diff table, paths/graphs) will be added later.
 *
 * @param {object} params
 *   - repository {string}
 *   - base { label, sha, message }
 *   - head { label, sha, message }
 *   - counts { base: {CRITICAL,HIGH,...}, head: {...} }
 *   - minSeverity {string}
 *   - diff { news:[], removed:[], unchanged:[] }
 *   - tooling { cyclonedx, syft, grype, chartjs, mermaid, puppeteer } // versions, raw without "v"
 *   - logo {string} // optional footer logo (reserved for future headers/footers)
 * @returns {{header:string, footer:string, body:string}}
 */
function buildMainHtml({
  repository,
  base = {},
  head = {},
  counts = {},
  minSeverity = "LOW",
  diff = {},
  tooling = {},
  logo,
} = {}) {
  const baseLabel = base.label || "base";
  const headLabel = head.label || "head";

  // Header/Footer templates kept minimal for now (we can enrich later).
  const headerTemplate = `
<style>
  .hdr { font-size:10px; width:100%; padding:0 8mm; color:#555; }
  .hdr .line { display:flex; justify-content:space-between; width:100%; }
</style>
<div class="hdr">
  <div class="line">
    <div>${escHtml(titleLine(repository, baseLabel, headLabel))}</div>
    <div></div>
  </div>
</div>`.trim();

  const footerTemplate = `
<style>
  .ftr { font-size:10px; width:100%; padding:0 8mm; color:#555; }
  .ftr .line { display:flex; justify-content:space-between; width:100%; }
</style>
<div class="ftr">
  <div class="line">
    <div>${logo ? `<img src="${escHtml(logo)}" style="height:10px">` : ""}</div>
    <div><span class="pageNumber"></span> / <span class="totalPages"></span> • ${escHtml(nowEU())}</div>
  </div>
</div>`.trim();

  // 1) Table of Contents (centered, numbered, airy)
  const toc = `
<section class="toc">
  <div class="toc-inner">
    <div class="toc-title">Table of contents</div>
    <ul class="toc-list">
      <li>1. Introduction</li>
      <li>2. Summary</li>
      <li>3. Severity distribution</li>
      <li>4. Change overview</li>
      <li>5. Vulnerability diff table</li>
      <li>6. Dependency graph base</li>
      <li>7. Dependency graph head</li>
      <li>8. Dependency path base</li>
      <li>9. Dependency path head</li>
    </ul>
  </div>
</section>`;

  // 2) Introduction (with repository, branches and actual tool versions)
  const intro = `
<section>
  <h2>1. Introduction</h2>
  <p>This security report has been generated for the repository <b>${escHtml(
    repository
  )}</b> to provide a clear, side-by-side comparison of vulnerabilities detected between two branches:
  <b>${escHtml(baseLabel)}</b> (base reference) and <b>${escHtml(
    headLabel
  )}</b> (head). Its goal is to highlight which vulnerabilities have been introduced, which have been fixed, and which remain unchanged, so that maintainers can verify that ongoing development does not inadvertently increase the project’s security risk.</p>

  <h3>Methodology and tooling</h3>
  <ul>
    <li>CycloneDX Maven plugin (${escHtml(safeVersion(tooling.cyclonedx))}) — Generates an accurate Software Bill of Materials (SBOM) for Java multi-module builds.</li>
    <li>Syft (${escHtml(safeVersion(tooling.syft))}) — Fallback SBOM generator for content outside Maven’s scope.</li>
    <li>Grype (${escHtml(safeVersion(tooling.grype))}) — Scans the generated SBOMs to detect known CVEs and advisories.</li>
    <li>Chart.js (${escHtml(safeVersion(tooling.chartjs))}) — Visualizes severity levels and cross-branch changes.</li>
    <li>Mermaid (${escHtml(safeVersion(tooling.mermaid))}) — Renders dependency graphs (landscape pages) to illustrate relationships and depth of vulnerable packages.</li>
    <li>Puppeteer (${escHtml(safeVersion(tooling.puppeteer))}) — Automates export to PDF for portability and readability.</li>
  </ul>
  <p>By combining these tools in a consistent pipeline, the comparison between <b>${escHtml(
    baseLabel
  )}</b> and <b>${escHtml(headLabel)}</b> is both comprehensive and easy to interpret.</p>
</section>`;

  // 3) Summary (branch details + severity counts + diff overview)
  const diffNew = (diff.news || []).length;
  const diffRemoved = (diff.removed || []).length;
  const diffUnchanged = (diff.unchanged || []).length;

  const summary = `
<section>
  <h2>2. Summary</h2>

  <h3>2.1 Branch details</h3>
  <table>
    <thead>
      <tr>
        <th>Branch</th>
        <th>Commit</th>
        <th>Message</th>
        <th>Severity counts</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="nowrap"><b>${escHtml(baseLabel)}</b></td>
        <td class="nowrap"><code>${escHtml(fmtSha(base.sha))}</code></td>
        <td class="break">${escHtml(base.message || "")}</td>
        <td class="nowrap">${escHtml(severityCountsToString(counts.base || {}))}</td>
      </tr>
      <tr>
        <td class="nowrap"><b>${escHtml(headLabel)}</b></td>
        <td class="nowrap"><code>${escHtml(fmtSha(head.sha))}</code></td>
        <td class="break">${escHtml(head.message || "")}</td>
        <td class="nowrap">${escHtml(severityCountsToString(counts.head || {}))}</td>
      </tr>
    </tbody>
  </table>
  <p class="small">Minimum severity considered: <b>${escHtml(minSeverity)}</b></p>

  <h3>2.2 Change overview</h3>
  <table>
    <thead>
      <tr>
        <th>New</th>
        <th>Removed</th>
        <th>Unchanged</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${diffNew}</td>
        <td>${diffRemoved}</td>
        <td>${diffUnchanged}</td>
      </tr>
    </tbody>
  </table>
</section>`;

  const body = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${MAIN_CSS}</style>
<title>${escHtml(titleLine(repository, baseLabel, headLabel))}</title>
</head>
<body>
  ${toc}
  ${intro}
  ${summary}
</body>
</html>`.trim();

  return { header: headerTemplate, footer: footerTemplate, body };
}

/* ------------------------------ Puppeteer I/O ------------------------------ */
/**
 * Render an HTML string to a PDF file using Puppeteer/Chromium.
 * Forces `preferCSSPageSize` to honor our @page declarations.
 */
async function htmlToPdf(html, outPath, opts = {}) {
  const { launchArgs = ["--no-sandbox", "--disable-setuid-sandbox"] } = opts;

  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  // Load puppeteer (try install at runtime if missing)
  let puppeteer = resolvePuppeteerModule();
  if (!puppeteer) {
    try {
      execSync("npm i -D puppeteer", { stdio: ["ignore", "pipe", "pipe"] });
      puppeteer = require("puppeteer");
    } catch {
      try {
        execSync("npm i -D puppeteer-core", { stdio: ["ignore", "pipe", "pipe"] });
        puppeteer = require("puppeteer-core");
      } catch {
        throw new Error("Unable to load puppeteer/puppeteer-core and runtime install failed.");
      }
    }
  }

  // Resolve browser path; auto-install if not found.
  let executablePath = resolveChromeExecutablePath(puppeteer);
  if (!executablePath) {
    const okChrome = tryInstallBrowser("chrome");
    if (!okChrome) tryInstallBrowser("chromium");
    executablePath = resolveChromeExecutablePath(puppeteer);
  }

  // Launch
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: executablePath || undefined,
      args: launchArgs,
    });
  } catch {
    // Last attempt without explicit executable
    browser = await puppeteer.launch({
      headless: "new",
      args: launchArgs,
    });
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outPath,
      format: "A4",
      landscape: false,
      displayHeaderFooter: false,
      margin: { top: "0", right: "0", bottom: "0", left: "0" }, // let CSS @page control margins
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

/* ------------------------------- Safe stubs ------------------------------- */
// Minimal placeholders to keep API compatibility while we iterate other sections.
function buildDiffTableHtml(/* diff */) {
  return `<table><thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Branches</th><th>Status</th></tr></thead><tbody></tbody></table>`;
}

function buildLandscapeHtml() {
  const body = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@page { size: A4 landscape; margin: 14mm 12mm 14mm 12mm; }
html, body { margin:0; padding:0; }
</style>
</head>
<body></body>
</html>`.trim();

  return { header: "", footer: "", body };
}

function buildPathsTableHtml() {
  return `<thead><tr><th>Module</th></tr></thead><tbody></tbody>`;
}

function buildMermaidGraphForPdf() {
  return "";
}

async function mergePdfs(inFiles, outFile) {
  const pdfDoc = await PDFDocument.create();
  for (const file of inFiles || []) {
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    const src = await PDFDocument.load(bytes);
    const copied = await pdfDoc.copyPages(src, src.getPageIndices());
    for (const p of copied) pdfDoc.addPage(p);
  }
  const outBytes = await pdfDoc.save();
  fs.writeFileSync(outFile, outBytes);
}

/* --------------------------------- Exports -------------------------------- */
module.exports = {
  buildCoverHtml,
  buildMainHtml,
  htmlToPdf,
  // temporary safe stubs to avoid breaking callers:
  buildDiffTableHtml,
  buildLandscapeHtml,
  buildPathsTableHtml,
  buildMermaidGraphForPdf,
  mergePdfs,
};
