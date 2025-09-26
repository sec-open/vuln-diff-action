// src/index.js
// v2 main — Orchestrates SBOM/scan/diff, builds HTML (cover+main+appendix) and exports PDFs.
// Adds: header/footer with dark background + light text, footer logo (data URI),
// UK time, HTML tables with links, transformed dependency-paths table,
// interactive HTML bundle with local data copies, artifact upload including /html recursively.

const core = require("@actions/core");
const exec = require("@actions/exec");
const artifact = require("@actions/artifact");
const github = require("@actions/github");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const http = require("http");
const { PDFDocument } = require("pdf-lib");

const { generateSbomAuto } = require("./sbom");
const { scanSbom } = require("./grype");
const { diff, renderMarkdownTable } = require("./diff");
const {
  buildMarkdownReport,
  buildDependencyPathsTable,
  renderPathsMarkdownTable,
  buildMermaidGraphFromBOMImproved
} = require("./report");
const { buildHtmlCover, buildHtmlMain, buildHtmlLandscape } = require("./report-html");

// ---------------------- helpers ----------------------

// Recursively collect file paths inside a directory
function listFilesRecursively(dir) {
  const out = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d)) {
      const p = path.join(d, e);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  }
  walk(dir);
  return out;
}

// --- fetch remote image and return data URI (for header/footer templates) ---
function fetchToDataUri(url, defaultMime = "image/png") {
  return new Promise((resolve) => {
    try {
      if (!url) return resolve(null);
      const mod = url.startsWith("https://") ? https : http;
      mod
        .get(url, (res) => {
          if (res.statusCode !== 200) return resolve(null);
          const chunks = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            const mime = res.headers["content-type"] || defaultMime;
            const b64 = buf.toString("base64");
            resolve(`data:${mime};base64,${b64}`);
          });
        })
        .on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sh(cmd, opts = {}) {
  return exec.exec("bash", ["-lc", cmd], opts);
}

async function tryRevParse(ref) {
  let out = "";
  try {
    await exec.exec("bash", ["-lc", `git rev-parse ${ref}`], {
      listeners: { stdout: (d) => (out += d.toString()) },
    });
    return out.trim();
  } catch {
    return null;
  }
}

function isSha(ref) {
  return /^[0-9a-f]{7,40}$/i.test(ref || "");
}

async function resolveRefToSha(ref) {
  if (isSha(ref)) {
    const sha = await tryRevParse(ref);
    if (sha) return sha;
    throw new Error(`Input '${ref}' looks like a SHA but does not exist locally.`);
  }
  let sha = await tryRevParse(ref);
  if (sha) return sha;
  sha = await tryRevParse(`refs/remotes/origin/${ref}`);
  if (sha) return sha;

  let remotes = "";
  await exec.exec("bash", ["-lc", "git remote"], {
    listeners: { stdout: (d) => (remotes += d.toString()) },
  });
  if (remotes.split(/\s+/).includes("upstream")) {
    sha = await tryRevParse(`refs/remotes/upstream/${ref}`);
    if (sha) return sha;
  }
  try {
    await sh(`git fetch origin ${ref}:${ref} --tags --prune`);
    sha = await tryRevParse(ref);
    if (sha) return sha;
  } catch {}
  throw new Error(`Cannot resolve ref '${ref}' to a commit SHA. Ensure the branch or SHA exists in this runner.`);
}

function shortSha(sha) {
  return (sha || "").substring(0, 12);
}
function guessLabel(ref) {
  const m = (ref || "").match(/^(?:refs\/remotes\/\w+\/|origin\/)?(.+)$/);
  return m ? m[1] : ref || "";
}

async function commitLine(sha) {
  let out = "";
  await exec.exec("bash", ["-lc", `git --no-pager log -1 --format="%H %s" ${sha}`], {
    listeners: { stdout: (d) => (out += d.toString()) },
  });
  return out.trim();
}

// Cambridge/UK time
function fmtNowUK() {
  try {
    const dt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
    // en-GB usually yields dd/mm/yyyy, we want dd-MM-yyyy HH:mm:ss
    const m = dt.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
    return dt;
  } catch {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}:${pad(d.getSeconds())}`;
  }
}

// Markdown table -> HTML with inline **bold**, `code` and GHSA/CVE links
function markdownTableToHtml(md) {
  if (!md || !/\|/.test(md)) return `<div class="muted">No data</div>`;
  const lines = md.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerIdx = lines.findIndex((l) => /\|/.test(l));
  if (headerIdx < 0 || headerIdx + 1 >= lines.length) return `<div class="muted">No data</div>`;
  const header = lines[headerIdx];
  const sep = lines[headerIdx + 1];
  if (!/^-{3,}|:?-{3,}:?/.test(sep.replace(/\|/g, "").trim())) return `<pre class="md">${escapeHtml(md)}</pre>`;
  const rows = [];
  const normalizeCells = (line) =>
    line
      .split("|")
      .map((c) => c.trim())
      .filter((_, i, arr) => !(i === 0 || i === arr.length - 1));
  rows.push({ type: "th", cells: normalizeCells(header) });
  for (let i = headerIdx + 2; i < lines.length; i++)
    if (/\|/.test(lines[i])) rows.push({ type: "td", cells: normalizeCells(lines[i]) });

  const linkify = (txt) => {
    txt = txt.replace(
      /\b(GHSA-[A-Za-z0-9-]{9,})\b/g,
      (_m, id) => `<a href="https://github.com/advisories/${id}" target="_blank" rel="noopener">${escapeHtml(id)}</a>`
    );
    txt = txt.replace(
      /\b(CVE-\d{4}-\d{4,7})\b/g,
      (_m, id) => `<a href="https://nvd.nist.gov/vuln/detail/${id}" target="_blank" rel="noopener">${escapeHtml(id)}</a>`
    );
    return txt;
  };
  const inline = (txt) => {
    if (!txt) return "";
    let s = String(txt);
    s = s.replace(/`([^`]+)`/g, (_, m) => `<code>${escapeHtml(m)}</code>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, (_, m) => `<strong>${escapeHtml(m)}</strong>`);
    s = linkify(s);
    return s;
  };
  let html = `<table class="tbl"><thead><tr>`;
  for (const c of rows[0].cells) html += `<th>${inline(c)}</th>`;
  html += `</tr></thead><tbody>`;
  for (let i = 1; i < rows.length; i++) {
    html += `<tr>`;
    for (const c of rows[i].cells) html += `<td>${inline(c)}</td>`;
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

// Transform dependency-paths markdown table:
// - Move Depth0 -> Module (strip literal "pkg")
// - Shift Depth1..n left (Depth1 -> Depth0, etc.)
function transformDependencyPathsMarkdown(md) {
  if (!md || !/\|/.test(md)) return md;
  const lines = md.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /\|/.test(l));
  if (headerIdx < 0 || headerIdx + 1 >= lines.length) return md;
  const cells = (line) =>
    line
      .split("|")
      .map((s) => s.trim())
      .filter((_, i, arr) => !(i === 0 || i === arr.length - 1));
  const header = cells(lines[headerIdx]);
  const colIdx = {
    severity: header.findIndex((h) => /^severity$/i.test(h)),
    module: header.findIndex((h) => /^module$/i.test(h)),
    pkg: header.findIndex((h) => /^package$/i.test(h)),
    depth0: header.findIndex((h) => /^depth0$/i.test(h)),
  };
  const otherDepths = header
    .map((h, i) => ({ h, i }))
    .filter((x) => /^depth\d+$/i.test(x.h))
    .sort((a, b) => parseInt(a.h.slice(5)) - parseInt(b.h.slice(5)));

  const newHeader = [];
  if (colIdx.severity >= 0) newHeader.push(header[colIdx.severity]);
  newHeader.push("Module");
  if (colIdx.pkg >= 0) newHeader.push(header[colIdx.pkg]);
  for (const d of otherDepths) {
    const n = parseInt(d.h.slice(5), 10);
    if (!isNaN(n) && n >= 1) newHeader.push(`Depth${n - 1}`);
  }

  const out = [];
  out.push("| " + newHeader.join(" | ") + " |");
  out.push("| " + newHeader.map(() => "---").join(" | ") + " |");

  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!/\|/.test(lines[i])) continue;
    const row = cells(lines[i]);
    const get = (idx) => (idx >= 0 && idx < row.length ? row[idx] : "");
    const severity = get(colIdx.severity);
    const moduleFromDepth0 =
      get(colIdx.depth0).replace(/^`?pkg`?$/i, "").trim() ||
      get(colIdx.module).replace(/^`?pkg`?$/i, "").trim();
    const moduleClean = moduleFromDepth0 || "";
    const pkg = get(colIdx.pkg);
    const shifted = [];
    for (const d of otherDepths) {
      const n = parseInt(d.h.slice(5), 10);
      if (!isNaN(n) && n >= 1) shifted.push(get(d.i));
    }

    const cellsOut = [];
    if (colIdx.severity >= 0) cellsOut.push(severity);
    cellsOut.push(moduleClean);
    if (colIdx.pkg >= 0) cellsOut.push(pkg);
    for (const s of shifted) cellsOut.push(s);
    out.push("| " + cellsOut.join(" | ") + " |");
  }
  return out.join("\n");
}

// ---------- Puppeteer + PDF ----------
async function ensureChromeForPuppeteer(version = "24.10.2") {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || `${os.homedir()}/.cache/puppeteer`;
  const cmd = `PUPPETEER_CACHE_DIR=${cacheDir} npx --yes puppeteer@${version} browsers install chrome`;
  await sh(cmd);
  return cacheDir;
}

/**
 * Render HTML to PDF.
 * - displayHeaderFooter=false for cover
 * - headerMeta: { repo, base, head, section, date, logo }
 * - Header/Footer with dark background (brand) and light text.
 */
async function renderPdfFromHtml(html, outPath, { landscape = false, headerMeta, displayHeaderFooter = true } = {}) {
  const puppeteer = require("puppeteer");
  await ensureChromeForPuppeteer();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");

    // Chart.js inject & render (if any canvas present)
    const hasAnyCanvas = await page.$("canvas");
    if (hasAnyCanvas) {
      await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" });
      await page.evaluate(() => {
        try {
          const elBase = document.getElementById("chartBase");
          const elHead = document.getElementById("chartHead");
          const elChanges = document.getElementById("chartChanges");
          const data = window.__vulnChartData || { labels: [], base: [], head: [], changes: [0, 0, 0] };
          const colors = ["#b91c1c", "#ea580c", "#ca8a04", "#16a34a", "#6b7280"];
          function doughnut(ctx, values) {
            return new window.Chart(ctx, {
              type: "doughnut",
              data: { labels: data.labels, datasets: [{ data: values, backgroundColor: colors }] },
              options: { plugins: { legend: { position: "bottom" } }, cutout: "60%" },
            });
          }
          if (elBase && elHead) {
            doughnut(elBase.getContext("2d"), data.base);
            doughnut(elHead.getContext("2d"), data.head);
          }
          if (elChanges) {
            new window.Chart(elChanges.getContext("2d"), {
              type: "bar",
              data: { labels: ["NEW", "REMOVED", "UNCHANGED"], datasets: [{ data: data.changes }] },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
              },
            });
          }
        } catch (e) {
          console.warn("Chart render failed", e);
        }
      });
    }

    // Mermaid inject & render (if any [data-mermaid] blocks)
    const hasMermaid = await page.$("[data-mermaid]");
    if (hasMermaid) {
      await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js" });
      await page.evaluate(async () => {
        try {
          window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: "antiscript",
            theme: "default",
            fontFamily: "ui-sans-serif, system-ui",
          });
          const blocks = document.querySelectorAll("[data-mermaid]");
          for (const block of blocks) {
            const code = block.getAttribute("data-mermaid") || "";
            if (code.trim().length === 0) continue;
            const { svg } = await window.mermaid.render("m" + Math.random().toString(36).slice(2), code);
            const target = block.nextElementSibling || block.parentElement;
            const holder = document.createElement("div");
            holder.innerHTML = svg;
            holder.style.transform = "scale(0.9)";
            holder.style.transformOrigin = "top left";
            target.appendChild(holder);
            block.remove();
          }
        } catch (e) {
          console.warn("Mermaid render failed", e);
        }
      });
    }

    // Header/Footer with brand bar + optional logo (data URI)
    const meta = headerMeta || {};
    const brandBg = "#111827";
    const brandFg = "#F9FAFB";

    let footerLogoSrc = null;
    if (meta.logo) footerLogoSrc = await fetchToDataUri(meta.logo);
    const footerLogo = footerLogoSrc
      ? `<img src="${escapeHtml(footerLogoSrc)}" style="height:14px; vertical-align:middle; margin-right:8px"/>`
      : "";

    const titleLeft =
      "Security Report — " +
      escapeHtml(meta.repo || "") +
      (meta.base && meta.head ? " — " + escapeHtml(meta.base) + " vs " + escapeHtml(meta.head) : "");

    const headerHtml = `
      <div style="width:100%;">
        <div style="font-size:9px; color:${brandFg}; background:${brandBg}; width:100%; padding:6px 10mm;">
          <span style="float:left;">${titleLeft}</span>
          <span style="float:right;">${escapeHtml(meta.section || "")}</span>
        </div>
      </div>`;

    // No page numbers as requested
    const footerHtml = `
      <div style="width:100%; text-align:left;">
        <div style="font-size:9px; color:${brandFg}; background:${brandBg}; width:100%; padding:6px 10mm;">
          ${footerLogo}${escapeHtml(meta.date || "")}
        </div>
      </div>`;

    const portraitMargins = {
      top: displayHeaderFooter ? "22mm" : "12mm",
      right: "10mm",
      bottom: displayHeaderFooter ? "20mm" : "12mm",
      left: "10mm",
    };
    const landscapeMargins = {
      top: displayHeaderFooter ? "20mm" : "10mm",
      right: "10mm",
      bottom: displayHeaderFooter ? "18mm" : "10mm",
      left: "10mm",
    };

    await page.pdf({
      path: outPath,
      format: "A4",
      landscape,
      printBackground: true,
      displayHeaderFooter: !!displayHeaderFooter,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      margin: landscape ? landscapeMargins : portraitMargins,
    });
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}

async function mergePdfs(pdfPaths, outPath) {
  const docs = [];
  for (const p of pdfPaths) {
    const bytes = fs.readFileSync(p);
    docs.push(await PDFDocument.load(bytes));
  }
  const out = await PDFDocument.create();
  for (const doc of docs) {
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const pg of pages) out.addPage(pg);
  }
  const finalBytes = await out.save();
  fs.writeFileSync(outPath, finalBytes);
}

// ---------------------- HTML interactive report bundle ----------------------

function writeHtmlReportBundle(workdir, { repository, baseLabel, headLabel, baseSha, headSha, logoUrl, generatedAt }) {
  const htmlDir = path.join(workdir, "html");
  const cssDir = path.join(htmlDir, "css");
  const jsDir = path.join(htmlDir, "js");
  fs.mkdirSync(cssDir, { recursive: true });
  fs.mkdirSync(jsDir, { recursive: true });

  // Copy required data into /html (works when opened from file:// or unzipped artifact)
  try {
    const srcFiles = [
      { from: path.join(workdir, "diff.json"), to: path.join(htmlDir, "diff.json") },
      { from: path.join(workdir, "grype-base.json"), to: path.join(htmlDir, "grype-base.json") },
      { from: path.join(workdir, "grype-head.json"), to: path.join(htmlDir, "grype-head.json") },
      { from: path.join(workdir, "report-landscape.html"), to: path.join(htmlDir, "report-landscape.html") },
      { from: path.join(workdir, "report.md"), to: path.join(htmlDir, "report.md") },
    ];
    for (const f of srcFiles) {
      if (fs.existsSync(f.from)) fs.copyFileSync(f.from, f.to);
    }
  } catch (e) {
    core.warning(`HTML bundle copy failed: ${e && e.stack ? e : e}`);
  }

  const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Security Report — ${escapeHtml(repository)}</title>
  <link rel="stylesheet" href="./css/style.css"/>
  <script>window.__meta__ = {
    repo: ${JSON.stringify(repository)},
    baseLabel: ${JSON.stringify(baseLabel)},
    headLabel: ${JSON.stringify(headLabel)},
    baseSha: ${JSON.stringify(baseSha)},
    headSha: ${JSON.stringify(headSha)},
    generatedAt: ${JSON.stringify(generatedAt)}
  };</script>
  <script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script defer src="./js/app.js"></script>
</head>
<body>
  <header class="app-header">
    <div class="brand">
      ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="logo"/>` : ""}
      <div class="titles">
        <div class="subtitle">Comparison of branches <b>${escapeHtml(baseLabel)}</b> vs <b>${escapeHtml(headLabel)}</b></div>
        <h1>${escapeHtml(repository)}</h1>
      </div>
    </div>
    <div class="meta">Generated: ${escapeHtml(generatedAt)}</div>
  </header>

  <div class="app-body">
    <aside class="sidebar">
      <nav>
        <a href="#/intro" class="nav-link">Introduction</a>
        <a href="#/summary" class="nav-link">Summary</a>
        <a href="#/severity" class="nav-link">Severity distribution</a>
        <a href="#/changes" class="nav-link">Change overview</a>
        <a href="#/diff" class="nav-link">Vulnerability diff</a>
        <a href="#/graph-base" class="nav-link">Dependency graph (base)</a>
        <a href="#/graph-head" class="nav-link">Dependency graph (head)</a>
        <a href="#/paths-base" class="nav-link">Dependency paths (base)</a>
        <a href="#/paths-head" class="nav-link">Dependency paths (head)</a>
      </nav>
    </aside>

    <main id="view" class="content">
      <noscript>Please enable JavaScript to view the interactive report.</noscript>
    </main>
  </div>

  <footer class="app-footer"><span>Security Report — ${escapeHtml(repository)}</span></footer>
</body>
</html>`;

  const STYLE_CSS = `:root{
  --bg:#ffffff; --fg:#1f2937; --muted:#6b7280; --border:#e5e7eb;
  --brand:#111827; --brand-fg:#F9FAFB; --side:#0f172a; --side-fg:#e5e7eb;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Arial,Helvetica;background:var(--bg);color:var(--fg)}
.app-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--brand);color:var(--brand-fg)}
.brand{display:flex;align-items:center;gap:12px}
.logo{width:36px;height:36px;object-fit:contain}
.titles h1{margin:0;font-size:18px}
.titles .subtitle{font-size:12px;color:#cbd5e1}
.meta{font-size:12px;color:#cbd5e1}
.app-body{display:grid;grid-template-columns:240px 1fr;min-height:calc(100vh - 72px)}
.sidebar{background:var(--side);color:var(--side-fg);padding:12px}
.sidebar .nav-link{display:block;color:var(--side-fg);text-decoration:none;padding:8px 10px;border-radius:8px;margin:4px 0}
.sidebar .nav-link:hover,.sidebar .nav-link.active{background:#1e293b}
.content{padding:16px}
.app-footer{padding:8px 16px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}
h2{margin:0 0 10px 0}
.panel{border:1px solid var(--border);border-radius:10px;padding:12px;background:#fff;margin-bottom:12px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.chart-box{border:1px solid var(--border);border-radius:10px;padding:12px}
.table,.tbl{width:100%;border-collapse:collapse;font-size:13px}
.table th,.table td,.tbl th,.tbl td{border:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}
.table thead th,.tbl thead th{background:#f9fafb}
code{background:#f1f5f9;padding:2px 6px;border-radius:6px}
@media (max-width:900px){.app-body{grid-template-columns:1fr}.sidebar{grid-row:2}.content{grid-row:1}}
`;

  const APP_JS = `'use strict';

// Simple hash router
const view = document.getElementById('view');
const routes = {
  "/intro": renderIntro,
  "/summary": renderSummary,
  "/severity": renderSeverity,
  "/changes": renderChanges,
  "/diff": renderDiff,
  "/graph-base": renderGraphBase,
  "/graph-head": renderGraphHead,
  "/paths-base": renderPathsBase,
  "/paths-head": renderPathsHead
};

async function loadJson(name){ const r = await fetch('./'+name); return r.json(); }
function esc(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Linkify GHSA/CVE
function linkify(txt){
  return String(txt)
    .replace(/\\b(GHSA-[A-Za-z0-9-]{9,})\\b/g, (m,id)=>'<a href="https://github.com/advisories/'+id+'" target="_blank" rel="noopener">'+id+'</a>')
    .replace(/\\b(CVE-\\d{4}-\\d{4,7})\\b/g, (m,id)=>'<a href="https://nvd.nist.gov/vuln/detail/'+id+'" target="_blank" rel="noopener">'+id+'</a>');
}

// Markdown-like table -> HTML
function mdTableToHtml(md){
  if(!md || !md.includes('|')) return '<div class="panel">No data</div>';
  const lines = md.split(/\\r?\\n/).filter(Boolean);
  const header = lines[0];
  const sep = lines[1] || '';
  if(!sep.replace(/\\|/g,'').trim().match(/^-{3,}|:?-{3,}:?/)) return '<pre>'+esc(md)+'</pre>';
  const cells = l => l.split('|').map(c=>c.trim()).filter((_,i,a)=>!(i===0||i===a.length-1));
  let html = '<table class="table"><thead><tr>';
  for(const h of cells(header)) html += '<th>'+h.replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>')+'</th>';
  html += '</tr></thead><tbody>';
  for(let i=2;i<lines.length;i++){
    const row = cells(lines[i]).map(c=> linkify(c.replace(/\\\`([^\\\`]+)\\\`/g,'<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>')));
    if(row.length) html += '<tr><td>'+row.join('</td><td>')+'</td></tr>';
  }
  html += '</tbody></table>';
  return html;
}

function navActive(){
  const hash = location.hash || '#/intro';
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href')===hash);
  });
}

async function renderIntro(){
  const m = window.__meta__ || {};
  const base = esc(m.baseLabel || 'base');
  const head = esc(m.headLabel || 'head');
  view.innerHTML =
    '<h2>Introduction</h2>' +
    '<div class="panel">This report compares security vulnerabilities between <b>'+base+'</b> (base) and <b>'+head+'</b> (head). ' +
    'The goal is to detect vulnerabilities that are introduced and/or fixed between development branches.</div>' +
    '<div class="panel">' +
      '<b>Tools & pipeline</b><br/>' +
      '<ul>' +
        '<li><b>CycloneDX Maven plugin</b>: generates an accurate SBOM (JSON) per ref.</li>' +
        '<li><b>Syft</b>: generates SBOMs when Maven is not present.</li>' +
        '<li><b>Grype</b>: scans SBOMs and produces vulnerability findings.</li>' +
        '<li><b>Diff logic</b>: classifies NEW, REMOVED, and UNCHANGED vulnerabilities.</li>' +
      '</ul>' +
    '</div>';
}

async function renderSummary(){
  const diff = await loadJson('diff.json');
  const meta = window.__meta__ || {};
  const baseSha = (meta.baseSha||'').slice(0,12);
  const headSha = (meta.headSha||'').slice(0,12);
  view.innerHTML = '<h2>Summary</h2>'
    + '<div class="panel"><b>Repository:</b> '+esc(meta.repo || '')
    + '<br/><b>Base:</b> '+esc(meta.baseLabel||'')+' — <code>'+esc(baseSha)+'</code>'
    + '<br/><b>Head:</b> '+esc(meta.headLabel||'')+' — <code>'+esc(headSha)+'</code>'
    + '<br/><b>Counts:</b> NEW='+diff.news.length+' · REMOVED='+diff.removed.length+' · UNCHANGED='+diff.unchanged.length
    + '</div>';
}

async function renderSeverity(){
  const base = await loadJson('grype-base.json');
  const head = await loadJson('grype-head.json');
  const count = arr => arr.reduce((m,x)=>{const s=(x.vulnerability&&x.vulnerability.severity)||'UNKNOWN';m[s]=(m[s]||0)+1;return m;}, {});
  const baseC = count(base.matches||[]);
  const headC = count(head.matches||[]);
  view.innerHTML = '<h2>Severity distribution</h2>'
    + '<div class="grid2">'
    + ' <div class="chart-box"><h3>'+esc((window.__meta__||{}).baseLabel||"BASE")+'</h3><canvas id="c1"></canvas></div>'
    + ' <div class="chart-box"><h3>'+esc((window.__meta__||{}).headLabel||"HEAD")+'</h3><canvas id="c2"></canvas></div>'
    + '</div>';
  const severities = ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"];
  const colors = ["#b91c1c","#ea580c","#ca8a04","#16a34a","#6b7280"];
  new Chart(document.getElementById('c1'),{type:'doughnut',
    data:{labels:severities,datasets:[{data:severities.map(s=>baseC[s]||0),backgroundColor:colors}]},
    options:{plugins:{legend:{position:'bottom'}},cutout:'60%'}
  });
  new Chart(document.getElementById('c2'),{type:'doughnut',
    data:{labels:severities,datasets:[{data:severities.map(s=>headC[s]||0),backgroundColor:colors}]},
    options:{plugins:{legend:{position:'bottom'}},cutout:'60%'}
  });
}

async function renderChanges(){
  const d = await loadJson('diff.json');
  view.innerHTML = '<h2>Change overview</h2><div class="chart-box"><canvas id="c3" style="height:260px"></canvas></div>';
  new Chart(document.getElementById('c3'),{
    type:'bar',
    data:{labels:["NEW","REMOVED","UNCHANGED"],datasets:[{data:[d.news.length,d.removed.length,d.unchanged.length]}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}
  });
}

async function renderDiff(){
  const diff = await fetch('./report.md').then(r=>r.text()); // contains table already
  const idx = diff.split('\\n').findIndex(l=>l.trim().startsWith('| Severity |'));
  const tableMd = idx>=0 ? diff.split('\\n').slice(idx).join('\\n') : diff;
  view.innerHTML = '<h2>Vulnerability diff</h2>' + mdTableToHtml(tableMd);
}

async function renderGraphBase(){
  view.innerHTML = '<h2>Dependency graph (base)</h2><div id="m1"></div>';
  const txt = await fetch('./report-landscape.html').then(r=>r.text());
  const m = txt.match(/data-mermaid="([^"]*)"/); // first diagram
  if(m){ await ensureMermaid(); renderMermaid('m1', decodeHtml(m[1])); }
}
async function renderGraphHead(){
  view.innerHTML = '<h2>Dependency graph (head)</h2><div id="m2"></div>';
  const txt = await fetch('./report-landscape.html').then(r=>r.text());
  const all = [...txt.matchAll(/data-mermaid="([^"]*)"/g)];
  if(all[1]){ await ensureMermaid(); renderMermaid('m2', decodeHtml(all[1][1])); }
}

async function renderPathsBase(){
  const html = await extractSection('Dependency path base');
  view.innerHTML = '<h2>Dependency paths (base)</h2>' + html;
}
async function renderPathsHead(){
  const html = await extractSection('Dependency path head');
  view.innerHTML = '<h2>Dependency paths (head)</h2>' + html;
}

function decodeHtml(s){ return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'); }
async function ensureMermaid(){ if(!window.mermaidInited){ window.mermaid.initialize({startOnLoad:false,securityLevel:"antiscript"}); window.mermaidInited=true; } }
async function renderMermaid(targetId, code){
  const { svg } = await window.mermaid.render('m'+Math.random().toString(36).slice(2), code);
  document.getElementById(targetId).innerHTML = svg;
}
async function extractSection(title){
  const html = await fetch('./report-landscape.html').then(r=>r.text());
  const re = new RegExp('<h2>[^<]*'+title.replace(/[.*+?^\\$\\{\\}()|[\\]\\\\]/g,'\\\\$&')+'[^<]*<\\/h2>[\\\\s\\\\S]*?(<table[\\\\s\\\\S]*?<\\/table>)','i');
  const m = html.match(re);
  return m ? m[1] : '<div class="panel">No data</div>';
}

// Router boot
function route(){ const hash = location.hash || '#/intro';
  document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href')===hash));
  const fn = (routes[hash.slice(1)]||renderIntro);
  Promise.resolve(fn()).catch(e=>{view.innerHTML='<div class="panel">Error: '+esc(e)+'</div>';});
}
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
`;

  fs.writeFileSync(path.join(htmlDir, "index.html"), INDEX_HTML, "utf8");
  fs.writeFileSync(path.join(cssDir, "style.css"), STYLE_CSS, "utf8");
  fs.writeFileSync(path.join(jsDir, "app.js"), APP_JS, "utf8");
}

// ---------------------- main ----------------------

async function run() {
  try {
    // Inputs
    const baseRefInput = core.getInput("base_ref", { required: true });
    const headRefInput = core.getInput("head_ref", { required: true });
    const scanPath = core.getInput("path") || ".";
    const buildCommand = core.getInput("build_command") || "";
    const minSeverity = core.getInput("min_severity") || "LOW";
    const writeSummary = (core.getInput("write_summary") || "true") === "true";
    const uploadArtifact = (core.getInput("upload_artifact") || "true") === "true";
    const artifactName = core.getInput("artifact_name") || "vuln-diff-artifacts";
    const graphMaxNodes = parseInt(core.getInput("graph_max_nodes") || "150", 10);
    const reportHtml = (core.getInput("report_html") || "true") === "true";
    const reportPdf = (core.getInput("report_pdf") || "true") === "true";
    const titleLogo = core.getInput("title_logo_url") || "";

    const repository = process.env.GITHUB_REPOSITORY || "";
    const nowStrUK = fmtNowUK();

    const workdir = process.cwd();
    const baseDir = path.join(workdir, "__base__");
    const headDir = path.join(workdir, "__head__");
    fs.mkdirSync(baseDir, { recursive: true });

    await sh("git fetch --all --tags --prune --force");
    const baseSha = await resolveRefToSha(baseRefInput);
    const headSha = await resolveRefToSha(headRefInput);
    if (baseSha === headSha) {
      core.setFailed(
        `Both refs resolve to the same commit (${baseSha}). base='${baseRefInput}', head='${headRefInput}'`
      );
      return;
    }

    let currentSha = "";
    await exec.exec("bash", ["-lc", "git rev-parse HEAD"], {
      listeners: { stdout: (d) => (currentSha += d.toString()) },
    });
    currentSha = currentSha.trim();

    await sh(`git worktree add --detach ${baseDir} ${baseSha}`);
    let headScanRoot = workdir;
    let createdHeadWorktree = false;
    if (currentSha !== headSha) {
      fs.mkdirSync(headDir, { recursive: true });
      await sh(`git worktree add --detach ${headDir} ${headSha}`);
      headScanRoot = headDir;
      createdHeadWorktree = true;
    }

    const baseLabel = guessLabel(baseRefInput);
    const headLabel = guessLabel(headRefInput);

    if (buildCommand) {
      await sh(buildCommand, { cwd: baseDir });
      await sh(buildCommand, { cwd: headScanRoot });
    }

    const baseSbom = path.join(workdir, "sbom-base.json");
    const headSbom = path.join(workdir, "sbom-head.json");
    await generateSbomAuto(path.join(baseDir, scanPath), baseSbom);
    await generateSbomAuto(path.join(headScanRoot, scanPath), headSbom);

    const baseScan = await scanSbom(baseSbom);
    const headScan = await scanSbom(headSbom);

    // Diff (renders with branch labels)
    const d = diff(baseScan.matches || [], headScan.matches || [], minSeverity, baseLabel, headLabel);
    const diffMarkdown = renderMarkdownTable(d.news, d.removed, d.unchanged);
    const diffHtml = markdownTableToHtml(diffMarkdown);

    const baseCommit = await commitLine(baseSha);
    const headCommit = await commitLine(headSha);

    // Summary
    if (writeSummary) {
      const summary = [];
      summary.push("### Vulnerability Diff (Syft+Grype)\n");
      summary.push(`- **Base**: \`${baseLabel}\` (_input:_ \`${baseRefInput}\`) → \`${shortSha(baseSha)}\``);
      summary.push(`  - ${baseCommit}`);
      summary.push(`- **Head**: \`${headLabel}\` (_input:_ \`${headRefInput}\`) → \`${shortSha(headSha)}\``);
      summary.push(`  - ${headCommit}`);
      summary.push(`- **Min severity**: \`${minSeverity}\``);
      summary.push(`- **Counts**: NEW=${d.news.length} · REMOVED=${d.removed.length} · UNCHANGED=${d.unchanged.length}\n`);
      summary.push(diffMarkdown);
      await core.summary.addRaw(summary.join("\n")).write();
    }

    // ------------- Reporting (HTML/PDF) -------------
    let reportHtmlMainPath = "",
      reportHtmlLscpPath = "",
      reportPdfPath = "";
    try {
      const baseBomJson = JSON.parse(fs.readFileSync(baseSbom, "utf8"));
      const headBomJson = JSON.parse(fs.readFileSync(headSbom, "utf8"));
      const mermaidBase = buildMermaidGraphFromBOMImproved(baseBomJson, baseScan.matches || [], graphMaxNodes);
      const mermaidHead = buildMermaidGraphFromBOMImproved(headBomJson, headScan.matches || [], graphMaxNodes);

      // Dependency paths => markdown -> transform -> HTML
      const pathsBaseMdRaw = renderPathsMarkdownTable(
        buildDependencyPathsTable(baseBomJson, baseScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 })
      );
      const pathsHeadMdRaw = renderPathsMarkdownTable(
        buildDependencyPathsTable(headBomJson, headScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 })
      );
      const pathsBaseMd = transformDependencyPathsMarkdown(pathsBaseMdRaw);
      const pathsHeadMd = transformDependencyPathsMarkdown(pathsHeadMdRaw);
      const pathsBaseHtml = markdownTableToHtml(pathsBaseMd);
      const pathsHeadHtml = markdownTableToHtml(pathsHeadMd);

      const toolVersions = {
        cyclonedx: "auto",
        syft: "auto",
        grype: "auto",
        chartjs: "4.4.1",
        mermaid: "10.x",
        puppeteer: "24.10.2",
      };

      // Cover / Main / Landscape HTML
      const htmlCover = buildHtmlCover({ titleLogoUrl: titleLogo, repo: repository, baseLabel, headLabel, nowStr: nowStrUK });
      const htmlMain = buildHtmlMain({
        repository,
        baseLabel,
        baseInput: baseRefInput,
        baseSha,
        baseCommitLine: baseCommit,
        headLabel,
        headInput: headRefInput,
        headSha,
        headCommitLine: headCommit,
        minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        diffTableHtml: diffHtml,
        baseMatches: baseScan.matches || [],
        headMatches: headScan.matches || [],
        nowStr: nowStrUK,
        title_logo_url: titleLogo,
        toolVersions,
      });
      const htmlLandscape = buildHtmlLandscape({
        baseLabel,
        headLabel,
        mermaidBase,
        mermaidHead,
        pathsBaseMd: pathsBaseHtml,
        pathsHeadMd: pathsHeadHtml,
      });

      // Save HTML
      reportHtmlMainPath = path.join(workdir, "report-main.html");
      reportHtmlLscpPath = path.join(workdir, "report-landscape.html");
      fs.writeFileSync(reportHtmlMainPath, htmlMain, "utf8");
      fs.writeFileSync(reportHtmlLscpPath, htmlLandscape, "utf8");

      // PDFs
      if (reportPdf) {
        const pdfCover = path.join(workdir, "report-cover.pdf");
        const pdfMain = path.join(workdir, "report-main.pdf");
        const pdfLscp = path.join(workdir, "report-landscape.pdf");

        // Cover — no header/footer
        await renderPdfFromHtml(htmlCover, pdfCover, {
          landscape: false,
          displayHeaderFooter: false,
        });

        // Main — header/footer + logo + UK time
        await renderPdfFromHtml(htmlMain, pdfMain, {
          landscape: false,
          headerMeta: {
            repo: repository,
            base: baseLabel,
            head: headLabel,
            section: "Main",
            date: nowStrUK,
            logo: titleLogo,
          },
          displayHeaderFooter: true,
        });

        // Appendix (landscape) — header/footer + logo + UK time
        await renderPdfFromHtml(htmlLandscape, pdfLscp, {
          landscape: true,
          headerMeta: {
            repo: repository,
            base: baseLabel,
            head: headLabel,
            section: "Appendix",
            date: nowStrUK,
            logo: titleLogo,
          },
          displayHeaderFooter: true,
        });

        // Merge: cover + main + appendix
        reportPdfPath = path.join(workdir, "report.pdf");
        await mergePdfs([pdfCover, pdfMain, pdfLscp], reportPdfPath);
      }
    } catch (err) {
      core.warning(`Reporting (HTML/PDF) failed: ${err && err.stack ? err.stack : err}`);
    }

    // Raw data artifacts
    const grypeBasePath = path.join(workdir, "grype-base.json");
    const grypeHeadPath = path.join(workdir, "grype-head.json");
    fs.writeFileSync(grypeBasePath, JSON.stringify(baseScan, null, 2));
    fs.writeFileSync(grypeHeadPath, JSON.stringify(headScan, null, 2));
    const diffJsonPath = path.join(workdir, "diff.json");
    fs.writeFileSync(
      diffJsonPath,
      JSON.stringify({ news: d.news, removed: d.removed, unchanged: d.unchanged }, null, 2)
    );

    // Markdown report (debug/extra)
    const reportMdPath = path.join(workdir, "report.md");
    fs.writeFileSync(
      reportMdPath,
      buildMarkdownReport({
        baseLabel,
        baseInput: baseRefInput,
        baseSha,
        baseCommitLine: baseCommit,
        headLabel,
        headInput: headRefInput,
        headSha,
        headCommitLine: headCommit,
        minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        table: renderMarkdownTable(d.news, d.removed, d.unchanged),
        headGrype: headScan,
        headBOM: JSON.parse(fs.readFileSync(headSbom, "utf8")),
        graphMaxNodes,
      }),
      "utf8"
    );

    // Generate interactive HTML report bundle (independent from PDF)
    writeHtmlReportBundle(workdir, {
      repository,
      baseLabel,
      headLabel,
      baseSha,
      headSha,
      logoUrl: titleLogo,
      generatedAt: nowStrUK,
    });

    // Upload artifacts (include /html contents)
    if (uploadArtifact) {
      try {
        const client = new artifact.DefaultArtifactClient();
        const files = [
          reportMdPath,
          ...(reportHtmlMainPath ? [reportHtmlMainPath] : []),
          ...(reportHtmlLscpPath ? [reportHtmlLscpPath] : []),
          baseSbom,
          headSbom,
          grypeBasePath,
          grypeHeadPath,
          diffJsonPath,
        ];
        const extra = [];
        for (const n of ["report-cover.pdf", "report-main.pdf", "report-landscape.pdf", "report.pdf"]) {
          const p = path.join(workdir, n);
          if (fs.existsSync(p)) extra.push(p);
        }
        const htmlDir = path.join(workdir, "html");
        const htmlFiles = listFilesRecursively(htmlDir);
        const allFiles = [...files, ...extra, ...htmlFiles];

        await client.uploadArtifact(artifactName, allFiles, workdir, {
          continueOnError: true,
          retentionDays: 90,
        });
      } catch (e) {
        core.warning(`Artifact upload failed: ${e && e.stack ? e : e}`);
      }
    }

    // Cleanup worktrees
    await sh(`git worktree remove ${baseDir} --force || true`);
    if (createdHeadWorktree) {
      await sh(`git worktree remove ${headDir} --force || true`);
    }
  } catch (error) {
    core.setFailed(error.message || String(error));
  }
}

run();
