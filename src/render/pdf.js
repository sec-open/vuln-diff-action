// src/render/pdf.js
// PDF-only renderer. This module is SELF-CONTAINED and does not reuse HTML/Markdown renderers.
//
// Exports:
// - buildCoverHtml({ repository, baseLabel, headLabel, titleLogoUrl, generatedAt, coverBg, coverFg })
// - buildMainHtml({ repository, base, head, counts, minSeverity, diffTableHtml, logo })
// - buildLandscapeHtml({ baseLabel, headLabel, pathsBaseHtml, pathsHeadHtml, mermaidBase, mermaidHead })
// - buildDiffTableHtml(diff, baseLabel, headLabel)
// - buildPathsTableHtml(bom, matches, opts)
// - buildMermaidGraphForPdf(bom, matches, maxNodes)
// - htmlToPdf(html, outPath, opts)
// - mergePdfs(inFiles, outFile)

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { PDFDocument } = require("pdf-lib");

/* --------------------------------- Theme --------------------------------- */
// Set here the exact cover color you used in v1 if you want it fixed.
// If you pass coverBg/coverFg to buildCoverHtml they will override these defaults.
const COVER_BG = "#0b2239";
const COVER_FG = "#ffffff";

/* --------------------------------- Utils --------------------------------- */
function toArray(x) {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  if (typeof x === "string") return [x];
  if (x instanceof Set) return [...x];
  if (typeof x === "object") {
    if ("path" in x) return toArray(x.path);
    if ("via" in x) return toArray(x.via);
    if ("dependencyPath" in x) return toArray(x.dependencyPath);
  }
  return [];
}

function escHtml(s) {
  // Basic HTML-escape to avoid template breakage in PDF HTML bodies
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function short(s, n = 80) {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function titleLine(repository, baseLabel, headLabel) {
  return `Security Report — ${repository} — ${baseLabel} vs ${headLabel}`;
}

function nowUK() {
  try {
    // Keep the same style your v1 used (dd/mm/yyyy HH:MM:SS)
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(new Date())
      .replace(",", "");
  } catch {
    const d = new Date(),
      p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(
      d.getHours()
    )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
}

/* ---------------------------------- CSS ---------------------------------- */
const BASE_CSS = `
@page { size: A4; margin: 14mm 12mm 14mm 12mm; }
html, body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
  color:#111;
}
h1, h2, h3 { margin: 0 0 8px 0; line-height: 1.3; }
h1 { font-size: 20px; }
h2 { font-size: 17px; }
h3 { font-size: 15px; }
p { margin: 0 0 10px 0; line-height: 1.45; }
.muted { color:#666; }
.small { font-size: 12px; }
.center { text-align:center; }

a, a:visited, a:active { color: #0366d6; text-decoration: none; }
/* Avoid raw URL suffixes in PDF anchors */
a[href]::after { content: none !important; }

/* Sections */
section { page-break-inside: avoid; margin-bottom: 14mm; }
.section { page-break-before: always; }

/* TOC */
.toc { page-break-before: always; }
.toc .title { font-size: 22px; margin-bottom: 10mm; }
.toc ul { list-style: none; padding: 0; margin: 0; width: 70%; margin-left: auto; margin-right: auto; }
.toc li { margin: 6px 0 10px 0; line-height: 1.8; font-size: 14px; }

/* Tables */
table { border-collapse: collapse; width: 100%; font-size: 12px; table-layout: fixed; }
th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
th { background:#f6f8fa; text-align:left; }
.right { text-align:right; }
.nowrap { white-space: nowrap; }
.break { word-break: break-word; overflow-wrap: anywhere; }

/* Header/Footer placeholders (Puppeteer templates will inject content) */
.header, .footer { font-size: 10px; color:#444; }

/* Figures */
.caption { font-size: 12px; color:#333; margin: 4px 0 10px 0; }
.figure { margin: 6px 0 16px 0; }

/* Mermaid (we output text blocks in landscape pages) */
.mermaid-box {
  border:1px solid #ddd; padding:8px; margin:8px 0 12px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;
  white-space: pre; font-size: 11px; overflow: auto;
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
  // The cover is a full-page section that matches your v1 aesthetic
  const title = titleLine(repository, baseLabel, headLabel);
  const logoHtml = titleLogoUrl
    ? `<div style="margin-top:18mm;"><img src="${escHtml(
        titleLogoUrl
      )}" alt="logo" style="max-height:28mm;"></div>`
    : "";

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
${BASE_CSS}
body {
  margin:0;
}
.cover {
  background:${coverBg};
  color:${coverFg};
  height: 100vh;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
  padding: 20mm 10mm;
}
.cover h1 { font-size: 26px; margin-bottom: 6mm; }
.cover .repo { font-size: 18px; opacity:.9; margin-bottom: 2mm; }
.cover .date { font-size: 13px; opacity:.9; }
</style>
</head>
<body>
  <section class="cover">
    <div class="repo">${escHtml(repository)}</div>
    <h1>${escHtml(title)}</h1>
    <div class="date">${escHtml(generatedAt || nowUK())}</div>
    ${logoHtml}
  </section>
</body>
</html>
`;
}

/* ------------------------------ Main document ---------------------------- */
function buildMainHtml({
  repository,
  base,
  head,
  counts,
  minSeverity,
  diffTableHtml,
  logo,
}) {
  // Header template (Puppeteer header/footer use separate small HTML fragments)
  const baseLabel = base.label;
  const headLabel = head.label;

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
    <div><span class="pageNumber"></span> / <span class="totalPages"></span> • ${escHtml(
      nowUK()
    )}</div>
  </div>
</div>`.trim();

  const toc = `
<section class="toc section">
  <div class="title">Table of Contents</div>
  <ul>
    <li>Introduction</li>
    <li>Summary</li>
    <li>Severity distribution</li>
    <li>Vulnerability diff table</li>
    <li>Dependency graph base</li>
    <li>Dependency graph head</li>
    <li>Dependency path base</li>
    <li>Dependency path head</li>
  </ul>
</section>`;

  const intro = `
<section class="section">
  <h2>Introduction</h2>
  <p>The goal of this report is to detect vulnerabilities that are introduced or fixed between two development branches.</p>
  <p>This report compares security vulnerabilities between two Git references (base and head) using:</p>
  <ul>
    <li>Syft / CycloneDX (SBOM generation)</li>
    <li>Grype (vulnerability scanning)</li>
    <li>Puppeteer (PDF export)</li>
    <li>Chart.js (severity charts)</li>
    <li>Mermaid (dependency graphs)</li>
  </ul>
</section>`;

  const summary = `
<section class="section">
  <h2>Summary</h2>
  <table>
    <thead>
      <tr>
        <th>Branch</th><th>Commit</th><th>Message</th><th>Severity counts</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="nowrap"><b>${escHtml(baseLabel)}</b> <span class="muted">(input: ${escHtml(
    baseLabel
  )})</span></td>
        <td class="nowrap"><code>${escHtml((base.sha || "").slice(0, 12))}</code></td>
        <td class="break">${escHtml(base.message || "")}</td>
        <td class="nowrap">${formatSeverityCounts(counts.base || {})}</td>
      </tr>
      <tr>
        <td class="nowrap"><b>${escHtml(
          head.sha ? head.sha : headLabel
        )}</b> <span class="muted">(input: ${escHtml(headLabel)})</span></td>
        <td class="nowrap"><code>${escHtml((head.sha || "").slice(0, 12))}</code></td>
        <td class="break">${escHtml(head.message || "")}</td>
        <td class="nowrap">${formatSeverityCounts(counts.head || {})}</td>
      </tr>
    </tbody>
  </table>
  <p class="small muted">Minimum severity: <b>${escHtml(minSeverity)}</b></p>
</section>`;

  // Charts placeholder (keep it simple/clean like v1)
  const charts = `
<section class="section">
  <h2>Severity distribution</h2>
  <div class="figure">
    <div class="caption">[Chart.js figure]</div>
    <div class="small muted">BASE: ${escHtml(
      baseLabel
    )} — HEAD: ${escHtml(head.sha || headLabel)}</div>
  </div>
</section>`;

  const diffTable = `
<section class="section">
  <h2>Vulnerability diff table</h2>
  ${diffTableHtml}
</section>`;

  // Graphs (portrait page with placeholders; actual data in landscape appendix)
  const graphs = `
<section class="section">
  <h2>Dependency graph base</h2>
</section>

<section class="section">
  <h2>Dependency graph head</h2>
</section>

<section class="section">
  <h2>Dependency path base</h2>
</section>

<section class="section">
  <h2>Dependency path head</h2>
</section>`;

  const body = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${BASE_CSS}</style>
<title>${escHtml(titleLine(repository, baseLabel, headLabel))}</title>
</head>
<body>
  ${toc}
  ${intro}
  ${summary}
  ${charts}
  ${diffTable}
  ${graphs}
</body>
</html>`.trim();

  return { header: headerTemplate, footer: footerTemplate, body };
}

/* ----------------------- PDF-only: Landscape appendix --------------------- */
function buildLandscapeHtml({
  baseLabel,
  headLabel,
  pathsBaseHtml,
  pathsHeadHtml,
  mermaidBase,
  mermaidHead,
}) {
  const header = `
<style>
  .hdr { font-size:10px; width:100%; padding:0 8mm; color:#555; }
  .hdr .line { display:flex; justify-content:space-between; width:100%; }
</style>
<div class="hdr">
  <div class="line">
    <div>Dependency graphs &amp; paths</div>
    <div></div>
  </div>
</div>`.trim();

  const footer = `
<style>
  .ftr { font-size:10px; width:100%; padding:0 8mm; color:#555; }
  .ftr .line { display:flex; justify-content:space-between; width:100%; }
</style>
<div class="ftr">
  <div class="line">
    <div></div>
    <div><span class="pageNumber"></span> / <span class="totalPages"></span></div>
  </div>
</div>`.trim();

  const body = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${BASE_CSS}</style>
</head>
<body>
  <section class="section">
    <h2>Dependency graph — BASE: ${escHtml(baseLabel)}</h2>
    <pre class="mermaid-box">${escHtml(mermaidBase || "[empty]")}</pre>
  </section>

  <section class="section">
    <h2>Dependency graph — HEAD: ${escHtml(headLabel)}</h2>
    <pre class="mermaid-box">${escHtml(mermaidHead || "[empty]")}</pre>
  </section>

  <section class="section">
    <h2>Dependency path — BASE</h2>
    <table>
      ${pathsBaseHtml}
    </table>
  </section>

  <section class="section">
    <h2>Dependency path — HEAD</h2>
    <table>
      ${pathsHeadHtml}
    </table>
  </section>
</body>
</html>`.trim();

  return { header, footer, body };
}

/* ----------------------- PDF-only: Vulnerability table -------------------- */
function buildDiffTableHtml(diff, baseLabel, headLabel) {
  // v1-style table with Branches + Status
  const rows = [];

  const pushRows = (arr, status, branches) => {
    for (const it of arr || []) {
      const sev = escHtml(it?.severity || "UNKNOWN");
      const id = escHtml(it?.id || "UNKNOWN");
      const href = pickHref(it);
      const pkg = escHtml(it?.package || "unknown");
      const ver = escHtml(it?.version || "-");
      const pkgVer = `${pkg}${ver ? ":" + ver : ""}`;

      rows.push(`
        <tr>
          <td class="nowrap"><b>${sev}</b></td>
          <td class="break">${
            href
              ? `<a href="${href}" rel="noopener noreferrer">${id}</a>`
              : id
          }</td>
          <td class="nowrap"><code>${pkgVer}</code></td>
          <td class="nowrap">${escHtml(branches)}</td>
          <td class="nowrap">${escHtml(status)}</td>
        </tr>`);
    }
  };

  pushRows(diff?.news, "NEW", headLabel);
  pushRows(diff?.removed, "REMOVED", baseLabel);
  pushRows(diff?.unchanged, "UNCHANGED", "BOTH");

  return `
<table>
  <thead>
    <tr>
      <th>Severity</th>
      <th>Vulnerability</th>
      <th>Package</th>
      <th>Branches</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${rows.join("\n")}
  </tbody>
</table>`;
}

function pickHref(it) {
  const id = it?.id || "";
  const url = it?.url || "";
  // Prefer official GHSA link for hovercards when viewed in GitHub previewers
  if (/^https:\/\/github\.com\/advisories\/GHSA-/.test(url)) return url;
  const ghsa = pickGhsa(it);
  if (ghsa) return `https://github.com/advisories/${ghsa}`;
  if (/^CVE-\d{4}-\d{4,7}$/.test(id)) return `https://nvd.nist.gov/vuln/detail/${id}`;
  return "";
}

function pickGhsa(x) {
  const id = x?.id || "";
  if (/^GHSA-[A-Za-z0-9-]+$/.test(id)) return id;
  const al = Array.isArray(x?.aliases) ? x.aliases : [];
  for (const a of al) if (/^GHSA-[A-Za-z0-9-]+$/.test(a)) return a;
  return null;
}

function formatSeverityCounts(obj) {
  const levels = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
  return levels.map((k) => `${k}:${obj[k] ?? 0}`).join(" · ");
}

/* ----------------------- PDF-only: Paths table (HTML) --------------------- */
function buildPathsTableHtml(
  bom,
  matches,
  { maxPathsPerPkg = 3, maxDepth = 10 } = {}
) {
  // Columns: Module, Depth0..DepthN (kept simple for PDF readability)
  const rows = [];

  for (const m of toArray(matches)) {
    const art = m?.artifact || m?.match || m?.package || {};
    const pkgName = art?.name || art?.purl || "unknown";
    const pkgVer = art?.version || "";

    const candidates = [
      ...toArray(m?.matchDetails).flatMap((d) => toArray(d?.via)),
      ...toArray(m?.paths),
      ...toArray(m?.via),
      ...toArray(art?.locations)
        .map((loc) => loc?.path)
        .filter(Boolean),
    ];

    let added = 0;
    for (const c of candidates) {
      if (added >= maxPathsPerPkg) break;
      const segments = toArray(c)
        .map((x) => String(x ?? "").trim())
        .filter(Boolean)
        .slice(0, maxDepth);

      if (segments.length === 0) continue;
      let start = 0;
      if (/^pkg$/i.test(segments[0])) start = 1; // normalize if path starts with 'pkg'
      const moduleName = segments[start] || pkgName;
      const depths = segments.slice(start + 1);
      rows.push([moduleName, ...depths]);
      added++;
    }

    if (added === 0) rows.push([pkgName + (pkgVer ? ":" + pkgVer : "")]);
  }

  // Compute max number of depth columns to align the table
  let maxCols = 1;
  for (const r of rows) maxCols = Math.max(maxCols, r.length);

  const headerCells = ["Module"];
  for (let i = 1; i < maxCols; i++) headerCells.push(`Depth${i}`);

  const thead =
    "<thead><tr>" +
    headerCells.map((h) => `<th>${escHtml(h)}</th>`).join("") +
    "</tr></thead>";

  const tbody =
    "<tbody>" +
    rows
      .map((r) => {
        const cells = [];
        for (let i = 0; i < maxCols; i++) {
          cells.push(`<td>${escHtml(short(r[i] || "", 80))}</td>`);
        }
        return `<tr>${cells.join("")}</tr>`;
      })
      .join("\n") +
    "</tbody>";

  return `${thead}${tbody}`;
}

/* ----------------------- PDF-only: Mermaid graph -------------------------- */
function buildMermaidGraphForPdf(bom, matches, maxNodes = 150) {
  // Build a light graph text (flowchart) suitable to be shown as text in PDF landscape.
  const components = toArray(bom?.components);
  const dependencies = toArray(bom?.dependencies);

  const compIndex = new Map();
  for (const c of components) {
    const key = c?.bomRef || c?.purl || c?.name || JSON.stringify(c);
    const label = [c?.name || "unknown", c?.version ? `@${c.version}` : ""].join("");
    compIndex.set(key, label);
  }

  const edges = [];
  for (const dep of toArray(dependencies)) {
    const ref = dep?.ref;
    for (const child of toArray(dep?.dependsOn)) edges.push([ref, child]);
  }

  const nodes = new Set();
  if (edges.length === 0) {
    for (const c of components.slice(0, maxNodes)) {
      const key = c?.bomRef || c?.purl || c?.name || JSON.stringify(c);
      nodes.add(key);
    }
  } else {
    for (const [a, b] of edges) {
      nodes.add(a);
      nodes.add(b);
      if (nodes.size >= maxNodes) break;
    }
  }

  const lines = [];
  lines.push("flowchart LR");

  for (const id of nodes) {
    const label = short(compIndex.get(id) || id, 36).replace(/"/g, "'");
    lines.push(`  ${hash(id)}["${label}"]`);
  }
  for (const [a, b] of edges) {
    if (!nodes.has(a) || !nodes.has(b)) continue;
    lines.push(`  ${hash(a)} --> ${hash(b)}`);
  }
  return lines.join("\n");

  function hash(s) {
    // Cheap stable short id
    let h = 0;
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h = (h * 33) ^ str.charCodeAt(i);
    }
    return "n" + (h >>> 0).toString(16);
  }
}

/* ------------------------------ Puppeteer I/O ------------------------------ */
/**
 * Render an HTML string to a PDF file using Puppeteer.
 * @param {string} html - Full HTML document string
 * @param {string} outPath - Path to output PDF
 * @param {object} opts - { displayHeaderFooter, headerTemplate, footerTemplate, landscape, margin }
 */
async function htmlToPdf(html, outPath, opts = {}) {
  // NOTE: We embed HTML directly; no reuse of HTML/Markdown renderers.
  // Comments kept in English for clarity.

  const {
    displayHeaderFooter = false,
    headerTemplate = "",
    footerTemplate = "",
    landscape = false,
    margin = { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" },
  } = opts;

  // Ensure output directory exists
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  // Launch headless Chromium. On GH runners Puppeteer downloads Chromium automatically.
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    await page.pdf({
      path: outPath,
      format: "A4",
      landscape,
      displayHeaderFooter,
      headerTemplate,
      footerTemplate,
      margin,
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

/**
 * Merge multiple PDFs into a single PDF using pdf-lib.
 * @param {string[]} inFiles - input PDF paths
 * @param {string} outFile - output PDF path
 */
async function mergePdfs(inFiles, outFile) {
  // Read all PDFs
  const pdfDoc = await PDFDocument.create();

  for (const file of inFiles) {
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    const src = await PDFDocument.load(bytes);
    const copied = await pdfDoc.copyPages(src, src.getPageIndices());
    for (const p of copied) pdfDoc.addPage(p);
  }

  const outBytes = await pdfDoc.save();
  fs.writeFileSync(outFile, outBytes);
}

/* --------------------------------- Helpers -------------------------------- */
function formatErr(e) {
  const msg =
    e && (e.stack || e.message) ? String(e.stack || e.message) : String(e || "Unknown error");
  return msg;
}

/* --------------------------------- Exports -------------------------------- */
module.exports = {
  buildCoverHtml,
  buildMainHtml,
  buildLandscapeHtml,
  buildDiffTableHtml,
  buildPathsTableHtml,
  buildMermaidGraphForPdf,
  htmlToPdf,
  mergePdfs,
};
