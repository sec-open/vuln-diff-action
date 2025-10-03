/**
 * Action entrypoint: parse inputs, run analysis, render outputs (Markdown/HTML/PDF),
 * and set outputs/artifacts as configured.
 */

const path = require("path");
const fs = require("fs/promises");
const core = require("@actions/core");
const github = require("@actions/github");

const { analyzeRefs } = require("./analyze");
const { renderPrTableMarkdown, renderSummaryTableMarkdown } = require("./render/markdown");
const { renderHtmlBundle } = require("./render/html");
// pdf renderer would require a puppeteer wrapper (out of scope in stub)
const pdfRenderer = require("./render/pdf");

async function run() {
  try {
    core.startGroup("Analyze branches");
    const baseRef = core.getInput("base_ref", { required: true });
    const headRef = core.getInput("head_ref", { required: true });
    const writeSummary = core.getBooleanInput("write_summary") || true;
    const reportHtml = core.getBooleanInput("report_html") || true;
    const reportPdf = core.getBooleanInput("report_pdf") || true;
    const uploadArtifact = core.getBooleanInput("upload_artifact") || true;
    const artifactName = core.getInput("artifact_name") || "vuln-diff-report";
    const minSeverity = core.getInput("min_severity") || "LOW";
    const repoPath = core.getInput("path") || ".";
    const graphMaxNodes = Number(core.getInput("graph_max_nodes") || 150);
    const titleLogoUrl = core.getInput("title_logo_url") || "";
    const token = core.getInput("github_token");
    const slackWebhookUrl = core.getInput("slack_webhook_url");

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

    // --- Markdown renderers ---
    core.startGroup("Rendering Summary");
    if (writeSummary) {
      const summaryMd = renderSummaryTableMarkdown(diffJson, baseJson, headJson, actionMeta, "BASE", "HEAD");
      await core.summary.addRaw(summaryMd, true).write();

      // PR comment (if token and event is pull_request)
      const ctx = github.context;
      if (token && ctx.payload?.pull_request) {
        const octo = github.getOctokit(token);
        const prNumber = ctx.payload.pull_request.number;
        const prMd = renderPrTableMarkdown(diffJson, "BASE", "HEAD");
        await octo.rest.issues.createComment({
          owner: ctx.repo.owner,
          repo: ctx.repo.repo,
          issue_number: prNumber,
          body: prMd,
        });
      } else {
        core.info("INFO_PR_COMMENT_SKIPPED: No token or not a PR event.");
      }
    }
    core.endGroup();

    // --- HTML bundle ---
    core.startGroup("Rendering HTML");
    if (reportHtml) {
      const htmlOut = path.join(outDir, "html");
      await renderHtmlBundle({
        outputDir: htmlOut,
        baseJson,
        headJson,
        diffJson,
        meta: { generatedAt: new Date().toISOString(), repo: process.env.GITHUB_REPOSITORY, base: { ref: baseRef }, head: { ref: headRef } },
      });
      core.setOutput("report_html_path", htmlOut);
    }
    core.endGroup();

    // --- PDF ---
    core.startGroup("Rendering PDF");
    if (reportPdf) {
      // Stub: just assemble HTML and write to file; Puppeteer integration to be added.
      const cover = await pdfRenderer.buildCoverHtml({ titleLogoUrl, baseLabel: baseRef, headLabel: headRef, baseJson, headJson });
      const main = await pdfRenderer.buildMainHtml({ baseJson, headJson, diffJson, params: { min_severity: minSeverity }});
      const landscape = await pdfRenderer.buildLandscapeHtml({ diffJson, graphMaxNodes });
      const html = `<!doctype html><meta charset="utf-8"><style>${basicCss()}</style>${cover}${main}${landscape}`;
      const pdfHtmlPath = path.join(outDir, "report.html");
      await fs.writeFile(pdfHtmlPath, html, "utf8");
      // In a future step, call Puppeteer to export PDF at outDir/report.pdf
      core.setOutput("report_pdf_path", pdfHtmlPath.replace(/\.html$/, ".pdf"));
    }
    core.endGroup();

    // Outputs for JSON (optional)
    core.setOutput("base_json_path", path.join(outDir, "base.json"));
    core.setOutput("head_json_path", path.join(outDir, "head.json"));
    core.setOutput("diff_json_path", path.join(outDir, "diff.json"));
    // --- Upload artifact (PDF + HTML bundle) ---
    const artifact = require("@actions/artifact");
    if (uploadArtifact) {
      try {
        const client = artifact.create();

        // Collect files to upload
        const files = [];
        // PDF (si se generó)
        const pdfPathOutput = core.getOutput("report_pdf_path");
        if (pdfPathOutput) {
          files.push(pdfPathOutput);
        }

        // HTML bundle (directorio completo). La lib requiere pasar archivos; recolectamos recursivamente.
        if (htmlOutDir) {
          const gather = async (dir) => {
            const out = [];
            const walk = async (d) => {
              const entries = await fs.readdir(d, { withFileTypes: true });
              for (const ent of entries) {
                const full = path.join(d, ent.name);
                if (ent.isDirectory()) await walk(full);
                else if (ent.isFile()) out.push(full);
              }
            };
            await walk(dir);
            return out;
          };
          const htmlFiles = await gather(htmlOutDir);
          files.push(...htmlFiles);
        }

        if (files.length === 0) {
          core.warning("No files to upload as artifact.");
        } else {
          // Choose a common root directory so files keep relative paths in the artifact.
          // Use the workspace or the outDir as root.
          const rootDirectory = process.cwd();
          const resp = await client.uploadArtifact(artifactName, files, rootDirectory, {
            continueOnError: true,
            compressionLevel: 6
          });
          core.info(`Artifact uploaded: ${resp?.artifactName || artifactName}`);
        }
      } catch (e) {
        core.warning(`Artifact upload failed: ${e?.message || e}`);
      }
    }

  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

function basicCss() {
  return `
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#111; }
  .cover { display:flex; flex-direction:column; align-items:center; justify-content:center; height:90vh; gap:8px; }
  .logo { margin-bottom:16px; }
  .report { padding:24px; }
  .toc { text-align:center; margin:24px 0; }
  .toc ol { display:inline-block; text-align:left; }
  .cards { display:flex; gap:12px; margin:12px 0; }
  .card { border:1px solid #ddd; padding:12px; border-radius:8px; min-width:120px; text-align:center; }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  table.table { width:100%; border-collapse: collapse; }
  table.table th, table.table td { border:1px solid #ddd; padding:6px 8px; }
  table.kv { border-collapse: collapse; }
  table.kv th, table.kv td { border:1px solid #ddd; padding:4px 6px; }
  .chart-placeholder, .table-placeholder, .mermaid { border:1px dashed #bbb; padding:16px; min-height:140px; }
  @page { size: A4; margin: 16mm; }
  `;
}

if (require.main === module) {
  run();
}

module.exports = { run };
