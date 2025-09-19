// src/index.js
// Generate SBOMs, scan with Grype, compute diff, write summary,
// build Markdown + HTML reports, and export PDFs:
//  - main.pdf (portrait): cover, TOC, intro, summary, dual pies, diff table
//  - landscape.pdf (landscape): dependency graphs (base/head) + dependency paths (base/head)
// Then merge into report.pdf using pdf-lib.
//
// Notes:
// - Comments are in English.
// - Margins: we reduced PDF margins (portrait and landscape) so graphs/tables fit better.
// - Cover page now shows repository ("owner/repo") and a timestamp footer (dd/mm/yyyy HH:MM:ss).
// - The "Summary" section (after Introduction) contains clear per-branch details.
// - setup_script input to prepare each worktree (e.g., clone opencga and create a symlink).
// - NEW: Optional reusable PR comment (single upserted comment per PR) with NEW vulnerabilities.

const core = require("@actions/core");
const exec = require("@actions/exec");
const artifact = require("@actions/artifact");
const github = require("@actions/github"); // <-- NEW
const fs = require("fs");
const path = require("path");
const os = require("os");
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
  // Ensure a Chrome binary is available in CI environment
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
    // Tighter margins to help content fit on one page (especially graphs)
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

// ----------------------- PR comment helpers (NEW) -----------------------
async function upsertPrComment({ token, owner, repo, prNumber, marker, body }) {
  const octokit = github.getOctokit(token);
  // List recent comments and find existing one with marker
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

    // NEW: PR comment inputs
    const prCommentEnabled = (core.getInput("pr_comment") || "false") === "true";
    const prMarker         = core.getInput("pr_comment_marker") || "<!-- vuln-diff-action:comment -->";
    const ghTokenInput     = core.getInput("github_token") || "";

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

    // ---------------- PR reusable comment (NEW) ----------------
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
        // Build a compact table with only NEW vulnerabilities
        const onlyNewTable = renderMarkdownTable(d.news, [], []);
        const bodyLines = [];
        if (d.news.length > 0) {
          bodyLines.push(`### 🚨 New vulnerabilities introduced (${d.news.length})`);
          bodyLines.push("");
        } else {
          bodyLines.push(`### ✅ No new vulnerabilities introduced`);
          bodyLines.push("");
        }
        bodyLines.push(`- **Base**: \`${baseLabel}\` → \`${shortSha(baseSha)}\``);
        bodyLines.push(`- **Head**: \`${headLabel}\` → \`${shortSha(headSha)}\``);
        bodyLines.push(`- **Minimum severity**: \`${minSeverity}\``);
        bodyLines.push("");
        if (d.news.length > 0) {
          bodyLines.push(onlyNewTable);
          bodyLines.push("");
        }
        bodyLines.push(`_Updated automatically by vuln-diff-action._`);
        bodyLines.push(prMarker);
        const commentBody = bodyLines.join("\n");

        try {
          const res = await upsertPrComment({
            token: ghToken, owner, repo, prNumber, marker: prMarker, body: commentBody
          });
          core.info(`PR comment ${res.action} (id=${res.id})`);
        } catch (e) {
          core.warning(`Failed to upsert PR comment: ${e.message || e}`);
        }
      }
    }
    // ----------------------------------------------------------

    // Simple Markdown report (kept for artifact/debug)
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

    // Data for HTML/PDF
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

    // HTMLs (main portrait + landscape sections)
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

    // PDFs (optional)
    let reportPdfPath = "";
    let pdfs = [];
    if (reportPdf) {
      const pdfMain = path.join(workdir, "report-main.pdf");
      const pdfLscp = path.join(workdir, "report-landscape.pdf");

      // Portrait main (reduced margins already set in renderPdfFromHtml)
      await renderPdfFromHtml(htmlMain, pdfMain, { landscape: false });
      // Landscape sections (graphs/paths) with tighter margins to keep title + graph on the same page
      await renderPdfFromHtml(htmlLandscape, pdfLscp, { landscape: true });

      // Merge into final report.pdf
      reportPdfPath = path.join(workdir, "report.pdf");
      await mergePdfs([pdfMain, pdfLscp], reportPdfPath);
      pdfs = [pdfMain, pdfLscp, reportPdfPath];
      core.info(`PDFs generated: ${pdfs.join(", ")}`);
    }

    // Save raw scans/diff for artifact
    const grypeBasePath = path.join(workdir, "grype-base.json");
    const grypeHeadPath = path.join(workdir, "grype-head.json");
    fs.writeFileSync(grypeBasePath, JSON.stringify(baseScan, null, 2));
    fs.writeFileSync(grypeHeadPath, JSON.stringify(headScan, null, 2));
    const diffJsonPath = path.join(workdir, "diff.json");
    fs.writeFileSync(diffJsonPath, JSON.stringify({ news: d.news, removed: d.removed, unchanged: d.unchanged }, null, 2));

    // Upload artifact bundle
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
