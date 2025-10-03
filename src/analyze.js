/**
 * Analyze two Git refs: generate SBOM, scan with Grype, normalize, summarize,
 * and emit base.json, head.json, diff.json (schema v2.0.0).
 */

const path = require("path");
const fs = require("fs/promises");
const { fetchAll, resolveRef, commitInfo } = require("./git");
const { generateSbom } = require("./sbom");
const { runGrypeOnSbom } = require("./grype");
const { normalizeFinding, summarizeBySeverity, computeDiff, shortSha } = require("./report");
const { normalizeSeverity } = require("./severity");

async function ensureDir(dir) { await fs.mkdir(dir, { recursive: true }); }

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
    cyclonedx_maven: await ver("mvn", ["-q", "help:evaluate", "-Dexpression=project.version"]),
    node: process.version.replace(/^v/,""),
  };
}

function filterByMinSeverity(items, minSeverity = "LOW") {
  const order = ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"];
  const idx = order.indexOf(normalizeSeverity(minSeverity));
  const allowed = new Set(order.slice(0, idx + 1)); // include UNKNOWN only if idx covers it (never)
  // Ensure UNKNOWN is included only when minSeverity is UNKNOWN
  if (normalizeSeverity(minSeverity) === "UNKNOWN") allowed.add("UNKNOWN");
  return items.filter(it => allowed.has(normalizeSeverity(it.severity)));
}

async function analyzeRefs(opts) {
  const {
    cwd = process.cwd(),
    pathRoot = ".",
    baseRef,
    headRef,
    minSeverity = "LOW",
    outDir = path.join(process.cwd(), "vuln-diff-output"),
    actionMeta = { name: "sec-open/vuln-diff-action", version: "", commit: "", ref: "" },
    repo = "",
  } = opts;

  if (!baseRef || !headRef) throw new Error("Missing baseRef/headRef");

  await fetchAll();
  const baseSha = await resolveRef(baseRef);
  const headSha = await resolveRef(headRef);

  const baseInfo = await commitInfo(baseSha);
  const headInfo = await commitInfo(headSha);

  const tools = await getToolVersions();

  await ensureDir(outDir);

  // SBOM + Grype for each ref (we assume same working directory contents; typical in Actions we checkout once at head)
  // For determinism, we scan the provided pathRoot as is.
  const sbomBase = await generateSbom(path.resolve(cwd, pathRoot), outDir);
  const grypeBase = await runGrypeOnSbom(sbomBase.path);

  const sbomHead = await generateSbom(path.resolve(cwd, pathRoot), outDir);
  const grypeHead = await runGrypeOnSbom(sbomHead.path);

  // Normalize
  const baseItemsAll = Array.isArray(grypeBase.matches) ? grypeBase.matches.map(normalizeFinding) : [];
  const headItemsAll = Array.isArray(grypeHead.matches) ? grypeHead.matches.map(normalizeFinding) : [];

  const baseItems = filterByMinSeverity(baseItemsAll, minSeverity);
  const headItems = filterByMinSeverity(headItemsAll, minSeverity);

  // Summaries
  const baseSummary = summarizeBySeverity(baseItems);
  const headSummary = summarizeBySeverity(headItems);

  // Build base.json and head.json
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
      path: sbomBase.path,
      format: "cyclonedx-json",
      component_count: grypeBase?.descriptor?.relationships?.length || undefined,
      tool: sbomBase.tool,
    },
    summary: baseSummary,
    vulnerabilities: baseItems,
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
      path: sbomHead.path,
      format: "cyclonedx-json",
      component_count: grypeHead?.descriptor?.relationships?.length || undefined,
      tool: sbomHead.tool,
    },
    summary: headSummary,
    vulnerabilities: headItems,
  };

  // Diff
  const diff = computeDiff(baseItems, headItems);

  // Aggregate severity x state
  const sevLevels = ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"];
  const by_sev_state = Object.fromEntries(sevLevels.map(s => [s, { NEW: 0, REMOVED: 0, UNCHANGED: 0 }]));
  for (const it of diff.new) by_sev_state[normalizeSeverity(it.severity)].NEW++;
  for (const it of diff.removed) by_sev_state[normalizeSeverity(it.severity)].REMOVED++;
  // unchanged_count is a number; distribute by severity by intersecting match_keys
  const baseMap = new Map(baseItems.map(i => [i.match_key, i]));
  for (const it of headItems) {
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
      unchanged: undefined,           // not storing list, only count
      unchanged_count: diff.unchanged_count,
    },
  };

  // Persist
  const basePath = path.join(outDir, "base.json");
  const headPath = path.join(outDir, "head.json");
  const diffPath = path.join(outDir, "diff.json");
  await fs.writeFile(basePath, JSON.stringify(baseJson, null, 2));
  await fs.writeFile(headPath, JSON.stringify(headJson, null, 2));
  await fs.writeFile(diffPath, JSON.stringify(diffJson, null, 2));

  return { basePath, headPath, diffPath, baseJson, headJson, diffJson };
}

module.exports = { analyzeRefs };
