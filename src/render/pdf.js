// src/render/pdf.js
// PDF-only renderers. This module is SELF-CONTAINED and does not reuse HTML/Markdown renderers.
//
// Exports (PDF only):
//   - buildCoverHtml({ repository, baseLabel, headLabel, titleLogoUrl, generatedAt })
//   - buildMainHtml({ repository, base, head, counts, minSeverity, diffTableHtml, logo })
//   - buildLandscapeHtml({ baseLabel, headLabel, pathsBaseHtml, pathsHeadHtml, mermaidBase, mermaidHead })
//   - buildDiffTableHtml(diff, baseLabel, headLabel)           // PDF-only diff table
//   - buildPathsTableHtml(bom, matches, opts)                   // PDF-only paths table
//   - buildMermaidGraphForPdf(bom, matches, maxNodes)           // PDF-only Mermaid
//   - htmlToPdf(html, outPath, opts)
//   - mergePdfs(inFiles, outFile)

const fs = require("fs");
const { execFileSync } = require("child_process");
const puppeteer = require("puppeteer"); // provided at runtime

/* --------------------------------- Utils --------------------------------- */

function toArray(x) {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  if (typeof x === "string") return [x];
  if (x instanceof Set) return [...x];
  if (typeof x === "object") {
    if ("path" in x) return toArray(x.path);
    if ("via" in x) return toArray(x.via);
    if ("dependencyPath" in x) return toArray(x.dependencyPath);
  }
  return [];
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function short(s, n = 80) {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function titleLine(repository, baseLabel, headLabel) {
  return `Security Report — ${repository} — ${baseLabel} vs ${headLabel}`;
}

/* ---------------------------------- CSS ---------------------------------- */

const BASE_CSS = `
  @page { size: A4; margin: 14mm 12mm 14mm 12mm; }
  html, body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif; color:#111; }
  h1, h2, h3 { margin: 0 0 8px 0; line-height: 1.3; }
  h1 { font-size: 20px; }
  h2 { font-size: 17px; }
  h3 { font-size: 15px; }
  p { margin: 0 0 10px 0; line-height: 1.45; }
  .muted { color:#666; }
  .small { font-size: 12px; }
  .center { text-align:center; }

  /* Sections */
  section { page-break-inside: avoid; margin-bottom: 14mm; }
  .section { page-break-before: always; }
  .toc { page-break-before: always; }
  .toc .title { font-size: 22px; margin-bottom: 10mm; }
  .toc ol { list-style: none; padding: 0; margin: 0; width: 70%; margin-left: auto; margin-right: auto; }
  .toc li { margin: 6px 0 10px 0; line-height: 1.8; font-size: 14px; }

  /* Tables */
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
  th { background:#f6f8fa; text-align:left; }
  .right { text-align:right; }
  .landscape table { font-size: 11px; }

  /* Header/Footer placeholders (Puppeteer templates inject content) */
  .header, .footer { font-size: 10px; color:#444; }

  /* Figures */
  .caption { font-size: 12px; color:#333; margin: 4px 0 10px 0; }
  .figure { margin: 6px 0 16px 0; }

  /* Mermaid pre */
  .mermaid-box { border:1px solid #ddd; padding:8px; margin:8px 0 12px 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace; white-space: pre; font-size: 11px; overflow: auto; }
`;

/* --------------------------------- Cover --------------------------------- */

function buildCoverHtml({ repository, baseLabel, headLabel, titleLogoUrl, generatedAt }) {
  const title = titleLine(repository, baseLabel, headLabel);
  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>${BASE_CSS}
        @page { margin: 0; }
        .cover { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; padding: 0 10mm; }
        .cover-title { font-size: 28px; margin: 0 0 8px 0; text-align:center; }
        .cover-sub { font-size: 16px; color:#444; margin: 0 0 14px 0; }
        .cover-logo { max-height: 80px; margin-top: 18px; }
      </style>
    </head>
    <body>
      <div class="cover">
        <h1 class="cover-title">${escHtml(title)}</h1>
        <div class="cover-sub">Generated at ${escHtml(generatedAt)}</div>
        ${titleLogoUrl ? `<img class="cover-logo" src="${escHtml(titleLogoUrl)}" />` : ""}
      </div>
    </body>
  </html>`;
}

/* ------------------------------ Main document ---------------------------- */

function buildMainHtml({ repository, base, head, counts, minSeverity, diffTableHtml, logo }) {
  const baseLabel = base.label;
  const headLabel = head.label;

  const headerTemplate = `
    <div class="header" style="width:100%; padding:6px 10mm;">
      <span>${escHtml(titleLine(repository, baseLabel, headLabel))}</span>
    </div>
  `;
  const footerTemplate = `
    <div class="footer" style="width:100%; padding:6px 10mm; display:flex; align-items:center; justify-content:space-between;">
      <div>${logo ? `<img src="${escHtml(logo)}" style="height:16px; vertical-align:middle;" />` : ""}</div>
      <div class="muted"><span class="pageNumber"></span>/<span class="totalPages"></span> • ${new Date().toLocaleString("en-GB", { timeZone: "Europe/London", hour12:false }).replace(",", "")}</div>
    </div>
  `;

  const toc = `
    <section class="toc center">
      <div class="title">Table of contents</div>
      <ol>
        <li>1. Introduction</li>
        <li>2. Summary</li>
        <li>3. Severity distribution</li>
        <li>4. Change overview</li>
        <li>5. Vulnerability diff table</li>
        <li>6. Dependency graph — BASE</li>
        <li>7. Dependency graph — HEAD</li>
        <li>8. Dependency path — BASE</li>
        <li>9. Dependency path — HEAD</li>
      </ol>
    </section>
  `;

  const introSlot = `
    <section class="section">
      <h2>1. Introduction</h2>
      <div id="pdf-intro-slot"></div>
    </section>
  `;

  const summary = `
    <section class="section">
      <h2>2. Summary</h2>
      <table>
        <thead><tr><th>Branch</th><th>Commit</th><th>Message</th><th class="right">Severity counts</th></tr></thead>
        <tbody>
          <tr>
            <td>${escHtml(baseLabel)}</td>
            <td><code>${escHtml((base.sha || "").slice(0,12))}</code></td>
            <td>${escHtml(base.message || "")}</td>
            <td class="right"><code>${formatSeverityCounts(counts.base || {})}</code></td>
          </tr>
          <tr>
            <td>${escHtml(headLabel)}</td>
            <td><code>${escHtml((head.sha || "").slice(0,12))}</code></td>
            <td>${escHtml(head.message || "")}</td>
            <td class="right"><code>${formatSeverityCounts(counts.head || {})}</code></td>
          </tr>
        </tbody>
      </table>
      <p class="small muted" style="margin-top:6px;">Minimum severity: <strong>${escHtml(minSeverity)}</strong></p>
    </section>
  `;

  const charts = `
    <section class="section">
      <h2>3. Severity distribution</h2>
      <div class="figure"><div id="pdf-severity-chart">[Chart.js figure]</div><div class="caption">Figure 1 — Severity distribution</div></div>
    </section>
    <section class="section">
      <h2>4. Change overview</h2>
      <div class="figure"><div id="pdf-change-overview">[Chart.js figure]</div><div class="caption">Figure 2 — Change overview</div></div>
    </section>
  `;

  const diffTable = `
    <section class="section">
      <h2>5. Vulnerability diff table</h2>
      ${diffTableHtml}
    </section>
  `;

  const body = `
    <html>
      <head>
        <meta charset="utf-8"/>
        <style>${BASE_CSS}</style>
      </head>
      <body>
        ${toc}
        ${introSlot}
        ${summary}
        ${charts}
        ${diffTable}
        <section class="section">
          <h2>6. Dependency graph — BASE</h2>
          <div id="pdf-graph-base"></div>
          <div class="caption">Figure 3 — Dependency graph (BASE)</div>
        </section>
        <section class="section">
          <h2>7. Dependency graph — HEAD</h2>
          <div id="pdf-graph-head"></div>
          <div class="caption">Figure 4 — Dependency graph (HEAD)</div>
        </section>
        <section class="section">
          <h2>8. Dependency path — BASE</h2>
          <div id="pdf-paths-base"></div>
        </section>
        <section class="section">
          <h2>9. Dependency path — HEAD</h2>
          <div id="pdf-paths-head"></div>
        </section>
      </body>
    </html>
  `;

  return { header: headerTemplate, footer: footerTemplate, body };
}

/* ----------------------- PDF-only: Landscape appendix --------------------- */

function buildLandscapeHtml({ baseLabel, headLabel, pathsBaseHtml, pathsHeadHtml, mermaidBase, mermaidHead }) {
  const header = `<div class="header" style="width:100%; padding:6px 10mm;">Dependency graphs &amp; paths</div>`;
  const footer = `<div class="footer" style="width:100%; padding:6px 10mm;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>`;

  const body = `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>${BASE_CSS}
        @page { size: A4 landscape; }
        .mermaid-box { border: 1px solid #ddd; padding: 8px; margin: 8px 0 12px 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace; white-space: pre; font-size: 11px; overflow: auto; }
      </style>
    </head>
    <body class="landscape">
      <section class="section">
        <h2>6. Dependency graph — BASE: ${escHtml(baseLabel)}</h2>
        <div class="mermaid-box">${escHtml(mermaidBase || "[empty]")}</div>
      </section>
      <section class="section">
        <h2>7. Dependency graph — HEAD: ${escHtml(headLabel)}</h2>
        <div class="mermaid-box">${escHtml(mermaidHead || "[empty]")}</div>
      </section>
      <section class="section">
        <h2>8. Dependency path — BASE</h2>
        ${pathsBaseHtml}
      </section>
      <section class="section">
        <h2>9. Dependency path — HEAD</h2>
        ${pathsHeadHtml}
      </section>
    </body>
  </html>`;

  return { header, footer, body };
}

/* ----------------------- PDF-only: Vulnerability table -------------------- */

function buildDiffTableHtml(diff, baseLabel, headLabel) {
  const rows = [];

  const pushRows = (arr, branch) => {
    for (const it of arr || []) {
      const sev = escHtml(it?.severity || "UNKNOWN");
      const id = escHtml(it?.id || "UNKNOWN");
      const href = pickHref(it);
      const pkg = escHtml(it?.package || "unknown");
      const ver = escHtml(it?.version || "-");
      rows.push(`<tr>
        <td><strong>${sev}</strong></td>
        <td>${href ? `<a href="${href}">${id}</a>` : id}</td>
        <td><code>${pkg}</code></td>
        <td><code>${ver}</code></td>
        <td>${escHtml(branch)}</td>
      </tr>`);
    }
  };

  pushRows(diff?.news,      headLabel);
  pushRows(diff?.removed,   baseLabel);
  pushRows(diff?.unchanged, "BOTH");

  return `
    <table>
      <thead>
        <tr>
          <th>Severity</th><th>Vulnerability</th><th>Package</th><th>Version</th><th>Branch</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join("\n")}
      </tbody>
    </table>
  `;
}

function pickHref(it) {
  const id = it?.id || "";
  const url = it?.url || "";
  if (/^https:\/\/github\.com\/advisories\/GHSA-/.test(url)) return url;
  const ghsa = pickGhsa(it);
  if (ghsa) return `https://github.com/advisories/${ghsa}`;
  if (/^CVE-\d{4}-\d{4,7}$/.test(id)) return `https://nvd.nist.gov/vuln/detail/${id}`;
  return "";
}

function pickGhsa(x) {
  const id = x?.id || "";
  if (/^GHSA-[A-Za-z0-9-]+$/.test(id)) return id;
  const al = Array.isArray(x?.aliases) ? x.aliases : [];
  for (const a of al) if (/^GHSA-[A-Za-z0-9-]+$/.test(a)) return a;
  return null;
}

function formatSeverityCounts(obj) {
  const levels = ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"];
  return levels.map(k => `${k}:${obj[k] ?? 0}`).join(" · ");
}

/* ----------------------- PDF-only: Paths table (HTML) --------------------- */

function buildPathsTableHtml(bom, matches, { maxPathsPerPkg = 3, maxDepth = 10 } = {}) {
  const rows = [];

  for (const m of toArray(matches)) {
    const art = m?.artifact || m?.match || m?.package || {};
    const pkgName = art?.name || art?.purl || "unknown";
    const pkgVer = art?.version || ""; // reservado por si quieres añadirlo a la tabla

    const candidates = [
      ...toArray(m?.matchDetails).flatMap(d => toArray(d?.via)),
      ...toArray(m?.paths),
      ...toArray(m?.via),
      ...toArray(art?.locations).map(loc => loc?.path).filter(Boolean),
    ];

    let added = 0;
    for (const c of candidates) {
      if (added >= maxPathsPerPkg) break;

      const segments = toArray(c).map(x => String(x ?? "").trim()).filter(Boolean).slice(0, maxDepth);
      if (segments.length === 0) continue;

      let start = 0;
      if (/^pkg$/i.test(segments[0])) start = 1;

      const moduleName = segments[start] || pkgName;
      const depths = segments.slice(start + 1);

      rows.push([moduleName, ...depths]);
      added++;
    }
    if (added === 0) {
      rows.push([pkgName]);
    }
  }

  // Compute max number of depth columns to align the table
  let maxCols = 1;
  for (const r of rows) maxCols = Math.max(maxCols, r.length);

  const headerCells = ["Module"];
  for (let i = 1; i < maxCols; i++) headerCells.push(`Depth${i}`);

  const thead = `<thead><tr>${headerCells.map(h => `<th>${escHtml(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r => {
    const cells = [];
    for (let i = 0; i < maxCols; i++) {
      cells.push(`<td>${escHtml(short(r[i] || "", 80))}</td>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  }).join("\n")}</tbody>`;

  return `<table>${thead}${tbody}</table>`;
}

/* ----------------------- PDF-only: Mermaid graph -------------------------- */

function buildMermaidGraphForPdf(bom, matches, maxNodes = 150) {
  const components = toArray(bom?.components);
  const dependencies = toArray(bom?.dependencies);

  const compIndex = new Map();
  for (const c of components) {
    const key = c?.bomRef || c?.purl || c?.name || JSON.stringify(c);
    const label = [c?.name || "unknown", c?.version ? `@${c.version}` : ""].join("");
    compIndex.set(key, label);
  }

  const edges = [];
  for (const dep of toArray(dependencies)) {
    const ref = dep?.ref;
    for (const child of toArray(dep?.dependsOn)) edges.push([ref, child]);
  }

  const nodes = new Set();
  if (edges.length === 0) {
    for (const c of components.slice(0, maxNodes)) {
      const key = c?.bomRef || c?.purl || c?.name || JSON.stringify(c);
      nodes.add(key);
    }
  } else {
    for (const [a, b] of edges) {
      nodes.add(a); nodes.add(b);
      if (nodes.size >= maxNodes) break;
    }
  }

  const lines = [];
  lines.push("flowchart LR");
  for (const id of nodes) {
    const label = short(compIndex.get(id) || id, 36).replace(/\"/g, "'");
    lines.push(`  ${hash(id)}["${label}"]`);
  }
  for (const [a, b] of edges) {
    if (!nodes.has(a) || !nodes.has(b)) continue;
    lines.push(`  ${hash(a)} --> ${hash(b)}`);
  }
  return lines.join("\n");

  function hash(s) {
    // cheap stable short id
    let h = 0;
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h = (h * 33) ^ str.charCodeAt(i);
    }
    return "n" + (h >>> 0).toString(16);
  }
}

/* ------------------------------ Puppeteer I/O ------------------------------ */

async function htmlToPdf(html, outPath, opts = {}) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: !!opts.displayHeaderFooter,
      headerTemplate: opts.headerTemplate || "",
      footerTemplate: opts.footerTemplate || "",
      margin: opts.margin || { top: "14mm", right: "10mm", bottom: "12mm", left: "10mm" },
      landscape: !!opts.landscape,
    });
  } finally {
    await browser.close();
  }
}

function mergePdfs(inFiles, outFile) {
  const all = (inFiles || []).filter(f => f && fs.existsSync(f));
  if (all.length === 0) return;
  try {
    execFileSync("pdfunite", [...all, outFile], { stdio: "ignore" });
  } catch {
    // fallback naive: copia el último
    fs.copyFileSync(all[all.length - 1], outFile);
  }
}

/* --------------------------------- Exports -------------------------------- */

module.exports = {
  buildCoverHtml,
  buildMainHtml,
  buildLandscapeHtml,
  buildDiffTableHtml,
  buildPathsTableHtml,
  buildMermaidGraphForPdf,
  htmlToPdf,
  mergePdfs,
};
