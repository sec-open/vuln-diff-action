// src/report-html.js
// v2 PDF layout refinado:
// - Portada separada (sin header/footer), título + repo + ramas + fecha
// - Table of Contents mejorado (ol numerado, más interlineado)
// - Secciones numeradas: 1..9
// - Gráficas con pie de figura: "Figure N — ..."
// - Summary en una columna (Base y Head uno debajo del otro)
// - Diff table espera HTML (no MD)
// - Landscape appendix con mermaid y dependency paths (HTML)
// Nota: los headers/footers se aplican desde index.js al PDF "main" y "appendix", NO a la portada.

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---- Severity helpers ----
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
    .panel{ border:1px solid var(--border); border-radius:8px; padding:12px; background:#fff }
    .md pre{ background:var(--subtle); padding:10px; border-radius:6px; overflow:auto; font-size:12px }

    /* tables */
    table.tbl { width:100%; border-collapse: collapse; font-size: 12px; }
    table.tbl th, table.tbl td { border:1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
    table.tbl thead th { background: var(--subtle); }
    table.tbl code { background:#f1f5f9; padding:2px 6px; border-radius:6px; display:inline-block }

    /* captions */
    .caption { font-size: 11px; color: var(--muted); margin-top: 6px; }

    /* charts */
    .chart-grid2{ display:grid; grid-template-columns: 1fr 1fr; gap:16px; align-items:center }
    .chart-box{ border:1px solid var(--border); border-radius:8px; padding:12px; }
    .chart-box h3{ margin-top:0; margin-bottom:8px }
    canvas{ max-width: 320px; max-height: 320px; }
    /* full width chart for Change overview */
    .chart-wide-box { border:1px solid var(--border); border-radius:8px; padding:12px; }
    #chartChanges { width:100%; height:260px; }

    /* TOC */
    .toc-wrap { max-width: 560px; }
    ol.toc { list-style: decimal; padding-left: 20px; line-height: 1.65; }
    ol.toc li { margin: 2px 0; }
  </style>`;
}

/* -------------------- Portada (sin header/footer) -------------------- */
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

/* -------------------- TOC mejorado -------------------- */
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
function introductionHtml({ baseLabel, headLabel, repo }) {
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
    <p>Tools and methodology:</p>
    <ul>
      <li><b>CycloneDX Maven plugin</b> – Accurate SBOM for Java multi-module builds.</li>
      <li><b>Syft</b> – SBOM fallback for non-Maven directories.</li>
      <li><b>Grype</b> – Vulnerability scanning of the SBOM.</li>
      <li><b>Chart.js</b> – Severity and change overview visualizations.</li>
      <li><b>Mermaid</b> – Dependency graphs on landscape pages.</li>
      <li><b>Puppeteer</b> – PDF export.</li>
    </ul>
  </div>`;
}

/* -------------------- Summary en una columna -------------------- */
function summaryHtml({ baseLabel, baseInput, baseSha, baseCommitLine, headLabel, headInput, headSha, headCommitLine, minSeverity, counts }) {
  const baseShort = (baseSha || "").slice(0,12);
  const headShort = (headSha || "").slice(0,12);
  return `
  <div class="page">
    <h2>2. Summary</h2>

    <h3>Base</h3>
    <div class="panel">
      <div><b>Name:</b> ${esc(baseLabel)} (input: ${esc(baseInput)})</div>
      <div><b>Commit:</b> <span class="mono">${esc(baseShort)}</span></div>
      <div><b>Commit Id:</b> <span class="mono">${esc(baseSha)}</span></div>
      <div><b>Message:</b> <span class="mono">${esc(baseCommitLine.replace(baseSha, "").trim())}</span></div>
    </div>

    <h3 style="margin-top:16px">Head</h3>
    <div class="panel">
      <div><b>Name:</b> ${esc(headLabel)} (input: ${esc(headInput)})</div>
      <div><b>Commit:</b> <span class="mono">${esc(headShort)}</span></div>
      <div><b>Commit Id:</b> <span class="mono">${esc(headSha)}</span></div>
      <div><b>Message:</b> <span class="mono">${esc(headCommitLine.replace(headSha, "").trim())}</span></div>
    </div>

    <div class="panel" style="margin-top:12px">
      <div><b>Minimum severity:</b> ${esc(minSeverity)}</div>
      <div><b>Counts:</b> NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}</div>
    </div>
  </div>`;
}

/* -------------------- Severities (donuts) con figura -------------------- */
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

/* -------------------- Change overview (barra) con figura -------------------- */
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

/* -------------------- Diff table (HTML) -------------------- */
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
  // htmlOrMd ya nos llega en HTML (index.js lo convierte); fallback si viniera MD.
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

/* -------------------- Build main (portrait) HTML -------------------- */
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
  const diffTableHtml   = options.diffTableHtml || "";        // HTML
  const baseMatches     = options.baseMatches || [];
  const headMatches     = options.headMatches || [];
  const nowStr          = options.nowStr || "";
  const titleLogoUrl    = options.title_logo_url || "";

  // Precompute severity counts for client-side Chart.js render
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
  ${coverHtml({ titleLogoUrl, repo, baseLabel, headLabel, nowStr })}
  ${tocHtml()}
  ${introductionHtml({ baseLabel, headLabel, repo })}
  ${summaryHtml({ baseLabel, baseInput, baseSha, baseCommitLine, headLabel, headInput, headSha, headCommitLine, minSeverity, counts })}
  ${severityChartsHtml({ baseLabel, headLabel })}
  ${changesOverviewHtml({ baseLabel, headLabel, counts })}
  ${diffTableSectionHtml(diffTableHtml)}

  <!-- Chart datasets; rendering happens in Puppeteer via page.addScriptTag(...) -->
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

/* -------------------- Build landscape appendix HTML -------------------- */
function buildHtmlLandscape(options) {
  options = options || {};
  const baseLabel     = options.baseLabel || "BASE";
  const headLabel     = options.headLabel || "HEAD";
  const mermaidBase   = options.mermaidBase || "";
  const mermaidHead   = options.mermaidHead || "";
  const pathsBaseHtml = options.pathsBaseMd || ""; // allow HTML
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

module.exports = { buildHtmlMain, buildHtmlLandscape };
