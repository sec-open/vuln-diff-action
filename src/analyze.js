// path: src/analyze.js
/**
 * Analyze two Git refs in isolated checkouts:
 *  - Create a temp tree for BASE and HEAD (worktree or archive).
 *  - SBOM per tree (CycloneDX Maven if pom.xml; otherwise Syft).
 *  - Grype on each SBOM; normalize; filter by min severity.
 *  - Summarize and compute diff (NEW/REMOVED/UNCHANGED).
 *  - Persist base.json, head.json, diff.json.
 */

const path = require("path");
const fs = require("fs/promises");
const { fetchAll, resolveRef, commitInfo, shortSha, prepareCheckout } = require("./git");
const { generateSbom } = require("./sbom");
const { runGrypeOnSbomWith } = require("./grype");
const { normalizeFinding, summarizeBySeverity, computeDiff } = require("./report");
const { normalizeSeverity } = require("./severity");
const { ensureAndLocateScannerTools } = require("./tools");

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }

function filterByMinSeverity(items, minSeverity = "LOW") {
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
  const idx = order.indexOf(normalizeSeverity(minSeverity));
  const allowed = new Set(order.slice(0, idx + 1));
  if (normalizeSeverity(minSeverity) === "UNKNOWN") allowed.add("UNKNOWN");
  return items.filter(it => allowed.has(normalizeSeverity(it.severity)));
}

async function getToolVersions() {
  const { execFile } = require("child_process");
  const { promisify } = require("util");
  const execFileP = promisify(execFile);

  async function ver(cmd, args) {
    try {
      const { stdout, stderr } = await execFileP(cmd, args);
      return (stdout || stderr || "").trim().split(/\r?\n/)[0];
    } catch {
      return undefined;
    }
  }

  return {
    syft: await ver("syft", ["version"]),
    grype: await ver("grype", ["version"]),
    cyclonedx_maven: await ver("mvn", ["-q", "--version"]),
    node: process.version.replace(/^v/, ""),
  };
}

async function analyzeOneRef({ sha, refLabel, checkoutParent, bins, minSeverity }) {
  // Prepare isolated checkout folder for this ref
  const refDir = path.join(checkoutParent, shortSha(sha));
  await prepareCheckout(sha, refDir);

  // Per-ref output dir (avoid overwriting)
  const perRefOut = path.join(checkoutParent, "out", shortSha(sha));
  await ensureDir(perRefOut);

  // SBOM (prefer CycloneDX Maven if pom.xml exists in this checkout)
  const sbom = await generateSbom(refDir, perRefOut, bins);

  // Grype over SBOM
  const grypeJson = await runGrypeOnSbomWith(bins.grypePath, sbom.path);

  // Normalize & filter
  const itemsAll = Array.isArray(grypeJson.matches) ? grypeJson.matches.map(normalizeFinding) : [];
  const items = filterByMinSeverity(itemsAll, minSeverity);

  // Summary
  const summary = summarizeBySeverity(items);

  return { refDir, sbom, items, summary };
}

async function analyzeRefs(opts) {
  const {
    cwd = process.cwd(),
    pathRoot = ".",           // kept for future use (when scanning non-root dirs)
    baseRef,
    headRef,
    minSeverity = "LOW",
    outDir = path.join(process.cwd(), "vuln-diff-output"),
    actionMeta = { name: "sec-open/vuln-diff-action", version: "", commit: "", ref: "" },
    repo = "",
  } = opts;

  if (!baseRef || !headRef) throw new Error("Missing baseRef/headRef");

  await ensureDir(outDir);
  await fetchAll();

  const baseSha = await resolveRef(baseRef);
  const headSha = await resolveRef(headRef);

  const baseInfo = await commitInfo(baseSha);
  const headInfo = await commitInfo(headSha);

  // Ensure Syft/Grype are installed and get absolute paths
  const bins = await ensureAndLocateScannerTools();
  const tools = await getToolVersions();

  // Parent temp area for checkouts
  const checksRoot = path.join(outDir, "refs");
  await ensureDir(checksRoot);

  // Analyze BASE and HEAD from their own checkout dirs
  const baseRes = await analyzeOneRef({
    sha: baseSha,
    refLabel: "BASE",
    checkoutParent: checksRoot,
    bins,
    minSeverity,
  });
  const headRes = await analyzeOneRef({
    sha: headSha,
    refLabel: "HEAD",
    checkoutParent: checksRoot,
    bins,
    minSeverity,
  });

  const now = new Date().toISOString();

  const baseJson = {
    schema_version: "2.0.0",
    generated_at: now,
    parameters: { min_severity: normalizeSeverity(minSeverity) },
    tools,
    git: {
      repo,
      ref: baseRef,
      sha: baseInfo.sha,
      sha_short: baseInfo.sha_short,
      commit_subject: baseInfo.subject,
      author: baseInfo.author,
      authored_at: baseInfo.date,
    },
    sbom: {
      path: baseRes.sbom.path,
      format: "cyclonedx-json",
      tool: baseRes.sbom.tool,
    },
    summary: baseRes.summary,
    vulnerabilities: baseRes.items,
  };

  const headJson = {
    schema_version: "2.0.0",
    generated_at: now,
    parameters: { min_severity: normalizeSeverity(minSeverity) },
    tools,
    git: {
      repo,
      ref: headRef,
      sha: headInfo.sha,
      sha_short: headInfo.sha_short,
      commit_subject: headInfo.subject,
      author: headInfo.author,
      authored_at: headInfo.date,
    },
    sbom: {
      path: headRes.sbom.path,
      format: "cyclonedx-json",
      tool: headRes.sbom.tool,
    },
    summary: headRes.summary,
    vulnerabilities: headRes.items,
  };

  // Diff (NEW / REMOVED / UNCHANGED) by match_key
  const diff = computeDiff(baseRes.items, headRes.items);

  // Aggregate severity x state
  const sevLevels = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
  const by_sev_state = Object.fromEntries(sevLevels.map(s => [s, { NEW: 0, REMOVED: 0, UNCHANGED: 0 }]));
  for (const it of diff.new) by_sev_state[normalizeSeverity(it.severity)].NEW++;
  for (const it of diff.removed) by_sev_state[normalizeSeverity(it.severity)].REMOVED++;

  const baseMap = new Map(baseRes.items.map(i => [i.match_key, i]));
  for (const it of headRes.items) {
    if (baseMap.has(it.match_key)) by_sev_state[normalizeSeverity(it.severity)].UNCHANGED++;
  }

  const diffJson = {
    schema_version: "2.0.0",
    generated_at: now,
    parameters: { min_severity: normalizeSeverity(minSeverity) },
    base: { ref: baseRef, sha: baseInfo.sha, short_sha: shortSha(baseInfo.sha) },
    head: { ref: headRef, sha: headInfo.sha, short_sha: shortSha(headInfo.sha) },
    tools,
    action: actionMeta,
    repo,
    summary: {
      totals: {
        NEW: diff.new.length,
        REMOVED: diff.removed.length,
        UNCHANGED: diff.unchanged_count,
      },
      by_severity_and_state: by_sev_state,
    },
    changes: {
      new: diff.new,
      removed: diff.removed,
      unchanged: undefined,
      unchanged_count: diff.unchanged_count,
    },
  };

  // Persist outputs
  const basePath = path.join(outDir, "base.json");
  const headPath = path.join(outDir, "head.json");
  const diffPath = path.join(outDir, "diff.json");
  await fs.writeFile(basePath, JSON.stringify(baseJson, null, 2));
  await fs.writeFile(headPath, JSON.stringify(headJson, null, 2));
  await fs.writeFile(diffPath, JSON.stringify(diffJson, null, 2));

  return { basePath, headPath, diffPath, baseJson, headJson, diffJson };
}

module.exports = { analyzeRefs };
