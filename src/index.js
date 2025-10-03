/**
 * Action entrypoint:
 * - Analyze refs, render Markdown/HTML/PDF
 * - Upsert PR comment using a stable marker (configurable)
 * - Upload artifact (PDF + HTML bundle) via @actions/artifact
 * All comments in English per project guideline.
 */

const path = require("path");
const fs = require("fs/promises");
const core = require("@actions/core");
const github = require("@actions/github");
const artifact = require("@actions/artifact");

const { analyzeRefs } = require("./analyze");
const { renderPrTableMarkdown, renderSummaryTableMarkdown } = require("./render/markdown");
const { renderHtmlBundle } = require("./render/html");
const { renderPdfReport } = require("./render/pdf");

async function run() {
  try {
    core.startGroup("Analyze branches");
    const baseRef = core.getInput("base_ref", { required: true });
    const headRef = core.getInput("head_ref", { required: true });

    const writeSummary = core.getBooleanInput("write_summary");   // defaults handled by action.yml
    const reportHtml   = core.getBooleanInput("report_html");
    const reportPdf    = core.getBooleanInput("report_pdf");
    const uploadArtifact = core.getBooleanInput("upload_artifact");

    const artifactName = core.getInput("artifact_name") || "vulnerability-diff";
    const minSeverity  = core.getInput("min_severity") || "LOW";
    const repoPath     = core.getInput("path") || ".";
    const graphMaxNodes = Number(core.getInput("graph_max_nodes") || 150);
    const titleLogoUrl = core.getInput("title_logo_url") || "";
    const token        = core.getInput("github_token") || "";
    const prMarker     = core.getInput("pr_comment_marker") || "<!-- vuln-diff-action:comment -->";
    // slack_webhook_url available if you later wire Slack notifications
    // const slackWebhookUrl = core.getInput("slack_webhook_url");

    const actionMeta = {
      name: "sec-open/vuln-diff-action",
      version: process.env.npm_package_version || "",
      commit: process.env.GITHUB_SHA || "",
      ref: process.env.GITHUB_REF || "",
    };

    const outDir = path.resolve(process.cwd(), "vuln-diff-output");
    await fs.mkdir(outDir, { recursive: true });

    const { baseJson, headJson, diffJson } = await analyzeRefs({
      baseRef, headRef, pathRoot: repoPath, minSeverity, outDir,
      actionMeta, repo: process.env.GITHUB_REPOSITORY || "",
    });
    core.endGroup();

    // ---------------- Markdown (Summary + PR comment) ----------------
    core.startGroup("Rendering Markdown");
    if (writeSummary) {
      const summaryMd = renderSummaryTableMarkdown(
        diffJson, baseJson, headJson, actionMeta, "BASE", "HEAD"
      );
      await core.summary.addRaw(summaryMd, true).write();

      const ctx = github.context;
      if (token && ctx.payload?.pull_request) {
        const prNumber = ctx.payload.pull_request.number;
        const prMdTable = renderPrTableMarkdown(
          diffJson, baseJson, headJson, "BASE", "HEAD"
        );
        const body = `${prMarker}\n${prMdTable}`;
        const octo = github.getOctokit(token);
        await upsertPrComment(octo, ctx.repo, prNumber, prMarker, body);
      } else {
        core.info("INFO_PR_COMMENT_SKIPPED: No token or not a PR event.");
      }
    }
    core.endGroup();

    // ---------------- HTML bundle ----------------
    core.startGroup("Rendering HTML");
    let htmlOutDir = "";
    if (reportHtml) {
      htmlOutDir = path.join(outDir, "html-bundle");
      await renderHtmlBundle({
        outputDir: htmlOutDir,
        baseJson,
        headJson,
        diffJson,
        meta: {
          generatedAt: new Date().toISOString(),
          repo: process.env.GITHUB_REPOSITORY,
          base: { ref: baseRef },
          head: { ref: headRef }
        },
      });
      core.setOutput("report_html_path", htmlOutDir);
    }
    core.endGroup();

    // ---------------- PDF (Puppeteer) ----------------
    core.startGroup("Rendering PDF");
    let pdfPathOutput = "";
    if (reportPdf) {
      const { pdfPath } = await renderPdfReport({
        outDir,
        baseJson,
        headJson,
        diffJson,
        titleLogoUrl,
        baseLabel: baseRef,
        headLabel: headRef,
        graphMaxNodes
      });
      pdfPathOutput = pdfPath;
      core.setOutput("report_pdf_path", pdfPathOutput);
    }
    core.endGroup();

    // Emit JSON paths for downstream steps
    core.setOutput("base_json_path", path.join(outDir, "base.json"));
    core.setOutput("head_json_path", path.join(outDir, "head.json"));
    core.setOutput("diff_json_path", path.join(outDir, "diff.json"));

    // ---------------- Upload artifact (PDF + HTML bundle) ----------------
    core.startGroup("Uploading artifact");
    if (uploadArtifact) {
      const client = artifact.create();
      const files = [];

      if (pdfPathOutput) files.push(pdfPathOutput);

      if (htmlOutDir) {
        const walk = async (dir, acc) => {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) await walk(full, acc);
            else if (ent.isFile()) acc.push(full);
          }
        };
        const htmlFiles = [];
        await walk(htmlOutDir, htmlFiles);
        files.push(...htmlFiles);
      }

      if (files.length) {
        await client.uploadArtifact(artifactName, files, process.cwd(), {
          continueOnError: true,
          compressionLevel: 6
        });
        core.info(`Artifact uploaded: ${artifactName} (${files.length} files)`);
      } else {
        core.info("No files to upload as artifact.");
      }
    }
    core.endGroup();

  } catch (err) {
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    core.setFailed(msg);
  }
}

/**
 * Find an existing PR comment containing the marker, update it; otherwise create it.
 * This keeps a single rolling comment per PR.
 */
async function upsertPrComment(octo, repo, prNumber, marker, body) {
  const { owner, repo: r } = repo;
  const list = await octo.paginate(octo.rest.issues.listComments, {
    owner, repo: r, issue_number: prNumber, per_page: 100
  });
  const found = list.find(c => typeof c.body === "string" && c.body.includes(marker));
  if (found) {
    await octo.rest.issues.updateComment({ owner, repo: r, comment_id: found.id, body });
  } else {
    await octo.rest.issues.createComment({ owner, repo: r, issue_number: prNumber, body });
  }
}

if (require.main === module) run();
module.exports = { run, upsertPrComment };
