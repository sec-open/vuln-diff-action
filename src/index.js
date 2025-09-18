// src/index.js
// Action entrypoint: compares vulnerabilities between two refs using Syft+Grype,
// generates SBOMs (CycloneDX via Maven plugin if available), creates a Markdown report,
// and optionally uploads all artifacts (SBOMs, Grype outputs, diff, report).
// Comments are in English as requested.

const core = require("@actions/core");
const exec = require("@actions/exec");
const { create: createArtifactClient } = require("@actions/artifact");
const fs = require("fs");
const path = require("path");
const { generateSbomAuto } = require("./sbom"); // auto: Maven CycloneDX if pom.xml, else Syft dir
const { scanSbom } = require("./grype");
const { diff, renderMarkdownTable } = require("./diff");

// ----------------------- shell + git helpers -----------------------
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
 *   1) as-is
 *   2) refs/remotes/origin/<ref>
 *   3) refs/remotes/upstream/<ref> (only if 'upstream' remote exists)
 *   4) last attempt: fetch from origin and rev-parse
 */
async function resolveRefToSha(ref) {
  if (isSha(ref)) {
    const sha = await tryRevParse(ref);
    if (sha) return sha;
    throw new Error(`Input '${ref}' looks like a SHA but does not exist locally.`);
  }

  // 1) as-is (local branch / full ref)
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

  // 4) fetch from origin and try again
  try {
    await sh(`git fetch origin ${ref}:${ref} --tags --prune`);
    sha = await tryRevParse(ref);
    if (sha) return sha;
  } catch { /* ignore */ }

  throw new Error(`Cannot resolve ref '${ref}' to a commit SHA. Ensure the branch or SHA exists in this runner.`);
}

// ----------------------- pretty helpers for summary -----------------------
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

// ----------------------- reporting helpers (severity groups + graph) -----------------------
const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function groupBySeverity(grypeMatches) {
  // returns Map<severity, Set<"name:version">>
  const map = new Map(SEV_ORDER.map(s => [s, new Set()]));
  for (const m of grypeMatches || []) {
    const sev = (m?.vulnerability?.severity || "UNKNOWN").toUpperCase();
    const a = m?.artifact || {};
    const key = `${a.name || "unknown"}:${a.version || "unknown"}`;
    if (!map.has(sev)) map.set(sev, new Set());
    map.get(sev).add(key);
  }
  return map;
}

/**
 * Build a dependency graph (Mermaid) from a CycloneDX BOM + Grype matches.
 * Keeps vulnerable nodes and their ancestors up to roots, limited by graphMax to avoid huge diagrams.
 */
function buildMermaidGraphFromBOM(bomJson, grypeMatches, title, graphMax = 150) {
  const nameVer = (c) => `${c?.name || "unknown"}:${c?.version || "unknown"}`;

  // Map bom-ref/purl -> label "name:version"
  const refToLabel = new Map();
  for (const c of (bomJson.components || [])) {
    const label = nameVer(c);
    if (c["bom-ref"]) refToLabel.set(c["bom-ref"], label);
    if (c.purl) refToLabel.set(c.purl, label);
  }

  // Build adjacency from BOM dependencies (componentRef -> [dependsOnRefs])
  const depsSection = bomJson.dependencies || [];
  const adj = new Map();     // node -> Set(children)
  const parents = new Map(); // child -> Set(parents)
  const ensure = (map, key) => { if (!map.has(key)) map.set(key, new Set()); return map.get(key); };

  for (const d of depsSection) {
    const parentRef = refToLabel.get(d.ref) || d.ref;
    const children = d.dependsOn || [];
    for (const ch of children) {
      const childRef = refToLabel.get(ch) || ch;
      ensure(adj, parentRef).add(childRef);
      ensure(parents, childRef).add(parentRef);
      ensure(adj, childRef);
      ensure(parents, parentRef);
    }
  }

  // Vulnerable nodes from Grype (HEAD)
  const vulnerable = new Set();
  for (const m of grypeMatches || []) {
    const a = m?.artifact || {};
    vulnerable.add(`${a.name || "unknown"}:${a.version || "unknown"}`);
  }

  // Collect subgraph: vulnerable nodes and all ancestors to roots (limited by graphMax)
  const keep = new Set();
  const queue = [];
  for (const v of vulnerable) {
    if (!keep.has(v)) { keep.add(v); queue.push(v); }
    ensure(adj, v); ensure(parents, v);
  }
  while (queue.length && keep.size < graphMax) {
    const cur = queue.shift();
    for (const p of (parents.get(cur) || [])) {
      if (!keep.has(p)) {
        keep.add(p);
        queue.push(p);
        if (keep.size >= graphMax) break;
      }
    }
  }

  // Mermaid graph
  let lines = [];
  if (title) lines.push(`%% ${title}`);
  lines.push("graph LR");
  const styleLines = [];
  let idx = 0;
  const idMap = new Map();
  const idFor = (label) => { if (!idMap.has(label)) idMap.set(label, `n${idx++}`); return idMap.get(label); };

  for (const [parent, children] of adj) {
    if (!keep.has(parent)) continue;
    const pid = idFor(parent);
    lines.push(`${pid}["${parent}"]`);
    for (const ch of children) {
      if (!keep.has(ch)) continue;
      const cid = idFor(ch);
      lines.push(`${pid} --> ${cid}`);
    }
  }
  for (const v of vulnerable) {
    if (keep.has(v)) {
      const vid = idFor(v);
      styleLines.push(`style ${vid} fill:#ffe0e0,stroke:#d33,stroke-width:2px`);
    }
  }
  return [...lines, ...styleLines].join("\n");
}

function buildMarkdownReport({
  baseLabel, baseInput, baseSha, baseCommitLine,
  headLabel, headInput, headSha, headCommitLine,
  minSeverity, counts, table,
  headGrype, headBOM, graphMaxNodes
}) {
  const sevGroups = groupBySeverity(headGrype.matches || []);
  const md = [];
  md.push("### Vulnerability Diff (Syft + Grype)\n");
  md.push(`- **Base**: \`${baseLabel}\` (_input:_ \`${baseInput}\`) → \`${shortSha(baseSha)}\``);
  md.push(`  - ${baseCommitLine}`);
  md.push(`- **Head**: \`${headLabel}\` (_input:_ \`${headInput}\`) → \`${shortSha(headSha)}\``);
  md.push(`  - ${headCommitLine}`);
  md.push(`- **Min severity**: \`${minSeverity}\``);
  md.push(`- **Counts**: NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}`);
  md.push("");
  md.push("#### Diff Table");
  md.push(table);
  md.push("");
  md.push("#### Vulnerable libraries in HEAD (grouped by severity)");
  for (const sev of SEV_ORDER) {
    const set = sevGroups.get(sev) || new Set();
    if (set.size === 0) continue;
    md.push(`- **${sev}** (${set.size})`);
    const list = Array.from(set).sort().slice(0, 200); // avoid huge lists
    for (const x of list) md.push(`  - \`${x}\``);
  }
  // Mermaid dependency graph
  if ((headBOM?.dependencies || []).length > 0) {
    md.push("");
    md.push("#### Dependency graph (HEAD)");
    md.push("```mermaid");
    md.push(buildMermaidGraphFromBOM(headBOM, headGrype.matches || [], "HEAD dependency graph (vulnerable nodes highlighted)", graphMaxNodes));
    md.push("```");
  }
  return md.join("\n");
}

// ----------------------- main -----------------------
async function run() {
  try {
    // Keep raw inputs to display exactly what the user passed
    const baseRefInput   = core.getInput("base_ref", { required: true });
    const headRefInput   = core.getInput("head_ref", { required: true });
    const scanPath       = core.getInput("path") || ".";
    const buildCommand   = core.getInput("build_command") || "";
    const minSeverity    = core.getInput("min_severity") || "LOW";
    const writeSummary   = (core.getInput("write_summary") || "true") === "true";
    const uploadArtifact = (core.getInput("upload_artifact") || "true") === "true";
    const artifactName   = core.getInput("artifact_name") || "vuln-diff-artifacts";
    const graphMaxNodes  = parseInt(core.getInput("graph_max_nodes") || "150", 10);

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

    // Optional build (helps produce accurate SBOMs for some setups)
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

    // Build full report.md (includes diff table, severity groups, and Mermaid graph)
    const reportPath = path.join(workdir, "report.md");
    const baseLabel = guessLabel(baseRefInput);
    const headLabel = guessLabel(headRefInput);
    let headBomJson = {};
    try {
      headBomJson = JSON.parse(fs.readFileSync(headSbom, "utf8"));
    } catch (e) {
      core.warning(`Failed to parse ${headSbom} for report graph: ${e.message}`);
    }
    const reportMd = buildMarkdownReport({
      baseLabel, baseInput: baseRefInput, baseSha, baseCommitLine: baseCommit,
      headLabel, headInput: headRefInput, headSha, headCommitLine: headCommit,
      minSeverity,
      counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
      table,
      headGrype: headScan,
      headBOM: headBomJson,
      graphMaxNodes: graphMaxNodes
    });
    fs.writeFileSync(reportPath, reportMd, "utf8");

    // Save raw scans and diff for artifact
    const grypeBasePath = path.join(workdir, "grype-base.json");
    const grypeHeadPath = path.join(workdir, "grype-head.json");
    fs.writeFileSync(grypeBasePath, JSON.stringify(baseScan, null, 2));
    fs.writeFileSync(grypeHeadPath, JSON.stringify(headScan, null, 2));
    const diffJsonPath = path.join(workdir, "diff.json");
    fs.writeFileSync(diffJsonPath, JSON.stringify({ news: d.news, removed: d.removed, unchanged: d.unchanged }, null, 2));

    // Upload artifact (SBOMs, grype outputs, report, diff)
      if (uploadArtifact) {
        const client = createArtifactClient();
        await client.uploadArtifact(
        artifactName,
        [reportPath, baseSbom, headSbom, grypeBasePath, grypeHeadPath, diffJsonPath],
        workdir,
        { continueOnError: true, retentionDays: 90 }
      );
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
