// src/render/pdf.js
// Minimal PDF renderer focused ONLY on the COVER page, but exporting harmless stubs
// for legacy calls (e.g., buildDiffTableHtml) so we don't break index.js.
//
// Exports:
// - buildCoverHtml({ repository, baseLabel, headLabel, titleLogoUrl, generatedAt, coverBg, coverFg })
// - htmlToPdf(html, outPath, opts)
// - buildDiffTableHtml(diff)                  // stub: empty table
// - buildMainHtml()                           // stub: empty, single blank node (no extra page content)
// - buildLandscapeHtml()                      // stub: empty
// - buildPathsTableHtml()                     // stub: empty thead/tbody
// - buildMermaidGraphForPdf()                 // stub: empty string
// - mergePdfs()                               // passthrough no-op merge if needed later

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

/* ---------------------------------- CSS ---------------------------------- */
// Force a single-page A4 cover with zero PDF margins. The container is exactly A4.
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
  max-width: 140mm;   /* generous width below page width */
  max-height: 40mm;   /* critical to avoid vertical overflow/cut */
  width: auto;
  height: auto;
  object-fit: contain; /* never crop the logo */
}
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

/* ------------------------------ Puppeteer I/O ------------------------------ */
/**
 * Render an HTML string to a PDF file using Puppeteer/Chromium.
 * Forces zero margins & preferCSSPageSize so the A4 cover fits exactly one page.
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
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

/* ------------------------------- Safe stubs ------------------------------- */
// NOTE: These stubs exist ONLY to avoid breaking index.js while we rebuild the PDF piece by piece.
// They return minimal/empty HTML so they DO NOT add meaningful pages to the final PDF.

function buildDiffTableHtml(/* diff */) {
  // Minimal empty table to satisfy callers.
  return `<table><thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Branches</th><th>Status</th></tr></thead><tbody></tbody></table>`;
}

function buildMainHtml() {
  // Empty document (no header/footer), CSS hides everything; one blank page at most if used.
  const body = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@page { size: A4; margin: 0; }
html, body { margin:0; padding:0; }
body { display: none; } /* hide everything (defensive) */
</style>
</head>
<body></body>
</html>`.trim();

  return { header: "", footer: "", body };
}

function buildLandscapeHtml() {
  // Same idea: return an "invisible" document.
  const body = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@page { size: A4 landscape; margin: 0; }
html, body { margin:0; padding:0; }
body { display: none; }
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

/** No-op merge to keep API compatible; if called, it just concatenates if files exist. */
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
  htmlToPdf,
  // temporary safe stubs to avoid breaking callers:
  buildDiffTableHtml,
  buildMainHtml,
  buildLandscapeHtml,
  buildPathsTableHtml,
  buildMermaidGraphForPdf,
  mergePdfs,
};
