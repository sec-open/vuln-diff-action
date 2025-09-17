const core = require("@actions/core");
const exec = require("@actions/exec");
const fs = require("fs");
const path = require("path");
const { generateSbom } = require("./sbom");
const { scanSbom } = require("./grype");
const { diff, renderMarkdownTable } = require("./diff");

async function sh(cmd, opts = {}) {
  return exec.exec("bash", ["-lc", cmd], opts);
}

// Resuelve una ref (rama/tag/SHA) a SHA
async function resolveSha(ref) {
  let out = "";
  await exec.exec("bash", ["-lc", `git rev-parse ${ref}`], {
    listeners: { stdout: d => (out += d.toString()) }
  });
  return out.trim();
}

async function run() {
  try {
    const baseRef = core.getInput("base_ref", { required: true });
    const headRef = core.getInput("head_ref", { required: true });
    const scanPath = core.getInput("path") || ".";
    const buildCommand = core.getInput("build_command") || "";
    const minSeverity = core.getInput("min_severity") || "LOW";
    const writeSummary = (core.getInput("write_summary") || "true") === "true";

    const workdir = process.cwd();
    const baseDir = path.join(workdir, "__base__");
    const headDir = path.join(workdir, "__head__");

    fs.mkdirSync(baseDir, { recursive: true });

    // Trae todas las refs para poder resolver a SHA
    await sh("git fetch --all --tags --prune --force");

    // Resuelve a SHA para evitar conflictos de nombre de rama
    const baseSha = await resolveSha(baseRef);
    const headSha = await resolveSha(headRef);

    // SHA actual del workspace (donde ya está checkout el repo)
    let currentSha = "";
    await exec.exec("bash", ["-lc", "git rev-parse HEAD"], {
      listeners: { stdout: d => (currentSha += d.toString()) }
    });
    currentSha = currentSha.trim();

    // BASE SIEMPRE como worktree --detach por SHA
    await sh(`git worktree add --detach ${baseDir} ${baseSha}`);

    // HEAD: si ya estamos en ese commit, reutiliza el workspace actual
    let headScanRoot = workdir;
    let createdHeadWorktree = false;
    if (currentSha !== headSha) {
      fs.mkdirSync(headDir, { recursive: true });
      await sh(`git worktree add --detach ${headDir} ${headSha}`);
      headScanRoot = headDir;
      createdHeadWorktree = true;
    }

    // Build opcional (para SBOM más fiel en proyectos Java/…)
    if (buildCommand) {
      await sh(buildCommand, { cwd: baseDir });
      await sh(buildCommand, { cwd: headScanRoot });
    }

    // Genera SBOMs
    const baseSbom = path.join(workdir, "sbom-base.json");
    const headSbom = path.join(workdir, "sbom-head.json");
    await generateSbom(path.join(baseDir, scanPath), baseSbom);
    await generateSbom(path.join(headScanRoot, scanPath), headSbom);

    // Scans con Grype
    const baseScan = await scanSbom(baseSbom);
    const headScan = await scanSbom(headSbom);

    // Diff y tabla
    const d = diff(baseScan.matches || [], headScan.matches || [], minSeverity);
    const table = renderMarkdownTable(d.news, d.removed, d.unchanged);

    // Outputs
    core.setOutput("new_count", String(d.news.length));
    core.setOutput("removed_count", String(d.removed.length));
    core.setOutput("unchanged_count", String(d.unchanged.length));
    core.setOutput("diff_markdown_table", table);
    core.setOutput("diff_json", JSON.stringify(d));

    // Summary
    if (writeSummary) {
      const summaryParts = [];
      summaryParts.push("### Vulnerability Diff (Syft+Grype)\n");
      summaryParts.push(`- **Base**: \`${baseRef}\`  \n- **Head**: \`${headRef}\`\n`);
      summaryParts.push(`- **Min severity**: \`${minSeverity}\`\n`);
      summaryParts.push(`- **Counts**: NEW=${d.news.length} · REMOVED=${d.removed.length} · UNCHANGED=${d.unchanged.length}\n`);
      summaryParts.push("\n");
      summaryParts.push(table);
      await core.summary.addRaw(summaryParts.join("\n")).write();
    }

    // Limpieza (no borres el workspace actual)
    await sh(`git worktree remove ${baseDir} --force || true`);
    if (createdHeadWorktree) {
      await sh(`git worktree remove ${headDir} --force || true`);
    }
  } catch (error) {
    core.setFailed(error.message || String(error));
  }
}

run();

