// src/index.js
// v2 — orchestrates SBOM/scan/diff, builds HTML bundle + PDFs, uploads artifacts, PR/summary text.
// Comments are in English, as requested.

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
  buildMermaidGraphFromBOMImproved,
} = require("./report");
const { buildHtmlCover, buildHtmlMain, buildHtmlLandscape } = require("./report-html");

// ---------------------- tiny utils ----------------------

function esc(s) {
  return String(s ?? "")
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

  throw new Error(`Cannot resolve ref '${ref}' to a commit SHA in this runner.`);
}

function shortSha(sha) {
  return (sha || "").slice(0, 12);
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

function fmtNowUK() {
  try {
    const f = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
    const m = f.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : f;
  } catch {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}:${pad(d.getSeconds())}`;
  }
}

// markdown GHSA/CVE → links (for job summary & PR comment)
function linkifyIdsMarkdown(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, (_m, id) => `[${id}](https://github.com/advisories/${id})`);
  out = out.replace(/\b(CVE-\d{4}-\d{4,7})\b/g, (_m, id) => `[${id}](https://nvd.nist.gov/vuln/detail/${id})`);
  return out;
}

// list files recursively (for artifact upload)
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

// fetch remote image → data URI (for footer logo)
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
            resolve(`data:${mime};base64,${buf.toString("base64")}`);
          });
        })
        .on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

// ---------------------- HTML helpers (tables, paths) ----------------------

// minimal MD table → HTML (interpret **bold**, `code`, linkify GHSA/CVE)
function markdownTableToHtml(md) {
  if (!md || !/\|/.test(md)) return `<div class="muted">No data</div>`;
  const lines = md.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0];
  const sep = lines[1] || "";
  if (!sep.replace(/\|/g, "").trim().match(/^-{3,}|:?-{3,}:?/)) return `<pre class="md">${esc(md)}</pre>`;

  const cells = (l) => l.split("|").map((c) => c.trim()).filter((_, i, a) => !(i === 0 || i === a.length - 1));
  const inline = (t) =>
    String(t || "")
      .replace(/`([^`]+)`/g, (_m, v) => `<code>${esc(v)}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, (_m, v) => `<strong>${esc(v)}</strong>`)
      .replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, (_m, id) => `<a href="https://github.com/advisories/${id}" target="_blank" rel="noopener" title="Open ${id}">${id}</a>`)
      .replace(/\b(CVE-\d{4}-\d{4,7})\b/g, (_m, id) => `<a href="https://nvd.nist.gov/vuln/detail/${id}" target="_blank" rel="noopener" title="Open ${id}">${id}</a>`);

  let html = `<table class="tbl"><thead><tr>`;
  for (const h of cells(header)) html += `<th>${inline(h)}</th>`;
  html += `</tr></thead><tbody>`;
  for (let i = 2; i < lines.length; i++) {
    const row = cells(lines[i]).map(inline);
    if (row.length) html += `<tr><td>${row.join("</td><td>")}</td></tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

// transform dependency-paths table:
// - Module := Depth0 (strip literal "pkg")
// - shift Depth1..n left (Depth1 → Depth0, etc.)
function transformDependencyPathsMarkdown(md) {
  if (!md || !/\|/.test(md)) return md;
  const lines = md.split(/\r?\n/);
  const headerIdx = 0;
  const cells = (l) => l.split("|").map((s) => s.trim()).filter((_, i, a) => !(i === 0 || i === a.length - 1));
  const header = cells(lines[0]);
  const sep = lines[1] || "";
  if (!sep.replace(/\|/g, "").trim().match(/^-{3,}|:?-{3,}:?/)) return md;

  const idx = {
    severity: header.findIndex((h) => /^severity$/i.test(h)),
    module: header.findIndex((h) => /^module$/i.test(h)),
    pkg: header.findIndex((h) => /^package$/i.test(h)),
    d0: header.findIndex((h) => /^depth0$/i.test(h)),
  };
  const depths = header
    .map((h, i) => ({ h, i }))
    .filter((x) => /^depth\d+$/i.test(x.h))
    .sort((a, b) => parseInt(a.h.slice(5)) - parseInt(b.h.slice(5)));

  const newHeader = [];
  if (idx.severity >= 0) newHeader.push(header[idx.severity]);
  newHeader.push("Module");
  if (idx.pkg >= 0) newHeader.push(header[idx.pkg]);
  for (const d of depths) {
    const n = parseInt(d.h.slice(5), 10);
    if (!isNaN(n) && n >= 1) newHeader.push(`Depth${n - 1}`);
  }

  const out = [];
  out.push("| " + newHeader.join(" | ") + " |");
  out.push("| " + newHeader.map(() => "---").join(" | ") + " |");

  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!/\|/.test(lines[i])) continue;
    const row = cells(lines[i]);
    const get = (k) => (k >= 0 && k < row.length ? row[k] : "");
    const sev = get(idx.severity);
    const moduleFromD0 = get(idx.d0).replace(/^`?pkg`?$/i, "").trim() || get(idx.module).replace(/^`?pkg`?$/i, "").trim();
    const pkg = get(idx.pkg);
    const shifted = [];
    for (const d of depths) {
      const n = parseInt(d.h.slice(5), 10);
      if (!isNaN(n) && n >= 1) shifted.push(get(d.i));
    }
    const cellsOut = [];
    if (idx.severity >= 0) cellsOut.push(sev);
    cellsOut.push(moduleFromD0 || "");
    if (idx.pkg >= 0) cellsOut.push(pkg);
    for (const s of shifted) cellsOut.push(s);
    out.push("| " + cellsOut.join(" | ") + " |");
  }
  return out.join("\n");
}

// ---------------------- Puppeteer + PDF ----------------------

async function ensureChromeForPuppeteer(version = "24.10.2") {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || `${os.homedir()}/.cache/puppeteer`;
  const cmd = `PUPPETEER_CACHE_DIR=${cacheDir} npx --yes puppeteer@${version} browsers install chrome`;
  await sh(cmd);
  return cacheDir;
}

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

    // charts (if canvas present)
    if (await page.$("canvas")) {
      await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" });
      await page.evaluate(() => {
        try {
          const data = window.__vulnChartData || { labels: [], base: [], head: [], changes: [0, 0, 0] };
          const colors = ["#b91c1c", "#ea580c", "#ca8a04", "#16a34a", "#6b7280"];
          function doughnut(id, values) {
            const el = document.getElementById(id);
            if (!el) return;
            new window.Chart(el.getContext("2d"), {
              type: "doughnut",
              data: { labels: data.labels, datasets: [{ data: values, backgroundColor: colors }] },
              options: { plugins: { legend: { position: "bottom" } }, cutout: "60%" },
            });
          }
          doughnut("chartBase", data.base);
          doughnut("chartHead", data.head);

          const elC = document.getElementById("chartChanges");
          if (elC) {
            new window.Chart(elC.getContext("2d"), {
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
        } catch {}
      });
    }

    // mermaid
    if (await page.$("[data-mermaid]")) {
      await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js" });
      await page.evaluate(async () => {
        try {
          window.mermaid.initialize({ startOnLoad: false, securityLevel: "antiscript" });
          const blocks = document.querySelectorAll("[data-mermaid]");
          for (const b of blocks) {
            const code = b.getAttribute("data-mermaid") || "";
            if (!code.trim()) continue;
            const { svg } = await window.mermaid.render("m" + Math.random().toString(36).slice(2), code);
            const holder = document.createElement("div");
            holder.innerHTML = svg;
            holder.style.transform = "scale(0.93)";
            holder.style.transformOrigin = "top left";
            (b.nextElementSibling || b.parentElement).appendChild(holder);
            b.remove();
          }
        } catch {}
      });
    }

    // header/footer (dark bar + optional logo + date)
    const brandBg = "#111827";
    const brandFg = "#F9FAFB";
    const meta = headerMeta || {};
    const titleLeft =
      "Security Report — " +
      esc(meta.repo || "") +
      (meta.base && meta.head ? " — " + esc(meta.base) + " vs " + esc(meta.head) : "");
    let footerLogo = "";
    if (meta.logo) {
      const dataUri = await (async () => {
        try {
          // If it's already a data URI or local path we keep it; else fetch
          if (/^data:/.test(meta.logo)) return meta.logo;
          return await new Promise((resolve) => {
            try {
              const u = meta.logo;
              const mod = u.startsWith("https://") ? https : http;
              mod
                .get(u, (res) => {
                  if (res.statusCode !== 200) return resolve("");
                  const chunks = [];
                  res.on("data", (d) => chunks.push(d));
                  res.on("end", () => {
                    const mime = res.headers["content-type"] || "image/png";
                    resolve(`data:${mime};base64,${Buffer.concat(chunks).toString("base64")}`);
                  });
                })
                .on("error", () => resolve(""));
            } catch {
              resolve("");
            }
          });
        } catch {
          return "";
        }
      })();
      if (dataUri) footerLogo = `<img src="${esc(dataUri)}" style="height:14px;vertical-align:middle;margin-right:8px"/>`;
    }

    const headerHtml = `
      <div style="width:100%;">
        <div style="font-size:9px;color:${brandFg};background:${brandBg};width:100%;padding:6px 10mm;">
          <span style="float:left;">${titleLeft}</span>
          <span style="float:right;">${esc(meta.section || "")}</span>
        </div>
      </div>`;

    const footerHtml = `
      <div style="width:100%;text-align:left;">
        <div style="font-size:9px;color:${brandFg};background:${brandBg};width:100%;padding:6px 10mm;">
          ${footerLogo}${esc(meta.date || "")}
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
  for (const p of pdfPaths) docs.push(await PDFDocument.load(fs.readFileSync(p)));
  const out = await PDFDocument.create();
  for (const doc of docs) {
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
  }
  fs.writeFileSync(outPath, await out.save());
}

// ---------------------- HTML interactive bundle ----------------------

function writeHtmlReportBundle(workdir, { repository, baseLabel, headLabel, baseSha, headSha, logoUrl, generatedAt }) {
  const htmlDir = path.join(workdir, "html");
  const cssDir = path.join(htmlDir, "css");
  const jsDir = path.join(htmlDir, "js");
  fs.mkdirSync(cssDir, { recursive: true });
  fs.mkdirSync(jsDir, { recursive: true });

  // copy inputs so the viewer can open from file:// (ZIP) without cross-dir fetch
  for (const f of [
    ["diff.json", "diff.json"],
    ["grype-base.json", "grype-base.json"],
    ["grype-head.json", "grype-head.json"],
    ["report-landscape.html", "report-landscape.html"],
    ["report.md", "report.md"],
  ]) {
    const from = path.join(workdir, f[0]);
    const to = path.join(htmlDir, f[1]);
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  }

  const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Security Report — ${esc(repository)}</title>
<link rel="stylesheet" href="./css/style.css"/>
<script>
window.__meta__ = {
  repo: ${JSON.stringify(repository)},
  baseLabel: ${JSON.stringify(baseLabel)},
  headLabel: ${JSON.stringify(headLabel)},
  baseSha: ${JSON.stringify(baseSha)},
  headSha: ${JSON.stringify(headSha)},
  generatedAt: ${JSON.stringify(generatedAt)}
};
</script>
<script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script defer src="./js/app.js"></script>
</head>
<body>
<header class="app-header">
  <div class="brand">
    ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="logo"/>` : ""}
    <div class="titles">
      <div class="subtitle">Comparison of branches <b>${esc(baseLabel)}</b> vs <b>${esc(headLabel)}</b></div>
      <h1>${esc(repository)}</h1>
    </div>
  </div>
  <div class="meta">Generated: ${esc(generatedAt)}</div>
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
  <main id="view" class="content"><noscript>Enable JavaScript to view the interactive report.</noscript></main>
</div>

<footer class="app-footer"><span>Security Report — ${esc(repository)}</span></footer>
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
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th,.tbl td{border:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}
.tbl thead th{background:#f9fafb}
code{background:#f1f5f9;padding:2px 6px;border-radius:6px}
@media (max-width:900px){.app-body{grid-template-columns:1fr}.sidebar{grid-row:2}.content{grid-row:1}}
`;

  const APP_JS = `'use strict';

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

function linkify(txt){
  return String(txt)
    .replace(/\\b(GHSA-[A-Za-z0-9-]{9,})\\b/g,(m,id)=>'<a title="Open '+id+'" href="https://github.com/advisories/'+id+'" target="_blank" rel="noopener">'+id+'</a>')
    .replace(/\\b(CVE-\\d{4}-\\d{4,7})\\b/g,(m,id)=>'<a title="Open '+id+'" href="https://nvd.nist.gov/vuln/detail/'+id+'" target="_blank" rel="noopener">'+id+'</a>');
}

function mdTableToHtml(md){
  if(!md || !md.includes('|')) return '<div class="panel">No data</div>';
  const lines = md.split(/\\r?\\n/).filter(Boolean);
  const header = lines[0];
  const sep = lines[1] || '';
  if(!sep.replace(/\\|/g,'').trim().match(/^-{3,}|:?-{3,}:?/)) return '<pre>'+esc(md)+'</pre>';
  const cells = l => l.split('|').map(c=>c.trim()).filter((_,i,a)=>!(i===0||i===a.length-1));
  let html = '<table class="tbl"><thead><tr>';
  for(const h of cells(header)) html += '<th>'+h.replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>')+'</th>';
  html += '</tr></thead><tbody>';
  for(let i=2;i<lines.length;i++){
    const row = cells(lines[i]).map(c=> linkify(c.replace(/\\\`([^\\\`]+)\\\`/g,'<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>')));
    if(row.length) html += '<tr><td>'+row.join('</td><td>')+'</td></tr>';
  }
  html += '</tbody></table>';
  return html;
}

function route(){
  const hash = location.hash || '#/intro';
  document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href')===hash));
  const fn = (routes[hash.slice(1)]||renderIntro);
  Promise.resolve(fn()).catch(e=>{view.innerHTML='<div class="panel">Error: '+esc(e)+'</div>';});
}
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

async function renderIntro(){
  const m = window.__meta__ || {};
  const base = esc(m.baseLabel || 'base');
  const head = esc(m.headLabel || 'head');
  view.innerHTML =
    '<h2>Introduction</h2>' +
    '<div class="panel">This report compares security vulnerabilities between <b>'+base+'</b> (base) and <b>'+head+'</b> (head). ' +
    'The goal is to detect vulnerabilities that are introduced and/or fixed between development branches.</div>' +
    '<div class="panel"><b>Tools & pipeline</b><br/><ul>' +
    '<li><b>CycloneDX Maven plugin</b>: generates an accurate SBOM (JSON) per ref.</li>' +
    '<li><b>Syft</b>: generates SBOMs when Maven is not present.</li>' +
    '<li><b>Grype</b>: scans SBOMs and produces vulnerability findings.</li>' +
    '<li><b>Diff logic</b>: classifies NEW, REMOVED, and UNCHANGED vulnerabilities.</li>' +
    '</ul></div>';
}

async function renderSummary(){
  const diff = await loadJson('diff.json');
  const m = window.__meta__ || {};
  const baseSha = (m.baseSha||'').slice(0,12);
  const headSha = (m.headSha||'').slice(0,12);
  view.innerHTML = '<h2>Summary</h2>' +
    '<div class="panel"><b>Repository:</b> '+esc(m.repo||'')+
    '<br/><b>Base:</b> '+esc(m.baseLabel||'')+' — <code>'+esc(baseSha)+'</code>'+
    '<br/><b>Head:</b> '+esc(m.headLabel||'')+' — <code>'+esc(headSha)+'</code>'+
    '<br/><b>Counts:</b> NEW='+diff.news.length+' · REMOVED='+diff.removed.length+' · UNCHANGED='+diff.unchanged.length+
    '</div>';
}

async function renderSeverity(){
  const base = await loadJson('grype-base.json');
  const head = await loadJson('grype-head.json');
  const count = arr => arr.reduce((m,x)=>{const s=(x.vulnerability&&x.vulnerability.severity)||'UNKNOWN';m[s]=(m[s]||0)+1;return m;}, {});
  const baseC = count(base.matches||[]);
  const headC = count(head.matches||[]);
  view.innerHTML = '<h2>Severity distribution</h2>' +
    '<div class="grid2">' +
    ' <div class="chart-box"><h3>'+esc((window.__meta__||{}).baseLabel||"BASE")+'</h3><canvas id="c1" style="width:100%;height:260px"></canvas></div>' +
    ' <div class="chart-box"><h3>'+esc((window.__meta__||{}).headLabel||"HEAD")+'</h3><canvas id="c2" style="width:100%;height:260px"></canvas></div>' +
    '</div>';
  const severities = ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"];
  const colors = ["#b91c1c","#ea580c","#ca8a04","#16a34a","#6b7280"];
  new Chart(document.getElementById('c1'),{type:'doughnut',
    data:{labels:severities,datasets:[{data:severities.map(s=>baseC[s]||0),backgroundColor:colors}]},
    options:{plugins:{legend:{position:'bottom'}},cutout:'60%'}});
  new Chart(document.getElementById('c2'),{type:'doughnut',
    data:{labels:severities,datasets:[{data:severities.map(s=>headC[s]||0),backgroundColor:colors}]},
    options:{plugins:{legend:{position:'bottom'}},cutout:'60%'}});
}

async function renderChanges(){
  const d = await loadJson('diff.json');
  view.innerHTML = '<h2>Change overview</h2><div class="chart-box"><canvas id="c3" style="height:260px;width:100%"></canvas></div>';
  new Chart(document.getElementById('c3'),{
    type:'bar',
    data:{labels:["NEW","REMOVED","UNCHANGED"],datasets:[{data:[d.news.length,d.removed.length,d.unchanged.length]}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}
  });
}

async function renderDiff(){
  const md = await fetch('./report.md').then(r=>r.text());
  const idx = md.split('\\n').findIndex(l=>l.trim().startsWith('| Severity |'));
  const table = idx>=0 ? md.split('\\n').slice(idx).join('\\n') : md;
  view.innerHTML = '<h2>Vulnerability diff</h2>' + mdTableToHtml(table);
}

async function renderGraphBase(){
  view.innerHTML = '<h2>Dependency graph (base)</h2><div id="m1"></div>';
  const txt = await fetch('./report-landscape.html').then(r=>r.text());
  const m = txt.match(/data-mermaid="([^"]*)"/);
  if(m){ await ensureMermaid(); renderMermaid('m1', decodeHtml(m[1])); }
}
async function renderGraphHead(){
  view.innerHTML = '<h2>Dependency graph (head)</h2><div id="m2"></div>';
  const txt = await fetch('./report-landscape.html').then(r=>r.text());
  const all = [...txt.matchAll(/data-mermaid="([^"]*)"/g)];
  if(all[1]){ await ensureMermaid(); renderMermaid('m2', decodeHtml(all[1][1])); }
}

async function renderPathsBase(){ view.innerHTML='<h2>Dependency paths (base)</h2>'+await extractSection('Dependency path base'); }
async function renderPathsHead(){ view.innerHTML='<h2>Dependency paths (head)</h2>'+await extractSection('Dependency path head'); }

function decodeHtml(s){ return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'); }
async function ensureMermaid(){ if(!window.mermaidInited){ window.mermaid.initialize({startOnLoad:false,securityLevel:"antiscript"}); window.mermaidInited=true; } }
async function renderMermaid(id, code){ const {svg}=await window.mermaid.render('m'+Math.random().toString(36).slice(2), code); document.getElementById(id).innerHTML=svg; }
async function extractSection(title){
  const html = await fetch('./report-landscape.html').then(r=>r.text());
  const re = new RegExp('<h2>[^<]*'+title.replace(/[.*+?^\\$\\{\\}()|[\\]\\\\]/g,'\\\\$&')+'[^<]*<\\/h2>[\\\\s\\\\S]*?(<table[\\\\s\\\\S]*?<\\/table>)','i');
  const m = html.match(re);
  return m ? m[1] : '<div class="panel">No data</div>';
}
`;

  fs.writeFileSync(path.join(htmlDir, "index.html"), INDEX_HTML, "utf8");
  fs.writeFileSync(path.join(cssDir, "style.css"), STYLE_CSS, "utf8");
  fs.writeFileSync(path.join(jsDir, "app.js"), APP_JS, "utf8");
}

// ---------------------- main ----------------------

async function run() {
  try {
    // inputs
    const baseRefInput = core.getInput("base_ref", { required: true });
    const headRefInput = core.getInput("head_ref", { required: true });
    const scanPath = core.getInput("path") || ".";
    const buildCommand = core.getInput("build_command") || "";
    const minSeverity = core.getInput("min_severity") || "LOW";
    const writeSummary = (core.getInput("write_summary") || "true") === "true";
    const uploadArtifacts = (core.getInput("upload_artifact") || "true") === "true";
    const artifactName = core.getInput("artifact_name") || "vulnerability-diff";
    const reportHtml = (core.getInput("report_html") || "true") === "true";
    const reportPdf = (core.getInput("report_pdf") || "true") === "true";
    const graphMaxNodes = parseInt(core.getInput("graph_max_nodes") || "150", 10);
    const titleLogoUrl = core.getInput("title_logo_url") || "";

    const repository = process.env.GITHUB_REPOSITORY || "";
    const nowStrUK = fmtNowUK();

    // workspace
    const workdir = process.cwd();
    const baseDir = path.join(workdir, "__base__");
    const headDir = path.join(workdir, "__head__");
    fs.mkdirSync(baseDir, { recursive: true });

    await sh("git fetch --all --tags --prune --force");

    const baseSha = await resolveRefToSha(baseRefInput);
    const headSha = await resolveRefToSha(headRefInput);
    if (baseSha === headSha) {
      core.setFailed(`Both refs resolve to the same commit (${baseSha}). base='${baseRefInput}', head='${headRefInput}'`);
      return;
    }

    let currentSha = "";
    await exec.exec("bash", ["-lc", "git rev-parse HEAD"], {
      listeners: { stdout: (d) => (currentSha += d.toString()) },
    });
    currentSha = currentSha.trim();

    // worktrees
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

    // optional build
    if (buildCommand) {
      await sh(buildCommand, { cwd: baseDir });
      await sh(buildCommand, { cwd: headScanRoot });
    }

    // SBOM
    const baseSbom = path.join(workdir, "sbom-base.json");
    const headSbom = path.join(workdir, "sbom-head.json");
    await generateSbomAuto(path.join(baseDir, scanPath), baseSbom);
    await generateSbomAuto(path.join(headScanRoot, scanPath), headSbom);

    // scan
    const baseScan = await scanSbom(baseSbom);
    const headScan = await scanSbom(headSbom);

    // diff
    const d = diff(baseScan.matches || [], headScan.matches || [], minSeverity, baseLabel, headLabel);
    let diffMarkdown = renderMarkdownTable(d.news, d.removed, d.unchanged);
    diffMarkdown = linkifyIdsMarkdown(diffMarkdown);
    const diffHtml = markdownTableToHtml(diffMarkdown);

    // summary (job)
    if (writeSummary) {
      const baseCommit = await commitLine(baseSha);
      const headCommit = await commitLine(headSha);
      const out = [];
      out.push("### Vulnerability Diff (Syft+Grype)\n");
      out.push(`- **Base**: \`${baseLabel}\` (_input:_ \`${baseRefInput}\`) → \`${shortSha(baseSha)}\``);
      out.push(`  - ${baseCommit}`);
      out.push(`- **Head**: \`${headLabel}\` (_input:_ \`${headRefInput}\`) → \`${shortSha(headSha)}\``);
      out.push(`  - ${headCommit}`);
      out.push(`- **Min severity**: \`${minSeverity}\``);
      out.push(`- **Counts**: NEW=${d.news.length} · REMOVED=${d.removed.length} · UNCHANGED=${d.unchanged.length}\n`);
      out.push(diffMarkdown);
      await core.summary.addRaw(out.join("\n")).write();
    }

    // ------ reports (HTML/PDF) ------
    let htmlMainPath = "",
      htmlLandscapePath = "",
      pdfPath = "";

    try {
      const baseBom = JSON.parse(fs.readFileSync(baseSbom, "utf8"));
      const headBom = JSON.parse(fs.readFileSync(headSbom, "utf8"));

      const mermaidBase = buildMermaidGraphFromBOMImproved(baseBom, baseScan.matches || [], graphMaxNodes);
      const mermaidHead = buildMermaidGraphFromBOMImproved(headBom, headScan.matches || [], graphMaxNodes);

      const pathsBaseMdRaw = renderPathsMarkdownTable(
        buildDependencyPathsTable(baseBom, baseScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 })
      );
      const pathsHeadMdRaw = renderPathsMarkdownTable(
        buildDependencyPathsTable(headBom, headScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 })
      );
      const pathsBaseMd = transformDependencyPathsMarkdown(pathsBaseMdRaw);
      const pathsHeadMd = transformDependencyPathsMarkdown(pathsHeadMdRaw);

      const baseCommitLine = await commitLine(baseSha);
      const headCommitLine = await commitLine(headSha);

      const toolVersions = { cyclonedx: "auto", syft: "auto", grype: "auto", chartjs: "4.4.1", mermaid: "10.x" };

      const htmlCover = buildHtmlCover({
        titleLogoUrl,
        repo: repository,
        baseLabel,
        headLabel,
        nowStr: fmtNowUK(),
      });

      const htmlMain = buildHtmlMain({
        repository,
        baseLabel,
        baseInput: baseRefInput,
        baseSha,
        baseCommitLine,
        headLabel,
        headInput: headRefInput,
        headSha,
        headCommitLine,
        minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        diffTableHtml: diffHtml,
        baseMatches: baseScan.matches || [],
        headMatches: headScan.matches || [],
        nowStr: fmtNowUK(),
        title_logo_url: titleLogoUrl,
        toolVersions,
      });

      const htmlLandscape = buildHtmlLandscape({
        baseLabel,
        headLabel,
        mermaidBase,
        mermaidHead,
        pathsBaseMd: markdownTableToHtml(pathsBaseMd),
        pathsHeadMd: markdownTableToHtml(pathsHeadMd),
      });

      htmlMainPath = path.join(workdir, "report-main.html");
      htmlLandscapePath = path.join(workdir, "report-landscape.html");
      fs.writeFileSync(htmlMainPath, htmlMain, "utf8");
      fs.writeFileSync(htmlLandscapePath, htmlLandscape, "utf8");

      if (reportPdf) {
        const coverPdf = path.join(workdir, "report-cover.pdf");
        const mainPdf = path.join(workdir, "report-main.pdf");
        const landscapePdf = path.join(workdir, "report-landscape.pdf");

        await renderPdfFromHtml(htmlCover, coverPdf, { displayHeaderFooter: false });
        await renderPdfFromHtml(htmlMain, mainPdf, {
          headerMeta: {
            repo: repository,
            base: baseLabel,
            head: headLabel,
            section: "Main",
            date: fmtNowUK(),
            logo: titleLogoUrl,
          },
          displayHeaderFooter: true,
          landscape: false,
        });
        await renderPdfFromHtml(htmlLandscape, landscapePdf, {
          headerMeta: {
            repo: repository,
            base: baseLabel,
            head: headLabel,
            section: "Appendix",
            date: fmtNowUK(),
            logo: titleLogoUrl,
          },
          displayHeaderFooter: true,
          landscape: true,
        });

        pdfPath = path.join(workdir, "report.pdf");
        await mergePdfs([coverPdf, mainPdf, landscapePdf], pdfPath);
      }
    } catch (e) {
      core.warning(`Reporting (HTML/PDF) failed: ${e && e.stack ? e : e}`);
    }

    // persist raw data + md
    const grypeBasePath = path.join(workdir, "grype-base.json");
    const grypeHeadPath = path.join(workdir, "grype-head.json");
    fs.writeFileSync(grypeBasePath, JSON.stringify(baseScan, null, 2));
    fs.writeFileSync(grypeHeadPath, JSON.stringify(headScan, null, 2));

    const diffJsonPath = path.join(workdir, "diff.json");
    fs.writeFileSync(diffJsonPath, JSON.stringify({ news: d.news, removed: d.removed, unchanged: d.unchanged }, null, 2));

    const reportMdPath = path.join(workdir, "report.md");
    fs.writeFileSync(
      reportMdPath,
      buildMarkdownReport({
        baseLabel,
        baseInput: baseRefInput,
        baseSha,
        baseCommitLine: await commitLine(baseSha),
        headLabel,
        headInput: headRefInput,
        headSha,
        headCommitLine: await commitLine(headSha),
        minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        table: renderMarkdownTable(d.news, d.removed, d.unchanged),
        headGrype: headScan,
        headBOM: JSON.parse(fs.readFileSync(headSbom, "utf8")),
        graphMaxNodes,
      }),
      "utf8"
    );

    // interactive HTML bundle
    writeHtmlReportBundle(workdir, {
      repository,
      baseLabel,
      headLabel,
      baseSha,
      headSha,
      logoUrl: titleLogoUrl,
      generatedAt: nowStrUK,
    });

    // artifacts (include /html recursively)
    if (uploadArtifacts) {
      try {
        const client = new artifact.DefaultArtifactClient();
        const files = [
          reportMdPath,
          baseSbom,
          headSbom,
          grypeBasePath,
          grypeHeadPath,
          diffJsonPath,
        ];
        if (htmlMainPath) files.push(htmlMainPath);
        if (htmlLandscapePath) files.push(htmlLandscapePath);
        // optional PDFs
        for (const n of ["report-cover.pdf", "report-main.pdf", "report-landscape.pdf", "report.pdf"]) {
          const p = path.join(workdir, n);
          if (fs.existsSync(p)) files.push(p);
        }
        const htmlDir = path.join(workdir, "html");
        const htmlFiles = listFilesRecursively(htmlDir);
        await client.uploadArtifact(artifactName, [...files, ...htmlFiles], workdir, {
          continueOnError: true,
          retentionDays: 90,
        });
      } catch (e) {
        core.warning(`Artifact upload failed: ${e && e.stack ? e : e}`);
      }
    }

    // cleanup
    await sh(`git worktree remove ${baseDir} --force || true`);
    if (createdHeadWorktree) {
      await sh(`git worktree remove ${headDir} --force || true`);
    }
  } catch (err) {
    core.setFailed(err.message || String(err));
  }
}

run();
