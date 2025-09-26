// src/report-html.js
// v2 — HTML templates for PDF export:
// - buildHtmlCover(): single-page cover without header/footer
// - buildHtmlMain(): portrait pages (TOC, Introduction, Summary, Severity distribution, Change overview, Diff table)
// - buildHtmlLandscape(): landscape appendix (Dependency graphs + Dependency paths)
// Notes: All section titles and figures are numbered; tables are HTML (no raw markdown).

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cssBase() {
  return `
  <style>
    :root {
      --fg:#1f2937;     /* slate-800 */
      --muted:#6b7280;  /* gray-500 */
      --border:#e5e7eb; /* gray-200 */
      --bg:#ffffff;     /* white */
      --subtle:#f9fafb; /* gray-50  */
      --brand-bg:#111827; /* header/footer background (gray-900) */
      --brand-fg:#F9FAFB; /* header/footer text (gray-50) */
    }
    *{ box-sizing:border-box }
    html,body{ margin:0; padding:0 }
    body{
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, Helvetica;
      color:var(--fg); background:var(--bg);
    }
    .page{ padding:24px 20px; page-break-after: always; }
    .page:last-of-type{ page-break-after: auto; }

    h1{ font-size:28px; margin:8px 0 4px }
    h2{ font-size:20px; margin:18px 0 10px }
    h3{ font-size:16px; margin:12px 0 8px }
    p{ line-height:1.55 }
    .muted{ color:var(--muted) }
    .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace }
    .small{ font-size:12px }
    .hr{ height:1px; background:var(--border); margin:12px 0 }
    .panel{ border:1px solid var(--border); border-radius:8px; padding:12px; background:#fff }
    .logo{ width:96px; height:96px; object-fit:contain }

    /* tables */
    table.tbl { width:100%; border-collapse: collapse; font-size: 12px; }
    table.tbl th, table.tbl td { border:1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
    table.tbl thead th { background: var(--subtle); }
    table.tbl code { background:#f1f5f9; padding:2px 6px; border-radius:6px; display:inline-block }
    .caption { font-size: 11px; color: var(--muted); margin-top: 6px; }

    /* charts */
    .chart-grid2{ display:grid; grid-template-columns: 1fr 1fr; gap:16px; align-items:center }
    .chart-box{ border:1px solid var(--border); border-radius:8px; padding:12px; }
    .chart-box h3{ margin-top:0; margin-bottom:8px }
    canvas{ max-width: 320px; max-height: 320px; }
    .chart-wide-box { border:1px solid var(--border); border-radius:8px; padding:12px; }
    #chartChanges { width:100%; height:260px; }

    /* TOC */
    .toc-wrap { max-width: 620px; }
    ol.toc { list-style: decimal; padding-left: 20px; line-height: 1.8; font-size: 14px; }
    ol.toc li { margin: 4px 0; }

    /* helper blocks */
    .md pre{ background:var(--subtle); padding:10px; border-radius:6px; overflow:auto; font-size:12px }

    /* layout helpers to keep space balanced in cover */
    .cover-flex{
      text-align:center; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:90vh;
    }
  </style>`;
}

/* -------------------- Portada (1 página, sin header/footer) -------------------- */
function buildHtmlCover({ titleLogoUrl, repo, baseLabel, headLabel, nowStr }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Security Report — Cover</title>
  ${cssBase()}
</head>
<body>
  <div class="page cover-flex">
    ${titleLogoUrl ? `<img class="logo" src="${esc(titleLogoUrl)}" alt="logo" />` : ""}
    <h1 style="font-size:34px; letter-spacing:0.2px;">Security Report</h1>
    <div class="muted" style="font-size:16px; margin-top:4px;">${esc(repo)}</div>
    <div class="hr" style="width:420px;"></div>
    <div class="mono" style="font-size:14px; margin-top:6px;">
      Comparison of branches <b>${esc(baseLabel)}</b> vs <b>${esc(headLabel)}</b>
    </div>
    <div style="height:28vh"></div>
    <div class="muted small">${esc(nowStr)}</div>
  </div>
</body>
</html>`;
}

/* -------------------- TOC mejorado (numerado) -------------------- */
function tocHtml() {
  return `
  <div class="page">
    <h2>Table of contents</h2>
    <div class="toc-wrap">
      <ol class="toc">
        <li>Introduction</li>
        <li>Summary</li>
        <li>Severity distribution</li>
        <li>Change overview</li>
        <li>Vulnerability diff table</li>
        <li>Dependency graph base</li>
        <li>Dependency graph head</li>
        <li>Dependency path base</li>
        <li>Dependency path head</li>
      </ol>
    </div>
  </div>`;
}


/* -------------------- Introducción extendida -------------------- */
function introductionHtml({ baseLabel, headLabel, repo, toolVersions }) {
  const v = toolVersions || {};
  return `
  <div class="page">
    <h2>1. Introduction</h2>
    <p>
      This security report has been generated for the repository <b>${esc(repo)}</b> to
      provide a clear comparison of vulnerabilities detected between two branches:
      <b>${esc(baseLabel)}</b> (used as the base reference) and <b>${esc(headLabel)}</b> (used as the head branch).
    </p>
    <p>
      The purpose of this analysis is to identify and highlight which security vulnerabilities have been newly introduced,
      which have been fixed, and which remain unchanged between these two stages of development. By doing so, the report
      helps developers and maintainers ensure that the evolution of the project does not unintentionally increase its
      security risks.
    </p>
    <p>Tools and methodology (versions detected during this run):</p>
    <ul>
      <li><b>CycloneDX Maven plugin</b>${v.cyclonedx ? " (v"+esc(v.cyclonedx)+")" : ""} – Accurate SBOM for Java multi-module builds.</li>
      <li><b>Syft</b>${v.syft ? " (v"+esc(v.syft)+")" : ""} – SBOM fallback for non-Maven directories.</li>
      <li><b>Grype</b>${v.grype ? " (v"+esc(v.grype)+")" : ""} – Vulnerability scanning over SBOMs (CVEs, advisories).</li>
      <li><b>Chart.js</b>${v.chartjs ? " (v"+esc(v.chartjs)+")" : ""} – Severity and change overview visualizations.</li>
      <li><b>Mermaid</b>${v.mermaid ? " (v"+esc(v.mermaid)+")" : ""} – Dependency graphs on landscape pages.</li>
      <li><b>Puppeteer</b>${v.puppeteer ? " (v"+esc(v.puppeteer)+")" : ""} – Automated PDF export.</li>
    </ul>
  </div>`;
}

/* -------------------- Summary (una columna: primero Base, luego Head) -------------------- */
function summaryHtml({ baseLabel, baseInput, baseSha, baseCommitLine, headLabel, headInput, headSha, headCommitLine, minSeverity, counts }) {
  const baseShort = (baseSha || "").slice(0,12);
  const headShort = (headSha || "").slice(0,12);
  const baseMsg = (baseCommitLine || "").replace(baseSha || "", "").trim();
  const headMsg = (headCommitLine || "").replace(headSha || "", "").trim();
  return `
  <div class="page">
    <h2>2. Summary</h2>

    <h3>Base</h3>
    <div class="panel">
      <div><b>Name:</b> ${esc(baseLabel)} (input: ${esc(baseInput)})</div>
      <div><b>Commit:</b> <span class="mono">${esc(baseShort)}</span></div>
      <div><b>Commit Id:</b> <span class="mono">${esc(baseSha)}</span></div>
      <div><b>Commit message:</b> <span class="mono">${esc(baseMsg)}</span></div>
    </div>

    <h3 style="margin-top:16px">Head</h3>
    <div class="panel">
      <div><b>Name:</b> ${esc(headLabel)} (input: ${esc(headInput)})</div>
      <div><b>Commit:</b> <span class="mono">${esc(headShort)}</span></div>
      <div><b>Commit Id:</b> <span class="mono">${esc(headSha)}</span></div>
      <div><b>Commit message:</b> <span class="mono">${esc(headMsg)}</span></div>
    </div>

    <div class="panel" style="margin-top:12px">
      <div><b>Minimum severity:</b> ${esc(minSeverity)}</div>
      <div><b>Counts:</b> NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}</div>
    </div>
  </div>`;
}

/* -------------------- Severities (dos donuts) -------------------- */
function severityChartsHtml({ baseLabel, headLabel }) {
  return `
  <div class="page">
    <h2>3. Severity distribution</h2>
    <div class="chart-grid2">
      <div class="chart-box">
        <h3>${esc(baseLabel)}</h3>
        <canvas id="chartBase"></canvas>
      </div>
      <div class="chart-box">
        <h3>${esc(headLabel)}</h3>
        <canvas id="chartHead"></canvas>
      </div>
    </div>
    <div class="caption">Figure 1 — Vulnerabilities per severity in each branch.</div>
  </div>`;
}

/* -------------------- Change overview (barra + texto introductorio) -------------------- */
function changesOverviewHtml({ baseLabel, headLabel, counts }) {
  const n1 = counts?.new ?? 0;
  const n2 = counts?.removed ?? 0;
  const n3 = counts?.unchanged ?? 0;
  return `
  <div class="page">
    <h2>4. Change overview</h2>
    <p>
      During the development on <b>${esc(headLabel)}</b>, <b>${n1}</b> new vulnerabilities were introduced,
      <b>${n2}</b> vulnerabilities were fixed, and <b>${n3}</b> remained unchanged compared to <b>${esc(baseLabel)}</b>.
    </p>
    <div class="chart-wide-box">
      <canvas id="chartChanges"></canvas>
    </div>
    <div class="caption">Figure 2 — NEW vs REMOVED vs UNCHANGED.</div>
  </div>`;
}

/* -------------------- Diff table (HTML ya interpretada) -------------------- */
function diffTableSectionHtml(diffTableHtml) {
  return `
  <div class="page">
    <h2>5. Vulnerability diff table</h2>
    ${diffTableHtml || "<div class='muted'>No data</div>"}
  </div>`;
}

/* -------------------- Landscape appendix -------------------- */
function mermaidSection(title, code, figureNumber) {
  return `
  <div class="page">
    <h2>${esc(title)}</h2>
    <div class="mono" data-mermaid="${esc(code || "")}"></div>
    <div id="mermaid-target"></div>
    ${figureNumber ? `<div class="caption">Figure ${figureNumber} — ${esc(title)}.</div>` : ""}
  </div>`;
}

function dependencyPathsSection(title, htmlOrMd, figureNumber) {
  const body = htmlOrMd && /<table|<div|<ul|<ol|<pre/i.test(htmlOrMd)
    ? htmlOrMd
    : `<div class="md"><pre>${esc(htmlOrMd||"(no data)")}</pre></div>`;
  return `
  <div class="page">
    <h2>${esc(title)}</h2>
    ${body}
    ${figureNumber ? `<div class="caption">Figure ${figureNumber} — ${esc(title)}.</div>` : ""}
  </div>`;
}

/* -------------------- Build main (portrait) -------------------- */
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
  const diffTableHtml   = options.diffTableHtml || "";
  const baseMatches     = options.baseMatches || [];
  const headMatches     = options.headMatches || [];
  const nowStr          = options.nowStr || "";
  const titleLogoUrl    = options.title_logo_url || "";
  const toolVersions    = options.toolVersions || {};

  // chart data
  const baseCounts = countSeverities(baseMatches);
  const headCounts = countSeverities(headMatches);
  const sevLabels  = JSON.stringify(SEVERITY_ORDER);
  const baseData   = JSON.stringify(SEVERITY_ORDER.map(s => baseCounts[s] || 0));
  const headData   = JSON.stringify(SEVERITY_ORDER.map(s => headCounts[s] || 0));
  const changes    = JSON.stringify([counts.new || 0, counts.removed || 0, counts.unchanged || 0]);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Security Report</title>
  ${cssBase()}
</head>
<body>
  <!-- Cover is not here; it is built with buildHtmlCover() -->
  ${tocHtml()}
  ${introductionHtml({ baseLabel, headLabel, repo, toolVersions })}
  ${summaryHtml({ baseLabel, baseInput, baseSha, baseCommitLine, headLabel, headInput, headSha, headCommitLine, minSeverity, counts })}
  ${severityChartsHtml({ baseLabel, headLabel })}
  ${changesOverviewHtml({ baseLabel, headLabel, counts })}
  ${diffTableSectionHtml(diffTableHtml)}

  <script>
    window.__vulnChartData = {
      labels: ${sevLabels},
      base: ${baseData},
      head: ${headData},
      changes: ${changes}
    };
  </script>
</body>
</html>`;
}

/* -------------------- Build landscape appendix -------------------- */
function buildHtmlLandscape(options) {
  options = options || {};
  const baseLabel     = options.baseLabel || "BASE";
  const headLabel     = options.headLabel || "HEAD";
  const mermaidBase   = options.mermaidBase || "";
  const mermaidHead   = options.mermaidHead || "";
  const pathsBaseHtml = options.pathsBaseMd || "";
  const pathsHeadHtml = options.pathsHeadMd || "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Appendix</title>
  ${cssBase()}
</head>
<body>
  ${mermaidSection('6. Dependency graph base — ' + baseLabel, mermaidBase, 3)}
  ${mermaidSection('7. Dependency graph head — ' + headLabel, mermaidHead, 4)}
  ${dependencyPathsSection("8. Dependency path base", pathsBaseHtml, 5)}
  ${dependencyPathsSection("9. Dependency path head", pathsHeadHtml, 6)}
</body>
</html>`;
}

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

module.exports = {
  buildHtmlCover,
  buildHtmlMain,
  buildHtmlLandscape
};
