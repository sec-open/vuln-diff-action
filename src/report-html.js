// src/report-html.js
// Builds the HTML used for the portrait (main) report and the landscape appendix.
// Robust against missing/odd data. No external network needed beyond images you pass by URL.

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// -------------------- Severity helpers (robust) --------------------
function toSeverity(value) {
  const s = String(value || "UNKNOWN").toUpperCase();
  return SEVERITY_ORDER.includes(s) ? s : "UNKNOWN";
}

function countSeverities(matches) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const m of (matches || [])) {
    const sev =
      (m && m.vulnerability && m.vulnerability.severity) ||
      (m && m.severity) ||
      "UNKNOWN";
    counts[toSeverity(sev)] += 1;
  }
  return counts;
}

function renderCountsTable(title, counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return `
  <div class="severity-box">
    <h3>${esc(title)}</h3>
    <table class="sev-table">
      <thead><tr><th>Severity</th><th>Count</th><th>%</th></tr></thead>
      <tbody>
        ${SEVERITY_ORDER.map(s => {
          const n = counts[s] || 0;
          const pct = total ? ((n * 100) / total).toFixed(1) : "0.0";
          return `<tr><td>${s}</td><td>${n}</td><td>${pct}%</td></tr>`;
        }).join("")}
      </tbody>
      <tfoot><tr><td>Total</td><td>${total}</td><td>100%</td></tr></tfoot>
    </table>
  </div>`;
}

function severitySectionHtml({ baseMatches = [], headMatches = [], baseLabel = "BASE", headLabel = "HEAD" } = {}) {
  const baseCounts = countSeverities(baseMatches);
  const headCounts = countSeverities(headMatches);
  return `
  <section class="section">
    <h2>Severity distribution</h2>
    <div class="severity-grid">
      ${renderCountsTable(`${baseLabel}`, baseCounts)}
      ${renderCountsTable(`${headLabel}`, headCounts)}
    </div>
  </section>`;
}

// -------------------- Small helpers --------------------
function sectionTitle(title) {
  return `<section class="section"><h2>${esc(title)}</h2>`;
}
function sectionEnd() { return `</section>`; }

function twoCol(labelLeft, valueLeft, labelRight, valueRight) {
  return `
  <div class="two-col">
    <div><div class="muted">${esc(labelLeft)}</div><div>${esc(valueLeft)}</div></div>
    <div><div class="muted">${esc(labelRight)}</div><div>${esc(valueRight)}</div></div>
  </div>`;
}

function keyValue(label, valueHtml) {
  return `<div class="kv"><span class="k">${esc(label)}:</span> <span class="v">${valueHtml}</span></div>`;
}

function cssBase() {
  return `
  <style>
    :root { --fg: #24292f; --muted: #57606a; --border: #d0d7de; --bg: #ffffff; --subtle: #f6f8fa; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, Helvetica, "Apple Color Emoji", "Segoe UI Emoji"; color: var(--fg); background: var(--bg); margin: 0; }
    .page { padding: 24px 20px; }
    h1 { font-size: 28px; margin: 8px 0 4px; }
    h2 { font-size: 20px; margin: 18px 0 10px; }
    h3 { font-size: 16px; margin: 12px 0 8px; }
    .muted { color: var(--muted); }
    .section { margin: 18px 0; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .kv { margin: 4px 0; }
    .kv .k { color: var(--muted); margin-right: 6px; }
    .panel { border: 1px solid var(--border); border-radius: 8px; padding: 12px; background: #fff; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .severity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .severity-box { border: 1px solid var(--border); border-radius: 8px; padding: 12px; background: #fff; }
    .sev-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .sev-table th, .sev-table td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
    .sev-table thead th { background: var(--subtle); }
    .sev-table tfoot td { font-weight: 600; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
    .toc ul { margin: 0 0 0 18px; padding: 0; }
    .toc li { margin: 4px 0; }
    .hr { height: 1px; background: var(--border); margin: 12px 0; }
    .md { font-size: 13px; }
    pre { background: var(--subtle); padding: 10px; border-radius: 6px; overflow: auto; }
    .center { text-align: center; }
    .small { font-size: 12px; }
    .logo { width: 96px; height: 96px; object-fit: contain; }
  </style>`;
}

function coverHtml({ titleLogoUrl, repo, baseLabel, headLabel, nowStr }) {
  return `
  <div class="page center">
    ${titleLogoUrl ? `<img class="logo" src="${esc(titleLogoUrl)}" alt="logo" />` : ""}
    <h1>Security Report</h1>
    <div class="muted">${esc(repo)}</div>
    <div class="hr"></div>
    <div class="mono">Comparison of branches ${esc(baseLabel)} vs ${esc(headLabel)}</div>
    <div style="height: 30vh;"></div>
    <div class="muted small">${esc(nowStr)}</div>
  </div>`;
}

function tocHtml() {
  return `
  <div class="page">
    <h2>Table of contents</h2>
    <div class="toc">
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
    </div>
  </div>`;
}

function introductionHtml() {
  return `
  <div class="page">
    <h2>Introduction</h2>
    <p>
      This report compares the software vulnerabilities found between two code references (branches or commits).
      Its goal is to highlight newly introduced vulnerabilities and those removed by changes.
    </p>
    <p>
      Tools used:
      <ul>
        <li><b>CycloneDX Maven plugin</b> – Generates a precise SBOM (Software Bill of Materials) for Java multi-module builds.</li>
        <li><b>Syft</b> – Generates SBOMs for non-Maven or general directories (fallback when no <code>pom.xml</code>).</li>
        <li><b>Grype</b> – Scans the SBOM and produces a list of vulnerabilities with severity.</li>
        <li><b>Puppeteer</b> – Renders this report to PDF.</li>
      </ul>
    </p>
  </div>`;
}

function summaryHtml({ baseLabel, baseInput, baseSha, baseCommitLine, headLabel, headInput, headSha, headCommitLine, minSeverity, counts }) {
  return `
  <div class="page">
    <h2>Summary</h2>
    ${twoCol("Base", `${esc(baseLabel)} (input: ${esc(baseInput)}) → <span class="mono">${esc(baseSha.slice(0,12))}</span>`,
             "Head", `${esc(headLabel)} (input: ${esc(headInput)}) → <span class="mono">${esc(headSha.slice(0,12))}</span>`)}
    <div class="panel" style="margin-top:12px;">
      ${keyValue("Base commit", `<span class="mono">${esc(baseCommitLine)}</span>`)}
      ${keyValue("Head commit", `<span class="mono">${esc(headCommitLine)}</span>`)}
      ${keyValue("Minimum severity", `<b>${esc(minSeverity)}</b>`)}
      ${keyValue("Counts", `NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}`)}
    </div>
  </div>`;
}

function diffTableSection(diffTableMarkdown) {
  // Render Markdown as <pre> for simplicity here; your pipeline already provides a formatted table.
  return `
  <div class="page">
    <h2>Vulnerability diff table</h2>
    <div class="md"><pre>${esc(diffTableMarkdown)}</pre></div>
  </div>`;
}

function mermaidSection(title, mermaidCode) {
  // We inline the mermaid code for reference (PDF won’t execute JS). If later you want image rendering, we can prerender SVG.
  return `
  <div class="page">
    <h2>${esc(title)}</h2>
    <pre class="mono">${esc(mermaidCode || "// (graph omitted or too large)")}</pre>
  </div>`;
}

function dependencyPathsSection(title, pathsMarkdown) {
  return `
  <div class="page">
    <h2>${esc(title)}</h2>
    <div class="md"><pre>${esc(pathsMarkdown || "(no data)")}</pre></div>
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
  const counts          = options.counts || { new: 0, removed: 0, unchanged: 0 };
  const diffTableMd     = options.diffTableMarkdown || "";
  const baseMatches     = options.baseMatches || [];
  const headMatches     = options.headMatches || [];
  const nowStr          = options.nowStr || "";
  const titleLogoUrl    = options.title_logo_url || "";
  const disableSeverity = !!options.disableSeveritySection;

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Security Report</title>${cssBase()}</head><body>`;

  // Cover
  html += coverHtml({ titleLogoUrl, repo, baseLabel, headLabel, nowStr });

  // TOC
  html += tocHtml();

  // Introduction
  html += introductionHtml();

  // Summary
  html += summaryHtml({ baseLabel, baseInput, baseSha, baseCommitLine, headLabel, headInput, headSha, headCommitLine, minSeverity, counts });

  // Severity distribution
  if (!disableSeverity) {
    html += `<div class="page">` +
              severitySectionHtml({ baseMatches, headMatches, baseLabel, headLabel }) +
            `</div>`;
  }

  // Diff table
  html += diffTableSection(diffTableMd);

  html += `</body></html>`;
  return html;
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

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Appendix</title>${cssBase()}</head><body>`;

  // Dependency graph BASE (landscape page)
  html += mermaidSection(`Dependency graph base — ${baseLabel}`, mermaidBase);

  // Dependency graph HEAD (landscape page)
  html += mermaidSection(`Dependency graph head — ${headLabel}`, mermaidHead);

  // Dependency paths BASE (landscape page)
  html += dependencyPathsSection(`Dependency path base`, pathsBaseMd);

  // Dependency paths HEAD (landscape page)
  html += dependencyPathsSection(`Dependency path head`, pathsHeadMd);

  html += `</body></html>`;
  return html;
}

module.exports = {
  buildHtmlMain,
  buildHtmlLandscape
};
