// src/index.js
// Main entrypoint for sec-open/vuln-diff-action.
// Pipeline: analyze two refs -> persist JSONs (base/head/diff) -> render (MD/HTML/PDF) -> write job summary -> optional PR comment.

const core = require("@actions/core");
const exec = require("@actions/exec");
const artifact = require("@actions/artifact");
const path = require("path");
const fs = require("fs");

const { analyzeBranches } = require("./analyze");
const { renderAllReports } = require("./report");
const { renderSummaryTableMarkdown } = require("./render/markdown");
const git = require("./git");
const { maybePostPrComment } = require("./pr_comment");

async function ensureDir(p) {
  await fs.promises.mkdir(p, { recursive: true });
  return p;
}

async function writeJson(file, obj) {
  await ensureDir(path.dirname(file));
  await fs.promises.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
}

async function uploadFilesAsArtifact(name, files) {
  const client = artifact.create();
  const rootDir = process.cwd();
  return client.uploadArtifact(name, files, rootDir, { continueOnError: false });
}

async function run() {
  try {
    // ---- Inputs -------------------------------------------------------------
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

    const baseRef = core.getInput("base_ref") || core.getInput("base-ref");
    const headRef = core.getInput("head_ref") || core.getInput("head-ref");
    if (!baseRef || !headRef) {
      throw new Error("Inputs 'base_ref' and 'head_ref' are required.");
    }

    const minSeverity = (core.getInput("min_severity") || core.getInput("min-severity") || "LOW").toUpperCase();
    const writeSummary = (core.getInput("write_summary") || "true") === "true";
    const reportHtml = (core.getInput("report_html") || "true") === "true";
    const reportPdf = (core.getInput("report_pdf") || "true") === "true";
    const uploadArtifact = (core.getInput("upload_artifact") || "true") === "true";

    // PR comment controls (already declared in your action.yml)
    const prComment = (core.getInput("pr_comment") || "false") === "true";
    const prCommentMarker = core.getInput("pr_comment_marker") || "";
    const ghToken =
      core.getInput("github_token") ||
      process.env.GITHUB_TOKEN ||
      process.env.GH_TOKEN ||
      "";

    // Optional custom artifact name
    const artifactName = core.getInput("artifact_name") || "vuln-diff-report";

    // ---- Analyze ------------------------------------------------------------
    core.startGroup("Analyze branches (Syft/Grype)");
    const analysis = await analyzeBranches({
      workspace,
      baseRef,
      headRef,
      minSeverity,
    });
    core.endGroup();

    // analysis should provide:
    // - base: { jsonPath, ref, commit, message, countsBySeverity, ... }
    // - head: { jsonPath, ref, commit, message, countsBySeverity, ... }
    // - diff: { news, removed, unchanged, ... }
    // If your analyze.js returns raw objects, adjust the persistence below.

    // Persist normalized JSONs to known locations (if not already persisted inside analyze)
    const outDir = path.join(workspace, "vuln-diff-output");
    await ensureDir(outDir);

    // Prefer paths provided by analyze; otherwise write here
    const baseJson = analysis?.base?.jsonPath || path.join(outDir, "base.json");
    const headJson = analysis?.head?.jsonPath || path.join(outDir, "head.json");
    const diffJson = analysis?.diff?.jsonPath || path.join(outDir, "diff.json");

    if (!analysis?.base?.jsonPath) await writeJson(baseJson, analysis.base);
    if (!analysis?.head?.jsonPath) await writeJson(headJson, analysis.head);
    if (!analysis?.diff?.jsonPath) await writeJson(diffJson, analysis.diff);

    const baseLabel = analysis?.base?.ref || baseRef;
    const headLabel = analysis?.head?.ref || headRef;
    const baseSha = analysis?.base?.commit || "";
    const headSha = analysis?.head?.commit || "";

    // ---- Render reports (MD/HTML/PDF) --------------------------------------
    core.startGroup("Render reports (Markdown/HTML/PDF)");
    const outputs = await renderAllReports({
      workspace,
      analysis,
      baseLabel,
      headLabel,
      baseJson,
      headJson,
      diffJson,
      reportHtml,
      reportPdf,
      minSeverity,
    });
    core.endGroup();

    // outputs can include: { htmlPath, pdfPath, mdPath, ... }
    // Do not assume; guard when uploading.

    // ---- Job Summary --------------------------------------------------------
    if (writeSummary) {
      const diffObj = analysis.diff;
      const mdTable = renderSummaryTableMarkdown(diffObj, baseLabel, headLabel);

      const lines = [];
      lines.push("### Vulnerability Diff (Syft + Grype)");
      if (baseSha) lines.push(`- **Base**: \`${baseLabel}\` → \`${git.shortSha(baseSha)}\``);
      if (headSha) lines.push(`- **Head**: \`${headLabel}\` → \`${git.shortSha(headSha)}\``);
      lines.push(`- **Min severity**: \`${minSeverity}\``);
      lines.push(
        `- **Counts**: NEW=${diffObj.news?.length ?? 0} · REMOVED=${diffObj.removed?.length ?? 0} · UNCHANGED=${diffObj.unchanged?.length ?? 0}\n`
      );
      lines.push(mdTable);

      await core.summary.addRaw(lines.join("\n")).write();
      core.info("Wrote job summary.");
    }

    // ---- Optional PR comment (for GHSA hovercards) -------------------------
    await maybePostPrComment({
      token: ghToken,
      enabled: prComment,
      marker: prCommentMarker,
      tableMarkdown: renderSummaryTableMarkdown(analysis.diff, baseLabel, headLabel),
      baseLabel,
      headLabel,
    });

    // ---- Upload artifacts ---------------------------------------------------
    if (uploadArtifact) {
      const files = [];
      if (fs.existsSync(baseJson)) files.push(baseJson);
      if (fs.existsSync(headJson)) files.push(headJson);
      if (fs.existsSync(diffJson)) files.push(diffJson);
      if (outputs?.htmlPath && fs.existsSync(outputs.htmlPath)) files.push(outputs.htmlPath);
      if (outputs?.pdfPath && fs.existsSync(outputs.pdfPath)) files.push(outputs.pdfPath);
      if (outputs?.mdPath && fs.existsSync(outputs.mdPath)) files.push(outputs.mdPath);

      if (files.length) {
        await uploadFilesAsArtifact(artifactName, files);
        core.info(`Uploaded artifact '${artifactName}' with ${files.length} files.`);
      } else {
        core.info("No files to upload as artifact.");
      }
    }

    // ---- Outputs ------------------------------------------------------------
    if (outputs?.htmlPath) core.setOutput("report_html_path", outputs.htmlPath);
    if (outputs?.pdfPath) core.setOutput("report_pdf_path", outputs.pdfPath);
    if (outputs?.mdPath) core.setOutput("report_md_path", outputs.mdPath);
    core.setOutput("base_json_path", baseJson);
    core.setOutput("head_json_path", headJson);
    core.setOutput("diff_json_path", diffJson);

  } catch (err) {
    core.setFailed(err?.message || String(err));
  }
}

run();
