// src/render/html.js
// Phase 3 — HTML-only components (interactive app + dashboard + static sections)

const fs = require("fs");
const path = require("path");

// very small sanitizer for inline text
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Markdown table -> HTML table (for diff/paths when we decide to reuse MD layout)
function markdownTableToHtml(md) {
  if (!md || !/\|/.test(md)) return '<div class="muted">No data</div>';
  const lines = md.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return '<div class="muted">No data</div>';
  const header = lines[0];
  const sep = lines[1];
  if (!sep.replace(/\|/g, "").trim().match(/^-{3,}|:?-{3,}:?/)) return '<pre class="md">'+esc(md)+'</pre>';
  const cells = (l) => l.split("|").map(c=>c.trim()).filter((_,i,a)=>!(i===0||i===a.length-1));
  const inline = (t) => String(t||"")
    .replace(/`([^`]+)`/g, (_m,v)=>"<code>"+esc(v)+"</code>")
    .replace(/\*\*([^*]+)\*\*/g, (_m,v)=>"<strong>"+esc(v)+"</strong>")
    .replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, (_m,id)=>'<a href="https://github.com/advisories/'+id+'" target="_blank" rel="noopener">'+id+'</a>')
    .replace(/\b(CVE-\d{4}-\d{4,7})\b/g, (_m,id)=>'<a href="https://nvd.nist.gov/vuln/detail/'+id+'" target="_blank" rel="noopener">'+id+'</a>');
  let html = '<table class="tbl"><thead><tr>';
  cells(header).forEach(h=> html += "<th>"+inline(h)+"</th>");
  html += "</tr></thead><tbody>";
  for (let i=2;i<lines.length;i++) {
    const row = cells(lines[i]).map(inline);
    if (row.length) html += "<tr><td>"+row.join("</td><td>")+"</td></tr>";
  }
  html += "</tbody></table>";
  return html;
}

function writeHtmlBundle(workdir, meta, data) {
  const htmlDir = path.join(workdir, "html");
  const cssDir = path.join(htmlDir, "css");
  const jsDir = path.join(htmlDir, "js");
  fs.mkdirSync(cssDir, { recursive: true });
  fs.mkdirSync(jsDir, { recursive: true });

  // Copy JSON sources so bundle works standalone from ZIP (file://)
  for (const name of ["base.json","head.json","diff.json"]) {
    const from = path.join(workdir, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(htmlDir, name));
  }

  // Basic shell
  const INDEX_HTML = [
    "<!DOCTYPE html>",
    '<html lang="en"><head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
    "<title>Security Report — "+esc(meta.repository)+"</title>",
    '<link rel="stylesheet" href="./css/style.css"/>',
    '<link rel="stylesheet" href="./css/dashboard.css"/>',
    "<script>window.__meta__="+JSON.stringify(meta)+";</script>",
    '<script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>',
    '<script defer src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>',
    '<script defer src="./js/app.js"></script>',
    '<script defer src="./js/dashboard.js"></script>',
    "</head><body>",
    '<header class="app-header"><div class="brand">',
    meta.titleLogoUrl ? '<img class="logo" src="'+esc(meta.titleLogoUrl)+'" alt="logo"/>' : "",
    '<div class="titles"><div class="subtitle">Comparison of branches <b>' +
      esc(meta.baseLabel) + "</b> vs <b>" + esc(meta.headLabel) + "</b></div>",
    "<h1>"+esc(meta.repository)+"</h1></div></div>",
    '<div class="meta">Generated: '+esc(meta.generatedAt)+'</div></header>',
    '<div class="app-body">',
    '<aside class="sidebar"><nav>',
    '<a href="#/dashboard" class="nav-link">Dashboard</a>',
    '<a href="#/intro" class="nav-link">Introduction</a>',
    '<a href="#/summary" class="nav-link">Summary</a>',
    '<a href="#/severity" class="nav-link">Severity distribution</a>',
    '<a href="#/changes" class="nav-link">Change overview</a>',
    '<a href="#/diff" class="nav-link">Vulnerability diff</a>',
    "</nav></aside>",
    '<main id="view" class="content"><noscript>Enable JavaScript to view the interactive report.</noscript></main>',
    "</div>",
    '<footer class="app-footer"><span>Security Report — '+esc(meta.repository)+'</span></footer>',
    "</body></html>"
  ].join("\n");

  const STYLE_CSS =
    ":root{--bg:#ffffff;--fg:#1f2937;--muted:#6b7280;--border:#e5e7eb;--brand:#111827;--brand-fg:#F9FAFB;--side:#0f172a;--side-fg:#e5e7eb}" +
    "*{box-sizing:border-box}html,body{margin:0;padding:0}" +
    "body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Ubuntu,Arial;background:var(--bg);color:var(--fg)}" +
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

  // app.js (router + views shell; dashboard.js will render charts/tables)
  const APP_JS = [
    "'use strict';",
    "var view=document.getElementById('view');",
    "var routes={'/dashboard':function(){return window.renderDashboard&&window.renderDashboard();},'/intro':renderIntro,'/summary':renderSummary,'/severity':renderSeverity,'/changes':renderChanges,'/diff':renderDiff};",
    "function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
    "function route(){var hash=location.hash||'#/dashboard';document.querySelectorAll('.nav-link').forEach(function(a){a.classList.toggle('active',a.getAttribute('href')===hash);});var fn=(routes[hash.slice(1)]||renderIntro);Promise.resolve(fn()).catch(function(e){view.innerHTML='<div class=\"panel\">Error: '+esc(e)+'</div>';});}",
    "window.addEventListener('hashchange',route);window.addEventListener('DOMContentLoaded',route);",
    "async function loadJson(name){var r=await fetch('./'+name);return r.json();}",
    "function linkify(txt){return String(txt).replace(/\\b(GHSA-[A-Za-z0-9-]{9,})\\b/g,function(m,id){return '<a href=\"https://github.com/advisories/'+id+'\" target=\"_blank\" rel=\"noopener\">'+id+'</a>';}).replace(/\\b(CVE-\\d{4}-\\d{4,7})\\b/g,function(m,id){return '<a href=\"https://nvd.nist.gov/vuln/detail/'+id+'\" target=\"_blank\" rel=\"noopener\">'+id+'</a>';});}",
    "async function renderIntro(){var m=window.__meta__||{};var base=esc(m.baseLabel||'base');var head=esc(m.headLabel||'head');view.innerHTML='<h2>Introduction</h2><div class=\"panel\">This report compares security vulnerabilities between <b>'+base+'</b> (base) and <b>'+head+'</b> (head). The goal is to detect vulnerabilities that are introduced and/or fixed between development branches.</div><div class=\"panel\"><b>Tools & pipeline</b><ul><li><b>CycloneDX Maven plugin</b> / <b>Syft</b> → SBOM (JSON)</li><li><b>Grype</b> → vulnerabilities from SBOM</li><li><b>Diff</b> → classify NEW/REMOVED/UNCHANGED</li></ul></div>';}",
    "async function renderSummary(){var d=await loadJson('diff.json');var m=window.__meta__||{};view.innerHTML='<h2>Summary</h2><div class=\"panel\"><b>Repository:</b> '+esc(m.repository||'')+'<br/><b>Base:</b> '+esc(m.baseLabel||'')+' — <code>'+esc((m.baseSha||'').slice(0,12))+'</code><br/><b>Head:</b> '+esc(m.headLabel||'')+' — <code>'+esc((m.headSha||'').slice(0,12))+'</code><br/><b>Counts:</b> NEW='+d.news.length+' · REMOVED='+d.removed.length+' · UNCHANGED='+d.unchanged.length+'</div>';}",
    "async function renderSeverity(){var base=await loadJson('base.json');var head=await loadJson('head.json');function count(arr){return (arr||[]).reduce(function(m,x){var s=(x.severity)||'UNKNOWN';m[s]=(m[s]||0)+1;return m;},{});}var baseC=count(base.items||[]);var headC=count(head.items||[]);var sev=['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];var colors=['#b91c1c','#ea580c','#ca8a04','#16a34a','#6b7280'];view.innerHTML='<h2>Severity distribution</h2><div class=\"grid2\"><div class=\"chart-box\"><h3>'+esc((window.__meta__||{}).baseLabel||'BASE')+'</h3><canvas id=\"c1\"></canvas></div><div class=\"chart-box\"><h3>'+esc((window.__meta__||{}).headLabel||'HEAD')+'</h3><canvas id=\"c2\"></canvas></div></div>';new Chart(document.getElementById('c1'),{type:'doughnut',data:{labels:sev,datasets:[{data:sev.map(function(s){return baseC[s]||0;}),backgroundColor:colors}]},options:{plugins:{legend:{position:'bottom'}},cutout:'60%'}});new Chart(document.getElementById('c2'),{type:'doughnut',data:{labels:sev,datasets:[{data:sev.map(function(s){return headC[s]||0;}),backgroundColor:colors}]},options:{plugins:{legend:{position:'bottom'}},cutout:'60%'}});}",
    "async function renderChanges(){var d=await loadJson('diff.json');view.innerHTML='<h2>Change overview</h2><div class=\"chart-box\"><canvas id=\"c3\" style=\"height:260px;width:100%\"></canvas></div>';new Chart(document.getElementById('c3'),{type:'bar',data:{labels:['NEW','REMOVED','UNCHANGED'],datasets:[{data:[d.news.length,d.removed.length,d.unchanged.length]}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});}",
    "async function renderDiff(){var diff=await loadJson('diff.json');var rows = [].concat(diff.news.map(x=>({st:'NEW',...x})), diff.removed.map(x=>({st:'REMOVED',...x})), diff.unchanged.map(x=>({st:'UNCHANGED',...x}))); var html='<table class=\"tbl\"><thead><tr><th>Status</th><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Version</th></tr></thead><tbody>'+rows.map(function(r){return '<tr><td>'+esc(r.st)+'</td><td><b>'+esc(r.severity||'UNKNOWN')+'</b></td><td>'+linkify(esc(r.id||''))+'</td><td><code>'+esc(r.package||'')+'</code></td><td><code>'+esc(r.version||'')+'</code></td></tr>';}).join('')+'</tbody></table>';view.innerHTML='<h2>Vulnerability diff</h2>'+html;}"
  ].join("\n");

  const DASHBOARD_CSS =
    ".filters{display:flex;flex-wrap:wrap;gap:14px;margin:12px 0}.filters .group{display:flex;align-items:center;gap:8px}" +
    ".kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:12px 0}.kpi{border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#fff}" +
    ".kpi .label{font-size:12px;color:#6b7280}.kpi .value{font-size:22px;font-weight:700}.panel{border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;margin:12px 0}" +
    ".grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.chart-wrap{position:relative;width:100%;min-height:260px}.muted{color:#6b7280}";

  const DASHBOARD_JS = [
    "(function(){var view=document.getElementById('view');",
    "function getCtx(id){return document.getElementById(id)?.getContext('2d');}",
    "window.renderDashboard=async function(){",
    "  view.innerHTML='<h2>Dashboard</h2><div class=\"panel\">Start with the sections on the left. A richer dashboard can be added later with filters and stacked charts.</div>';",
    "};",
    "})();"
  ].join("\n");

  fs.writeFileSync(path.join(htmlDir, "index.html"), INDEX_HTML, "utf8");
  fs.writeFileSync(path.join(cssDir, "style.css"), STYLE_CSS, "utf8");
  fs.writeFileSync(path.join(cssDir, "dashboard.css"), DASHBOARD_CSS, "utf8");
  fs.writeFileSync(path.join(jsDir, "app.js"), APP_JS, "utf8");
  fs.writeFileSync(path.join(jsDir, "dashboard.js"), DASHBOARD_JS, "utf8");
}

module.exports = {
  writeHtmlBundle,
  markdownTableToHtml,
};
