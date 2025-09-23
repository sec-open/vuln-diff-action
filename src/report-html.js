// Build HTML for portrait (main) and landscape (graphs/paths) reports.
// - Cover with optional logo
// - TOC
// - Introduction + Summary
// - Severity distribution (BASE vs HEAD) side-by-side pies (SVG)
// - Diff table (Markdown rendered as HTML)
// - Landscape: dependency graph BASE, dependency graph HEAD, dependency paths BASE, dependency paths HEAD.
//
// NOTE: We keep CSS minimal and inline for portability (Puppeteer PDF).

// --- helpers for severity distribution (robust) ---
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function toSeverity(value) {
  const s = String(value || "UNKNOWN").toUpperCase();
  return SEVERITY_ORDER.includes(s) ? s : "UNKNOWN";
}

function countSeverities(matches) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const m of (matches || [])) {
    // Grype JSON: try vulnerability.severity, fallback to m.severity
    const sev = toSeverity(
      (m && m.vulnerability && m.vulnerability.severity) ||
      (m && m.severity)
    );
    counts[sev] += 1;
  }
  return counts;
}

function renderCountsTable(title, counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return `
  <div class="severity-box">
    <h3>${title}</h3>
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



const { svgPie } = require("./svg-charts");
const marked = (md) => {
  // Tiny Markdown to HTML converter (very limited) to render our tables safely.
  // If you already use a proper renderer, replace this function accordingly.
  // Here we only handle code fences and tables minimally.
  return String(md || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") // escape
    .replace(/^\|([\s\S]+?)\|\s*$/gm, (m) => {
      // naive table rows: | a | b |
      const cells = m.trim().slice(1, -1).split("|").map(c => c.trim());
      return `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
    })
    .replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${code}</code></pre>`)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>")
    ;
};

function severityBuckets(matches) {
  const b = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const m of matches || []) {
    const s = (m.severity || m.vulnerability?.severity || "LOW").toUpperCase();
    if (b[s] == null) b.LOW++; else b[s]++;
  }
  return b;
}

function cssBase() {
  return `
  <style>
    :root {
      --fg: #222;
      --muted: #666;
      --sep: #e5e7eb;
      --accent: #6b46c1;
    }
    html, body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--fg); }
    h1,h2,h3 { margin: 0.2rem 0 0.6rem }
    h1 { font-size: 1.8rem; }
    h2 { font-size: 1.4rem; border-bottom: 1px solid var(--sep); padding-bottom: .3rem; }
    h3 { font-size: 1.1rem; }
    p, li { line-height: 1.5; }
    .muted { color: var(--muted); }
    .grid { display: grid; gap: 16px; }
    .two { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .toc { font-size: .95rem; line-height: 1.4; }
    .card { border: 1px solid var(--sep); border-radius: 8px; padding: 12px; }
    .kv { margin: 4px 0; }
    .kv b { display: inline-block; width: 100px; }
    .page-break { page-break-before: always; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
    td, th { border: 1px solid var(--sep); padding: 6px 8px; vertical-align: top; }
    th { background: #f9fafb; text-align: left; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .cover { display:flex; flex-direction:column; align-items:center; justify-content:center; height: 80vh; text-align:center; }
    .cover .logo { margin-bottom: 16px; }
    .meta { margin-top: 6px; color: var(--muted); font-size: 0.95rem; }
    .severity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .severity-box { border: 1px solid #eee; padding: 12px; border-radius: 8px; }
    .sev-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .sev-table th, .sev-table td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    .sev-table thead th { background: #f6f8fa; }
    .sev-table tfoot td { font-weight: 600; }
  </style>
  `;
}

function coverHtml({ repository, baseLabel, headLabel, nowStr, title_logo_url }) {
  const logo = title_logo_url
    ? `<img class="logo" src="${title_logo_url}" alt="logo" width="96" height="96"/>`
    : "";
  return `
  <section class="cover">
    ${logo}
    <h1>Security Report</h1>
    <div class="meta">${repository}</div>
    <div class="meta">Comparison of branches <strong>${baseLabel}</strong> vs <strong>${headLabel}</strong></div>
    <div class="meta">${nowStr}</div>
  </section>
  `;
}

function tocHtml() {
  return `
  <section>
    <h2>Table of Contents</h2>
    <div class="toc">
      <ol>
        <li>Introduction</li>
        <li>Summary</li>
        <li>Severity distribution</li>
        <li>Vulnerability diff table</li>
      </ol>
    </div>
  </section>
  `;
}

function introHtml() {
  return `
  <section class="page-break">
    <h2>Introduction</h2>
    <p>
      This report compares software vulnerabilities between two branches to
      detect issues that are introduced or fixed in a development cycle.
      It uses <strong>Syft</strong> to generate SBOMs (CycloneDX) and
      <strong>Grype</strong> to scan them for known vulnerabilities (CVEs/GHSAs).
    </p>
    <p>
      Sections include: a summary with commit details and metrics, severity distributions
      for both branches, a detailed vulnerability diff table, and (in the landscape report)
      dependency graphs and dependency paths to understand transitive risk.
    </p>
  </section>
  `;
}

function summaryHtml({ baseLabel, baseInput, baseSha, baseCommitLine, headLabel, headInput, headSha, headCommitLine, minSeverity, counts }) {
  return `
  <section class="page-break">
    <h2>Summary</h2>
    <div class="grid two">
      <div class="card">
        <h3>Base</h3>
        <div class="kv"><b>Branch</b> <code>${baseLabel}</code> (input: <code>${baseInput}</code>)</div>
        <div class="kv"><b>Commit</b> <code>${baseSha}</code></div>
        <div class="kv"><b>Message</b> ${baseCommitLine}</div>
      </div>
      <div class="card">
        <h3>Head</h3>
        <div class="kv"><b>Branch</b> <code>${headLabel}</code> (input: <code>${headInput}</code>)</div>
        <div class="kv"><b>Commit</b> <code>${headSha}</code></div>
        <div class="kv"><b>Message</b> ${headCommitLine}</div>
      </div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="kv"><b>Min severity</b> ${minSeverity}</div>
      <div class="kv"><b>Counts</b> NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}</div>
    </div>
  </section>
  `;
}

// Robust severity section: never calls unknown functions; accepts arrays safely
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


function diffTableSectionHtml({ diffTableMarkdown }) {
  // Start on a new page and inject the Markdown diff table
  return `
  <section class="page-break">
    <h2>Vulnerability diff table</h2>
    ${marked(diffTableMarkdown)}
  </section>
  `;
}

function landscapeGraphsHtml({ baseLabel, headLabel, mermaidBase, mermaidHead, pathsBaseMd, pathsHeadMd }) {
  // Mermaid render via script (works in headless Chromium)
  return `
  <html>
    <head>
      ${cssBase()}
      <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
      <script>mermaid.initialize({ startOnLoad: true, securityLevel: 'loose' });</script>
    </head>
    <body>
      <section>
        <h2>Dependency graph — BASE: ${baseLabel}</h2>
        <div class="mermaid">${mermaidBase}</div>
      </section>

      <section class="page-break">
        <h2>Dependency graph — HEAD: ${headLabel}</h2>
        <div class="mermaid">${mermaidHead}</div>
      </section>

      <section class="page-break">
        <h2>Dependency paths — BASE: ${baseLabel}</h2>
        ${marked(pathsBaseMd)}
      </section>

      <section class="page-break">
        <h2>Dependency paths — HEAD: ${headLabel}</h2>
        ${marked(pathsHeadMd)}
      </section>
    </body>
  </html>
  `;
}

function buildHtmlMain(opts) {
  const {
    repository, baseLabel, baseInput, baseSha, baseCommitLine,
    headLabel, headInput, headSha, headCommitLine,
    minSeverity, counts, diffTableMarkdown,
    baseMatches, headMatches, nowStr, title_logo_url
  } = opts;

  return `
  <html>
    <head>
      ${cssBase()}
      <meta charset="utf-8"/>
      <title>Security Report</title>
    </head>
    <body>
      ${coverHtml({ repository, baseLabel, headLabel, nowStr, title_logo_url })}
      ${tocHtml()}
      ${introHtml()}
      ${summaryHtml({ baseLabel, baseInput, baseSha, baseCommitLine, headLabel, headInput, headSha, headCommitLine, minSeverity, counts })}
      ${severitySectionHtml({baseMatches: options.baseMatches || [], headMatches: options.headMatches || [], baseLabel: options.baseLabel || "BASE", headLabel: options.headLabel || "HEAD" })}
      ${diffTableSectionHtml({ diffTableMarkdown })}
    </body>
  </html>
  `;
}

function buildHtmlLandscape(opts) {
  return landscapeGraphsHtml(opts);
}

module.exports = { buildHtmlMain, buildHtmlLandscape };
