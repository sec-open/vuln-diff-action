// src/index.js
// v2 main — Orchestrates SBOM/scan/diff, builds HTML (cover+main+appendix) and exports PDFs.
// Adds: header/footer with dark background + light text, footer logo, UK time, HTML tables with links, transformed dependency-paths table.

const core = require("@actions/core");
const exec = require("@actions/exec");
const artifact = require("@actions/artifact");
const github = require("@actions/github");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { PDFDocument } = require("pdf-lib");

const { generateSbomAuto } = require("./sbom");
const { scanSbom } = require("./grype");
const { diff, renderMarkdownTable } = require("./diff");
const {
  buildMarkdownReport,
  buildDependencyPathsTable,
  renderPathsMarkdownTable,
  buildMermaidGraphFromBOMImproved
} = require("./report");
const { buildHtmlCover, buildHtmlMain, buildHtmlLandscape } = require("./report-html");

// ---------------------- helpers ----------------------
function escapeHtml(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
                  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
async function sh(cmd, opts = {}) { return exec.exec("bash", ["-lc", cmd], opts); }
async function tryRevParse(ref) {
  let out = "";
  try { await exec.exec("bash", ["-lc", `git rev-parse ${ref}`], { listeners: { stdout: d => (out += d.toString()) }}); return out.trim(); }
  catch { return null; }
}
function isSha(ref) { return /^[0-9a-f]{7,40}$/i.test(ref || ""); }
async function resolveRefToSha(ref) {
  if (isSha(ref)) { const sha = await tryRevParse(ref); if (sha) return sha; throw new Error(`Input '${ref}' looks like a SHA but does not exist locally.`); }
  let sha = await tryRevParse(ref); if (sha) return sha;
  sha = await tryRevParse(`refs/remotes/origin/${ref}`); if (sha) return sha;
  let remotes = ""; await exec.exec("bash", ["-lc", "git remote"], { listeners: { stdout: d => (remotes += d.toString()) }});
  if (remotes.split(/\s+/).includes("upstream")) { sha = await tryRevParse(`refs/remotes/upstream/${ref}`); if (sha) return sha; }
  try { await sh(`git fetch origin ${ref}:${ref} --tags --prune`); sha = await tryRevParse(ref); if (sha) return sha; } catch {}
  throw new Error(`Cannot resolve ref '${ref}' to a commit SHA. Ensure the branch or SHA exists in this runner.`);
}
function shortSha(sha) { return (sha || "").substring(0, 12); }
function guessLabel(ref) { const m = (ref || "").match(/^(?:refs\/remotes\/\w+\/|origin\/)?(.+)$/); return m ? m[1] : (ref || ""); }

async function commitLine(sha) {
  let out = "";
  await exec.exec("bash", ["-lc", `git --no-pager log -1 --format="%H %s" ${sha}`], {
    listeners: { stdout: d => (out += d.toString()) },
  });
  return out.trim();
}

// Cambridge/UK time
function fmtNowUK() {
  try {
    const dt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false
    }).format(new Date());
    // en-GB usually yields dd/mm/yyyy, we need dd-MM-yyyy HH:mm:ss
    const m = dt.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
    return dt;
  } catch {
    const d = new Date(); const pad = n => String(n).padStart(2,"0");
    return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

// Markdown table -> HTML with inline **bold**, `code` and GHSA/CVE links
function markdownTableToHtml(md) {
  if (!md || !/\|/.test(md)) return `<div class="muted">No data</div>`;
  const lines = md.split(/\r?\n/).filter(l => l.trim().length > 0);
  const headerIdx = lines.findIndex(l => /\|/.test(l)); if (headerIdx < 0 || headerIdx + 1 >= lines.length) return `<div class="muted">No data</div>`;
  const header = lines[headerIdx]; const sep = lines[headerIdx + 1];
  if (!/^-{3,}|:?-{3,}:?/.test(sep.replace(/\|/g, "").trim())) return `<pre class="md">${escapeHtml(md)}</pre>`;
  const rows = [];
  const normalizeCells = (line) => line.split("|").map(c => c.trim()).filter((_,i,arr)=> !(i===0 || i===arr.length-1));
  rows.push({ type: "th", cells: normalizeCells(header) });
  for (let i = headerIdx + 2; i < lines.length; i++) if (/\|/.test(lines[i])) rows.push({ type: "td", cells: normalizeCells(lines[i]) });

  const linkify = (txt) => {
    txt = txt.replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, (_m,id) => `<a href="https://github.com/advisories/${id}" target="_blank" rel="noopener">${escapeHtml(id)}</a>`);
    txt = txt.replace(/\b(CVE-\d{4}-\d{4,7})\b/g, (_m,id) => `<a href="https://nvd.nist.gov/vuln/detail/${id}" target="_blank" rel="noopener">${escapeHtml(id)}</a>`);
    return txt;
  };
  const inline = (txt) => {
    if (!txt) return "";
    let s = String(txt);
    s = s.replace(/`([^`]+)`/g, (_,m) => `<code>${escapeHtml(m)}</code>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, (_,m) => `<strong>${escapeHtml(m)}</strong>`);
    s = linkify(s);
    return s;
  };
  let html = `<table class="tbl"><thead><tr>`;
  for (const c of rows[0].cells) html += `<th>${inline(c)}</th>`;
  html += `</tr></thead><tbody>`;
  for (let i = 1; i < rows.length; i++) {
    html += `<tr>`;
    for (const c of rows[i].cells) html += `<td>${inline(c)}</td>`;
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

// Transform dependency-paths markdown table:
// - Move Depth0 -> Module (strip literal "pkg")
// - Shift Depth1..n left (Depth1 -> Depth0, etc.)
function transformDependencyPathsMarkdown(md) {
  if (!md || !/\|/.test(md)) return md;
  const lines = md.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => /\|/.test(l)); if (headerIdx < 0 || headerIdx + 1 >= lines.length) return md;
  const cells = (line) => line.split("|").map(s => s.trim()).filter((_,i,arr)=> !(i===0 || i===arr.length-1));
  const header = cells(lines[headerIdx]);
  const colIdx = {
    severity: header.findIndex(h => /^severity$/i.test(h)),
    module:   header.findIndex(h => /^module$/i.test(h)),
    pkg:      header.findIndex(h => /^package$/i.test(h)),
    depth0:   header.findIndex(h => /^depth0$/i.test(h)),
  };
  const otherDepths = header.map((h,i)=> ({h,i})).filter(x => /^depth\d+$/i.test(x.h)).sort((a,b)=> parseInt(a.h.slice(5)) - parseInt(b.h.slice(5)));

  const newHeader = [];
  if (colIdx.severity >= 0) newHeader.push(header[colIdx.severity]);
  newHeader.push("Module");
  if (colIdx.pkg >= 0) newHeader.push(header[colIdx.pkg]);
  for (const d of otherDepths) { const n = parseInt(d.h.slice(5),10); if (!isNaN(n) && n >= 1) newHeader.push(`Depth${n-1}`); }

  const out = [];
  out.push("| " + newHeader.join(" | ") + " |");
  out.push("| " + newHeader.map(()=> "---").join(" | ") + " |");

  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!/\|/.test(lines[i])) continue;
    const row = cells(lines[i]); const get = (idx) => (idx >= 0 && idx < row.length ? row[idx] : "");
    const severity = get(colIdx.severity);
    const moduleFromDepth0 = get(colIdx.depth0).replace(/^`?pkg`?$/i, "").trim() || get(colIdx.module).replace(/^`?pkg`?$/i, "").trim();
    const moduleClean = moduleFromDepth0 || "";
    const pkg = get(colIdx.pkg);
    const shifted = [];
    for (const d of otherDepths) { const n = parseInt(d.h.slice(5),10); if (!isNaN(n) && n >= 1) shifted.push(get(d.i)); }

    const cellsOut = [];
    if (colIdx.severity >= 0) cellsOut.push(severity);
    cellsOut.push(moduleClean);
    if (colIdx.pkg >= 0) cellsOut.push(pkg);
    for (const s of shifted) cellsOut.push(s);
    out.push("| " + cellsOut.join(" | ") + " |");
  }
  return out.join("\n");
}

// ---------- Puppeteer + PDF ----------
async function ensureChromeForPuppeteer(version = "24.10.2") {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || `${os.homedir()}/.cache/puppeteer`;
  const cmd = `PUPPETEER_CACHE_DIR=${cacheDir} npx --yes puppeteer@${version} browsers install chrome`;
  await sh(cmd);
  return cacheDir;
}

/**
 * Render HTML to PDF.
 * - displayHeaderFooter=false for cover
 * - headerMeta: { repo, base, head, section, date, logo }
 * - Header/Footer with dark background (brand) and light text; subtle framing simulated via background bar.
 */
async function renderPdfFromHtml(html, outPath, { landscape = false, headerMeta, displayHeaderFooter = true } = {}) {
  const puppeteer = require("puppeteer");
  await ensureChromeForPuppeteer();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--no-sandbox","--disable-setuid-sandbox"]
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");

    // Chart.js inject & render
    const hasAnyCanvas = await page.$("canvas");
    if (hasAnyCanvas) {
      await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" });
      await page.evaluate(() => {
        try {
          const elBase = document.getElementById("chartBase");
          const elHead = document.getElementById("chartHead");
          const elChanges = document.getElementById("chartChanges");
          const data = window.__vulnChartData || { labels:[], base:[], head:[], changes:[0,0,0] };
          const colors = ["#b91c1c","#ea580c","#ca8a04","#16a34a","#6b7280"];
          function doughnut(ctx, values){
            return new window.Chart(ctx, {
              type: "doughnut",
              data: { labels: data.labels, datasets: [{ data: values, backgroundColor: colors }] },
              options: { plugins:{ legend:{ position:"bottom" } }, cutout: "60%" }
            });
          }
          if (elBase && elHead) { doughnut(elBase.getContext("2d"), data.base); doughnut(elHead.getContext("2d"), data.head); }
          if (elChanges) {
            new window.Chart(elChanges.getContext("2d"), {
              type: "bar",
              data: { labels: ["NEW","REMOVED","UNCHANGED"], datasets: [{ data: data.changes }] },
              options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
              }
            });
          }
        } catch(e) { console.warn("Chart render failed", e); }
      });
    }

    // Mermaid inject & render
    const hasMermaid = await page.$("[data-mermaid]");
    if (hasMermaid) {
      await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js" });
      await page.evaluate(async () => {
        try {
          window.mermaid.initialize({ startOnLoad: false, securityLevel: "antiscript", theme: "default", fontFamily: "ui-sans-serif, system-ui" });
          const blocks = document.querySelectorAll("[data-mermaid]");
          for (const block of blocks) {
            const code = block.getAttribute("data-mermaid") || "";
            if (code.trim().length === 0) continue;
            const { svg } = await window.mermaid.render("m"+Math.random().toString(36).slice(2), code);
            const target = block.nextElementSibling || block.parentElement;
            const holder = document.createElement("div");
            holder.innerHTML = svg;
            holder.style.transform = "scale(0.9)";
            holder.style.transformOrigin = "top left";
            target.appendChild(holder);
            block.remove();
          }
        } catch(e) { console.warn("Mermaid render failed", e); }
      });
    }

    // Header/Footer templates
    // dentro de renderPdfFromHtml(...)

    const meta = headerMeta || {};
    const brandBg = "#111827";
    const brandFg = "#F9FAFB";
    const footerLogo = meta.logo ? `<img src="${escapeHtml(meta.logo)}" style="height:10px; vertical-align:middle; margin-right:8px"/>` : "";

    // 🔧 Evitar template literal anidado: construir la parte izquierda como string normal
    const titleLeft =
      'Security Report — ' +
      escapeHtml(meta.repo || '') +
      (meta.base && meta.head ? (' — ' + escapeHtml(meta.base) + ' vs ' + escapeHtml(meta.head)) : '');

    const headerHtml = `
      <div style="width:100%;">
        <div style="font-size:9px; color:${brandFg}; background:${brandBg}; width:100%; padding:6px 10mm;">
          <span style="float:left;">${titleLeft}</span>
          <span style="float:right;">${escapeHtml(meta.section || "")}</span>
        </div>
      </div>`;

    const footerHtml = `
      <div style="width:100%;">
        <div style="font-size:9px; color:${brandFg}; background:${brandBg}; width:100%; padding:6px 10mm;">
          <span style="float:left;">${footerLogo}${escapeHtml(meta.date || "")}</span>
          <span style="float:right;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      </div>`;


    const portraitMargins = { top: displayHeaderFooter ? "22mm" : "12mm", right: "10mm", bottom: displayHeaderFooter ? "20mm" : "12mm", left: "10mm" };
    const landscapeMargins = { top: displayHeaderFooter ? "20mm" : "10mm", right: "10mm", bottom: displayHeaderFooter ? "18mm" : "10mm", left: "10mm" };

    await page.pdf({
      path: outPath,
      format: "A4",
      landscape,
      printBackground: true,
      displayHeaderFooter: !!displayHeaderFooter,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      margin: landscape ? landscapeMargins : portraitMargins
    });
  } finally {
    // ensure browser closes even on failure
    try { await browser.close(); } catch {}
  }
}

async function mergePdfs(pdfPaths, outPath) {
  const docs = [];
  for (const p of pdfPaths) {
    const bytes = fs.readFileSync(p);
    docs.push(await PDFDocument.load(bytes));
  }
  const out = await PDFDocument.create();
  for (const doc of docs) {
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const pg of pages) out.addPage(pg);
  }
  const finalBytes = await out.save();
  fs.writeFileSync(outPath, finalBytes);
}

// ---------------------- PR comment / Slack (tu lógica existente puede quedarse) ----------------------

async function run() {
  try {
    // Inputs
    const baseRefInput   = core.getInput("base_ref", { required: true });
    const headRefInput   = core.getInput("head_ref", { required: true });
    const scanPath       = core.getInput("path") || ".";
    const buildCommand   = core.getInput("build_command") || "";
    const minSeverity    = core.getInput("min_severity") || "LOW";
    const writeSummary   = (core.getInput("write_summary") || "true") === "true";
    const uploadArtifact = (core.getInput("upload_artifact") || "true") === "true";
    const artifactName   = core.getInput("artifact_name") || "vuln-diff-artifacts";
    const graphMaxNodes  = parseInt(core.getInput("graph_max_nodes") || "150", 10);
    const reportHtml     = (core.getInput("report_html") || "true") === "true";
    const reportPdf      = (core.getInput("report_pdf") || "true") === "true";
    const titleLogo      = core.getInput("title_logo_url") || "";

    const repository = process.env.GITHUB_REPOSITORY || "";
    const nowStrUK = fmtNowUK();

    const workdir = process.cwd();
    const baseDir = path.join(workdir, "__base__");
    const headDir = path.join(workdir, "__head__");
    fs.mkdirSync(baseDir, { recursive: true });

    await sh("git fetch --all --tags --prune --force");
    const baseSha = await resolveRefToSha(baseRefInput);
    const headSha = await resolveRefToSha(headRefInput);
    if (baseSha === headSha) { core.setFailed(`Both refs resolve to the same commit (${baseSha}). base='${baseRefInput}', head='${headRefInput}'`); return; }

    let currentSha = ""; await exec.exec("bash", ["-lc", "git rev-parse HEAD"], { listeners: { stdout: d => (currentSha += d.toString()) }}); currentSha = currentSha.trim();
    await sh(`git worktree add --detach ${baseDir} ${baseSha}`);
    let headScanRoot = workdir; let createdHeadWorktree = false;
    if (currentSha !== headSha) { fs.mkdirSync(headDir, { recursive: true }); await sh(`git worktree add --detach ${headDir} ${headSha}`); headScanRoot = headDir; createdHeadWorktree = true; }

    const baseLabel = guessLabel(baseRefInput);
    const headLabel = guessLabel(headRefInput);

    if (buildCommand) { await sh(buildCommand, { cwd: baseDir }); await sh(buildCommand, { cwd: headScanRoot }); }

    const baseSbom = path.join(workdir, "sbom-base.json");
    const headSbom = path.join(workdir, "sbom-head.json");
    await generateSbomAuto(path.join(baseDir, scanPath), baseSbom);
    await generateSbomAuto(path.join(headScanRoot, scanPath), headSbom);

    const baseScan = await scanSbom(baseSbom);
    const headScan = await scanSbom(headSbom);

    // Diff (renders with branch labels)
    const d = diff(baseScan.matches || [], headScan.matches || [], minSeverity, baseLabel, headLabel);
    const diffMarkdown = renderMarkdownTable(d.news, d.removed, d.unchanged);
    const diffHtml = markdownTableToHtml(diffMarkdown);

    const baseCommit = await commitLine(baseSha);
    const headCommit = await commitLine(headSha);

    // Summary
    if (writeSummary) {
      const summary = [];
      summary.push("### Vulnerability Diff (Syft+Grype)\n");
      summary.push(`- **Base**: \`${baseLabel}\` (_input:_ \`${baseRefInput}\`) → \`${shortSha(baseSha)}\``);
      summary.push(`  - ${baseCommit}`);
      summary.push(`- **Head**: \`${headLabel}\` (_input:_ \`${headRefInput}\`) → \`${shortSha(headSha)}\``);
      summary.push(`  - ${headCommit}`);
      summary.push(`- **Min severity**: \`${minSeverity}\``);
      summary.push(`- **Counts**: NEW=${d.news.length} · REMOVED=${d.removed.length} · UNCHANGED=${d.unchanged.length}\n`);
      summary.push(diffMarkdown);
      await core.summary.addRaw(summary.join("\n")).write();
    }

    // ------------- Reporting (HTML/PDF) -------------
    let reportHtmlMainPath = "", reportHtmlLscpPath = "", reportPdfPath = "";
    try {
      const baseBomJson = JSON.parse(fs.readFileSync(baseSbom, "utf8"));
      const headBomJson = JSON.parse(fs.readFileSync(headSbom, "utf8"));
      const mermaidBase = buildMermaidGraphFromBOMImproved(baseBomJson, baseScan.matches || [], graphMaxNodes);
      const mermaidHead = buildMermaidGraphFromBOMImproved(headBomJson, headScan.matches || [], graphMaxNodes);

      // Dependency paths => markdown -> transform -> HTML
      const pathsBaseMdRaw = renderPathsMarkdownTable(buildDependencyPathsTable(baseBomJson, baseScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 }));
      const pathsHeadMdRaw = renderPathsMarkdownTable(buildDependencyPathsTable(headBomJson, headScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 }));
      const pathsBaseMd = transformDependencyPathsMarkdown(pathsBaseMdRaw);
      const pathsHeadMd = transformDependencyPathsMarkdown(pathsHeadMdRaw);
      const pathsBaseHtml = markdownTableToHtml(pathsBaseMd);
      const pathsHeadHtml = markdownTableToHtml(pathsHeadMd);

      // tool versions (best-effort; optional)
      const toolVersions = {
        cyclonedx: "auto",
        syft: "auto",
        grype: "auto",
        chartjs: "4.4.1",
        mermaid: "10.x",
        puppeteer: "24.10.2"
      };

      // Cover / Main / Landscape HTML
      const htmlCover = buildHtmlCover({ titleLogoUrl: titleLogo, repo: repository, baseLabel, headLabel, nowStr: nowStrUK });
      const htmlMain = buildHtmlMain({
        repository,
        baseLabel, baseInput: baseRefInput, baseSha, baseCommitLine: baseCommit,
        headLabel, headInput: headRefInput, headSha, headCommitLine: headCommit,
        minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        diffTableHtml: diffHtml,
        baseMatches: baseScan.matches || [],
        headMatches: headScan.matches || [],
        nowStr: nowStrUK,
        title_logo_url: titleLogo,
        toolVersions
      });
      const htmlLandscape = buildHtmlLandscape({
        baseLabel, headLabel,
        mermaidBase, mermaidHead,
        pathsBaseMd: pathsBaseHtml,
        pathsHeadMd: pathsHeadHtml
      });

      // Save HTML (optional artifacts)
      const reportHtmlMainPathLocal = path.join(workdir, "report-main.html");
      const reportHtmlLscpPathLocal = path.join(workdir, "report-landscape.html");
      fs.writeFileSync(reportHtmlMainPathLocal, htmlMain, "utf8");
      fs.writeFileSync(reportHtmlLscpPathLocal, htmlLandscape, "utf8");
      reportHtmlMainPath = reportHtmlMainPathLocal;
      reportHtmlLscpPath = reportHtmlLscpPathLocal;

      // PDFs
      if (reportPdf) {
        const pdfCover = path.join(workdir, "report-cover.pdf");
        const pdfMain  = path.join(workdir, "report-main.pdf");
        const pdfLscp  = path.join(workdir, "report-landscape.pdf");

        // Cover — no header/footer
        await renderPdfFromHtml(htmlCover, pdfCover, {
          landscape: false,
          displayHeaderFooter: false
        });

        // Main — header/footer + logo + UK time
        await renderPdfFromHtml(htmlMain, pdfMain, {
          landscape: false,
          headerMeta: {
            repo: repository,
            base: baseLabel,
            head: headLabel,
            section: "Main",
            date: nowStrUK,
            logo: titleLogo
          },
          displayHeaderFooter: true
        });

        // Appendix (landscape) — header/footer + logo + UK time
        await renderPdfFromHtml(htmlLandscape, pdfLscp, {
          landscape: true,
          headerMeta: {
            repo: repository,
            base: baseLabel,
            head: headLabel,
            section: "Appendix",
            date: nowStrUK,
            logo: titleLogo
          },
          displayHeaderFooter: true
        });

        // Merge: cover + main + appendix
        reportPdfPath = path.join(workdir, "report.pdf");
        await mergePdfs([pdfCover, pdfMain, pdfLscp], reportPdfPath);
      }
    } catch (err) {
      core.warning(`Reporting (HTML/PDF) failed: ${err && err.stack ? err.stack : err}`);
    }

    // Raw data artifacts
    const grypeBasePath = path.join(workdir, "grype-base.json");
    const grypeHeadPath = path.join(workdir, "grype-head.json");
    fs.writeFileSync(grypeBasePath, JSON.stringify(baseScan, null, 2));
    fs.writeFileSync(grypeHeadPath, JSON.stringify(headScan, null, 2));
    const diffJsonPath = path.join(workdir, "diff.json");
    fs.writeFileSync(diffJsonPath, JSON.stringify({ news: d.news, removed: d.removed, unchanged: d.unchanged }, null, 2));

    // Markdown report (debug/extra)
    const reportMdPath = path.join(workdir, "report.md");
    fs.writeFileSync(
      reportMdPath,
      buildMarkdownReport({
        baseLabel, baseInput: baseRefInput, baseSha, baseCommitLine: baseCommit,
        headLabel, headInput: headRefInput, headSha, headCommitLine: headCommit,
        minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        table: renderMarkdownTable(d.news, d.removed, d.unchanged),
        headGrype: headScan,
        headBOM: JSON.parse(fs.readFileSync(headSbom, "utf8")),
        graphMaxNodes
      }),
      "utf8"
    );

    if (uploadArtifact) {
      try {
        const client = new artifact.DefaultArtifactClient();
        const files = [
          reportMdPath,
          ...(reportHtmlMainPath ? [reportHtmlMainPath] : []),
          ...(reportHtmlLscpPath ? [reportHtmlLscpPath] : []),
          baseSbom, headSbom, grypeBasePath, grypeHeadPath, diffJsonPath
        ];
        const extra = [];
        for (const n of ["report-cover.pdf","report-main.pdf","report-landscape.pdf","report.pdf"]) {
          const p = path.join(workdir, n); if (fs.existsSync(p)) extra.push(p);
        }
        await client.uploadArtifact(artifactName, [...files, ...extra], workdir, { continueOnError: true, retentionDays: 90 });
      } catch (e) {
        core.warning(`Artifact upload failed: ${e && e.stack ? e.stack : e}`);
      }
    }

    // Cleanup
    await sh(`git worktree remove ${baseDir} --force || true`);
    // only remove if we created it
    let createdHeadWorktree = fs.existsSync(headDir) && headDir !== workdir;
    if (createdHeadWorktree) await sh(`git worktree remove ${headDir} --force || true`);

  } catch (error) {
    core.setFailed(error.message || String(error));
  }
}

run();
