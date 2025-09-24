// src/report-html.js (v1-style layout with v2 cover/TOC/summary enhancements)

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---- Severity helpers (robust) ----
function toSeverity(value) {
  const s = String(value || "UNKNOWN").toUpperCase();
  return SEVERITY_ORDER.includes(s) ? s : "UNKNOWN";
}
function countSeverities(matches) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const m of (matches || [])) {
    const sev = (m && m.vulnerability && m.vulnerability.severity) || (m && m.severity) || "UNKNOWN";
    counts[toSeverity(sev)] += 1;
  }
  return counts;
}

function cssBase() {
  return `
  <style>
    :root { --fg:#24292f; --muted:#57606a; --border:#d0d7de; --bg:#fff; --subtle:#f6f8fa; }
    *{ box-sizing:border-box }
    body{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, Helvetica;
          color:var(--fg); background:var(--bg); margin:0 }
    .page{ padding:24px 20px; page-break-after: always; }
    .page:last-of-type{ page-break-after: auto; }
    h1{ font-size:28px; margin:8px 0 4px }
    h2{ font-size:20px; margin:18px 0 10px }
    h3{ font-size:16px; margin:12px 0 8px }
    .muted{ color:var(--muted) }
    .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace }
    .hr{ height:1px; background:var(--border); margin:12px 0 }
    .small{ font-size:12px }
    .logo{ width:96px; height:96px; object-fit:contain }
    .two-col{ display:grid; grid-template-columns: 1fr 1fr; gap: 12px }
    .panel{ border:1px solid var(--border); border-radius:8px; padding:12px; background:#fff }
    .md pre{ background:var(--subtle); padding:10px; border-radius:6px; overflow:auto; font-size:12px }
    /* charts */
    .chart-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:16px; align-items:center }
    .chart-box{ border:1px solid var(--border); border-radius:8px; padding:12px; }
    .chart-box h3{ margin-top:0; margin-bottom:8px }
    canvas{ max-width: 320px; max-height: 320px; }
    /* landscape appendix still uses normal pages; Puppeteeer will render landscape for that HTML */
  </style>`;
}

function coverHtml({ titleLogoUrl, repo, baseLabel, headLabel, nowStr }) {
  return `
  <div class="page" style="text-align:center">
    ${titleLogoUrl ? `<img class="logo" src="${esc(titleLogoUrl)}" alt="logo" />` : ""}
    <h1>Security Report</h1>
    <div class="muted">${esc(repo)}</div>
    <div class="hr"></div>
    <div class="mono">Comparison of branches ${esc(baseLabel)} vs ${esc(headLabel)}</div>
    <div style="height:30vh"></div>
    <div class="muted small">${esc(nowStr)}</div>
  </div>`;
}

function tocHtml() {
  return `
  <div class="page">
    <h2>Table of contents</h2>
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
  </div>`;
}

function introductionHtml() {
  return `
  <div class="page">
    <h2>Introduction</h2>
    <p>This report compares security vulnerabilities between two Git references (base and head).
       The goal is to detect vulnerabilities that are introduced and/or fixed between development branches.</p>
    <p>Tools used:</p>
    <ul>
      <li><b>CycloneDX Maven plugin</b> – Accurate SBOM for Java multi-module builds.</li>
      <li><b>Syft</b> – SBOM fallback for non-Maven directories.</li>
      <li><b>Grype</b> – Vulnerability scanning of the SBOM.</li>
      <li><b>Chart.js</b> – Severity distribution charts.</li>
      <li><b>Mermaid</b> – Dependency graphs (landscape pages).</li>
      <li><b>Puppeteer</b> – PDF export.</li>
    </ul>
  </div>`;
}

function summaryHtml({ baseLabel, baseInput, baseSha, baseCommitLine, headLabel, headInput, headSha, headCommitLine, minSeverity, counts }) {
  return `
  <div class="page">
    <h2>Summary</h2>
    <div class="two-col">
      <div>
        <h3>Base</h3>
        <div><b>Name:</b> ${esc(baseLabel)} (input: ${esc(baseInput)})</div>
        <div><b>Commit:</b> <span class="mono">${esc((baseSha||"").slice(0,12))}</span></div>
        <div><b>Message:</b> <span class="mono">${esc(baseCommitLine)}</span></div>
      </div>
      <div>
        <h3>Head</h3>
        <div><b>Name:</b> ${esc(headLabel)} (input: ${esc(headInput)})</div>
        <div><b>Commit:</b> <span class="mono">${esc((headSha||"").slice(0,12))}</span></div>
        <div><b>Message:</b> <span class="mono">${esc(headCommitLine)}</span></div>
      </div>
    </div>
    <div class="panel" style="margin-top:12px">
      <div><b>Minimum severity:</b> ${esc(minSeverity)}</div>
      <div><b>Counts:</b> NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}</div>
    </div>
  </div>`;
}

// ---- Severity section with Chart.js (two donuts) ----
function severityChartsHtml({ baseLabel, headLabel }) {
  return `
  <div class="page">
    <h2>Severity distribution</h2>
    <div class="chart-grid">
      <div class="chart-box">
        <h3>${esc(baseLabel)}</h3>
        <canvas id="chartBase"></canvas>
      </div>
      <div class="chart-box">
        <h3>${esc(headLabel)}</h3>
        <canvas id="chartHead"></canvas>
      </div>
    </div>
  </div>`;
}

function diffTableSection(diffTableMarkdown) {
  return `
  <div class="page">
    <h2>Vulnerability diff table</h2>
    <div class="md"><pre>${esc(diffTableMarkdown || "(no data)")}</pre></div>
  </div>`;
}

// Landscape pages (title + graph/text in same page)
function mermaidSection(title, code) {
  return `
  <div class="page">
    <h2>${esc(title)}</h2>
    <div class="mono" data-mermaid="${esc(code || "")}"></div>
    <div id="mermaid-target"></div>
  </div>`;
}
function dependencyPathsSection(title, md) {
  return `
  <div class="page">
    <h2>${esc(title)}</h2>
    <div class="md"><pre>${esc(md || "(no data)")}</pre></div>
  </div>`;
}

// -------------------- Build main (portrait) HTML --------------------
function buildHtmlMain(options) {
  options = options || {};
  const repo            = options.repository || "";
  const baseLabel       = options.baseLabel || "BASE";
  const baseInput       = options.baseInput || "";
  const baseSha         = options.baseSha || "";
  const baseCommitLine  = options.baseCommitLine || "";
  const headLabel       = options.headLabel || "HEAD";
  const headInput       = options.headInput || "";
  const headSha         = options.headSha || "";
  const headCommitLine  = options.headCommitLine || "";
  const minSeverity     = options.minSeverity || "LOW";
  const counts          = options.counts || { new:0, removed:0, unchanged:0 };
  const diffTableMd     = options.diffTableMarkdown || "";
  const baseMatches     = options.baseMatches || [];
  const headMatches     = options.headMatches || [];
  const nowStr          = options.nowStr || "";
  const titleLogoUrl    = options.title_logo_url || "";

  // Prepare severity counts for client-side Chart.js render
  const baseCounts = countSeverities(baseMatches);
  const headCounts = countSeverities(headMatches);
  const sevLabels = JSON.stringify(SEVERITY_ORDER);
  const baseData  = JSON.stringify(SEVERITY_ORDER.map(s => baseCounts[s] || 0));
  const headData  = JSON.stringify(SEVERITY_ORDER.map(s => headCounts[s] || 0));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Security Report</title>
  ${cssBase()}
</head>
<body>
  ${coverHtml({ titleLogoUrl, repo, baseLabel, headLabel, nowStr })}
  ${tocHtml()}
  ${introductionHtml()}
  ${summaryHtml({ baseLabel, baseInput, baseSha, baseCommitLine, headLabel, headInput, headSha, headCommitLine, minSeverity, counts })}
  ${severityChartsHtml({ baseLabel, headLabel })}
  ${diffTableSection(diffTableMd)}

  <!-- Chart.js + bootstrap script to render donuts, will be executed in Puppeteer -->
  <script>
    window.__vulnChartData = {
      labels: ${sevLabels},
      base: ${baseData},
      head: ${headData}
    };
  </script>
</body>
</html>`;
}

// -------------------- Build landscape appendix HTML --------------------
function buildHtmlLandscape(options) {
  options = options || {};
  const baseLabel   = options.baseLabel || "BASE";
  const headLabel   = options.headLabel || "HEAD";
  const mermaidBase = options.mermaidBase || "";
  const mermaidHead = options.mermaidHead || "";
  const pathsBaseMd = options.pathsBaseMd || "";
  const pathsHeadMd = options.pathsHeadMd || "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Appendix</title>
  ${cssBase()}
</head>
<body>
  ${mermaidSection(\`Dependency graph base — \${baseLabel}\`, mermaidBase)}
  ${mermaidSection(\`Dependency graph head — \${headLabel}\`, mermaidHead)}
  ${dependencyPathsSection("Dependency path base", pathsBaseMd)}
  ${dependencyPathsSection("Dependency path head", pathsHeadMd)}
</body>
</html>`;
}

module.exports = { buildHtmlMain, buildHtmlLandscape };
