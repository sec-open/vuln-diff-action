// src/index.js
// v2 main: enhanced HTML/PDF reporting (no history), PR comment, Slack alert with severity icons.
// Generates SBOMs (CycloneDX for Maven or Syft dir), scans with Grype, computes diff, writes summary,
// builds HTML (portrait) + HTML (landscape) and exports PDFs (cover without header/footer + main + appendix) then merges into report.pdf.

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
const { buildHtmlMain, buildHtmlLandscape } = require("./report-html");

// ---------------------- small utils ----------------------

function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

async function sh(cmd, opts = {}) { return exec.exec("bash", ["-lc", cmd], opts); }

async function tryRevParse(ref) {
  let out = "";
  try {
    await exec.exec("bash", ["-lc", `git rev-parse ${ref}`], {
      listeners: { stdout: d => (out += d.toString()) },
    });
    return out.trim();
  } catch { return null; }
}

function isSha(ref) { return /^[0-9a-f]{7,40}$/i.test(ref || ""); }

async function resolveRefToSha(ref) {
  if (isSha(ref)) {
    const sha = await tryRevParse(ref);
    if (sha) return sha;
    throw new Error(`Input '${ref}' looks like a SHA but does not exist locally.`);
  }
  let sha = await tryRevParse(ref);
  if (sha) return sha;
  sha = await tryRevParse(`refs/remotes/origin/${ref}`);
  if (sha) return sha;
  let remotes = "";
  await exec.exec("bash", ["-lc", "git remote"], { listeners: { stdout: d => (remotes += d.toString()) } });
  if (remotes.split(/\s+/).includes("upstream")) {
    sha = await tryRevParse(`refs/remotes/upstream/${ref}`);
    if (sha) return sha;
  }
  try {
    await sh(`git fetch origin ${ref}:${ref} --tags --prune`);
    sha = await tryRevParse(ref);
    if (sha) return sha;
  } catch {}
  throw new Error(`Cannot resolve ref '${ref}' to a commit SHA. Ensure the branch or SHA exists in this runner.`);
}

function shortSha(sha) { return (sha || "").substring(0, 12); }

function guessLabel(ref) {
  const m = (ref || "").match(/^(?:refs\/remotes\/\w+\/|origin\/)?(.+)$/);
  return m ? m[1] : (ref || "");
}

async function commitLine(sha) {
  let out = "";
  await exec.exec("bash", ["-lc", `git --no-pager log -1 --format="%H %s" ${sha}`], {
    listeners: { stdout: d => (out += d.toString()) },
  });
  return out.trim();
}

function fmtNow() {
  const pad = n => String(n).padStart(2, "0");
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------------------- Markdown table -> HTML (diff + dependency paths) ----------------------

// Markdown table -> HTML (header/separator + inline **bold**, `code`, GHSA/CVE links)
function markdownTableToHtml(md) {
  if (!md || !/\|/.test(md)) return `<div class="muted">No data</div>`;
  const lines = md.split(/\r?\n/).filter(l => l.trim().length > 0);

  const headerIdx = lines.findIndex(l => /\|/.test(l));
  if (headerIdx < 0 || headerIdx + 1 >= lines.length) return `<div class="muted">No data</div>`;
  const header = lines[headerIdx];
  const sep = lines[headerIdx + 1];
  if (!/^-{3,}|:?-{3,}:?/.test(sep.replace(/\|/g, "").trim())) {
    return `<pre class="md">${escapeHtml(md)}</pre>`;
  }

  const rows = [];
  const normalizeCells = (line) =>
    line.split("|")
        .map(c => c.trim())
        .filter((_,i,arr)=> !(i===0 || i===arr.length-1));

  const headerCells = normalizeCells(header);
  rows.push({ type: "th", cells: headerCells });

  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!/\|/.test(lines[i])) continue;
    rows.push({ type: "td", cells: normalizeCells(lines[i]) });
  }

  const linkify = (txt) => {
    // GHSA-xxxx-xxxx-xxxx
    txt = txt.replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, (_m,id) =>
      `<a href="https://github.com/advisories/${id}" target="_blank" rel="noopener">${escapeHtml(id)}</a>`
    );
    // CVE-YYYY-NNNN+
    txt = txt.replace(/\b(CVE-\d{4}-\d{4,7})\b/g, (_m,id) =>
      `<a href="https://nvd.nist.gov/vuln/detail/${id}" target="_blank" rel="noopener">${escapeHtml(id)}</a>`
    );
    return txt;
  };

  // inline formatting: **bold**, `code`, then linkify
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

// Transform dependency-paths markdown table: move Depth0 -> Module, shift Depth1..n left, strip literal 'pkg' in Module
function transformDependencyPathsMarkdown(md) {
  if (!md || !/\|/.test(md)) return md;

  const lines = md.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => /\|/.test(l));
  if (headerIdx < 0 || headerIdx + 1 >= lines.length) return md;

  const cells = (line) =>
    line.split("|").map(s => s.trim())
      .filter((_,i,arr)=> !(i===0 || i===arr.length-1));

  const header = cells(lines[headerIdx]);

  const colIdx = {
    severity: header.findIndex(h => /^severity$/i.test(h)),
    module:   header.findIndex(h => /^module$/i.test(h)),
    pkg:      header.findIndex(h => /^package$/i.test(h)),
    depth0:   header.findIndex(h => /^depth0$/i.test(h)),
  };

  // Depth columns ordered
  const otherDepths = header
    .map((h,i)=> ({h, i}))
    .filter(x => /^depth\d+$/i.test(x.h))
    .sort((a,b)=> parseInt(a.h.slice(5)) - parseInt(b.h.slice(5)));

  // New header: Severity | Module | Package | Depth0..Depth(n-1)
  const newHeader = [];
  if (colIdx.severity >= 0) newHeader.push(header[colIdx.severity]);
  newHeader.push("Module");
  if (colIdx.pkg >= 0) newHeader.push(header[colIdx.pkg]);
  for (const d of otherDepths) {
    const n = parseInt(d.h.slice(5),10);
    if (!isNaN(n) && n >= 1) newHeader.push(`Depth${n-1}`);
  }

  const out = [];
  out.push("| " + newHeader.join(" | ") + " |");
  out.push("| " + newHeader.map(()=> "---").join(" | ") + " |");

  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!/\|/.test(lines[i])) continue;
    const row = cells(lines[i]);
    const get = (idx) => (idx >= 0 && idx < row.length ? row[idx] : "");

    const severity = get(colIdx.severity);
    const moduleFromDepth0 = get(colIdx.depth0).replace(/^`?pkg`?$/i, "").trim() || get(colIdx.module).replace(/^`?pkg`?$/i, "").trim();
    const moduleClean = moduleFromDepth0 || "";
    const pkg = get(colIdx.pkg);

    const shifted = [];
    for (const d of otherDepths) {
      const n = parseInt(d.h.slice(5),10);
      if (!isNaN(n) && n >= 1) shifted.push(get(d.i));
    }

    const cellsOut = [];
    if (colIdx.severity >= 0) cellsOut.push(severity);
    cellsOut.push(moduleClean);
    if (colIdx.pkg >= 0) cellsOut.push(pkg);
    for (const s of shifted) cellsOut.push(s);

    out.push("| " + cellsOut.join(" | ") + " |");
  }

  return out.join("\n");
}

// ---------------------- Puppeteer (Chrome) + PDF helpers ----------------------

async function ensureChromeForPuppeteer(version = "24.10.2") {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || `${os.homedir()}/.cache/puppeteer`;
  const cmd = `PUPPETEER_CACHE_DIR=${cacheDir} npx --yes puppeteer@${version} browsers install chrome`;
  await sh(cmd);
  return cacheDir;
}

/**
 * Render an HTML string to PDF.
 * - displayHeaderFooter: false for cover, true for main/appendix
 * - headerMeta: { repo, base, head, section, date, logo }
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

    // Chart.js and Mermaid rendering inside the page
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
          if (elBase && elHead) {
            doughnut(elBase.getContext("2d"), data.base);
            doughnut(elHead.getContext("2d"), data.head);
          }
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
    const meta = headerMeta || {};
    const footerLogo = meta.logo ? `<img src="${escapeHtml(meta.logo)}" style="height:10px; vertical-align:middle; margin-right:8px"/>` : "";

    const headerHtml = `
      <div style="font-size:9px; color:#6b7280; width:100%; padding:0 10mm;">
        <span style="float:left;">
          Security Report — ${escapeHtml(meta.repo || "")}${meta.base && meta.head ? ` — ${escapeHtml(meta.base)} vs ${escapeHtml(meta.head)}` : ""}
        </span>
        <span style="float:right;">${escapeHtml(meta.section || "")}</span>
      </div>`;

    const footerHtml = `
      <div style="font-size:9px; color:#6b7280; width:100%; padding:0 10mm;">
        <span style="float:left;">${footerLogo}${escapeHtml(meta.date || "")}</span>
        <span style="float:right;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`;

    const portraitMargins = { top: displayHeaderFooter ? "18mm" : "10mm", right: "8mm", bottom: displayHeaderFooter ? "15mm" : "10mm", left: "8mm" };
    const landscapeMargins = { top: displayHeaderFooter ? "16mm" : "8mm", right: "8mm", bottom: displayHeaderFooter ? "12mm" : "8mm", left: "8mm" };

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
    await browser.close();
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

// ---------------------- PR comment utils ----------------------

async function upsertPrComment(octokit, { owner, repo, issue_number, marker, body }) {
  const { data: comments } = await octokit.rest.issues.listComments({ owner, repo, issue_number, per_page: 100 });
  const existing = comments.find(c => typeof c.body === "string" && c.body.includes(marker));
  const payload = { owner, repo, issue_number, body };
  if (existing) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    return { updated: true, id: existing.id };
  } else {
    const res = await octokit.rest.issues.createComment(payload);
    return { created: true, id: res.data.id };
  }
}

// ---------------------- Slack ----------------------

async function sendSlackMessage(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const url = new URL(webhookUrl);
    const options = {
      method: "POST",
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    };
    const req = https.request(options, res => {
      let body = "";
      res.on("data", d => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ---------------------- main ----------------------

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

    // Reporting
    const reportHtml     = (core.getInput("report_html") || "true") === "true";
    const reportPdf      = (core.getInput("report_pdf") || "true") === "true";
    const titleLogo      = core.getInput("title_logo_url") || "";

    // PR comment
    const prCommentEnabled = (core.getInput("pr_comment") || "false") === "true";
    const prMarker         = core.getInput("pr_comment_marker") || "<!-- vuln-diff-action:comment -->";
    const ghTokenInput     = core.getInput("github_token") || "";

    // Slack
    const slackInputWebhook = core.getInput("slack_webhook_url") || "";
    const slackEnvWebhook   = process.env.SLACK_SECURITY_WEBHOOK_URL || "";
    const slackWebhookUrl   = slackInputWebhook || slackEnvWebhook;
    const slackChannel      = core.getInput("slack_channel") || "";

    const repository = process.env.GITHUB_REPOSITORY || "";
    const nowStr = fmtNow();

    const workdir = process.cwd();
    const baseDir = path.join(workdir, "__base__");
    const headDir = path.join(workdir, "__head__");
    fs.mkdirSync(baseDir, { recursive: true });

    // Ensure refs local
    await sh("git fetch --all --tags --prune --force");

    // Resolve SHAs
    const baseSha = await resolveRefToSha(baseRefInput);
    const headSha = await resolveRefToSha(headRefInput);
    if (baseSha === headSha) {
      core.setFailed(`Both refs resolve to the same commit (${baseSha}). base='${baseRefInput}', head='${headRefInput}'`);
      return;
    }

    // Current workspace SHA
    let currentSha = "";
    await exec.exec("bash", ["-lc", "git rev-parse HEAD"], { listeners: { stdout: d => (currentSha += d.toString()) } });
    currentSha = currentSha.trim();

    // Worktrees
    await sh(`git worktree add --detach ${baseDir} ${baseSha}`);
    let headScanRoot = workdir;
    let createdHeadWorktree = false;
    if (currentSha !== headSha) {
      fs.mkdirSync(headDir, { recursive: true });
      await sh(`git worktree add --detach ${headDir} ${headSha}`);
      headScanRoot = headDir;
      createdHeadWorktree = true;
    }

    // Labels
    const baseLabel = guessLabel(baseRefInput);
    const headLabel = guessLabel(headRefInput);

    // Optional build
    if (buildCommand) {
      await sh(buildCommand, { cwd: baseDir });
      await sh(buildCommand, { cwd: headScanRoot });
    }

    // SBOMs
    const baseSbom = path.join(workdir, "sbom-base.json");
    const headSbom = path.join(workdir, "sbom-head.json");
    await generateSbomAuto(path.join(baseDir, scanPath), baseSbom);
    await generateSbomAuto(path.join(headScanRoot, scanPath), headSbom);

    // Scans
    const baseScan = await scanSbom(baseSbom);
    const headScan = await scanSbom(headSbom);

    // Diff and Markdown table (pass real branch labels)
    const d = diff(
      baseScan.matches || [],
      headScan.matches || [],
      minSeverity,
      baseLabel,
      headLabel
    );

    const diffMarkdown = renderMarkdownTable(d.news, d.removed, d.unchanged);
    const diffHtml = markdownTableToHtml(diffMarkdown);

    // Commit lines
    const baseCommit = await commitLine(baseSha);
    const headCommit = await commitLine(headSha);

    // Outputs
    core.setOutput("new_count", String(d.news.length));
    core.setOutput("removed_count", String(d.removed.length));
    core.setOutput("unchanged_count", String(d.unchanged.length));
    core.setOutput("diff_markdown_table", diffMarkdown);
    core.setOutput("diff_json", JSON.stringify(d));
    core.setOutput("base_sha", baseSha);
    core.setOutput("head_sha", headSha);
    core.setOutput("base_input", baseRefInput);
    core.setOutput("head_input", headRefInput);

    // Summary (job summary)
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

    // PR comment (reusable)
    if (prCommentEnabled && github.context.eventName === "pull_request") {
      const token = ghTokenInput || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
      if (!token) {
        core.warning("PR comment requested but no github_token provided.");
      } else {
        const octokit = github.getOctokit(token);
        const { owner, repo } = github.context.repo;
        const prNumber = github.context.payload.pull_request.number;
        const siren = d.news.length > 0 ? "🚨" : "✅";
        const body = `${prMarker}
${siren} **${d.news.length} new vulnerabilities introduced**
- Repo: ${repository}
- Base: ${baseLabel} → \`${shortSha(baseSha)}\`
- Head: ${headLabel} → \`${shortSha(headSha)}\`

${renderMarkdownTable(d.news, [], [])}`;
        await upsertPrComment(octokit, { owner, repo, issue_number: prNumber, marker: prMarker, body });
      }
    }

    // Slack (severity-colored list)
    if (slackWebhookUrl && d.news.length > 0) {
      const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
      const sevIcon = (s) => {
        const x = (s || "UNKNOWN").toUpperCase();
        return x === "CRITICAL" ? "🔴"
          : x === "HIGH"       ? "🟠"
          : x === "MEDIUM"     ? "🟡"
          : x === "LOW"        ? "🟢"
          : "⚪";
      };
      const bySeverityThenId = (a, b) => {
        const sa = (a.severity || "UNKNOWN").toUpperCase();
        const sb = (b.severity || "UNKNOWN").toUpperCase();
        const oa = order[sa] ?? 9, ob = order[sb] ?? 9;
        if (oa !== ob) return oa - ob;
        return String(a.vulnId || a.id || "").localeCompare(String(b.vulnId || b.id || ""));
      };
      function advisoryUrl(id, fallbackUrl) {
        if (!id) return fallbackUrl || "";
        if (/^GHSA-/i.test(id)) return `https://github.com/advisories/${id}`;
        if (/^CVE-/i.test(id))  return `https://nvd.nist.gov/vuln/detail/${id}`;
        return fallbackUrl || `https://www.google.com/search?q=${encodeURIComponent(id + " vulnerability")}`;
      }
      function pkgLabel(entry) {
        if (entry.pv) return entry.pv;
        const name = entry.pkg || entry.package || entry.packageName || entry.name || "";
        const ver  = entry.version || entry.packageVersion || entry.ver || "";
        return ver ? `${name}:${ver}` : name;
      }
      const top = [...d.news].sort(bySeverityThenId).slice(0, 10);
      const bullet = top.map(n =>
        `• ${sevIcon(n.severity)} <${advisoryUrl(n.vulnId, n.url)}|${n.vulnId}> → ${pkgLabel(n)}`
      ).join("\n");
      const text = `:rotating_light: ${d.news.length} new vulnerabilities introduced
• Repo: ${repository}
• Base: ${baseLabel} → ${shortSha(baseSha)}
• Head: ${headLabel} → ${shortSha(headSha)}
${bullet}`;
      const payload = slackChannel
        ? { channel: slackChannel, text }
        : { text };
      try {
        const res = await sendSlackMessage(slackWebhookUrl, payload);
        core.info(`Slack notified: status=${res.status}`);
      } catch (e) {
        core.warning(`Slack notification failed: ${e && e.stack ? e.stack : e}`);
      }
    }

    // Markdown report (artifact/debug)
    const reportMdPath = path.join(workdir, "report.md");
    fs.writeFileSync(
      reportMdPath,
      buildMarkdownReport({
        baseLabel, baseInput: baseRefInput, baseSha, baseCommitLine: baseCommit,
        headLabel, headInput: headRefInput, headSha, headCommitLine: headCommit,
        minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        table: diffMarkdown,
        headGrype: headScan,
        headBOM: JSON.parse(fs.readFileSync(headSbom, "utf8")),
        graphMaxNodes
      }),
      "utf8"
    );

    // ---------------------- Reporting (HTML/PDF) ----------------------
    let reportHtmlMainPath = "", reportHtmlLscpPath = "", reportPdfPath = "", pdfs = [];
    try {
      // Data for landscape appendix
      const baseBomJson = JSON.parse(fs.readFileSync(baseSbom, "utf8"));
      const headBomJson = JSON.parse(fs.readFileSync(headSbom, "utf8"));
      const mermaidBase = buildMermaidGraphFromBOMImproved(baseBomJson, baseScan.matches || [], graphMaxNodes);
      const mermaidHead = buildMermaidGraphFromBOMImproved(headBomJson, headScan.matches || [], graphMaxNodes);

      // Dependency paths (transform + to HTML)
      const pathsBaseMdRaw = renderPathsMarkdownTable(
        buildDependencyPathsTable(baseBomJson, baseScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 })
      );
      const pathsHeadMdRaw = renderPathsMarkdownTable(
        buildDependencyPathsTable(headBomJson, headScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 })
      );
      const pathsBaseMd = transformDependencyPathsMarkdown(pathsBaseMdRaw);
      const pathsHeadMd = transformDependencyPathsMarkdown(pathsHeadMdRaw);
      const pathsBaseHtml = markdownTableToHtml(pathsBaseMd);
      const pathsHeadHtml = markdownTableToHtml(pathsHeadMd);

      // Build HTMLs
      const htmlMain = buildHtmlMain({
        repository,
        baseLabel, baseInput: baseRefInput, baseSha, baseCommitLine: baseCommit,
        headLabel, headInput: headRefInput, headSha, headCommitLine: headCommit,
        minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        diffTableHtml: diffHtml,
        baseMatches: baseScan.matches || [],
        headMatches: headScan.matches || [],
        nowStr,
        title_logo_url: titleLogo
      });

      const htmlLandscape = buildHtmlLandscape({
        baseLabel, headLabel,
        mermaidBase, mermaidHead,
        pathsBaseMd: pathsBaseHtml,
        pathsHeadMd: pathsHeadHtml
      });

      // Write HTMLs to disk
      const reportHtmlMainPathLocal = path.join(workdir, "report-main.html");
      const reportHtmlLscpPathLocal = path.join(workdir, "report-landscape.html");
      fs.writeFileSync(reportHtmlMainPathLocal, htmlMain, "utf8");
      fs.writeFileSync(reportHtmlLscpPathLocal, htmlLandscape, "utf8");
      reportHtmlMainPath = reportHtmlMainPathLocal;
      reportHtmlLscpPath = reportHtmlLscpPathLocal;

      // PDFs: cover (no header/footer), main (with header/footer), appendix (with header/footer)
      if (reportPdf) {
        const pdfCover = path.join(workdir, "report-cover.pdf");
        const pdfMain  = path.join(workdir, "report-main.pdf");
        const pdfLscp  = path.join(workdir, "report-landscape.pdf");

        // Cover: use the same htmlMain, but render without header/footer to ensure cover page is clean.
        await renderPdfFromHtml(htmlMain, pdfCover, {
          landscape: false,
          displayHeaderFooter: false
        });

        // Main: with header/footer (logo in footer)
        await renderPdfFromHtml(htmlMain, pdfMain, {
          landscape: false,
          headerMeta: {
            repo: repository,
            base: baseLabel,
            head: headLabel,
            section: "Main",
            date: nowStr,
            logo: titleLogo
          },
          displayHeaderFooter: true
        });

        // Landscape appendix: with header/footer (logo in footer)
        await renderPdfFromHtml(htmlLandscape, pdfLscp, {
          landscape: true,
          headerMeta: {
            repo: repository,
            base: baseLabel,
            head: headLabel,
            section: "Appendix",
            date: nowStr,
            logo: titleLogo
          },
          displayHeaderFooter: true
        });

        // Merge cover + main + appendix
        reportPdfPath = path.join(workdir, "report.pdf");
        await mergePdfs([pdfCover, pdfMain, pdfLscp], reportPdfPath);

        pdfs = [pdfCover, pdfMain, pdfLscp, reportPdfPath];
        core.info(`PDFs generated: ${pdfs.join(", ")}`);
      }
    } catch (err) {
      core.warning(`Reporting (HTML/PDF) failed: ${err && err.stack ? err.stack : err}`);
    }

    // ---------------------- Raw data artifacts ----------------------
    const grypeBasePath = path.join(workdir, "grype-base.json");
    const grypeHeadPath = path.join(workdir, "grype-head.json");
    fs.writeFileSync(grypeBasePath, JSON.stringify(baseScan, null, 2));
    fs.writeFileSync(grypeHeadPath, JSON.stringify(headScan, null, 2));
    const diffJsonPath = path.join(workdir, "diff.json");
    fs.writeFileSync(diffJsonPath, JSON.stringify({ news: d.news, removed: d.removed, unchanged: d.unchanged }, null, 2));

    // Upload artifacts
    if (uploadArtifact) {
      try {
        const client = new artifact.DefaultArtifactClient();
        const files = [
          reportMdPath,
          ...(reportHtmlMainPath ? [reportHtmlMainPath] : []),
          ...(reportHtmlLscpPath ? [reportHtmlLscpPath] : []),
          baseSbom, headSbom, grypeBasePath, grypeHeadPath, diffJsonPath
        ];
        // Include PDFs if produced
        const extra = [];
        try {
          const cand = ["report-cover.pdf","report-main.pdf","report-landscape.pdf","report.pdf"]
            .map(n => path.join(workdir, n))
            .filter(p => fs.existsSync(p));
          extra.push(...cand);
        } catch {}
        await client.uploadArtifact(artifactName, [...files, ...extra], workdir, { continueOnError: true, retentionDays: 90 });
      } catch (e) {
        core.warning(`Artifact upload failed: ${e && e.stack ? e.stack : e}`);
      }
    }

    // Cleanup worktrees
    await sh(`git worktree remove ${baseDir} --force || true`);
    if (createdHeadWorktree) await sh(`git worktree remove ${headDir} --force || true`);
  } catch (error) {
    core.setFailed(error.message || String(error));
  }
}

run();
