// Build HTML for portrait (main) and landscape (graphs/paths) reports.
// - Cover with optional logo
// - TOC
// - Introduction + Summary
// - Severity distribution (BASE vs HEAD) side-by-side pies (SVG)
// - Diff table (Markdown rendered as HTML)
// - Landscape: dependency graph BASE, dependency graph HEAD, dependency paths BASE, dependency paths HEAD.
//
// NOTE: We keep CSS minimal and inline for portability (Puppeteer PDF).

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

function severitySectionHtml({ baseLabel, headLabel, baseMatches, headMatches }) {
  const colors = { CRITICAL: "#c62828", HIGH: "#ef6c00", MEDIUM: "#fbc02d", LOW: "#2e7d32" };
  const basePie = svgPie({ data: severityBuckets(baseMatches), colors, label: `Base: ${baseLabel}` });
  const headPie = svgPie({ data: severityBuckets(headMatches), colors, label: `Head: ${headLabel}` });
  return `
  <section class="page-break">
    <h2>Severity distribution</h2>
    <div style="display:flex; gap:24px; flex-wrap:wrap; align-items:flex-start">
      ${basePie}
      ${headPie}
    </div>
  </section>
  `;
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
      ${severitySectionHtml({ baseLabel, headLabel, baseMatches, headMatches })}
      ${diffTableSectionHtml({ diffTableMarkdown })}
    </body>
  </html>
  `;
}

function buildHtmlLandscape(opts) {
  return landscapeGraphsHtml(opts);
}

module.exports = { buildHtmlMain, buildHtmlLandscape };
