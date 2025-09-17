const core = require("@actions/core");
const exec = require("@actions/exec");
const fs = require("fs");
const path = require("path");
const { generateSbom } = require("./sbom");
const { scanSbom } = require("./grype");
const { diff, renderMarkdownTable } = require("./diff");

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
    fs.mkdirSync(headDir, { recursive: true });

    await exec.exec("bash", ["-lc", "git fetch --all --tags --prune --force"]);

    await exec.exec("bash", ["-lc", `git worktree add ${baseDir} ${baseRef}`]);
    if (buildCommand) await exec.exec("bash", ["-lc", buildCommand], { cwd: baseDir });

    await exec.exec("bash", ["-lc", `git worktree add ${headDir} ${headRef}`]);
    if (buildCommand) await exec.exec("bash", ["-lc", buildCommand], { cwd: headDir });

    const baseSbom = path.join(workdir, "sbom-base.json");
    const headSbom = path.join(workdir, "sbom-head.json");
    await generateSbom(path.join(baseDir, scanPath), baseSbom);
    await generateSbom(path.join(headDir, scanPath), headSbom);

    const baseScan = await scanSbom(baseSbom);
    const headScan = await scanSbom(headSbom);

    const d = diff(baseScan.matches || [], headScan.matches || [], minSeverity);
    const table = renderMarkdownTable(d.news, d.removed, d.unchanged);

    core.setOutput("new_count", String(d.news.length));
    core.setOutput("removed_count", String(d.removed.length));
    core.setOutput("unchanged_count", String(d.unchanged.length));
    core.setOutput("diff_markdown_table", table);
    core.setOutput("diff_json", JSON.stringify(d));

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

    await exec.exec("bash", ["-lc", `git worktree remove ${baseDir} --force || true`]);
    await exec.exec("bash", ["-lc", `git worktree remove ${headDir} --force || true`]);
  } catch (error) {
    core.setFailed(error.message || String(error));
  }
}

run();
