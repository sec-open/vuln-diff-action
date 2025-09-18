// src/report-html.js
// Two HTML templates:
//  - Main (portrait): Cover, TOC, Introduction, Summary, Severity distribution, Diff table.
//  - Landscape: Dependency graph (base/head) and Dependency paths (base/head) on separate pages.
// Each section starts on a new page (page-break). Footer date on cover.
// Comments in English.

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortSha(sha) { return (sha || "").substring(0, 12); }

function sevCountsFromMatches(matches = []) {
  const init = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  return matches.reduce((acc, m) => {
    const sev = (m?.vulnerability?.severity || "UNKNOWN").toUpperCase();
    acc[sev] = (acc[sev] || 0) + 1;
    return acc;
  }, init);
}

function buildHtmlMain({
  repository, // NEW: "owner/repo"
  baseLabel, baseInput, baseSha, baseCommitLine,
  headLabel, headInput, headSha, headCommitLine,
  minSeverity, counts, diffTableMarkdown,
  baseMatches, headMatches,
  nowStr // footer date dd/mm/yyyy HH:MM:ss
}) {
  const sevBase = sevCountsFromMatches(baseMatches || []);
  const sevHead = sevCountsFromMatches(headMatches || []);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Security Report — ${escapeHtml(repository)} — ${escapeHtml(baseLabel)} vs ${escapeHtml(headLabel)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; margin: 24px; line-height: 1.45; }
  h1,h2,h3 { margin: .6em 0 .3em; }
  .muted { opacity:.7; }
  .center { text-align: center; }
  .cover { margin-top: 18vh; }
  .subtitle { font-size: 1.15rem; margin-top:.3rem; }
  .repo { font-size: 1.2rem; margin-top:.2rem; }
  .footer { position: fixed; bottom: 24px; left: 24px; right: 24px; text-align: center; font-size: .9rem; opacity:.65; }
  .toc ul { margin: .4rem 0 .8rem 1.1rem; }
  .card { border: 1px solid #ccc3; border-radius: 10px; padding: 16px; margin: 16px 0; }
  .flex { display: flex; gap: 16px; flex-wrap: wrap; align-items: stretch; }
  .col { flex: 1 1 320px; }
  .small { font-size: .95em; }
  .page-break { page-break-before: always; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
  th { background: #f6f6f6; }
</style>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
</head>
<body>

<!-- Cover -->
<section class="cover center">
  <h1>Security Report</h1>
  <div class="repo">${escapeHtml(repository)}</div>
  <div class="subtitle">Comparison of branches <b>${escapeHtml(baseLabel)}</b> vs <b>${escapeHtml(headLabel)}</b></div>
  <div class="footer">${escapeHtml(nowStr)}</div>
</section>

<!-- TOC -->
<section class="toc page-break">
  <h2>Table of Contents</h2>
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
</section>

<!-- Introduction -->
<section class="intro page-break">
  <h2>Introduction</h2>
  <p>The goal of this report is to detect vulnerabilities that are introduced or fixed between two development branches.</p>
  <p>This report compares security vulnerabilities between two Git references (base and head) using:</p>
  <ul>
    <li><b>Syft</b>: Generates a Software Bill of Materials (SBOM) in CycloneDX JSON format (or via Maven CycloneDX plugin for accurate Java dependencies).</li>
    <li><b>Grype</b>: Scans SBOMs to identify known vulnerabilities from multiple advisory sources.</li>
    <li><b>GitHub Actions</b>: Orchestrates the workflow and provides summary, artifacts, and automation.</li>
    <li><b>Puppeteer</b>: Exports this HTML report to PDF (optional).</li>
    <li><b>Chart.js</b>: Renders charts for severity distributions.</li>
    <li><b>Mermaid</b> (in landscape sections): Draws dependency graphs with vulnerable nodes highlighted.</li>
  </ul>
</section>

<!-- Summary -->
<section class="summary page-break">
  <h2>Summary</h2>
  <div class="card">
    <h3>Base branch</h3>
    <ul>
      <li><b>Name</b>: <code>${escapeHtml(baseLabel)}</code> (input: <code>${escapeHtml(baseInput)}</code>)</li>
      <li><b>Commit</b>: <code>${shortSha(baseSha)}</code></li>
      <li><b>Message</b>: <span class="small">${escapeHtml(baseCommitLine)}</span></li>
    </ul>
  </div>
  <div class="card">
    <h3>Head branch</h3>
    <ul>
      <li><b>Name</b>: <code>${escapeHtml(headLabel)}</code> (input: <code>${escapeHtml(headInput)}</code>)</li>
      <li><b>Commit</b>: <code>${shortSha(headSha)}</code></li>
      <li><b>Message</b>: <span class="small">${escapeHtml(headCommitLine)}</span></li>
    </ul>
  </div>
  <div class="card">
    <h3>Scan parameters</h3>
    <ul>
      <li><b>Minimum severity</b>: <code>${escapeHtml(minSeverity)}</code></li>
      <li><b>Counts</b>: NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}</li>
    </ul>
  </div>
</section>

<!-- Severity distribution -->
<section class="card page-break">
  <h2>Severity distribution</h2>
  <div class="flex">
    <div class="col">
      <h3>BASE: ${escapeHtml(baseLabel)}</h3>
      <canvas id="pieBase" width="360" height="240"></canvas>
    </div>
    <div class="col">
      <h3>HEAD: ${escapeHtml(headLabel)}</h3>
      <canvas id="pieHead" width="360" height="240"></canvas>
    </div>
  </div>
</section>

<!-- Diff table -->
<section class="card page-break">
  <h2>Vulnerability diff table</h2>
  <div id="diff-md"></div>
</section>

<script>
  // Render diff table
  const diffMd = ${JSON.stringify(diffTableMarkdown || "")};
  document.getElementById("diff-md").innerHTML = marked.parse(diffMd);

  // Severity pies
  const sevBase = ${JSON.stringify(sevBase)};
  const sevHead = ${JSON.stringify(sevHead)};
  function makePie(el, data) {
    return new Chart(el.getContext('2d'), {
      type: "pie",
      data: { labels: Object.keys(data), datasets: [{ data: Object.values(data) }] },
      options: { responsive: false, plugins: { legend: { position: "bottom" } } }
    });
  }
  makePie(document.getElementById("pieBase"), sevBase);
  makePie(document.getElementById("pieHead"), sevHead);
</script>

</body>
</html>`;
}

function buildHtmlLandscape({
  baseLabel, headLabel,
  mermaidBase, mermaidHead,
  pathsBaseMd, pathsHeadMd
}) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Security Report — Landscape sections</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; margin: 24px; line-height: 1.4; }
  h1,h2,h3 { margin: .5em 0 .3em; }
  .card { border: 1px solid #ccc3; border-radius: 10px; padding: 16px; margin: 16px 0; }
  .page-break { page-break-before: always; }
  .mermaid { width: 100%; font-size: 16px; }
  .mermaid svg { width: 100% !important; height: auto !important; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; vertical-align: top; }
  th { background: #f6f6f6; }
</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({
    startOnLoad: true,
    securityLevel: "loose",
    theme: "default",
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis" },
    themeVariables: { fontSize: "16px" }
  });
</script>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>

<section class="card page-break">
  <h2>Dependency graph — BASE: ${escapeHtml(baseLabel)}</h2>
  <pre class="mermaid">${mermaidBase ? mermaidBase : "graph LR\nA[No data]"}</pre>
</section>

<section class="card page-break">
  <h2>Dependency graph — HEAD: ${escapeHtml(headLabel)}</h2>
  <pre class="mermaid">${mermaidHead ? mermaidHead : "graph LR\nA[No data]"}</pre>
</section>

<section class="card page-break">
  <h2>Dependency path — BASE</h2>
  <div id="paths-base"></div>
</section>

<section class="card page-break">
  <h2>Dependency path — HEAD</h2>
  <div id="paths-head"></div>
</section>

<script>
  const pathsBaseMd = ${JSON.stringify(pathsBaseMd || "")};
  const pathsHeadMd = ${JSON.stringify(pathsHeadMd || "")};
  document.getElementById("paths-base").innerHTML = marked.parse(pathsBaseMd || "_No paths_");
  document.getElementById("paths-head").innerHTML = marked.parse(pathsHeadMd || "_No paths_");
</script>

</body>
</html>`;
}

module.exports = { buildHtmlMain, buildHtmlLandscape };
