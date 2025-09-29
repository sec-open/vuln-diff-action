// src/index.js
// v2 — Orchestrates SBOM/scan/diff, builds HTML bundle + PDFs (cover/main/landscape), uploads artifacts, PR/summary, and now Dashboard (Chart.js).
// Comments are in English as requested.

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

// ------------------------------------------------------------
// small utilities
// ------------------------------------------------------------
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
    await exec.exec("bash", ["-lc", "git rev-parse " + ref], {
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
    throw new Error("Input '" + ref + "' looks like a SHA but does not exist locally.");
  }
  let sha = await tryRevParse(ref);
  if (sha) return sha;

  sha = await tryRevParse("refs/remotes/origin/" + ref);
  if (sha) return sha;

  let remotes = "";
  await exec.exec("bash", ["-lc", "git remote"], {
    listeners: { stdout: (d) => (remotes += d.toString()) },
  });
  if (remotes.split(/\s+/).includes("upstream")) {
    sha = await tryRevParse("refs/remotes/upstream/" + ref);
    if (sha) return sha;
  }

  try {
    await sh("git fetch origin " + ref + ":" + ref + " --tags --prune");
    sha = await tryRevParse(ref);
    if (sha) return sha;
  } catch {}

  throw new Error("Cannot resolve ref '" + ref + "' to a commit SHA in this runner.");
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
  await exec.exec("bash", ["-lc", 'git --no-pager log -1 --format="%H %s" ' + sha], {
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
    return m ? m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] + ":" + m[6] : f;
  } catch {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (
      pad(d.getDate()) +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      d.getFullYear() +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes()) +
      ":" +
      pad(d.getSeconds())
    );
  }
}

// linkify GHSA/CVE ids for markdown (summary + PR comment)
function linkifyIdsMarkdown(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, function (_m, id) {
    return "[" + id + "](https://github.com/advisories/" + id + ")";
  });
  out = out.replace(/\b(CVE-\d{4}-\d{4,7})\b/g, function (_m, id) {
    return "[" + id + "](https://nvd.nist.gov/vuln/detail/" + id + ")";
  });
  return out;
}

// list files recursively (for artifact)
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

// ------------------------------------------------------------
// HTML helpers (tables/paths normalization for dashboard)
// ------------------------------------------------------------
function markdownTableToHtml(md) {
  if (!md || !/\|/.test(md)) return '<div class="muted">No data</div>';
  const lines = md.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0];
  const sep = lines[1] || "";
  if (!sep.replace(/\|/g, "").trim().match(/^-{3,}|:?-{3,}:?/)) return '<pre class="md">' + esc(md) + "</pre>";

  const cells = function (l) {
    return l.split("|").map(function (c) { return c.trim(); }).filter(function (_v, i, a) { return !(i === 0 || i === a.length - 1); });
  };
  const inline = function (t) {
    return String(t || "")
      .replace(/`([^`]+)`/g, function (_m, v) { return "<code>" + esc(v) + "</code>"; })
      .replace(/\*\*([^*]+)\*\*/g, function (_m, v) { return "<strong>" + esc(v) + "</strong>"; })
      .replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, function (_m, id) {
        return '<a href="https://github.com/advisories/' + id + '" target="_blank" rel="noopener" title="Open ' + id + '">' + id + "</a>";
      })
      .replace(/\b(CVE-\d{4}-\d{4,7})\b/g, function (_m, id) {
        return '<a href="https://nvd.nist.gov/vuln/detail/' + id + '" target="_blank" rel="noopener" title="Open ' + id + '">' + id + "</a>";
      });
  };

  let html = '<table class="tbl"><thead><tr>';
  cells(header).forEach(function (h) { html += "<th>" + inline(h) + "</th>"; });
  html += "</tr></thead><tbody>";
  for (let i = 2; i < lines.length; i++) {
    const row = cells(lines[i]).map(inline);
    if (row.length) html += "<tr><td>" + row.join("</td><td>") + "</td></tr>";
  }
  html += "</tbody></table>";
  return html;
}

// Normalize dependency-path rows for JSON (used by dashboard)
function normalizePathsForJson(rows) {
  return (rows || []).map(function (r) {
    const severity = r.severity || (r.vulnerability && r.vulnerability.severity) || "UNKNOWN";
    const moduleName =
      r.module || r.depth0 || (Array.isArray(r.path) && r.path[0]) || "";
    const pkg = r.package || r.pkg || r.name || "";
    const pathArr = Array.isArray(r.path)
      ? r.path.slice()
      : Object.keys(r)
          .filter(function (k) { return /^depth\d+/i.test(k); })
          .sort(function (a, b) { return parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10); })
          .map(function (k) { return r[k]; })
          .filter(Boolean);
    const depth = Number.isFinite(r.depth) ? r.depth : pathArr.length;
    const vulnId = r.vulnId || r.id || undefined;
    return { severity: severity, module: moduleName, package: pkg, path: pathArr, depth: depth, vulnId: vulnId };
  });
}

// ------------------------------------------------------------
// Puppeteer + PDF (kept simple; Chrome installed at runtime)
// ------------------------------------------------------------
async function ensureChromeForPuppeteer(version) {
  const ver = version || "24.10.2";
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || (os.homedir() + "/.cache/puppeteer");
  const cmd = "PUPPETEER_CACHE_DIR=" + cacheDir + " npx --yes puppeteer@" + ver + " browsers install chrome";
  await sh(cmd);
  return cacheDir;
}

async function renderPdfFromHtml(html, outPath, opts) {
  const options = opts || {};
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

    // auto-inject Chart.js for charts (if present)
    if (await page.$("canvas")) {
      await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" });
      await page.evaluate(function () {
        try {
          var data = window.__vulnChartData || { labels: [], base: [], head: [], changes: [0, 0, 0] };
          var colors = ["#b91c1c", "#ea580c", "#ca8a04", "#16a34a", "#6b7280"];
          function doughnut(id, values) {
            var el = document.getElementById(id);
            if (!el) return;
            new window.Chart(el.getContext("2d"), {
              type: "doughnut",
              data: { labels: data.labels, datasets: [{ data: values, backgroundColor: colors }] },
              options: { plugins: { legend: { position: "bottom" } }, cutout: "60%" },
            });
          }
          doughnut("chartBase", data.base);
          doughnut("chartHead", data.head);
          var elC = document.getElementById("chartChanges");
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

    // mermaid graphs (if present)
    if (await page.$("[data-mermaid]")) {
      await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js" });
      await page.evaluate(async function () {
        try {
          window.mermaid.initialize({ startOnLoad: false, securityLevel: "antiscript" });
          var blocks = document.querySelectorAll("[data-mermaid]");
          for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i];
            var code = b.getAttribute("data-mermaid") || "";
            if (!code.trim()) continue;
            var res = await window.mermaid.render("m" + Math.random().toString(36).slice(2), code);
            var holder = document.createElement("div");
            holder.innerHTML = res.svg;
            holder.style.transform = "scale(0.93)";
            holder.style.transformOrigin = "top left";
            (b.nextElementSibling || b.parentElement).appendChild(holder);
            b.remove();
          }
        } catch {}
      });
    }

    // header/footer bars
    var brandBg = "#111827";
    var brandFg = "#F9FAFB";
    var meta = options.headerMeta || {};
    var titleLeft =
      "Security Report — " +
      esc(meta.repo || "") +
      (meta.base && meta.head ? " — " + esc(meta.base) + " vs " + esc(meta.head) : "");

    // fetch logo (if any) and embed as data URI
    async function fetchLogo(u) {
      return await new Promise(function (resolve) {
        if (!u) return resolve("");
        try {
          var mod = u.indexOf("https://") === 0 ? https : http;
          mod
            .get(u, function (res) {
              if (res.statusCode !== 200) return resolve("");
              var chunks = [];
              res.on("data", function (d) { chunks.push(d); });
              res.on("end", function () {
                var mime = res.headers["content-type"] || "image/png";
                resolve("data:" + mime + ";base64," + Buffer.concat(chunks).toString("base64"));
              });
            })
            .on("error", function () { resolve(""); });
        } catch {
          resolve("");
        }
      });
    }
    var footerLogo = "";
    if (meta.logo) {
      var logoData = /^data:/.test(meta.logo) ? meta.logo : await fetchLogo(meta.logo);
      if (logoData) footerLogo = '<img src="' + esc(logoData) + '" style="height:14px;vertical-align:middle;margin-right:8px"/>';
    }

    var headerHtml =
      '<div style="width:100%;">' +
      '<div style="font-size:9px;color:' + brandFg + ";background:" + brandBg + ';width:100%;padding:6px 10mm;">' +
      '<span style="float:left;">' + titleLeft + "</span>" +
      '<span style="float:right;">' + esc(meta.section || "") + "</span>" +
      "</div>" +
      "</div>";

    var footerHtml =
      '<div style="width:100%;text-align:left;">' +
      '<div style="font-size:9px;color:' + brandFg + ";background:" + brandBg + ';width:100%;padding:6px 10mm;">' +
      footerLogo + esc(meta.date || "") +
      "</div>" +
      "</div>";

    var portraitMargins = {
      top: options.displayHeaderFooter ? "22mm" : "12mm",
      right: "10mm",
      bottom: options.displayHeaderFooter ? "20mm" : "12mm",
      left: "10mm",
    };
    var landscapeMargins = {
      top: options.displayHeaderFooter ? "20mm" : "10mm",
      right: "10mm",
      bottom: options.displayHeaderFooter ? "18mm" : "10mm",
      left: "10mm",
    };

    await page.pdf({
      path: outPath,
      format: "A4",
      landscape: !!options.landscape,
      printBackground: true,
      displayHeaderFooter: !!options.displayHeaderFooter,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      margin: options.landscape ? landscapeMargins : portraitMargins,
    });
  } finally {
    try { await browser.close(); } catch {}
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

// ------------------------------------------------------------
// HTML interactive bundle (includes Dashboard files)
// ------------------------------------------------------------
function writeHtmlReportBundle(workdir, meta) {
  const repository = meta.repository || "";
  const baseLabel = meta.baseLabel || "BASE";
  const headLabel = meta.headLabel || "HEAD";
  const baseSha = meta.baseSha || "";
  const headSha = meta.headSha || "";
  const logoUrl = meta.logoUrl || "";
  const generatedAt = meta.generatedAt || "";

  const htmlDir = path.join(workdir, "html");
  const cssDir = path.join(htmlDir, "css");
  const jsDir = path.join(htmlDir, "js");
  fs.mkdirSync(cssDir, { recursive: true });
  fs.mkdirSync(jsDir, { recursive: true });

  // copy data files so index.html can open from ZIP with file://
  const copies = [
    ["diff.json", "diff.json"],
    ["grype-base.json", "grype-base.json"],
    ["grype-head.json", "grype-head.json"],
    ["paths-base.json", "paths-base.json"],   // new
    ["paths-head.json", "paths-head.json"],   // new
    ["report-landscape.html", "report-landscape.html"],
    ["report.md", "report.md"],
  ];
  for (const pair of copies) {
    const from = path.join(workdir, pair[0]);
    const to = path.join(htmlDir, pair[1]);
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  }

  const INDEX_HTML =
    '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    "<title>Security Report — " + esc(repository) + "</title>" +
    '<link rel="stylesheet" href="./css/style.css"/>' +
    '<link rel="stylesheet" href="./css/dashboard.css"/>' +
    "<script>window.__meta__=" + JSON.stringify({
      repo: repository,
      baseLabel: baseLabel,
      headLabel: headLabel,
      baseSha: baseSha,
      headSha: headSha,
      generatedAt: generatedAt
    }) + ";</script>" +
    '<script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>' +
    '<script defer src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>' +
    '<script defer src="./js/app.js"></script>' +
    '<script defer src="./js/dashboard.js"></script>' +
    "</head><body>" +
    '<header class="app-header"><div class="brand">' +
    (logoUrl ? '<img class="logo" src="' + esc(logoUrl) + '" alt="logo"/>' : "") +
    '<div class="titles"><div class="subtitle">Comparison of branches <b>' +
    esc(baseLabel) + "</b> vs <b>" + esc(headLabel) + "</b></div>" +
    "<h1>" + esc(repository) + "</h1></div></div>" +
    '<div class="meta">Generated: ' + esc(generatedAt) + "</div></header>" +
    '<div class="app-body">' +
    '<aside class="sidebar"><nav>' +
    '<a href="#/dashboard" class="nav-link">Dashboard</a>' +
    '<a href="#/intro" class="nav-link">Introduction</a>' +
    '<a href="#/summary" class="nav-link">Summary</a>' +
    '<a href="#/severity" class="nav-link">Severity distribution</a>' +
    '<a href="#/changes" class="nav-link">Change overview</a>' +
    '<a href="#/diff" class="nav-link">Vulnerability diff</a>' +
    '<a href="#/graph-base" class="nav-link">Dependency graph (base)</a>' +
    '<a href="#/graph-head" class="nav-link">Dependency graph (head)</a>' +
    '<a href="#/paths-base" class="nav-link">Dependency paths (base)</a>' +
    '<a href="#/paths-head" class="nav-link">Dependency paths (head)</a>' +
    "</nav></aside>" +
    '<main id="view" class="content"><noscript>Enable JavaScript to view the interactive report.</noscript></main>' +
    "</div>" +
    '<footer class="app-footer"><span>Security Report — ' + esc(repository) + "</span></footer>" +
    "</body></html>";

  const STYLE_CSS =
    ":root{--bg:#ffffff;--fg:#1f2937;--muted:#6b7280;--border:#e5e7eb;--brand:#111827;--brand-fg:#F9FAFB;--side:#0f172a;--side-fg:#e5e7eb}" +
    "*{box-sizing:border-box}html,body{margin:0;padding:0}" +
    "body{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Ubuntu,Cantarell,'Noto Sans',Arial,Helvetica;background:var(--bg);color:var(--fg)}" +
    ".app-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--brand);color:var(--brand-fg)}" +
    ".brand{display:flex;align-items:center;gap:12px}.logo{width:36px;height:36px;object-fit:contain}" +
    ".titles h1{margin:0;font-size:18px}.titles .subtitle{font-size:12px;color:#cbd5e1}.meta{font-size:12px;color:#cbd5e1}" +
    ".app-body{display:grid;grid-template-columns:240px 1fr;min-height:calc(100vh - 72px)}" +
    ".sidebar{background:var(--side);color:var(--side-fg);padding:12px}" +
    ".sidebar .nav-link{display:block;color:var(--side-fg);text-decoration:none;padding:8px 10px;border-radius:8px;margin:4px 0}" +
    ".sidebar .nav-link:hover,.sidebar .nav-link.active{background:#1e293b}" +
    ".content{padding:16px}.app-footer{padding:8px 16px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}" +
    "h2{margin:0 0 10px 0}.panel{border:1px solid var(--border);border-radius:10px;padding:12px;background:#fff;margin-bottom:12px}" +
    ".grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}" +
    ".chart-box{border:1px solid var(--border);border-radius:10px;padding:12px}" +
    ".tbl{width:100%;border-collapse:collapse;font-size:13px}.tbl th,.tbl td{border:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}" +
    ".tbl thead th{background:#f9fafb}code{background:#f1f5f9;padding:2px 6px;border-radius:6px}" +
    "@media (max-width:900px){.app-body{grid-template-columns:1fr}.sidebar{grid-row:2}.content{grid-row:1}}";

  const DASHBOARD_CSS =
    ".filters{display:flex;flex-wrap:wrap;gap:14px;margin:12px 0}.filters .group{display:flex;align-items:center;gap:8px}" +
    ".filters label{font-weight:600;color:#374151}.chip{display:inline-block;padding:6px 10px;border:1px solid #e5e7eb;border-radius:999px;cursor:pointer;color:#374151;background:#fff}" +
    ".chip.active{background:#111827;color:#f9fafb;border-color:#111827}.radio{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:#374151}" +
    ".btn{background:#111827;color:#f9fafb;border:none;border-radius:8px;padding:8px 12px;cursor:pointer}" +
    ".kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:12px 0}.kpi{border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#fff}" +
    ".kpi .label{font-size:12px;color:#6b7280}.kpi .value{font-size:22px;font-weight:700}.panel{border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;margin:12px 0}" +
    ".grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.chart-wrap{position:relative;width:100%;min-height:260px}.muted{color:#6b7280}" +
    "@media (max-width:1100px){.kpis{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}}";

  const APP_JS =
    "'use strict';" +
    "var view=document.getElementById('view');" +
    "var routes={"/dashboard":function(){return window.renderDashboard&&window.renderDashboard();}, " +
    '"/intro":renderIntro,"/summary":renderSummary,"/severity":renderSeverity,"/changes":renderChanges,' +
    '"/diff":renderDiff,"/graph-base":renderGraphBase,"/graph-head":renderGraphHead,"/paths-base":renderPathsBase,"/paths-head":renderPathsHead};' +
    "function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}" +
    "function route(){var hash=location.hash||'#/dashboard';document.querySelectorAll('.nav-link').forEach(function(a){a.classList.toggle('active',a.getAttribute('href')===hash);});var fn=(routes[hash.slice(1)]||renderIntro);Promise.resolve(fn()).catch(function(e){view.innerHTML='<div class=\"panel\">Error: '+esc(e)+'</div>';});}" +
    "window.addEventListener('hashchange',route);window.addEventListener('DOMContentLoaded',route);" +
    "async function loadJson(name){var r=await fetch('./'+name);return r.json();}" +
    "function linkify(txt){return String(txt).replace(/\\b(GHSA-[A-Za-z0-9-]{9,})\\b/g,function(m,id){return '<a title=\"Open '+id+'\" href=\"https://github.com/advisories/'+id+'\" target=\"_blank\" rel=\"noopener\">'+id+'</a>';}).replace(/\\b(CVE-\\d{4}-\\d{4,7})\\b/g,function(m,id){return '<a title=\"Open '+id+'\" href=\"https://nvd.nist.gov/vuln/detail/'+id+'\" target=\"_blank\" rel=\"noopener\">'+id+'</a>';});}" +
    "function mdTableToHtml(md){if(!md||!md.includes('|'))return '<div class=\"panel\">No data</div>';var lines=md.split(/\\r?\\n/).filter(Boolean);var header=lines[0];var sep=lines[1]||'';if(!sep.replace(/\\|/g,'').trim().match(/^-{3,}|:?-{3,}:?/))return '<pre>'+esc(md)+'</pre>';var cells=function(l){return l.split('|').map(function(c){return c.trim();}).filter(function(_v,i,a){return !(i===0||i===a.length-1);});};var html='<table class=\"tbl\"><thead><tr>';cells(header).forEach(function(h){html+='<th>'+h.replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>')+'</th>';});html+='</tr></thead><tbody>';for(var i=2;i<lines.length;i++){var row=cells(lines[i]).map(function(c){return linkify(c.replace(/\\`([^\\`]+)\\`/g,'<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>'));});if(row.length)html+='<tr><td>'+row.join('</td><td>')+'</td></tr>';}html+='</tbody></table>';return html;}" +
    "async function renderIntro(){var m=window.__meta__||{};var base=esc(m.baseLabel||'base');var head=esc(m.headLabel||'head');view.innerHTML='<h2>Introduction</h2><div class=\"panel\">This report compares security vulnerabilities between <b>'+base+'</b> (base) and <b>'+head+'</b> (head). The goal is to detect vulnerabilities that are introduced and/or fixed between development branches.</div><div class=\"panel\"><b>Tools & pipeline</b><br/><ul><li><b>CycloneDX Maven plugin</b>: generates an accurate SBOM (JSON) per ref.</li><li><b>Syft</b>: generates SBOMs when Maven is not present.</li><li><b>Grype</b>: scans SBOMs and produces vulnerability findings.</li><li><b>Diff logic</b>: classifies NEW, REMOVED, and UNCHANGED vulnerabilities.</li></ul></div>';}" +
    "async function renderSummary(){var d=await loadJson('diff.json');var m=window.__meta__||{};var baseSha=(m.baseSha||'').slice(0,12);var headSha=(m.headSha||'').slice(0,12);view.innerHTML='<h2>Summary</h2><div class=\"panel\"><b>Repository:</b> '+esc(m.repo||'')+'<br/><b>Base:</b> '+esc(m.baseLabel||'')+' — <code>'+esc(baseSha)+'</code><br/><b>Head:</b> '+esc(m.headLabel||'')+' — <code>'+esc(headSha)+'</code><br/><b>Counts:</b> NEW='+d.news.length+' · REMOVED='+d.removed.length+' · UNCHANGED='+d.unchanged.length+'</div>';}" +
    "async function renderSeverity(){var base=await loadJson('grype-base.json');var head=await loadJson('grype-head.json');function count(arr){return (arr||[]).reduce(function(m,x){var s=(x.vulnerability&&x.vulnerability.severity)||'UNKNOWN';m[s]=(m[s]||0)+1;return m;},{})}var baseC=count(base.matches);var headC=count(head.matches);var m=window.__meta__||{};view.innerHTML='<h2>Severity distribution</h2><div class=\"grid2\"><div class=\"chart-box\"><h3>'+esc(m.baseLabel||'BASE')+'</h3><canvas id=\"c1\" style=\"width:100%;height:260px\"></canvas></div><div class=\"chart-box\"><h3>'+esc(m.headLabel||'HEAD')+'</h3><canvas id=\"c2\" style=\"width:100%;height:260px\"></canvas></div></div>';var severities=['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];var colors=['#b91c1c','#ea580c','#ca8a04','#16a34a','#6b7280'];new Chart(document.getElementById('c1'),{type:'doughnut',data:{labels:severities,datasets:[{data:severities.map(function(s){return baseC[s]||0;}),backgroundColor:colors}]},options:{plugins:{legend:{position:'bottom'}},cutout:'60%'}});new Chart(document.getElementById('c2'),{type:'doughnut',data:{labels:severities,datasets:[{data:severities.map(function(s){return headC[s]||0;}),backgroundColor:colors}]},options:{plugins:{legend:{position:'bottom'}},cutout:'60%'}});}" +
    "async function renderChanges(){var d=await loadJson('diff.json');view.innerHTML='<h2>Change overview</h2><div class=\"chart-box\"><canvas id=\"c3\" style=\"height:260px;width:100%\"></canvas></div>';new Chart(document.getElementById('c3'),{type:'bar',data:{labels:['NEW','REMOVED','UNCHANGED'],datasets:[{data:[d.news.length,d.removed.length,d.unchanged.length]}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});}" +
    "async function renderDiff(){var md=await fetch('./report.md').then(function(r){return r.text();});var idx=md.split('\\n').findIndex(function(l){return l.trim().startsWith('| Severity |');});var table=idx>=0?md.split('\\n').slice(idx).join('\\n'):md;view.innerHTML='<h2>Vulnerability diff</h2>'+mdTableToHtml(table);}" +
    "async function renderGraphBase(){view.innerHTML='<h2>Dependency graph (base)</h2><div id=\"m1\"></div>';var txt=await fetch('./report-landscape.html').then(function(r){return r.text();});var m=txt.match(/data-mermaid=\"([^\"]*)\"/);if(m){await ensureMermaid();renderMermaid('m1', decodeHtml(m[1]));}}" +
    "async function renderGraphHead(){view.innerHTML='<h2>Dependency graph (head)</h2><div id=\"m2\"></div>';var txt=await fetch('./report-landscape.html').then(function(r){return r.text();});var all=txt.match(/data-mermaid=\"([^\"]*)\"/g)||[];if(all.length>1){var second=(all[1]||'').match(/data-mermaid=\"([^\"]*)\"/);if(second){await ensureMermaid();renderMermaid('m2', decodeHtml(second[1]));}}}" +
    "async function renderPathsBase(){view.innerHTML='<h2>Dependency paths (base)</h2>'+await extractSection('Dependency path base');}" +
    "async function renderPathsHead(){view.innerHTML='<h2>Dependency paths (head)</h2>'+await extractSection('Dependency path head');}" +
    "function decodeHtml(s){return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}" +
    "async function ensureMermaid(){if(!window.mermaidInited){window.mermaid.initialize({startOnLoad:false,securityLevel:'antiscript'});window.mermaidInited=true;}}" +
    "async function renderMermaid(id, code){var r=await window.mermaid.render('m'+Math.random().toString(36).slice(2),code);document.getElementById(id).innerHTML=r.svg;}" +
    "async function extractSection(title){var html=await fetch('./report-landscape.html').then(function(r){return r.text();});var safe=title.replace(/[.*+?^\\$\\{\\}()|[\\]\\\\]/g,'\\\\$&');var re=new RegExp('<h2>[^<]*'+safe+'[^<]*</h2>[\\\\s\\\\S]*?(<table[\\\\s\\\\S]*?</table>)','i');var m=html.match(re);return m?m[1]:'<div class=\"panel\">No data</div>';}" ;

  // Dashboard code is big; written as separate file
  const DASHBOARD_JS =
    "(function(){var view=document.getElementById('view');" +
    "var state={severity:new Set(),status:new Set(),scope:'HEAD',data:{diff:null,pathsBase:[],pathsHead:[]},charts:{}};" +
    "window.renderDashboard=async function(){if(!state.data.diff){state.data.diff=await (await fetch('./diff.json')).json();}if(!state.data.pathsBase.length){try{state.data.pathsBase=await (await fetch('./paths-base.json')).json();}catch(e){state.data.pathsBase=[];}}if(!state.data.pathsHead.length){try{state.data.pathsHead=await (await fetch('./paths-head.json')).json();}catch(e){state.data.pathsHead=[];}}renderLayout();renderAll();};" +
    "function renderLayout(){view.innerHTML='<h2>Dashboard</h2><div class=\"filters\"><div class=\"group\"><label>Severity:</label>'+['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'].map(function(s){return chip(\"severity\",s);}).join('')+'</div><div class=\"group\"><label>Status:</label>'+['NEW','REMOVED','UNCHANGED'].map(function(s){return chip(\"status\",s);}).join('')+'</div><div class=\"group\"><label>Scope:</label>'+['BASE','HEAD'].map(function(s){return radio(\"scope\",s,state.scope===s);}).join('')+'</div><div class=\"group\"><button class=\"btn\" id=\"resetFilters\">Reset filters</button></div></div><section class=\"kpis\" id=\"kpis\"></section><section class=\"panel\"><h3>Status × Severity</h3><div class=\"chart-wrap\"><canvas id=\"ch_status_sev\"></canvas></div></section><section class=\"grid2\"><div class=\"panel\"><h3>Severity distribution — NEW</h3><div class=\"chart-wrap\"><canvas id=\"ch_new_donut\"></canvas></div></div><div class=\"panel\"><h3>Severity distribution — REMOVED</h3><div class=\"chart-wrap\"><canvas id=\"ch_removed_donut\"></canvas></div></div></section><section class=\"grid2\"><div class=\"panel\"><h3>Severity distribution — UNCHANGED</h3><div class=\"chart-wrap\"><canvas id=\"ch_unchanged_donut\"></canvas></div></div><div class=\"panel\"><h3>Status distribution per severity</h3><div class=\"chart-wrap\"><canvas id=\"ch_per_severity_stacked\"></canvas></div></div></section><section class=\"grid2\"><div class=\"panel\"><h3>Top modules (BASE)</h3><div class=\"chart-wrap\"><canvas id=\"ch_top_modules_base\"></canvas></div></div><div class=\"panel\"><h3>Top modules (HEAD)</h3><div class=\"chart-wrap\"><canvas id=\"ch_top_modules_head\"></canvas></div></div></section><section class=\"panel\"><h3>Vulnerability diff (filtered)</h3><div id=\"diffTable\"></div></section><section class=\"panel\"><h3>Dependency paths (filtered — <span id=\"scopeLabel\"></span>)</h3><div id=\"pathsTable\"></div></section>';document.getElementById('resetFilters').addEventListener('click',function(){state.severity.clear();state.status.clear();state.scope='HEAD';renderLayout();renderAll();});view.querySelectorAll('[data-chip]').forEach(function(el){el.addEventListener('click',function(){var kind=el.getAttribute('data-kind');var val=el.getAttribute('data-chip');var set=state[kind];if(set.has(val))set.delete(val);else set.add(val);el.classList.toggle('active');renderAll();});});view.querySelectorAll('input[name=\"scope\"]').forEach(function(el){el.addEventListener('change',function(){state.scope=el.value;renderAll();});});}" +
    "function chip(kind,label){var active=state[kind].has(label);return '<span class=\"chip '+(active?'active':'')+'\" data-kind=\"'+kind+'\" data-chip=\"'+label+'\">'+label+'</span>';}" +
    "function radio(name,value,checked){var id=name+'_'+value;return '<label class=\"radio\"><input type=\"radio\" name=\"'+name+'\" value=\"'+value+'\" '+(checked?'checked':'')+'/><span>'+value+'</span></label>';}" +
    "var SEVERITIES=['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];var STATUS=['NEW','REMOVED','UNCHANGED'];var COLORS={CRITICAL:'#b91c1c',HIGH:'#ea580c',MEDIUM:'#ca8a04',LOW:'#16a34a',UNKNOWN:'#6b7280',NEW:'#2563eb',REMOVED:'#059669',UNCHANGED:'#6b7280'};" +
    "function applyFiltersToDiff(items){var sevOn=state.severity.size?state.severity:null;var stOn=state.status.size?state.status:null;return items.filter(function(x){var okSev=!sevOn||sevOn.has(x.severity||'UNKNOWN');var okSt=!stOn||stOn.has(x.status||x._status||'UNKNOWN');return okSev&&okSt;});}" +
    "function diffFlat(){var d=state.data.diff||{news:[],removed:[],unchanged:[]};var m=[];d.news.forEach(function(x){m.push(Object.assign({},x,{status:'NEW'}));});d.removed.forEach(function(x){m.push(Object.assign({},x,{status:'REMOVED'}));});d.unchanged.forEach(function(x){m.push(Object.assign({},x,{status:'UNCHANGED'}));});return m;}" +
    "function renderAll(){renderKPIs();renderStatusSeverity();renderDonuts();renderPerSeverityStacked();renderTopModules();renderDiffTable();renderPathsTable();}" +
    "function renderKPIs(){var flat=diffFlat();var f=applyFiltersToDiff(flat);var counts={NEW:0,REMOVED:0,UNCHANGED:0};var maxHead='UNKNOWN',maxBase='UNKNOWN';f.forEach(function(x){counts[x.status]++;});function prio(s){var i=SEVERITIES.indexOf(s);return i<0?999:i;}function maxSeverity(kind){if(kind==='HEAD'){var arr=flat.filter(function(x){return x.status!=='REMOVED';});return arr.reduce(function(a,x){return prio(x.severity)<prio(a)?x.severity:a;},'UNKNOWN');}else{var arr2=flat.filter(function(x){return x.status!=='NEW';});return arr2.reduce(function(a,x){return prio(x.severity)<prio(a)?x.severity:a;},'UNKNOWN');}}maxHead=maxSeverity('HEAD');maxBase=maxSeverity('BASE');document.getElementById('kpis').innerHTML='<div class=\"kpi\"><div class=\"label\">NEW</div><div class=\"value\" style=\"color:'+COLORS.NEW+'\">'+counts.NEW+'</div></div><div class=\"kpi\"><div class=\"label\">REMOVED</div><div class=\"value\" style=\"color:'+COLORS.REMOVED+'\">'+counts.REMOVED+'</div></div><div class=\"kpi\"><div class=\"label\">UNCHANGED</div><div class=\"value\" style=\"color:'+COLORS.UNCHANGED+'\">'+counts.UNCHANGED+'</div></div><div class=\"kpi\"><div class=\"label\">Max severity (HEAD)</div><div class=\"value\" style=\"color:'+(COLORS[maxHead]||'#111')+'\">'+maxHead+'</div></div><div class=\"kpi\"><div class=\"label\">Max severity (BASE)</div><div class=\"value\" style=\"color:'+(COLORS[maxBase]||'#111')+'\">'+maxBase+'</div></div>';}" +
    "function renderStatusSeverity(){var flat=applyFiltersToDiff(diffFlat());var matrix={NEW:{CRITICAL:0,HIGH:0,MEDIUM:0,LOW:0,UNKNOWN:0},REMOVED:{CRITICAL:0,HIGH:0,MEDIUM:0,LOW:0,UNKNOWN:0},UNCHANGED:{CRITICAL:0,HIGH:0,MEDIUM:0,LOW:0,UNKNOWN:0}};flat.forEach(function(x){var st=x.status||'UNKNOWN';var sv=x.severity||'UNKNOWN';if(matrix[st]&&matrix[st][sv]!=null)matrix[st][sv]++;});var ctx=getCtx('ch_status_sev');var datasets=SEVERITIES.map(function(sv){return {label:sv,backgroundColor:COLORS[sv],data:STATUS.map(function(st){return matrix[st][sv]||0;})};});drawOrUpdateBar('statusSev',ctx,{labels:STATUS,datasets:datasets},{stacked:false});}" +
    "function renderDonuts(){var flat=applyFiltersToDiff(diffFlat());var by={NEW:{},REMOVED:{},UNCHANGED:{}};Object.keys(by).forEach(function(k){SEVERITIES.forEach(function(sv){by[k][sv]=0;});});flat.forEach(function(x){var st=x.status||'UNKNOWN';var sv=x.severity||'UNKNOWN';if(by[st]&&by[st][sv]!=null)by[st][sv]++;});function cfg(id,data){var ctx=getCtx(id);var values=SEVERITIES.map(function(sv){return data[sv]||0;});drawOrUpdateDoughnut(id,ctx,SEVERITIES,values,SEVERITIES.map(function(s){return COLORS[s];}));}cfg('ch_new_donut',by.NEW);cfg('ch_removed_donut',by.REMOVED);cfg('ch_unchanged_donut',by.UNCHANGED);}" +
    "function renderPerSeverityStacked(){var flat=applyFiltersToDiff(diffFlat());var matrix={CRITICAL:{NEW:0,REMOVED:0,UNCHANGED:0},HIGH:{NEW:0,REMOVED:0,UNCHANGED:0},MEDIUM:{NEW:0,REMOVED:0,UNCHANGED:0},LOW:{NEW:0,REMOVED:0,UNCHANGED:0},UNKNOWN:{NEW:0,REMOVED:0,UNCHANGED:0}};flat.forEach(function(x){var st=x.status||'UNKNOWN';var sv=x.severity||'UNKNOWN';if(matrix[sv]&&matrix[sv][st]!=null)matrix[sv][st]++;});var ctx=getCtx('ch_per_severity_stacked');var datasets=STATUS.map(function(st){return {label:st,backgroundColor:COLORS[st],data:SEVERITIES.map(function(sv){return matrix[sv][st]||0;})};});drawOrUpdateBar('perSeverity',ctx,{labels:SEVERITIES,datasets:datasets},{stacked:true});}" +
    "function renderTopModules(){function topModules(list){var acc={};list.forEach(function(r){if(!r.module)return;acc[r.module]=(acc[r.module]||0)+1;});return Object.entries(acc).sort(function(a,b){return b[1]-a[1];}).slice(0,10);}var base=filteredPaths('BASE');var head=filteredPaths('HEAD');var ctxB=getCtx('ch_top_modules_base');var ctxH=getCtx('ch_top_modules_head');var tb=topModules(base),th=topModules(head);drawOrUpdateBar('topBase',ctxB,{labels:tb.map(function(x){return x[0];}),datasets:[{label:'BASE',backgroundColor:'#334155',data:tb.map(function(x){return x[1];})}]},{horizontal:true});drawOrUpdateBar('topHead',ctxH,{labels:th.map(function(x){return x[0];}),datasets:[{label:'HEAD',backgroundColor:'#1f2937',data:th.map(function(x){return x[1];})}]},{horizontal:true});}" +
    "function renderDiffTable(){var rows=applyFiltersToDiff(diffFlat());var html='<table class=\"tbl\"><thead><tr><th>Status</th><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Version</th></tr></thead><tbody>'+rows.map(function(r){return '<tr><td>'+esc(r.status||'')+'</td><td><b>'+esc(r.severity||'UNKNOWN')+'</b></td><td>'+linkify(esc(r.id||''))+'</td><td><code>'+esc(r.package||'')+'</code></td><td><code>'+esc(r.version||'')+'</code></td></tr>';}).join('')+'</tbody></table>';document.getElementById('diffTable').innerHTML=html;}" +
    "function renderPathsTable(){document.getElementById('scopeLabel').textContent=state.scope;var rows=filteredPaths(state.scope);if(!rows.length){document.getElementById('pathsTable').innerHTML='<div class=\"muted\">No data</div>';return;}var maxDepth=rows.reduce(function(m,r){return Math.max(m, r.depth||(r.path?r.path.length:0));},0);var cols=['Severity','Module','Package'].concat(Array.from({length:maxDepth},function(_,_i){return 'Depth'+_i;}));var html='<table class=\"tbl\"><thead><tr>'+cols.map(function(c){return '<th>'+c+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(r){var base=['<b>'+esc(r.severity||'UNKNOWN')+'</b>','<code>'+esc(r.module||'')+'</code>','<code>'+esc(r.package||'')+'</code>'];var path=(r.path||[]);var pads=Array.from({length:maxDepth},function(_,_i){return '<code>'+esc(path[_i]||'')+'</code>';});return '<tr><td>'+base.concat(pads).join('</td><td>')+'</td></tr>';}).join('')+'</tbody></table>';document.getElementById('pathsTable').innerHTML=html;}" +
    "function filteredPaths(which){var rows=which==='BASE'?state.data.pathsBase:state.data.pathsHead;if(!rows||!rows.length)return [];var sevOn=state.severity.size?state.severity:null;var out=rows;if(sevOn)out=out.filter(function(r){return sevOn.has(r.severity||'UNKNOWN');});return out;}" +
    "function getCtx(id){return document.getElementById(id).getContext('2d');}" +
    "function drawOrUpdateBar(key,ctx,data,opts){opts=opts||{};var stacked=!!opts.stacked;var horizontal=!!opts.horizontal;if(state.charts[key]){var c=state.charts[key];c.data=data;c.options.indexAxis=horizontal?'y':'x';c.options.scales={x:{stacked:stacked},y:{stacked:stacked,beginAtZero:true,ticks:{precision:0}}};c.update();return;}state.charts[key]=new Chart(ctx,{type:'bar',data:data,options:{responsive:true,maintainAspectRatio:false,indexAxis:horizontal?'y':'x',plugins:{legend:{position:'bottom'}},scales:{x:{stacked:stacked},y:{stacked:stacked,beginAtZero:true,ticks:{precision:0}}}}});}" +
    "function drawOrUpdateDoughnut(key,ctx,labels,values,colors){if(state.charts[key]){var c=state.charts[key];c.data.labels=labels;c.data.datasets[0].data=values;c.update();return;}state.charts[key]=new Chart(ctx,{type:'doughnut',data:{labels:labels,datasets:[{data:values,backgroundColor:colors}]},options:{plugins:{legend:{position:'bottom'}},cutout:'60%'}});}" +
    "function linkify(txt){return String(txt).replace(/\\b(GHSA-[A-Za-z0-9-]{9,})\\b/g,function(m,id){return '<a title=\"Open '+id+'\" href=\"https://github.com/advisories/'+id+'\" target=\"_blank\" rel=\"noopener\">'+id+'</a>';}).replace(/\\b(CVE-\\d{4}-\\d{4,7})\\b/g,function(m,id){return '<a title=\"Open '+id+'\" href=\"https://nvd.nist.gov/vuln/detail/'+id+'\" target=\"_blank\" rel=\"noopener\">'+id+'</a>';});}" +
    "function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}" +
    "})();";

  // write bundle files
  fs.writeFileSync(path.join(htmlDir, "index.html"), INDEX_HTML, "utf8");
  fs.writeFileSync(path.join(cssDir, "style.css"), STYLE_CSS, "utf8");
  fs.writeFileSync(path.join(cssDir, "dashboard.css"), DASHBOARD_CSS, "utf8");
  fs.writeFileSync(path.join(jsDir, "app.js"), APP_JS, "utf8");
  fs.writeFileSync(path.join(jsDir, "dashboard.js"), DASHBOARD_JS, "utf8");
}

// ------------------------------------------------------------
// main
// ------------------------------------------------------------
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
      core.setFailed("Both refs resolve to the same commit (" + baseSha + "). base='" + baseRefInput + "', head='" + headRefInput + "'");
      return;
    }

    let currentSha = "";
    await exec.exec("bash", ["-lc", "git rev-parse HEAD"], {
      listeners: { stdout: (d) => (currentSha += d.toString()) },
    });
    currentSha = currentSha.trim();

    // worktrees
    await sh("git worktree add --detach " + baseDir + " " + baseSha);
    let headScanRoot = workdir;
    let createdHeadWorktree = false;
    if (currentSha !== headSha) {
      fs.mkdirSync(headDir, { recursive: true });
      await sh("git worktree add --detach " + headDir + " " + headSha);
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

    // SBOM (auto: Maven CycloneDX if pom.xml else Syft)
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

    // summary
    if (writeSummary) {
      const baseCommit = await commitLine(baseSha);
      const headCommit = await commitLine(headSha);
      const out = [];
      out.push("### Vulnerability Diff (Syft+Grype)\n");
      out.push("- **Base**: `" + baseLabel + "` (_input:_ `" + baseRefInput + "`) → `" + shortSha(baseSha) + "`");
      out.push("  - " + baseCommit);
      out.push("- **Head**: `" + headLabel + "` (_input:_ `" + headRefInput + "`) → `" + shortSha(headSha) + "`");
      out.push("  - " + headCommit);
      out.push("- **Min severity**: `" + minSeverity + "`");
      out.push("- **Counts**: NEW=" + d.news.length + " · REMOVED=" + d.removed.length + " · UNCHANGED=" + d.unchanged.length + "\n");
      out.push(diffMarkdown);
      await core.summary.addRaw(out.join("\n")).write();
    }

    // reports (HTML/PDF)
    let htmlMainPath = "", htmlLandscapePath = "", pdfPath = "";
    try {
      const baseBom = JSON.parse(fs.readFileSync(baseSbom, "utf8"));
      const headBom = JSON.parse(fs.readFileSync(headSbom, "utf8"));

      const mermaidBase = buildMermaidGraphFromBOMImproved(baseBom, baseScan.matches || [], graphMaxNodes);
      const mermaidHead = buildMermaidGraphFromBOMImproved(headBom, headScan.matches || [], graphMaxNodes);

      const pathsBaseRows = buildDependencyPathsTable(baseBom, baseScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 });
      const pathsHeadRows = buildDependencyPathsTable(headBom, headScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 });
      const pathsBaseJson = normalizePathsForJson(pathsBaseRows);
      const pathsHeadJson = normalizePathsForJson(pathsHeadRows);

      // JSON for dashboard
      const pathsBaseJsonPath = path.join(workdir, "paths-base.json");
      const pathsHeadJsonPath = path.join(workdir, "paths-head.json");
      fs.writeFileSync(pathsBaseJsonPath, JSON.stringify(pathsBaseJson, null, 2));
      fs.writeFileSync(pathsHeadJsonPath, JSON.stringify(pathsHeadJson, null, 2));

      // Markdown versions (legacy sections)
      const pathsBaseMdRaw = renderPathsMarkdownTable(pathsBaseRows);
      const pathsHeadMdRaw = renderPathsMarkdownTable(pathsHeadRows);

      const baseCommitLine = await commitLine(baseSha);
      const headCommitLine = await commitLine(headSha);

      const toolVersions = { cyclonedx: "auto", syft: "auto", grype: "auto", chartjs: "4.4.1", mermaid: "10.x" };

      const htmlCover = buildHtmlCover({
        titleLogoUrl: titleLogoUrl,
        repo: repository,
        baseLabel: baseLabel,
        headLabel: headLabel,
        nowStr: fmtNowUK(),
      });

      const htmlMain = buildHtmlMain({
        repository: repository,
        baseLabel: baseLabel,
        baseInput: baseRefInput,
        baseSha: baseSha,
        baseCommitLine: baseCommitLine,
        headLabel: headLabel,
        headInput: headRefInput,
        headSha: headSha,
        headCommitLine: headCommitLine,
        minSeverity: minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        diffTableHtml: diffHtml,
        baseMatches: baseScan.matches || [],
        headMatches: headScan.matches || [],
        nowStr: fmtNowUK(),
        title_logo_url: titleLogoUrl,
        toolVersions: toolVersions,
      });

      const htmlLandscape = buildHtmlLandscape({
        baseLabel: baseLabel,
        headLabel: headLabel,
        mermaidBase: mermaidBase,
        mermaidHead: mermaidHead,
        pathsBaseMd: markdownTableToHtml(pathsBaseMdRaw),
        pathsHeadMd: markdownTableToHtml(pathsHeadMdRaw),
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
          headerMeta: { repo: repository, base: baseLabel, head: headLabel, section: "Main", date: fmtNowUK(), logo: titleLogoUrl },
          displayHeaderFooter: true,
          landscape: false,
        });
        await renderPdfFromHtml(htmlLandscape, landscapePdf, {
          headerMeta: { repo: repository, base: baseLabel, head: headLabel, section: "Appendix", date: fmtNowUK(), logo: titleLogoUrl },
          displayHeaderFooter: true,
          landscape: true,
        });

        pdfPath = path.join(workdir, "report.pdf");
        await mergePdfs([coverPdf, mainPdf, landscapePdf], pdfPath);
      }
    } catch (e) {
      core.warning("Reporting (HTML/PDF) failed: " + (e && e.stack ? e.stack : String(e)));
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
        baseLabel: baseLabel,
        baseInput: baseRefInput,
        baseSha: baseSha,
        baseCommitLine: await commitLine(baseSha),
        headLabel: headLabel,
        headInput: headRefInput,
        headSha: headSha,
        headCommitLine: await commitLine(headSha),
        minSeverity: minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        table: renderMarkdownTable(d.news, d.removed, d.unchanged),
        headGrype: headScan,
        headBOM: JSON.parse(fs.readFileSync(headSbom, "utf8")),
        graphMaxNodes: graphMaxNodes,
      }),
      "utf8"
    );

    // interactive HTML bundle (includes dashboard js/css)
    writeHtmlReportBundle(workdir, {
      repository: repository,
      baseLabel: baseLabel,
      headLabel: headLabel,
      baseSha: baseSha,
      headSha: headSha,
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
        for (const n of ["report-cover.pdf", "report-main.pdf", "report-landscape.pdf", "report.pdf"]) {
          const p = path.join(workdir, n);
          if (fs.existsSync(p)) files.push(p);
        }
        const htmlDir = path.join(workdir, "html");
        const htmlFiles = listFilesRecursively(htmlDir);
        await client.uploadArtifact(artifactName, files.concat(htmlFiles), workdir, {
          continueOnError: true,
          retentionDays: 90,
        });
      } catch (e) {
        core.warning("Artifact upload failed: " + (e && e.stack ? e.stack : String(e)));
      }
    }

    // cleanup
    await sh("git worktree remove " + baseDir + " --force || true");
    if (createdHeadWorktree) await sh("git worktree remove " + headDir + " --force || true");
  } catch (err) {
    core.setFailed(err.message || String(err));
  }
}

run();
