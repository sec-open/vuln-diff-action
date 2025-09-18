// src/report-html.js
// Build a standalone HTML report with charts (Chart.js) and diagrams (Mermaid).
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

function buildHtmlReport({
  baseLabel, baseInput, baseSha, baseCommitLine,
  headLabel, headInput, headSha, headCommitLine,
  minSeverity, counts, diffTableMarkdown,
  headGrype, headBOM, mermaidGraph, pathsTableMarkdown
}) {
  const sevCounts = sevCountsFromMatches(headGrype?.matches || []);
  const mermaidBlock = mermaidGraph
    ? `<pre class="mermaid">${mermaidGraph}</pre>`
    : `<div class="muted">No dependency graph available</div>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Vulnerability Diff Report</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, "Apple Color Emoji", "Segoe UI Emoji"; margin: 24px; line-height: 1.45; }
    h1,h2,h3 { margin: 0.6em 0 0.3em; }
    .muted { opacity: .7; }
    .meta { margin: 8px 0 16px; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 0.95em; }
    .card { border: 1px solid #ccc3; border-radius: 10px; padding: 16px; margin: 16px 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
    th { background: #f6f6f6; }
    .flex { display: flex; gap: 16px; flex-wrap: wrap; }
    .col { flex: 1 1 320px; }
    .small { font-size: 0.92em; }
    .kbd { border: 1px solid #ccc; border-radius: 4px; padding: 2px 6px; background: #f7f7f7; }
    .sev-badge { display:inline-block; padding:2px 8px; border-radius:8px; margin-right:6px; }
    .sev-CRITICAL { background:#ffebee; color:#b71c1c; border:1px solid #ffcdd2; }
    .sev-HIGH     { background:#fff3e0; color:#e65100; border:1px solid #ffe0b2; }
    .sev-MEDIUM   { background:#fff8e1; color:#f57f17; border:1px solid #ffecb3; }
    .sev-LOW      { background:#e8f5e9; color:#1b5e20; border:1px solid #c8e6c9; }
    .sev-UNKNOWN  { background:#eceff1; color:#37474f; border:1px solid #cfd8dc; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>
    mermaid.initialize({ startOnLoad: true, securityLevel: "loose", theme: "default" });
  </script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
</head>
<body>
  <h1>Vulnerability Diff (Syft + Grype)</h1>
  <div class="meta small">
    <div><b>Base</b> <code>${escapeHtml(baseLabel)}</code> (input: <code>${escapeHtml(baseInput)}</code>) → <code>${shortSha(baseSha)}</code></div>
    <div class="muted">${escapeHtml(baseCommitLine)}</div>
    <div><b>Head</b> <code>${escapeHtml(headLabel)}</code> (input: <code>${escapeHtml(headInput)}</code>) → <code>${shortSha(headSha)}</code></div>
    <div class="muted">${escapeHtml(headCommitLine)}</div>
    <div><b>Min severity</b>: <span class="kbd">${escapeHtml(minSeverity)}</span></div>
    <div><b>Counts</b>: NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}</div>
  </div>

  <div class="flex">
    <div class="card col">
      <h3>Severity distribution (HEAD)</h3>
      <canvas id="severityPie" width="380" height="260"></canvas>
    </div>
    <div class="card col">
      <h3>Dependency graph (HEAD)</h3>
      ${mermaidBlock}
    </div>
  </div>

  <div class="card">
    <h3>Diff table</h3>
    <div id="diff-md"></div>
  </div>

  <div class="card">
    <h3>Dependency paths (root → … → vulnerable)</h3>
    <div id="paths-md"></div>
  </div>

  <script>
    // Render Markdown sections
    const diffMd = ${JSON.stringify(diffTableMarkdown || "")};
    const pathsMd = ${JSON.stringify(pathsTableMarkdown || "")};
    document.getElementById("diff-md").innerHTML = marked.parse(diffMd);
    document.getElementById("paths-md").innerHTML = marked.parse(pathsMd);

    // Charts
    const sevData = ${JSON.stringify(sevCounts)};
    const ctx = document.getElementById("severityPie");
    new Chart(ctx, {
      type: "pie",
      data: {
        labels: Object.keys(sevData),
        datasets: [{ data: Object.values(sevData) }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" } }
      }
    });
  </script>
</body>
</html>`;
}

module.exports = { buildHtmlReport };
