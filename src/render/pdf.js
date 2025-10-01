// src/render/pdf.js
// Focused PDF renderer: Cover + Main (TOC, Introduction, Summary) with clean pagination.
// Self-contained: does not reuse Markdown/HTML renderers.
//
// Exports:
// - buildCoverHtml({ repository, baseLabel, headLabel, titleLogoUrl, generatedAt, coverBg, coverFg })
// - buildMainHtml({ repository, base, head, counts, minSeverity, diff, tooling, logo, baseDataPath, headDataPath, diffDataPath })
// - htmlToPdf(html, outPath, opts)
// - (safe stubs) buildDiffTableHtml, buildLandscapeHtml, buildPathsTableHtml, buildMermaidGraphForPdf, mergePdfs
//
// Notes:
// - Each main section (TOC, Introduction, Summary) starts on a new page.
// - Tool versions: try to resolve from package.json; if unknown, print only the tool name (no parentheses).
// - Severity counts: if not provided, try to load from base/head JSON files and compute.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { PDFDocument } = require("pdf-lib");

/* -------------------------- Puppeteer resolution -------------------------- */
function resolvePuppeteerModule() {
  try { return require("puppeteer"); } catch (_) { /* ignore */ }
  try { return require("puppeteer-core"); } catch (_) { /* ignore */ }
  return null;
}
function which(bin) {
  try {
    const out = execSync(`which ${bin}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return out || null;
  } catch { return null; }
}
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
  const hardcoded = ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
  for (const p of hardcoded) if (fs.existsSync(p)) return p;
  return null;
}
function tryInstallBrowser(product = "chrome") {
  const cmd = `npx --yes puppeteer browsers install ${product}`;
  try { execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }); return true; } catch { return false; }
}

/* --------------------------------- Theme --------------------------------- */
const COVER_BG = "#0b2239";
const COVER_FG = "#ffffff";

/* --------------------------------- Utils --------------------------------- */
function escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function titleLine(repository, baseLabel, headLabel) { return `Security Report — ${repository} — ${baseLabel} vs ${headLabel}`; }
function nowEU() {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date()).replace(",", "");
  } catch {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
}
function short(s, n = 80) { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; }
const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
function normalizeVer(v) { return String(v || "").replace(/^[~^]/, ""); }
function fmtSha(sha) { return (sha || "").slice(0, 12); }

/* ---------------------------------- CSS ---------------------------------- */
// COVER: single page, zero margins, fixed A4 container to avoid cut-offs.
const COVER_CSS = `
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; }
.cover {
  width: 210mm; height: 297mm; background: VAR_BG; color: VAR_FG;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  text-align:center; box-sizing:border-box; padding: 18mm 12mm;
}
.cover .repo { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif; font-size: 18px; opacity: .9; margin-bottom: 4mm; }
.cover h1 { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif; font-size: 26px; line-height: 1.25; margin: 0 0 6mm 0; }
.cover .date { font-size: 13px; opacity: .9; }
.cover .logo-wrap { display:flex; align-items:center; justify-content:center; margin-top: 14mm; width:100%; }
.cover .logo-wrap img { display:block; max-width: 140mm; max-height: 40mm; width:auto; height:auto; object-fit: contain; }
`;

// MAIN: every section begins on a new page; TOC centered and airy.
const MAIN_CSS = `
@page { size: A4; margin: 14mm 12mm 14mm 12mm; }
html, body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif; color:#111;
}
h1, h2, h3 { margin: 0 0 8px 0; line-height: 1.3; }
h1 { font-size: 20px; } h2 { font-size: 17px; } h3 { font-size: 15px; }
p { margin: 0 0 10px 0; line-height: 1.5; }
.small { font-size: 12px; color:#555; } .muted { color:#666; } .nowrap { white-space: nowrap; }
.section { page-break-before: always; margin: 0 0 14mm 0; }

/* TOC centered with larger line spacing */
.toc { display:flex; align-items:center; justify-content:center; min-height: 220mm; }
.toc-inner { text-align:left; width: 120mm; line-height: 2.0; }
.toc-title { font-size: 22px; text-align:center; margin-bottom: 10mm; }
.toc-list { list-style:none; padding:0; margin:0; font-size:14px; }

/* Key-Value tables (two columns) */
table { border-collapse: collapse; width: 100%; font-size: 12px; table-layout: fixed; }
th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
th { background:#f6f8fa; text-align:left; }
.kv td:first-child { width: 35%; background:#fafbfc; font-weight: 600; }
.break { word-break: break-word; overflow-wrap: anywhere; }
`;

/* --------------------------------- Cover --------------------------------- */
function buildCoverHtml({
  repository, baseLabel, headLabel, titleLogoUrl, generatedAt,
  coverBg = COVER_BG, coverFg = COVER_FG,
}) {
  const title = titleLine(repository, baseLabel, headLabel);
  const css = COVER_CSS.replace("VAR_BG", escHtml(coverBg)).replace("VAR_FG", escHtml(coverFg));
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style><title>${escHtml(title)}</title></head>
<body>
  <section class="cover">
    <div class="repo">${escHtml(repository)}</div>
    <h1>${escHtml(title)}</h1>
    <div class="date">${escHtml(generatedAt || nowEU())}</div>
    ${titleLogoUrl ? `<div class="logo-wrap"><img src="${escHtml(titleLogoUrl)}" alt="logo"></div>` : ""}
  </section>
</body></html>`.trim();
}

/* ---------------------------- Tool versions ------------------------------ */
/**
 * Resolve tool versions from provided `tooling` or fallback to package.json.
 * If a version cannot be resolved, return empty string -> caller prints tool name without parentheses.
 */
function resolveToolVersions(tooling = {}, pkgJsonPath = path.resolve(process.cwd(), "package.json")) {
  const readPkg = () => {
    try {
      const txt = fs.readFileSync(pkgJsonPath, "utf8");
      return JSON.parse(txt);
    } catch { return null; }
  };
  const pkg = readPkg();
  const depVer = (name) => {
    if (!pkg) return "";
    const v = pkg.dependencies?.[name] || pkg.devDependencies?.[name] || pkg.optionalDependencies?.[name] || "";
    return normalizeVer(v || "");
  };

  // Map known JS libs from package.json
  const out = {
    cyclonedx: tooling.cyclonedx || "",   // likely not in package.json (Maven plugin)
    syft: tooling.syft || "",             // CLI, not in package.json
    grype: tooling.grype || "",           // CLI, not in package.json
    chartjs: tooling.chartjs || depVer("chart.js"),
    mermaid: tooling.mermaid || depVer("mermaid"),
    puppeteer: tooling.puppeteer || depVer("puppeteer") || depVer("puppeteer-core"),
  };
  return out;
}
function fmtTool(name, version) {
  // If version provided -> "Name (x.y.z)"; else "Name"
  return version ? `${name} (${version})` : `${name}`;
}

/* -------------------- Severity counts & diff breakdown -------------------- */
/** Compute severity counts from our normalized arrays or raw Grype JSON. */
function computeSeverityCounts(data) {
  const counts = { CRITICAL:0, HIGH:0, MEDIUM:0, LOW:0, UNKNOWN:0 };
  if (!data) return counts;
  // Prefer normalized items (from analyze.js)
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.matches) ? data.matches : (data.grypeRaw?.matches || []);
  for (const m of items) {
    const sev = (m.severity || m?.vulnerability?.severity || "UNKNOWN").toUpperCase();
    const key = ORDER.includes(sev) ? sev : "UNKNOWN";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
/** Group diff arrays by severity. */
function groupDiffBySeverity(diff = {}) {
  const mk = () => ({ CRITICAL:0, HIGH:0, MEDIUM:0, LOW:0, UNKNOWN:0 });
  const result = { NEW: mk(), REMOVED: mk(), UNCHANGED: mk() };
  const add = (arr, bucket) => {
    for (const x of arr || []) {
      const sev = (x?.severity || "UNKNOWN").toUpperCase();
      const key = ORDER.includes(sev) ? sev : "UNKNOWN";
      result[bucket][key] += 1;
    }
  };
  add(diff.news, "NEW");
  add(diff.removed, "REMOVED");
  add(diff.unchanged, "UNCHANGED");
  return result;
}

/* ------------------------------ Main document ---------------------------- */
/**
 * Build the MAIN document with: Table of Contents, Introduction, Summary.
 * Each section starts on a new page (.section).
 *
 * Optionally pass baseDataPath/headDataPath/diffDataPath so this renderer can
 * compute severity counts and diff breakdowns directly from the JSON artifacts.
 */
function buildMainHtml({
  repository,
  base = {},            // { label, sha, message }
  head = {},            // { label, sha, message }
  counts = {},          // { base:{...}, head:{...} } optional; computed if not provided and data paths exist
  minSeverity = "LOW",
  diff = {},            // { news, removed, unchanged } optional; computed if diffDataPath provided (we only use for grouping)
  tooling = {},         // { cyclonedx, syft, grype, chartjs, mermaid, puppeteer }
  logo,
  baseDataPath,         // optional path to base.json
  headDataPath,         // optional path to head.json
  diffDataPath,         // optional path to diff.json
} = {}) {
  const baseLabel = base.label || "base";
  const headLabel = head.label || "head";

  // If counts not provided, try to compute from JSON files
  const safeRead = (p) => { try { return p ? JSON.parse(fs.readFileSync(p, "utf8")) : null; } catch { return null; } };
  const baseData = counts?.base ? null : safeRead(baseDataPath);
  const headData = counts?.head ? null : safeRead(headDataPath);
  const diffData = (diff && (diff.news || diff.removed || diff.unchanged)) ? null : safeRead(diffDataPath);

  const baseCounts = counts.base || computeSeverityCounts(baseData);
  const headCounts = counts.head || computeSeverityCounts(headData);
  const effectiveDiff = (diff && (diff.news || diff.removed || diff.unchanged)) ? diff : (diffData || { news:[], removed:[], unchanged:[] });
  const diffTotals = {
    new: (effectiveDiff.news || []).length,
    removed: (effectiveDiff.removed || []).length,
    unchanged: (effectiveDiff.unchanged || []).length,
  };
  const diffBySev = groupDiffBySeverity(effectiveDiff);

  // Resolve tooling versions (fallback to package.json)
  const tools = resolveToolVersions(tooling);

  // Header/Footer minimal placeholders (reserved)
  const headerTemplate = `
<style>.hdr { font-size:10px; width:100%; padding:0 8mm; color:#555; }
.hdr .line { display:flex; justify-content:space-between; width:100%; }</style>
<div class="hdr"><div class="line"><div>${escHtml(titleLine(repository, baseLabel, headLabel))}</div><div></div></div></div>`.trim();
  const footerTemplate = `
<style>.ftr { font-size:10px; width:100%; padding:0 8mm; color:#555; }
.ftr .line { display:flex; justify-content:space-between; width:100%; }</style>
<div class="ftr"><div class="line"><div>${logo ? `<img src="${escHtml(logo)}" style="height:10px">` : ""}</div><div><span class="pageNumber"></span> / <span class="totalPages"></span> • ${escHtml(nowEU())}</div></div></div>`.trim();

  /* 1) Table of Contents (new page) */
  const toc = `
<section class="section toc">
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

  /* 2) Introduction (new page) */
  const intro = `
<section class="section">
  <h2>1. Introduction</h2>
  <p>This security report has been generated for the repository <b>${escHtml(repository)}</b> to provide a clear, side-by-side comparison of vulnerabilities detected between two branches: <b>${escHtml(baseLabel)}</b> (base reference) and <b>${escHtml(headLabel)}</b> (head). Its goal is to highlight which vulnerabilities have been introduced, which have been fixed, and which remain unchanged, so that maintainers can verify that ongoing development does not inadvertently increase the project’s security risk.</p>

  <h3>Methodology and tooling</h3>
  <ul>
    <li>${escHtml(fmtTool("CycloneDX Maven plugin", tools.cyclonedx))} — Generates an accurate Software Bill of Materials (SBOM) for Java multi-module builds.</li>
    <li>${escHtml(fmtTool("Syft", tools.syft))} — Fallback SBOM generator for content outside Maven’s scope.</li>
    <li>${escHtml(fmtTool("Grype", tools.grype))} — Scans the generated SBOMs to detect known CVEs and advisories.</li>
    <li>${escHtml(fmtTool("Chart.js", tools.chartjs))} — Visualizes severity levels and cross-branch changes.</li>
    <li>${escHtml(fmtTool("Mermaid", tools.mermaid))} — Renders dependency graphs (landscape pages) to illustrate relationships and depth of vulnerable packages.</li>
    <li>${escHtml(fmtTool("Puppeteer", tools.puppeteer))} — Automates export to PDF for portability and readability.</li>
  </ul>

  <p>By combining these tools in a consistent pipeline, the comparison between <b>${escHtml(baseLabel)}</b> and <b>${escHtml(headLabel)}</b> is both comprehensive and easy to interpret.</p>
</section>`;

  /* Helpers for key-value tables */
  const kvRow = (k, v) => `<tr><td>${escHtml(k)}</td><td class="break">${escHtml(v || "")}</td></tr>`;
  const kvTable = (rows) => `<table class="kv"><tbody>${rows.join("")}</tbody></table>`;

  /* 3) Summary (new page) */
  const baseKV = kvTable([
    kvRow("Branch", baseLabel),
    kvRow("Commit", fmtSha(base.sha)),
    kvRow("Message", base.message || ""),
    kvRow("Severity counts", ORDER.map(s => `${s}:${baseCounts[s] || 0}`).join(" · ")),
  ]);
  const headKV = kvTable([
    kvRow("Branch", headLabel),
    kvRow("Commit", fmtSha(head.sha)),
    kvRow("Message", head.message || ""),
    kvRow("Severity counts", ORDER.map(s => `${s}:${headCounts[s] || 0}`).join(" · ")),
  ]);

  // Totals table
  const totalsTable = `
<table>
  <thead><tr><th>New</th><th>Removed</th><th>Unchanged</th></tr></thead>
  <tbody><tr><td>${diffTotals.new}</td><td>${diffTotals.removed}</td><td>${diffTotals.unchanged}</td></tr></tbody>
</table>`.trim();

  // Severity breakdown table (rows: severities; cols: New/Removed/Unchanged)
  const sevRows = ORDER.map(sev =>
    `<tr><td><b>${sev}</b></td><td>${diffBySev.NEW[sev]}</td><td>${diffBySev.REMOVED[sev]}</td><td>${diffBySev.UNCHANGED[sev]}</td></tr>`
  ).join("");
  const sevTable = `
<table>
  <thead><tr><th>Severity</th><th>New</th><th>Removed</th><th>Unchanged</th></tr></thead>
  <tbody>${sevRows}</tbody>
</table>`.trim();

  const summary = `
<section class="section">
  <h2>2. Summary</h2>

  <h3>2.1 Branch details</h3>
  <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10mm;">
    <div><h3 class="muted" style="margin-bottom:6px;">${escHtml(baseLabel)}</h3>${baseKV}</div>
    <div><h3 class="muted" style="margin-bottom:6px;">${escHtml(headLabel)}</h3>${headKV}</div>
  </div>

  <h3 style="margin-top:12mm;">2.2 Change overview</h3>
  ${totalsTable}
  <div style="height:6mm"></div>
  ${sevTable}
</section>`;

  const body = `<!doctype html>
<html><head><meta charset="utf-8"><style>${MAIN_CSS}</style>
<title>${escHtml(titleLine(repository, baseLabel, headLabel))}</title></head>
<body>
  ${toc}
  ${intro}
  ${summary}
</body></html>`.trim();

  return { header: headerTemplate, footer: footerTemplate, body };
}

/* ------------------------------ Puppeteer I/O ------------------------------ */
async function htmlToPdf(html, outPath, opts = {}) {
  const { launchArgs = ["--no-sandbox", "--disable-setuid-sandbox"] } = opts;
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  let puppeteer = resolvePuppeteerModule();
  if (!puppeteer) {
    try { execSync("npm i -D puppeteer", { stdio: ["ignore", "pipe", "pipe"] }); puppeteer = require("puppeteer"); }
    catch { execSync("npm i -D puppeteer-core", { stdio: ["ignore", "pipe", "pipe"] }); puppeteer = require("puppeteer-core"); }
  }

  let executablePath = resolveChromeExecutablePath(puppeteer);
  if (!executablePath) { const okChrome = tryInstallBrowser("chrome"); if (!okChrome) tryInstallBrowser("chromium"); executablePath = resolveChromeExecutablePath(puppeteer); }

  let browser;
  try {
    browser = await puppeteer.launch({ headless: "new", executablePath: executablePath || undefined, args: launchArgs });
  } catch {
    browser = await puppeteer.launch({ headless: "new", args: launchArgs });
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outPath, format: "A4", landscape: false,
      displayHeaderFooter: false,
      margin: { top: "0", right: "0", bottom: "0", left: "0" }, // honor CSS @page
      printBackground: true, preferCSSPageSize: true,
    });
  } finally { await browser.close(); }
}

/* ------------------------------- Safe stubs ------------------------------- */
function buildDiffTableHtml() {
  return `<table><thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Branches</th><th>Status</th></tr></thead><tbody></tbody></table>`;
}
function buildLandscapeHtml() {
  const body = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4 landscape; margin: 14mm 12mm 14mm 12mm; } html, body { margin:0; padding:0; }
</style></head><body></body></html>`;
  return { header: "", footer: "", body };
}
function buildPathsTableHtml() { return `<thead><tr><th>Module</th></tr></thead><tbody></tbody>`; }
function buildMermaidGraphForPdf() { return ""; }
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
  buildDiffTableHtml,
  buildLandscapeHtml,
  buildPathsTableHtml,
  buildMermaidGraphForPdf,
  mergePdfs,
};
