// src/index.js
// Orchestrator for the 3-phase pipeline: analyze → store → render (md/html/pdf). // Comments in English.

const core = require("@actions/core");
const exec = require("@actions/exec");
const artifact = require("@actions/artifact");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { analyzeOneRef, makeDiff } = require("./analyze");
const { persistAll } = require("./storage");
const { renderDiffTableMarkdown, linkifyIdsMarkdown } = require("./render/markdown");
const { writeHtmlBundle, markdownTableToHtml } = require("./render/html");
const {
  buildCoverHtml,
  buildMainHtml,
  buildLandscapeHtml,
  htmlToPdf,
  mergePdfs,
} = require("./render/pdf");
const {
  buildMermaidGraphFromBOMImproved,
  renderPathsMarkdownTable,
  buildDependencyPathsTable,
} = require("./report"); // you already had these

const git = require("./git");

// small helpers
async function sh(cmd, opts = {}) {
  return exec.exec("bash", ["-lc", cmd], opts);
} // kept for non-git shell uses

function shortSha(s) {
  return (s || "").slice(0, 12);
} // legacy; replaced by git.shortSha in new code

function guessLabel(ref) {
  const m = (ref || "").match(/^(?:refs\/remotes\/\w+\/|origin\/)?(.+)$/);
  return m ? m[1] : ref || "";
} // legacy; replaced by git.guessLabel

function nowUK() {
  try {
    const f = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
    const m = f.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : f;
  } catch {
    const d = new Date(),
      p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(
      d.getHours()
    )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
}

function listFilesRec(dir) {
  const out = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d)) {
      const p = path.join(d, e),
        st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  })(dir);
  return out;
}

async function run() {
  try {
    const baseRefInput = core.getInput("base_ref", { required: true });
    const headRefInput = core.getInput("head_ref", { required: true });
    const scanPath = core.getInput("path") || ".";
    const buildCommand = core.getInput("build_command") || "";
    const minSeverity = core.getInput("min_severity") || "LOW";
    const writeSummary = (core.getInput("write_summary") || "true") === "true";
    const reportHtml = (core.getInput("report_html") || "true") === "true";
    const reportPdf = (core.getInput("report_pdf") || "true") === "true";
    const uploadArtifact = (core.getInput("upload_artifact") || "true") === "true";
    const artifactName = core.getInput("artifact_name") || "vulnerability-diff";
    const titleLogoUrl = core.getInput("title_logo_url") || "";
    const graphMaxNodes = parseInt(core.getInput("graph_max_nodes") || "150", 10);
    const repository = process.env.GITHUB_REPOSITORY || "";

    const workdir = process.cwd();
    const baseDir = path.join(workdir, "__base__");
    const headDir = path.join(workdir, "__head__");

    fs.mkdirSync(baseDir, { recursive: true });

    await git.sh("git fetch --all --tags --prune --force");
    await git.ensureRefLocal(baseRefInput);
    await git.ensureRefLocal(headRefInput);

    const baseSha = await git.resolveRefToSha(baseRefInput);
    const headSha = await git.resolveRefToSha(headRefInput);

    if (baseSha === headSha) {
      core.setFailed(
        `Both refs resolve to the same commit (${baseSha}).\nbase='${baseRefInput}', head='${headRefInput}'`
      );
      return;
    }

    let currentSha = "";
    await exec.exec("bash", ["-lc", "git rev-parse HEAD"], {
      listeners: { stdout: (d) => (currentSha += d.toString()) },
    });
    currentSha = currentSha.trim();

    await git.addWorktree(baseDir, baseSha);

    let headScanRoot = workdir;
    let createdHeadWorktree = false;
    if (currentSha !== headSha) {
      fs.mkdirSync(headDir, { recursive: true });
      await git.addWorktree(headDir, headSha);
      headScanRoot = headDir;
      createdHeadWorktree = true;
    }

    const baseLabel = git.guessLabel(baseRefInput);
    const headLabel = git.guessLabel(headRefInput);

    if (buildCommand) {
      await sh(buildCommand, { cwd: baseDir });
      await sh(buildCommand, { cwd: headScanRoot });
    }

    // Phase 1 — Analysis
    const baseSbomPath = path.join(workdir, "sbom-base.json");
    const headSbomPath = path.join(workdir, "sbom-head.json");

    const baseObj = await analyzeOneRef(baseLabel, baseDir, scanPath, baseSbomPath);
    const headObj = await analyzeOneRef(headLabel, headScanRoot, scanPath, headSbomPath);

    const diffObj = makeDiff(baseObj.items, headObj.items, minSeverity);

    // Phase 2 — Storage
    const stored = persistAll(workdir, baseObj, headObj, diffObj);

    // Summary (markdown only)
    if (writeSummary) {
      const md = renderDiffTableMarkdown(diffObj, baseLabel, headLabel);
      const out = [];
      out.push("### Vulnerability Diff (Syft+Grype)");
      out.push(`- **Base**: \`${baseLabel}\` → \`${git.shortSha(baseSha)}\``);
      out.push(`- **Head**: \`${headLabel}\` → \`${git.shortSha(headSha)}\``);
      out.push(`- **Min severity**: \`${minSeverity}\``);
      out.push(
        `- **Counts**: NEW=${diffObj.news.length} · REMOVED=${diffObj.removed.length} · UNCHANGED=${diffObj.unchanged.length}\n`
      );
      out.push(md);
      await core.summary.addRaw(out.join("\n")).write();
    }

    // Phase 3 — Renderers
    // HTML bundle (independent)
    if (reportHtml) {
      writeHtmlBundle(
        workdir,
        {
          repository,
          baseLabel,
          headLabel,
          baseSha,
          headSha,
          generatedAt: nowUK(),
          titleLogoUrl,
        },
        {
          // Data not needed here because bundle will fetch base.json/head.json/diff.json from /html
        }
      );
    }

    // PDF (independent)
    if (reportPdf) {
      // Build mermaid + paths from the stored base/head JSONs
      const baseJson = JSON.parse(fs.readFileSync(stored.basePath, "utf8"));
      const headJson = JSON.parse(fs.readFileSync(stored.headPath, "utf8"));
      const baseGrype = baseJson.grype || {};
      const headGrype = headJson.grype || {};
      const baseBom = JSON.parse(fs.readFileSync(baseObj.sbomPath, "utf8"));
      const headBom = JSON.parse(fs.readFileSync(headObj.sbomPath, "utf8"));

      const mermaidBase = buildMermaidGraphFromBOMImproved(
        baseBom,
        baseGrype.matches || [],
        graphMaxNodes
      );
      const mermaidHead = buildMermaidGraphFromBOMImproved(
        headBom,
        headGrype.matches || [],
        graphMaxNodes
      );

      // dependency paths (strictly for PDF; not reusing html)
      // IMPORTANT: buildDependencyPathsTable returns an OBJECT { rows, depthCols } (see src/report.js).
      // We must pass that object directly to renderPathsMarkdownTable.
      const pathsBaseObj = buildDependencyPathsTable(
        baseBom,
        baseGrype.matches || [],
        { maxPathsPerPkg: 3, maxDepth: 10 }
      );
      const pathsHeadObj = buildDependencyPathsTable(
        headBom,
        headGrype.matches || [],
        { maxPathsPerPkg: 3, maxDepth: 10 }
      );

      const pathsBaseMd = renderPathsMarkdownTable(
        pathsBaseObj || { rows: [], depthCols: [] }
      );
      const pathsHeadMd = renderPathsMarkdownTable(
        pathsHeadObj || { rows: [], depthCols: [] }
      );

      const diffMd = renderDiffTableMarkdown(diffObj, baseLabel, headLabel);
      const diffHtml = markdownTableToHtml(diffMd);
      const pathsBaseHtml = markdownTableToHtml(pathsBaseMd);
      const pathsHeadHtml = markdownTableToHtml(pathsHeadMd);

      // cover
      const coverHtml = buildCoverHtml({
        repository,
        baseLabel,
        headLabel,
        titleLogoUrl,
        generatedAt: nowUK(),
      });

      // main
      const main = buildMainHtml({
        repository,
        base: { label: baseLabel, sha: baseSha },
        head: { label: headLabel, sha: headSha },
        counts: {
          new: diffObj.news.length,
          removed: diffObj.removed.length,
          unchanged: diffObj.unchanged.length,
        },
        minSeverity,
        diffTableHtml: diffHtml,
        logo: titleLogoUrl,
      });

      // appendix (landscape)
      const appendix = buildLandscapeHtml({
        baseLabel,
        headLabel,
        pathsBaseHtml,
        pathsHeadHtml,
        mermaidBase,
        mermaidHead,
      });

      const coverPdf = path.join(workdir, "report-cover.pdf");
      const mainPdf = path.join(workdir, "report-main.pdf");
      const landscapePdf = path.join(workdir, "report-landscape.pdf");
      const mergedPdf = path.join(workdir, "report.pdf");

      await htmlToPdf(coverHtml, coverPdf, { displayHeaderFooter: false });
      await htmlToPdf(main.body, mainPdf, {
        displayHeaderFooter: true,
        headerTemplate: main.header,
        footerTemplate: main.footer,
      });
      await htmlToPdf(appendix.body, landscapePdf, {
        displayHeaderFooter: true,
        headerTemplate: appendix.header,
        footerTemplate: "",
        landscape: true,
        margin: { top: "14mm", right: "10mm", bottom: "12mm", left: "10mm" },
      });

      await mergePdfs([coverPdf, mainPdf, landscapePdf], mergedPdf);
    }

    // Upload artifacts
    if (uploadArtifact) {
      try {
        const client = new artifact.DefaultArtifactClient();
        const files = [
          stored.basePath,
          stored.headPath,
          stored.diffPath,
          path.join(workdir, "sbom-base.json"),
          path.join(workdir, "sbom-head.json"),
        ];
        for (const n of [
          "report-cover.pdf",
          "report-main.pdf",
          "report-landscape.pdf",
          "report.pdf",
        ]) {
          const p = path.join(workdir, n);
          if (fs.existsSync(p)) files.push(p);
        }
        const htmlDir = path.join(workdir, "html");
        if (fs.existsSync(htmlDir)) files.push(...listFilesRec(htmlDir));

        await client.uploadArtifact(
          core.getInput("artifact_name") || "vulnerability-diff",
          files,
          workdir,
          { continueOnError: true, retentionDays: 90 }
        );
      } catch (e) {
        core.warning("Artifact upload failed: " + (e?.stack || String(e)));
      }
    }

    core.setOutput("new_count", String(diffObj.news.length));
    core.setOutput("removed_count", String(diffObj.removed.length));
    core.setOutput("unchanged_count", String(diffObj.unchanged.length));

    // Cleanup worktrees
    await git.removeWorktree(baseDir);
    if (fs.existsSync(headDir) && headDir !== workdir) {
      await git.removeWorktree(headDir);
    }
  } catch (err) {
    core.setFailed(err?.message || String(err));
  }
}

run();
