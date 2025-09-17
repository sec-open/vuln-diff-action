const core = require("@actions/core");
const exec = require("@actions/exec");
const fs = require("fs");
const path = require("path");
const { generateSbomAuto } = require("./sbom"); // auto: Maven CycloneDX if pom.xml, else Syft dir
const { scanSbom } = require("./grype");
const { diff, renderMarkdownTable } = require("./diff");

// ---------- shell helpers ----------
async function sh(cmd, opts = {}) {
  return exec.exec("bash", ["-lc", cmd], opts);
}

async function tryRevParse(ref) {
  let out = "";
  try {
    await exec.exec("bash", ["-lc", `git rev-parse ${ref}`], {
      listeners: { stdout: d => (out += d.toString()) },
    });
    return out.trim();
  } catch {
    return null;
  }
}

function isSha(ref) {
  return /^[0-9a-f]{7,40}$/i.test(ref || "");
}

/**
 * Resolve a user-supplied ref (branch name or SHA) to a commit SHA.
 * Tries in this order:
 *  1) as-is
 *  2) refs/remotes/origin/<ref>
 *  3) refs/remotes/upstream/<ref> (only if 'upstream' remote exists)
 *  4) final attempt: fetch from origin and rev-parse
 */
async function resolveRefToSha(ref) {
  if (isSha(ref)) {
    const sha = await tryRevParse(ref);
    if (sha) return sha;
    throw new Error(`Input '${ref}' looks like a SHA but does not exist locally.`);
  }

  // 1) try as-is (local branch / full ref)
  let sha = await tryRevParse(ref);
  if (sha) return sha;

  // 2) origin/<ref>
  sha = await tryRevParse(`refs/remotes/origin/${ref}`);
  if (sha) return sha;

  // 3) upstream/<ref> (if remote exists)
  let remotes = "";
  await exec.exec("bash", ["-lc", "git remote"], {
    listeners: { stdout: d => (remotes += d.toString()) },
  });
  if (remotes.split(/\s+/).includes("upstream")) {
    sha = await tryRevParse(`refs/remotes/upstream/${ref}`);
    if (sha) return sha;
  }

  // 4) last attempt: fetch that ref from origin
  try {
    await sh(`git fetch origin ${ref}:${ref} --tags --prune`);
    sha = await tryRevParse(ref);
    if (sha) return sha;
  } catch { /* ignore */ }

  throw new Error(`Cannot resolve ref '${ref}' to a commit SHA. Ensure the branch or SHA exists in this runner.`);
}

// ---------- pretty helpers for summary ----------
function shortSha(sha) { return (sha || "").substring(0, 12); }
function guessLabel(ref) {
  if (!ref) return "";
  const m = ref.match(/^(?:refs\/remotes\/\w+\/|origin\/)?(.+)$/);
  return m ? m[1] : ref;
}
async function commitLine(sha) {
  let out = "";
  await exec.exec("bash", ["-lc", `git --no-pager log -1 --format="%H %s" ${sha}`], {
    listeners: { stdout: d => (out += d.toString()) },
  });
  return out.trim();
}

// ---------- main ----------
async function run() {
  try {
    // Keep raw inputs to display exactly what the user passed
    const baseRefInput = core.getInput("base_ref", { required: true });
    const headRefInput = core.getInput("head_ref", { required: true });
    const scanPath = core.getInput("path") || ".";
    const buildCommand = core.getInput("build_command") || "";
    const minSeverity = core.getInput("min_severity") || "LOW";
    const writeSummary = (core.getInput("write_summary") || "true") === "true";

    const workdir = process.cwd();
    const baseDir = path.join(workdir, "__base__");
    const headDir = path.join(workdir, "__head__");
    fs.mkdirSync(baseDir, { recursive: true });

    // Ensure we have all refs locally
    await sh("git fetch --all --tags --prune --force");

    // Resolve inputs to SHAs
    const baseSha = await resolveRefToSha(baseRefInput);
    const headSha = await resolveRefToSha(headRefInput);

    // Guard: comparing the same commit is useless and misleading
    if (baseSha === headSha) {
      core.setFailed(
        `Both refs resolve to the same commit (${baseSha}). ` +
        `Please ensure you're comparing different commits. base='${baseRefInput}', head='${headRefInput}'.`
      );
      return;
    }

    // Detect current workspace SHA
    let currentSha = "";
    await exec.exec("bash", ["-lc", "git rev-parse HEAD"], {
      listeners: { stdout: d => (currentSha += d.toString()) },
    });
    currentSha = currentSha.trim();

    // Create BASE worktree (always detached by SHA)
    await sh(`git worktree add --detach ${baseDir} ${baseSha}`);

    // HEAD: reuse current workspace if already at headSha, else create detached worktree
    let headScanRoot = workdir;
    let createdHeadWorktree = false;
    if (currentSha !== headSha) {
      fs.mkdirSync(headDir, { recursive: true });
      await sh(`git worktree add --detach ${headDir} ${headSha}`);
      headScanRoot = headDir;
      createdHeadWorktree = true;
    }

    // Optional build (helps produce accurate SBOMs for Java/Gradle/etc.)
    if (buildCommand) {
      await sh(buildCommand, { cwd: baseDir });
      await sh(buildCommand, { cwd: headScanRoot });
    }

    // Generate SBOMs (auto: Maven CycloneDX if pom.xml, otherwise Syft directory scan)
    const baseSbom = path.join(workdir, "sbom-base.json");
    const headSbom = path.join(workdir, "sbom-head.json");
    await generateSbomAuto(path.join(baseDir, scanPath), baseSbom);
    await generateSbomAuto(path.join(headScanRoot, scanPath), headSbom);

    // Scan with Grype
    const baseScan = await scanSbom(baseSbom);
    const headScan = await scanSbom(headSbom);

    // Diff and Markdown table
    const d = diff(baseScan.matches || [], headScan.matches || [], minSeverity);
    const table = renderMarkdownTable(d.news, d.removed, d.unchanged);

    // Extra context lines for summary
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

    // Job summary
    if (writeSummary) {
      const summaryParts = [];
      summaryParts.push("### Vulnerability Diff (Syft+Grype)\n");
      summaryParts.push(`- **Base**: \`${guessLabel(baseRefInput)}\` (_input:_ \`${baseRefInput}\`) → \`${shortSha(baseSha)}\`\n`);
      summaryParts.push(`  - ${baseCommit}\n`);
      summaryParts.push(`- **Head**: \`${guessLabel(headRefInput)}\` (_input:_ \`${headRefInput}\`) → \`${shortSha(headSha)}\`\n`);
      summaryParts.push(`  - ${headCommit}\n`);
      summaryParts.push(`- **Min severity**: \`${minSeverity}\`\n`);
      summaryParts.push(`- **Counts**: NEW=${d.news.length} · REMOVED=${d.removed.length} · UNCHANGED=${d.unchanged.length}\n\n`);
      summaryParts.push(table);
      await core.summary.addRaw(summaryParts.join("\n")).write();
    }

    // Cleanup worktrees (never remove the current workspace)
    await sh(`git worktree remove ${baseDir} --force || true`);
    if (createdHeadWorktree) {
      await sh(`git worktree remove ${headDir} --force || true`);
    }
  } catch (error) {
    core.setFailed(error.message || String(error));
  }
}

run();
