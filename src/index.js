// src/index.js
// Generate SBOMs, scan with Grype, compute diff, write summary,
// build Markdown + HTML reports, export optional PDFs, upsert a reusable PR comment,
// and (NEW) send a Slack notification when NEW vulns are introduced.
//
// Notes:
// - Comments are in English.
// - Margins are reduced in PDFs so charts/graphs fit better.
// - setup_script: prepare each worktree (e.g., clone opencga & make symlink) before build/SBOM.
// - PR comment: single comment per PR, updated on every run.
// - Slack: reads webhook from input `slack_webhook_url` OR env `SLACK_SECURITY_WEBHOOK_URL`.
//
// Required runtime: Node 20 (native fetch is available, but we use https for compatibility).

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

// ----------------------- shell + git helpers -----------------------
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

// ----------------------- time / repo helpers -----------------------
function fmtNow() {
  const pad = n => String(n).padStart(2, "0");
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ----------------------- Puppeteer helpers -----------------------
async function ensureChromeForPuppeteer(version = "24.10.2") {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || `${os.homedir()}/.cache/puppeteer`;
  const cmd = `PUPPETEER_CACHE_DIR=${cacheDir} npx --yes puppeteer@${version} browsers install chrome`;
  await sh(cmd);
  return cacheDir;
}

async function renderPdfFromHtml(html, outPath, { landscape = false } = {}) {
  const puppeteer = require("puppeteer");
  await ensureChromeForPuppeteer();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");
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

// ----------------------- setup_script runner -----------------------
async function runSetupScriptIfAny(setupScript, role, dir, envExtras) {
  if (!setupScript || !setupScript.trim()) return;
  await sh(setupScript, {
    cwd: dir,
    env: { ...process.env, ...envExtras, WORKTREE_ROLE: role, WORKTREE_DIR: dir }
  });
}

// ----------------------- PR comment helpers -----------------------
async function upsertPrComment({ token, owner, repo, prNumber, marker, body }) {
  const octokit = github.getOctokit(token);
  const { data: comments } = await octokit.rest.issues.listComments({
    owner, repo, issue_number: prNumber, per_page: 100,
  });
  const existing = comments.find(c => (c.body || "").includes(marker));
  if (existing) {
    await octokit.rest.issues.updateComment({
      owner, repo, comment_id: existing.id, body,
    });
    return { action: "updated", id: existing.id };
  } else {
    const { data: created } = await octokit.rest.issues.createComment({
      owner, repo, issue_number: prNumber, body,
    });
    return { action: "created", id: created.id };
  }
}

// ----------------------- Slack helpers (https) -----------------------
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

// ----------------------- main -----------------------
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
    const reportPdf      = (core.getInput("report_pdf") || "false") === "true";
    const setupScript    = core.getInput("setup_script") || "";

    // PR comment inputs
    const prCommentEnabled = (core.getInput("pr_comment") || "false") === "true";
    const prMarker         = core.getInput("pr_comment_marker") || "<!-- vuln-diff-action:comment -->";
    const ghTokenInput     = core.getInput("github_token") || "";

    // Slack inputs
    const slackInputWebhook = core.getInput("slack_webhook_url") || "";
    const slackEnvWebhook   = process.env.SLACK_SECURITY_WEBHOOK_URL || "";
    const slackWebhookUrl   = slackInputWebhook || slackEnvWebhook; // prefer explicit input, fallback to env

    const repository = process.env.GITHUB_REPOSITORY || ""; // e.g., "owner/repo"
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
    await exec.exec("bash", ["-lc", "git rev-parse HEAD"], {
      listeners: { stdout: d => (currentSha += d.toString()) },
    });
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

    // ---- run setup_script in each worktree BEFORE build/SBOM ----
    const baseLabel = guessLabel(baseRefInput);
    const headLabel = guessLabel(headRefInput);
    const envExtras = {
      REPOSITORY: repository,
      BASE_LABEL: baseLabel,
      HEAD_LABEL: headLabel,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ""
    };
    await runSetupScriptIfAny(setupScript, "BASE", baseDir, envExtras);
    await runSetupScriptIfAny(setupScript, "HEAD", headScanRoot, envExtras);

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

    // Diff (show real branch names instead of BASE/HEAD)
    const d = diff(baseScan.matches || [], headScan.matches || [], minSeverity, baseLabel, headLabel);
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

    // Job Summary (short)
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

    // ---------------- PR reusable comment ----------------
    const ghToken = ghTokenInput || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    if (prCommentEnabled) {
      const ctx = github.context;
      const isPr = (ctx.eventName === "pull_request" || ctx.eventName === "pull_request_target") && ctx.payload?.pull_request;
      if (!isPr) {
        core.info("PR comment requested but this run is not a pull_request event; skipping comment.");
      } else if (!ghToken) {
        core.warning("PR comment requested but no github_token provided; skipping comment.");
      } else {
        const prNumber = ctx.payload.pull_request.number;
        const [owner, repo] = (process.env.GITHUB_REPOSITORY || "").split("/");
        const onlyNewTable = renderMarkdownTable(d.news, [], []);
        const maxSev = (arr => {
          const order = ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"];
          let idx = 999;
          for (const s of arr) idx = Math.min(idx, order.indexOf((s || "UNKNOWN").toUpperCase()));
          return ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"][Math.max(0, idx)];
        })(d.news.map(x => x.severity));
        const icon = d.news.length === 0 ? "✅" : (maxSev === "CRITICAL" ? "🛑" : "🚨");

        const lines = [];
        if (d.news.length > 0) {
          lines.push(`## ${icon} New vulnerabilities introduced (${d.news.length})`);
          lines.push("");
        } else {
          lines.push(`## ${icon} No new vulnerabilities introduced`);
          lines.push("");
        }
        lines.push(`- **Base**: \`${baseLabel}\` → \`${shortSha(baseSha)}\``);
        lines.push(`- **Head**: \`${headLabel}\` → \`${shortSha(headSha)}\``);
        lines.push(`- **Minimum severity**: \`${minSeverity}\``);
        lines.push("");
        if (d.news.length > 0) {
          lines.push(onlyNewTable);
          lines.push("");
        }
        lines.push(`_Updated automatically by vuln-diff-action._`);
        lines.push(prMarker);

        try {
          const res = await upsertPrComment({
            token: ghToken, owner, repo, prNumber, marker: prMarker, body: lines.join("\n")
          });
          core.info(`PR comment ${res.action} (id=${res.id})`);
        } catch (e) {
          core.warning(`Failed to upsert PR comment: ${e.message || e}`);
        }
      }
    }

    // ---------------- Slack notification  ----------------

    if (slackWebhookUrl && d.news.length > 0) {
      // Severity ordering + icons
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

      // Build advisory URL
      function advisoryUrl(id, fallbackUrl) {
        if (!id) return fallbackUrl || "";
        if (/^GHSA-/i.test(id)) return `https://github.com/advisories/${id}`;
        if (/^CVE-/i.test(id))  return `https://nvd.nist.gov/vuln/detail/${id}`;
        return fallbackUrl || `https://www.google.com/search?q=${encodeURIComponent(id + " vulnerability")}`;
      }

      // Package label
      function pkgLabel(entry) {
        if (entry.pv) return entry.pv; // e.g. "name:version"
        const name = entry.pkg || entry.package || entry.packageName || entry.name || "";
        const ver  = entry.version || entry.packageVersion || entry.ver || "";
        if (name && ver) return `${name}:${ver}`;
        if (name) return name;
        return entry.artifact || "unknown";
      }

      const LIMIT = 20;
      const sorted = [...d.news].sort(bySeverityThenId);
      const shown = sorted.slice(0, LIMIT);
      const extra = d.news.length - shown.length;

      const bullets = shown.map((e) => {
        const id = e.vulnId || e.id;
        const url = advisoryUrl(id, e.url);
        const link = url ? `<${url}|${id}>` : `${id}`;
        const pkg = pkgLabel(e);
        const sev = (e.severity || "UNKNOWN").toUpperCase();
        return `• ${sevIcon(sev)} *${sev}* — ${link} → \`${pkg}\``;
      });

      const prLink = (() => {
        const ctx = github.context;
        if (ctx.eventName === "pull_request" && ctx.payload?.pull_request?.html_url) return ctx.payload.pull_request.html_url;
        if (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY) {
          return `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`;
        }
        return "";
      })();

      const header =
        `*:rotating_light: ${d.news.length} new vulnerabilities introduced*\n` +
        `• Repo: \`${repository}\`\n` +
        `• Base: \`${baseLabel}\` → \`${shortSha(baseSha)}\`\n` +
        `• Head: \`${headLabel}\` → \`${shortSha(headSha)}\`` +
        (prLink ? `\n• PR: ${prLink}` : "");

      const footer = extra > 0
        ? `\n…and *${extra} more*. Download the artifact or open the PR for full details.`
        : "";

      const text = [header, "", "*New Vulnerabilities:*", bullets.join("\n"), footer].filter(Boolean).join("\n");

      try {
        const res = await sendSlackMessage(slackWebhookUrl, { text });
        core.info(`Slack notification sent (status ${res.status})`);
      } catch (e) {
        core.warning(`Failed to send Slack message: ${e.message || e}`);
      }
    }

    // ---------------- Reports / artifacts ----------------
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
      nowStr
    });

    const htmlLandscape = buildHtmlLandscape({
      baseLabel,
      headLabel,
      mermaidBase, mermaidHead,
      pathsBaseMd, pathsHeadMd
    });

    const reportHtmlMainPath = path.join(workdir, "report-main.html");
    const reportHtmlLscpPath = path.join(workdir, "report-landscape.html");
    fs.writeFileSync(reportHtmlMainPath, htmlMain, "utf8");
    fs.writeFileSync(reportHtmlLscpPath, htmlLandscape, "utf8");

    let reportPdfPath = "";
    let pdfs = [];
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

    const grypeBasePath = path.join(workdir, "grype-base.json");
    const grypeHeadPath = path.join(workdir, "grype-head.json");
    fs.writeFileSync(grypeBasePath, JSON.stringify(baseScan, null, 2));
    fs.writeFileSync(grypeHeadPath, JSON.stringify(headScan, null, 2));
    const diffJsonPath = path.join(workdir, "diff.json");
    fs.writeFileSync(diffJsonPath, JSON.stringify({ news: d.news, removed: d.removed, unchanged: d.unchanged }, null, 2));

    if (uploadArtifact) {
      const client = new artifact.DefaultArtifactClient();
      const files = [
        reportMdPath, reportHtmlMainPath, reportHtmlLscpPath,
        baseSbom, headSbom, grypeBasePath, grypeHeadPath, diffJsonPath,
        ...pdfs
      ];
      await client.uploadArtifact(artifactName, files, workdir, { continueOnError: true, retentionDays: 90 });
    }

    // Cleanup worktrees
    await sh(`git worktree remove ${baseDir} --force || true`);
    if (createdHeadWorktree) await sh(`git worktree remove ${headDir} --force || true`);
  } catch (error) {
    core.setFailed(error.message || String(error));
  }
}

run();
