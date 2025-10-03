/**
 * PDF renderer (Puppeteer)
 * - Ensures a Chrome/Chromium binary is available (downloads if missing)
 *   using @puppeteer/browsers, then launches Puppeteer with that path.
 * - Exports renderPdfReport(opts) used by index.js
 * - Keeps section builders: buildCoverHtml, buildMainHtml, buildLandscapeHtml
 * Comments in English per project guideline.
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

/* ---------------- Ensure Chrome present & get executablePath ---------------- */

async function ensureChromeExecutable() {
  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error("Unsupported platform for Puppeteer.");
  }

  // Prefer Puppeteer's configured cache dir; fallback to ~/.cache/puppeteer
  const pptrCfg = puppeteer.configuration?.();
  const cacheDir =
    process.env.PUPPETEER_CACHE_DIR ||
    (pptrCfg && pptrCfg.cache && pptrCfg.cache.directory) ||
    path.join(os.homedir(), ".cache", "puppeteer");

  // Resolve a stable Chrome build id for this platform
  const buildId = await resolveBuildId("chrome", platform, "stable");

  const execPath = computeExecutablePath({
    browser: "chrome",
    cacheDir,
    platform,
    buildId,
  });

  // If the executable does not exist, download & install it
  const exists = await fileExists(execPath);
  if (!exists) {
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

  // Sanity check
  if (!(await fileExists(execPath))) {
    throw new Error(`Chrome executable not found after install: ${execPath}`);
  }
  return execPath;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Public entrypoint ---------------- */

/**
 * Entrypoint called by src/index.js
 * @param {Object} opts
 * @param {string} opts.outDir
 * @param {Object} opts.baseJson
 * @param {Object} opts.headJson
 * @param {Object} opts.diffJson
 * @param {string} [opts.titleLogoUrl]
 * @param {string} [opts.baseLabel]
 * @param {string} [opts.headLabel]
 * @param {number} [opts.graphMaxNodes]
 * @returns {Promise<{ pdfPath: string, htmlPath: string }>}
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

  // Build HTML (simple scaffolding; sections can be expanded per Chapter 8)
  const cover = await buildCoverHtml({ titleLogoUrl, baseLabel, headLabel, baseJson, headJson });
  const main = await buildMainHtml({ baseJson, headJson, diffJson });
  const landscape = await buildLandscapeHtml({ diffJson, graphMaxNodes });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Vulnerability Diff Report</title>
<style>${basicCss()}</style>
</head>
<body>
${cover}
${main}
${landscape}
</body>
</html>`;

  const htmlPath = path.join(pdfDir, "report.html");
  await fs.writeFile(htmlPath, html, "utf8");

  // Ensure Chrome is present and launch Puppeteer with explicit executablePath
  const executablePath = await ensureChromeExecutable();

  const browser = await puppeteer.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    // Use file content directly to avoid file:// CSP oddities
    await page.setContent(html, { waitUntil: ["domcontentloaded"] });
    await page.emulateMediaType("screen");

    const pdfPath = path.join(outDir, "report.pdf");
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });

    return { pdfPath, htmlPath };
  } finally {
    await browser.close();
  }
}

/* ---------------- Section builders (initial incremental version) ---------------- */

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
  <h1>Vulnerability Diff Report</h1>
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
<section class="report">
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
  <p>This document compares known vulnerabilities between two Git references. It includes a high-level summary, an overview with counts per severity and state, a detailed diff table, and visual sections.</p>

  <h2>2. Summary</h2>
  <ul>
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
</section>
`;
}

async function buildLandscapeHtml({ diffJson, graphMaxNodes = 150 }) {
  const note = `Graphs up to ${Number.isFinite(graphMaxNodes) ? graphMaxNodes : 150} nodes (placeholder).`;
  return `
<section class="landscape">
  <h2>5. Graph</h2>
  <p class="muted">${esc(note)}</p>
  <div class="chart-placeholder">Mermaid/Chart content rendered in HTML renderer; PDF keeps a placeholder by design.</div>
</section>
<section class="landscape">
  <h2>6. Path</h2>
  <div class="table-placeholder">Dependency paths will be rendered as tables.</div>
</section>
`;
}

/* ---------------- Helpers ---------------- */

function sevRowTable(bySev) {
  const s = bySev || {};
  const headers = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
  const cells = headers.map(h => `<td>${s[h] ?? 0}</td>`).join("");
  return `<table class="table">
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody><tr>${cells}</tr></tbody>
  </table>`;
}

function basicCss() {
  return `
  :root { --fg:#111; --muted:#666; --bd:#ddd; }
  html,body { margin:0; padding:0; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: var(--fg); }
  h1,h2,h3 { margin: 0.2em 0 0.4em; }
  .muted { color: var(--muted); }
  .cover { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height: 90vh; gap:10px; padding: 24px; }
  .cover .logo { max-height: 64px; object-fit: contain; }
  .kv { margin-top: 8px; }
  .report { padding: 24px; page-break-before: always; }
  .toc { text-align:center; margin: 16px 0 24px; }
  .toc ol { display:inline-block; text-align:left; }
  .cards { display:flex; gap:12px; margin:14px 0 10px; }
  .card { border:1px solid var(--bd); border-radius:8px; padding:10px 12px; min-width:110px; text-align:center; }
  .card .k { font-weight: 600; }
  .row { display:flex; gap:18px; flex-wrap:wrap; }
  .panel { flex:1 1 320px; border:1px solid var(--bd); border-radius:8px; padding:12px; }
  table.table { width:100%; border-collapse: collapse; margin: 4px 0; }
  table.table th, table.table td { border:1px solid var(--bd); padding:6px 8px; }
  .chart-placeholder, .table-placeholder { border:1px dashed #bbb; padding:16px; min-height:140px; }
  .landscape { page-break-before: always; }
  @page { size: A4; margin: 12mm; }
  `;
}

module.exports = {
  renderPdfReport,
  buildCoverHtml,
  buildMainHtml,
  buildLandscapeHtml,
};
