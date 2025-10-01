// src/analyze.js
// Phase 1 — Analysis: produce normalized JS objects for base/head (SBOM + Grype)
// Adds an orchestrator: analyzeBranches(opts) to support older entrypoints.

const path = require("path");
const fs = require("fs");
const exec = require("@actions/exec");
const { generateSbomAuto } = require("./sbom");
const { scanSbom } = require("./grype");
const git = require("./git");

// ---- tiny shell helper ----
async function sh(cmd, opts = {}) {
  return exec.exec("bash", ["-lc", cmd], opts);
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

function normalizeMatches(grypeJson) {
  const matches = Array.isArray(grypeJson?.matches) ? grypeJson.matches : [];
  return matches.map((m) => {
    const v = m.vulnerability || {};
    const a = m.artifact || {};
    // Keep everything that might be useful later for renderers
    return {
      id: v.id || "",
      severity: v.severity || "UNKNOWN",
      dataSource: v.dataSource || "",
      description: v.description || "",
      urls: v.urls || [],
      cvss: v.cvss || [],
      advisories: v.advisories || [],
      package: a.name || "",
      version: a.version || "",
      type: a.type || "",
      purl: a.purl || "",
      locations: a.locations || [],
      // Keep related IDs if any
      related: Array.isArray(m.relatedVulnerabilities) ? m.relatedVulnerabilities.map(r => r.id) : [],
      _raw: m
    };
  });
}

async function analyzeOneRef(refLabel, worktreeDir, scanPath, outSbomPath) {
  // SBOM (CycloneDX if Maven; else Syft directory)
  await generateSbomAuto(path.join(worktreeDir, scanPath), outSbomPath);
  // Grype scan
  const grype = await scanSbom(outSbomPath);
  const normalized = normalizeMatches(grype);
  return { sbomPath: outSbomPath, grype: grype, items: normalized };
}

function makeDiff(baseItems, headItems, minSeverity) {
  const sevOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
  const sevRank = (s) => {
    const i = sevOrder.indexOf((s || "").toUpperCase());
    return i >= 0 ? i : sevOrder.length - 1;
  };
  const meets = (s) => sevRank(s) <= sevRank(minSeverity);
  const key = (x) => (x.id || "") + "§" + (x.package || "") + "§" + (x.version || "");
  const map = (arr) => {
    const m = new Map();
    for (const x of arr) if (meets(x.severity)) m.set(key(x), x);
    return m;
  };
  const mb = map(baseItems);
  const mh = map(headItems);
  const news = [];
  const removed = [];
  const unchanged = [];
  for (const [k, v] of mh) { if (!mb.has(k)) news.push(v); else unchanged.push(v); }
  for (const [k, v] of mb) { if (!mh.has(k)) removed.push(v); }

  // Sort by severity desc, then id/package
  const cmp = (a, b) => {
    const d = sevRank(a.severity) - sevRank(b.severity);
    if (d !== 0) return d;
    return (a.id + a.package).localeCompare(b.id + b.package);
  };
  news.sort(cmp);
  removed.sort(cmp);
  unchanged.sort(cmp);

  return { news, removed, unchanged };
}

/**
 * High-level orchestrator used by some entrypoints (e.g., older tags).
 * - Resolves refs to SHAs
 * - Creates worktrees
 * - (Optionally) runs build commands
 * - Generates SBOMs and scans with Grype
 * - Returns normalized base/head objects and diff
 *
 * @param {Object} opts
 * @param {string} opts.workspace   Runner workspace (process.cwd() if not set)
 * @param {string} opts.baseRef     Base ref (branch/tag/SHA)
 * @param {string} opts.headRef     Head ref (branch/tag/SHA)
 * @param {string} [opts.scanPath]  Directory to scan (default ".")
 * @param {string} [opts.buildCommand] Optional build command to run in each worktree
 * @param {string} [opts.minSeverity]  LOW|MEDIUM|HIGH|CRITICAL (default LOW)
 * @returns {Promise<{base:{ref,commit,message?,sbomPath,grype,items}, head:{...}, diff:{news,removed,unchanged}}>}
 */
async function analyzeBranches(opts) {
  const workspace = opts?.workspace || process.cwd();
  const scanPath = opts?.scanPath || ".";
  const buildCommand = opts?.buildCommand || "";
  const minSeverity = (opts?.minSeverity || "LOW").toUpperCase();

  // Resolve refs and prepare worktrees
  await git.sh("git fetch --all --tags --prune --force");
  await git.ensureRefLocal(opts.baseRef);
  await git.ensureRefLocal(opts.headRef);

  const baseSha = await git.resolveRefToSha(opts.baseRef);
  const headSha = await git.resolveRefToSha(opts.headRef);
  const baseLabel = git.guessLabel(opts.baseRef);
  const headLabel = git.guessLabel(opts.headRef);

  const workdir = workspace;
  const baseDir = path.join(workdir, "__base__");
  const headDir = path.join(workdir, "__head__");
  await fs.promises.mkdir(baseDir, { recursive: true });

  // Current HEAD SHA to decide if we need a separate head worktree
  let currentSha = "";
  await exec.exec("bash", ["-lc", "git rev-parse HEAD"], {
    listeners: { stdout: (d) => (currentSha += d.toString()) },
  });
  currentSha = currentSha.trim();

  await git.addWorktree(baseDir, baseSha);
  const createdHeadWorktree = currentSha !== headSha;
  if (createdHeadWorktree) {
    await fs.promises.mkdir(headDir, { recursive: true });
    await git.addWorktree(headDir, headSha);
  }

  try {
    if (buildCommand) {
      await sh(buildCommand, { cwd: baseDir });
      await sh(buildCommand, { cwd: createdHeadWorktree ? headDir : workdir });
    }

    // SBOM + Grype
    const baseSbomPath = path.join(workdir, "sbom-base.json");
    const headSbomPath = path.join(workdir, "sbom-head.json");

    const base = await analyzeOneRef(baseLabel, baseDir, scanPath, baseSbomPath);
    const head = await analyzeOneRef(headLabel, createdHeadWorktree ? headDir : workdir, scanPath, headSbomPath);

    // Add minimal git info (commit message one-liner)
    let baseLine = "";
    let headLine = "";
    try { baseLine = await git.commitLine(baseSha); } catch {}
    try { headLine = await git.commitLine(headSha); } catch {}

    const diff = makeDiff(base.items, head.items, minSeverity);

    return {
      base: { ref: baseLabel, commit: baseSha, message: baseLine, ...pick(base, ["sbomPath", "grype", "items"]) },
      head: { ref: headLabel, commit: headSha, message: headLine, ...pick(head, ["sbomPath", "grype", "items"]) },
      diff
    };
  } finally {
    // Cleanup worktrees
    try { await git.removeWorktree(baseDir); } catch {}
    try {
      if (createdHeadWorktree && fs.existsSync(headDir)) await git.removeWorktree(headDir);
    } catch {}
  }
}

module.exports = {
  analyzeOneRef,
  makeDiff,
  analyzeBranches, // <- added for older entrypoints expecting it
};
