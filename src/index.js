// v2 main: enhanced HTML/PDF reporting (no history), PR comment, Slack alert with severity icons.
// Generates SBOMs (CycloneDX for Maven or Syft dir), scans with Grype, computes diff, writes summary,
// builds HTML (portrait) + HTML (landscape) and exports PDFs then merges into report.pdf.

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

// -------------- utils -----------------------
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
function guessLabel(ref) { const m = (ref || "").match(/^(?:refs\/remotes\/\w+\/|origin\/)?(.+)$/); return m ? m[1] : (ref || ""); }
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

// Puppeteer for PDF
async function ensureChromeForPuppeteer(version = "24.10.2") {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || `${os.homedir()}/.cache/puppeteer`;
  const cmd = `PUPPETEER_CACHE_DIR=${cacheDir} npx --yes puppeteer@${version} browsers install chrome`;
  await sh(cmd);
  return cacheDir;
}
async function renderPdfFromHtml(html, outPath, { landscape = false } = {}) {
  const puppeteer = require("puppeteer");
  await ensureChromeForPuppeteer(); // descarga/asegura Chrome gestionado
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--no-sandbox","--disable-setuid-sandbox"]
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");

    // Detect if this is main (with chart placeholders) or landscape (mermaid)
    const hasBaseCanvas = await page.$("#chartBase");
    if (hasBaseCanvas) {
      // Load Chart.js and render donuts
      await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" });
      await page.evaluate(() => {
        const elBase = document.getElementById("chartBase");
        const elHead = document.getElementById("chartHead");
        const data = window.__vulnChartData || { labels:[], base:[], head:[] };
        const colors = ["#b91c1c","#ea580c","#ca8a04","#16a34a","#6b7280"]; // CRIT,HIGH,MED,LOW,UNK

        function doughnut(ctx, values){
          return new window.Chart(ctx, {
            type: "doughnut",
            data: { labels: data.labels, datasets: [{ data: values, backgroundColor: colors }] },
            options: { plugins:{ legend:{ position:"bottom" } }, cutout: "60%" }
          });
        }
        doughnut(elBase.getContext("2d"), data.base);
        doughnut(elHead.getContext("2d"), data.head);
      });
    } else {
      // Landscape: render Mermaid blocks to SVG (if any)
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
              // scale a bit to fit page
              holder.style.transform = "scale(0.9)";
              holder.style.transformOrigin = "top left";
              target.appendChild(holder);
              block.remove();
            }
          } catch(e) {
            console.warn("Mermaid render failed", e);
          }
        });
      }
    }

    // Export PDF
    const portraitMargins = { top: "10mm", right: "8mm", bottom: "10mm", left: "8mm" };
    const landscapeMargins = { top: "8mm", right: "6mm", bottom: "8mm", left: "6mm" };
    await page.pdf({
      path: outPath,
      format: "A4",
      landscape,
      printBackground: true,
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

// PR comment utils
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

// Slack
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

    // Diff and Markdown table
    // Pass baseLabel and headLabel so that the table shows real branch names (e.g. develop, TASK-7908)
    const d = diff(
      baseScan.matches || [],
      headScan.matches || [],
      minSeverity,
      baseLabel,
      headLabel
    );

    const table = renderMarkdownTable(d.news, d.removed, d.unchanged);


    // Commit lines
    const baseCommit = await commitLine(baseSha);
    const headCommit = await commitLine(headSha);

    // Outputs
    core.setOutput("new_count", String(d.news.length));
    core.setOutput("removed_count", String(d.removed.length));
    core.setOutput("unchanged_count", String(d.unchanged.length));
    core.setOutput("diff_markdown_table", table);
    core.setOutput("diff_json", JSON.stringify(d));
    core.setOutput("base_sha", baseSha);
    core.setOutput("head_sha", headSha);
    core.setOutput("base_input", baseRefInput);
    core.setOutput("head_input", headRefInput);

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
      summary.push(table);
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
        table,
        headGrype: headScan,
        headBOM: JSON.parse(fs.readFileSync(headSbom, "utf8")),
        graphMaxNodes
      }),
      "utf8"
    );

    // ===== Reporting (HTML/PDF) guarded to avoid hard-fail =====
    let reportHtmlMainPath = "", reportHtmlLscpPath = "", reportPdfPath = "", pdfs = [];
    try {
      // Landscape data
      const baseBomJson = JSON.parse(fs.readFileSync(baseSbom, "utf8"));
      const headBomJson = JSON.parse(fs.readFileSync(headSbom, "utf8"));
      const mermaidBase = buildMermaidGraphFromBOMImproved(baseBomJson, baseScan.matches || [], graphMaxNodes);
      const mermaidHead = buildMermaidGraphFromBOMImproved(headBomJson, headScan.matches || [], graphMaxNodes);
      const pathsBaseMd = renderPathsMarkdownTable(
        buildDependencyPathsTable(baseBomJson, baseScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 })
      );
      const pathsHeadMd = renderPathsMarkdownTable(
        buildDependencyPathsTable(headBomJson, headScan.matches || [], { maxPathsPerPkg: 3, maxDepth: 10 })
      );

      // HTMLs
      const repositoryEnv = process.env.GITHUB_REPOSITORY || repository;
      const htmlMain = buildHtmlMain({
        repository: repositoryEnv,
        baseLabel, baseInput: baseRefInput, baseSha, baseCommitLine: baseCommit,
        headLabel, headInput: headRefInput, headSha, headCommitLine: headCommit,
        minSeverity,
        counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
        diffTableMarkdown: table,
        baseMatches: baseScan.matches || [],
        headMatches: headScan.matches || [],
        nowStr,
        title_logo_url: titleLogo
      });
      const htmlLandscape = buildHtmlLandscape({
        baseLabel, headLabel, mermaidBase, mermaidHead, pathsBaseMd, pathsHeadMd
      });

      const reportHtmlMainPathLocal = path.join(workdir, "report-main.html");
      const reportHtmlLscpPathLocal = path.join(workdir, "report-landscape.html");
      fs.writeFileSync(reportHtmlMainPathLocal, htmlMain, "utf8");
      fs.writeFileSync(reportHtmlLscpPathLocal, htmlLandscape, "utf8");
      reportHtmlMainPath = reportHtmlMainPathLocal;
      reportHtmlLscpPath = reportHtmlLscpPathLocal;

      // PDFs
      if (reportPdf) {
        const pdfMain = path.join(workdir, "report-main.pdf");
        const pdfLscp = path.join(workdir, "report-landscape.pdf");
        await renderPdfFromHtml(htmlMain, pdfMain, { landscape: false });
        await renderPdfFromHtml(htmlLandscape, pdfLscp, { landscape: true });
        reportPdfPath = path.join(workdir, "report.pdf");
        await mergePdfs([pdfMain, pdfLscp], reportPdfPath);
        pdfs = [pdfMain, pdfLscp, reportPdfPath];
        core.info(`PDFs generated: ${pdfs.join(", ")}`);
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

    // Upload artifacts
    if (uploadArtifact) {
      try {
        const client = new artifact.DefaultArtifactClient();
        const files = [
          reportMdPath,
          ...(reportHtmlMainPath ? [reportHtmlMainPath] : []),
          ...(reportHtmlLscpPath ? [reportHtmlLscpPath] : []),
          baseSbom, headSbom, grypeBasePath, grypeHeadPath, diffJsonPath,
          ...pdfs
        ];
        await client.uploadArtifact(artifactName, files, workdir, { continueOnError: true, retentionDays: 90 });
      } catch (e) {
        core.warning(`Artifact upload failed: ${e && e.stack ? e.stack : e}`);
      }
    }

    // Cleanup
    await sh(`git worktree remove ${baseDir} --force || true`);
    if (createdHeadWorktree) await sh(`git worktree remove ${headDir} --force || true`);
  } catch (error) {
    core.setFailed(error.message || String(error));
  }
}

run();
