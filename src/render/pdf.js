/**
 * PDF renderer (stubs): build HTML strings per section and delegate to Puppeteer.
 * Sections:
 *  - buildCoverHtml
 *  - buildMainHtml (Introduction, Summary, Overview, Diff Table)
 *  - buildLandscapeHtml (Graphs and Paths in landscape)
 */

const fs = require("fs/promises");
const path = require("path");

async function buildCoverHtml(opts) {
  const { titleLogoUrl, baseLabel, headLabel, baseJson, headJson } = opts;
  const logo = titleLogoUrl ? `<img src="${titleLogoUrl}" alt="Logo" style="max-height:72px;object-fit:contain"/>` : "";
  return /* html */`
  <section class="cover">
    <div class="logo">${logo}</div>
    <h1>Vulnerability Diff Report</h1>
    <p><strong>${baseLabel || baseJson?.git?.ref || "BASE"}</strong> vs <strong>${headLabel || headJson?.git?.ref || "HEAD"}</strong></p>
    <p>${baseJson?.git?.sha_short || ""} vs ${headJson?.git?.sha_short || ""}</p>
    <p>${new Date().toISOString()}</p>
  </section>
  `;
}

async function buildMainHtml(opts) {
  // Orchestrates: TOC, Introduction, Summary cards, Overview charts (placeholders) and Diff table
  const intro = buildIntroductionSection(opts);
  const summary = buildSummarySection(opts);
  const overview = buildOverviewSection(opts);
  const table = buildVulnDiffTableSection(opts);
  const toc = buildToc([
    "1. Introduction",
    "2. Summary",
    "3. Overview",
    "4. Vulnerability diff table",
  ]);
  return /* html */`
  <main class="report">
    ${toc}
    ${intro}
    ${summary}
    ${overview}
    ${table}
  </main>`;
}

async function buildLandscapeHtml(opts) {
  // Graphs and Paths (landscape pages). Return HTML string (or null if not requested).
  const graph = buildGraphSection(opts);
  const path = buildPathSection(opts);
  return /* html */`
  <section class="landscape">
    ${graph}
    ${path}
  </section>`;
}

/* -------------------- Building blocks (pure HTML) ------------------------- */

function buildToc(entries) {
  return /* html */`
  <section class="toc">
    <h2>Table of contents</h2>
    <ol>
      ${entries.map(e => `<li>${e}</li>`).join("")}
    </ol>
  </section>`;
}

function buildIntroductionSection(opts) {
  const d = opts?.diffJson || {};
  return /* html */`
  <section>
    <h2>1. Introduction</h2>
    <p>This report compares the security posture of <strong>${d.repo || "repository"}</strong> between
    <strong>${d.head?.ref || "HEAD"}</strong> (${d.head?.short_sha || ""}) and
    <strong>${d.base?.ref || "BASE"}</strong> (${d.base?.short_sha || ""}).</p>
    <p>It shows how known vulnerabilities differ across these two references so reviewers can quickly assess newly introduced risks, confirm improvements, and verify areas that remain unchanged.</p>
  </section>`;
}

function buildSummarySection(opts) {
  const { baseJson, headJson, diffJson, params = {} } = opts || {};
  const totals = diffJson?.summary?.totals || { NEW:0, REMOVED:0, UNCHANGED:0 };
  function sevTable(sum) {
    const s = sum?.by_severity || {};
    return `
      <table class="kv">
        <tr><th>CRITICAL</th><td>${s.CRITICAL||0}</td></tr>
        <tr><th>HIGH</th><td>${s.HIGH||0}</td></tr>
        <tr><th>MEDIUM</th><td>${s.MEDIUM||0}</td></tr>
        <tr><th>LOW</th><td>${s.LOW||0}</td></tr>
        <tr><th>UNKNOWN</th><td>${s.UNKNOWN||0}</td></tr>
      </table>`;
  }
  const paramsTable = `
    <table class="kv">
      ${Object.entries(params).map(([k,v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`).join("")}
    </table>`;
  return /* html */`
  <section>
    <h2>2. Summary</h2>
    <div class="cards">
      <div class="card"><h3>NEW</h3><p>${totals.NEW}</p></div>
      <div class="card"><h3>REMOVED</h3><p>${totals.REMOVED}</p></div>
      <div class="card"><h3>UNCHANGED</h3><p>${totals.UNCHANGED}</p></div>
    </div>
    <div class="row">
      <div class="card"><h3>Base</h3>
        <p><strong>${baseJson?.git?.ref || "BASE"}</strong> (${baseJson?.git?.sha_short || ""})</p>
        ${sevTable(baseJson?.summary)}
      </div>
      <div class="card"><h3>Head</h3>
        <p><strong>${headJson?.git?.ref || "HEAD"}</strong> (${headJson?.git?.sha_short || ""})</p>
        ${sevTable(headJson?.summary)}
      </div>
      <div class="card"><h3>Parameters</h3>${paramsTable}</div>
    </div>
  </section>`;
}

function buildOverviewSection(opts) {
  // Placeholder containers for charts; in PDF we may render static images or SVG later.
  return /* html */`
  <section>
    <h2>3. Overview</h2>
    <div class="row">
      <div class="card"><h3>States by Severity</h3><div class="chart-placeholder">[chart]</div></div>
      <div class="card"><h3>Totals per state</h3><div class="chart-placeholder">[chart]</div></div>
    </div>
    <div class="row">
      <div class="card"><h3>NEW by package/severity</h3><div class="chart-placeholder">[donut]</div></div>
      <div class="card"><h3>REMOVED by package/severity</h3><div class="chart-placeholder">[donut]</div></div>
    </div>
    <div class="card"><h3>Critical in HEAD</h3><div class="table-placeholder">[table]</div></div>
  </section>`;
}

function buildVulnDiffTableSection(opts) {
  const diff = opts?.diffJson || {};
  const rows = [
    ...(diff?.changes?.new || []).map(v => ({...v, __status:"NEW"})),
    ...(diff?.changes?.removed || []).map(v => ({...v, __status:"REMOVED"})),
  ];
  const tr = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.severity || "UNKNOWN")}</td>
      <td><a href="${escapeHtml(attrAdvisory(r))}" target="_blank">${escapeHtml(r.id || "")}</a></td>
      <td><code>${escapeHtml(formatPackage(r.package?.name, r.package?.version))}</code></td>
      <td>${r.__status === "NEW" ? "HEAD" : "BASE"}</td>
      <td>${r.__status}</td>
    </tr>`).join("");
  return /* html */`
  <section>
    <h2>4. Vulnerability diff table</h2>
    <table class="table">
      <thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Branches</th><th>Status</th></tr></thead>
      <tbody>${tr}</tbody>
    </table>
  </section>`;
}

function buildGraphSection(opts) {
  return /* html */`
  <section>
    <h2>5. Graph</h2>
    <h3>5.1. Dependency graph base</h3>
    <div class="mermaid">%% base graph placeholder %%</div>
    <h3>5.2. Dependency graph head</h3>
    <div class="mermaid">%% head graph placeholder %%</div>
  </section>`;
}

function buildPathSection(opts) {
  return /* html */`
  <section>
    <h2>6. Path</h2>
    <h3>6.1. Dependency path base</h3>
    <div class="table-placeholder">[base path table]</div>
    <h3>6.2. Dependency path head</h3>
    <div class="table-placeholder">[head path table]</div>
  </section>`;
}

/* ------------------------------ Utils ------------------------------------ */

function formatPackage(name, version) {
  const n = name || "unknown";
  const v = (version && String(version).trim()) ? String(version).trim() : "-";
  return `${n}:${v}`;
}
function attrAdvisory(v) {
  if (v?.ids?.ghsa) return `https://github.com/advisories/${v.ids.ghsa}`;
  if (v?.ids?.cve) return `https://nvd.nist.gov/vuln/detail/${v.ids.cve}`;
  return v?.url || "#";
}
function escapeHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

module.exports = {
  buildCoverHtml,
  buildMainHtml,
  buildLandscapeHtml,
  // expose building blocks for tests if needed
  _blocks: {
    buildIntroductionSection,
    buildSummarySection,
    buildOverviewSection,
    buildVulnDiffTableSection,
    buildGraphSection,
    buildPathSection,
  },
};
