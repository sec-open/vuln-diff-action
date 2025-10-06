// src/analyze.js
// Phase 1+2 — Analysis & Normalization orchestrator (robust to module exports)
// - Resolves SBOM/Grype runners dynamically (generateSbomAuto/generateSbom/...; scanSbom/runGrype...)
// - Analyzes base/head in isolated checkouts, dedupes by vulnerability ID, builds summaries and diff.
// - Writes base.json, head.json, diff.json, meta.json
// Comments in English.

const path = require("path");
const fsp = require("fs/promises");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

async function sh(cmd, opts = {}) {
  return execFileP("bash", ["-lc", cmd], { maxBuffer: 64 * 1024 * 1024, ...opts });
}

/* ---------------- Severity helpers ---------------- */

const SEV_ORDER_LIST = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SEV_TO_RANK = new Map(SEV_ORDER_LIST.map((s, i) => [s, i]));
function normSev(s) {
  const v = String(s || "UNKNOWN").toUpperCase();
  return SEV_TO_RANK.has(v) ? v : "UNKNOWN";
}

/* ---------------- Tool versions ---------------- */

async function toolVersion(cmd, args) {
  try {
    const { stdout, stderr } = await execFileP(cmd, args || []);
    return (stdout || stderr || "").trim().split(/\r?\n/)[0];
  } catch { return undefined; }
}

/* ---------------- Grype normalization ---------------- */

// Stable key by vulnerability ID only (GHSA > CVE > raw id)
function keyFromIds(obj) {
  const idsArr = Array.isArray(obj?.vulnerability?.ids) ? obj.vulnerability.ids : [];
  const ghsa = idsArr.find(x => typeof x === "string" && /^ghsa-/i.test(x));
  if (ghsa) return String(ghsa).toUpperCase();
  const cve = idsArr.find(x => typeof x === "string" && /^cve-/i.test(x));
  if (cve) return String(cve).toUpperCase();
  const id = obj?.vulnerability?.id || obj?.id || "";
  return String(id).toUpperCase();
}

function maxCvss(v) {
  const list = Array.isArray(v?.cvss) ? v.cvss : [];
  let best = null;
  for (const c of list) {
    const score = Number(c?.metrics?.score ?? c?.baseScore ?? 0);
    if (!best || score > best.score) best = { score, vector: c?.vectorString || c?.vector || undefined };
  }
  return best || undefined;
}

// Normalize Grype JSON -> flat finding objects (one entry per match)
function normalizeMatches(grypeJson) {
  const matches = Array.isArray(grypeJson?.matches) ? grypeJson.matches : [];
  return matches.map((m) => {
    const v = m.vulnerability || {};
    const a = m.artifact || {};

    const id = String(v.id || "");
    const idsArr = Array.isArray(v.ids) ? v.ids : [];
    const ghsa = idsArr.find(x => typeof x === "string" && /^ghsa-/i.test(x));
    const cve  = idsArr.find(x => typeof x === "string" && /^cve-/i.test(x));

    const severity = normSev(v.severity);

    return {
      id,
      ids: { ghsa: ghsa || undefined, cve: cve || undefined },
      severity,
      dataSource: v.dataSource || "",
      description: v.description || "",
      urls: Array.isArray(v.urls) ? v.urls : [],
      cvss: Array.isArray(v.cvss) ? v.cvss : [],
      cvss_max: maxCvss(v),
      advisories: Array.isArray(v.advisories) ? v.advisories : [],
      package: a.name || "",
      version: a.version || "",
      type: a.type || "",
      purl: a.purl || "",
      locations: Array.isArray(a.locations) ? a.locations : [],
      related: Array.isArray(m.relatedVulnerabilities) ? m.relatedVulnerabilities.map(r => r.id) : [],
      match_key: keyFromIds({ vulnerability: { id, ids: idsArr } }), // ID-only
      _raw: m,
    };
  });
}

// Deduplicate a list by match_key (ID). Keep “worst” (higher severity), tie → higher CVSS.
function dedupeByIdKeepingWorst(arr) {
  const map = new Map();
  for (const it of arr || []) {
    const k = it.match_key;
    const prev = map.get(k);
    if (!prev) { map.set(k, it); continue; }
    const prevRank = SEV_TO_RANK.get(normSev(prev.severity)) ?? 0;
    const curRank  = SEV_TO_RANK.get(normSev(it.severity)) ?? 0;
    if (curRank > prevRank) map.set(k, it);
    else if (curRank === prevRank) {
      const a = prev?.cvss_max?.score ?? 0;
      const b = it?.cvss_max?.score ?? 0;
      if (b > a) map.set(k, it);
    }
  }
  return Array.from(map.values());
}

function summarizeBySeverity(items) {
  const res = { total: 0, by_severity: { CRITICAL:0, HIGH:0, MEDIUM:0, LOW:0, UNKNOWN:0 } };
  for (const it of items || []) {
    const sev = normSev(it.severity);
    res.by_severity[sev] = (res.by_severity[sev] || 0) + 1;
    res.total++;
  }
  return res;
}

/* ---------------- SBOM & Grype dynamic loaders ---------------- */

// Load modules
const sbomMod = require("./sbom");
const grypeMod = require("./grype");

// Pick available functions (handle default/named exports across versions)
const genSbomFn =
  sbomMod.generateSbomAuto ||
  sbomMod.generateSbom ||
  sbomMod.makeSbom ||
  sbomMod.default;

const scanSbomFn =
  grypeMod.scanSbom ||
  grypeMod.runGrypeOnSbomWith ||
  grypeMod.runGrypeOnSbom ||
  grypeMod.default;

async function callGenSbom(dir, outPath, maybeBins) {
  if (typeof genSbomFn !== "function") {
    throw new Error("SBOM generator function not found in './sbom' (expected generateSbomAuto/generateSbom/makeSbom/default).");
  }
  // Try (dir, outPath, bins)
  try {
    const res = await genSbomFn(dir, outPath, maybeBins);
    // If function returns an object with path, accept it
    if (res && typeof res === "object" && res.path) {
      await fsp.access(res.path);
      return { path: res.path, tool: res.tool || "auto" };
    }
    // Otherwise, assume it wrote to outPath
    await fsp.access(outPath);
    return { path: outPath, tool: "auto" };
  } catch (e1) {
    // Try simpler signature (dir, outPath)
    const res2 = await genSbomFn(dir, outPath);
    if (res2 && typeof res2 === "object" && res2.path) {
      await fsp.access(res2.path);
      return { path: res2.path, tool: res2.tool || "auto" };
    }
    await fsp.access(outPath);
    return { path: outPath, tool: "auto" };
  }
}

async function callScanSbom(sbomPath) {
  if (typeof scanSbomFn !== "function") {
    throw new Error("Grype scanner function not found in './grype' (expected scanSbom/runGrypeOnSbomWith/runGrypeOnSbom/default).");
  }
  const res = await scanSbomFn(sbomPath);
  // Some wrappers may return {json:...}
  if (res && res.matches) return res;
  if (res && res.json && res.json.matches) return res.json;
  return res;
}

/* ---------------- Analyze one ref ---------------- */

async function analyzeOneRef(refLabel, worktreeDir, scanPath, outSbomPath, minSeverity = "LOW", bins) {
  // SBOM
  const sbom = await callGenSbom(path.join(worktreeDir, scanPath), outSbomPath, bins);

  // Grype
  const grypeJson = await callScanSbom(sbom.path);

  // Normalize, filter, dedupe by ID keeping worst
  const all = normalizeMatches(grypeJson);

  const sevRank = (s) => SEV_ORDER_LIST.indexOf(normSev(s));
  const threshold = Math.max(0, sevRank(minSeverity));
  const itemsFilt = all.filter(x => sevRank(x.severity) >= threshold);
  const items = dedupeByIdKeepingWorst(itemsFilt);

  return { sbomPath: sbom.path, sbomTool: sbom.tool, grypeRaw: grypeJson, items };
}

/* ---------------- Diff by ID ---------------- */

function makeDiff(baseItems, headItems) {
  const baseDedup = dedupeByIdKeepingWorst(Array.isArray(baseItems) ? baseItems : []);
  const headDedup = dedupeByIdKeepingWorst(Array.isArray(headItems) ? headItems : []);
  const mb = new Map(baseDedup.map(x => [x.match_key, x]));
  const mh = new Map(headDedup.map(x => [x.match_key, x]));

  const news = [];
  const removed = [];
  const unchanged = [];

  for (const [k, v] of mh) {
    if (!mb.has(k)) news.push(v);
    else unchanged.push(v);
  }
  for (const [k, v] of mb) {
    if (!mh.has(k)) removed.push(v);
  }

  const sevRank = (s) => SEV_ORDER_LIST.indexOf(normSev(s));
  const cmp = (a, b) => {
    const da = sevRank(a.severity), db = sevRank(b.severity);
    if (da !== db) return db - da; // worst first
    return String(a.id || "").localeCompare(String(b.id || ""));
  };
  news.sort(cmp); removed.sort(cmp); unchanged.sort(cmp);
  return { news, removed, unchanged };
}

/* ---------------- Git helpers ---------------- */

const { fetchAll, resolveRef, commitInfo, shortSha, prepareCheckout } = require("./git");

/* ---------------- Orchestrator: analyzeRefs ---------------- */

async function analyzeRefs({
  baseRef,
  headRef,
  pathRoot = ".",
  minSeverity = "LOW",
  outDir = path.join(process.cwd(), "vuln-diff-output"),
  actionMeta = { name: "sec-open/vuln-diff-action", version: "", commit: "", ref: "" },
  repo = process.env.GITHUB_REPOSITORY || "",
}) {
  if (!baseRef || !headRef) throw new Error("analyzeRefs: baseRef and headRef are required.");

  await fsp.mkdir(outDir, { recursive: true });
  await fetchAll();

  const baseSha = await resolveRef(baseRef);
  const headSha = await resolveRef(headRef);
  const baseInfo = await commitInfo(baseSha);
  const headInfo = await commitInfo(headSha);

  const tools = {
    syft: await toolVersion("syft", ["version"]),
    grype: await toolVersion("grype", ["version"]),
    cyclonedx_maven: await toolVersion("mvn", ["-q", "--version"]),
    node: process.version.replace(/^v/, ""),
  };

  // Checkouts
  const checksRoot = path.join(outDir, "refs");
  await fsp.mkdir(checksRoot, { recursive: true });
  const baseDir = path.join(checksRoot, shortSha(baseSha));
  const headDir = path.join(checksRoot, shortSha(headSha));
  await prepareCheckout(baseSha, baseDir);
  await prepareCheckout(headSha, headDir);

  // SBOM output paths
  const baseSbom = path.join(outDir, "sbom-base.json");
  const headSbom = path.join(outDir, "sbom-head.json");

  // Analyze each ref
  const baseRes = await analyzeOneRef("BASE", baseDir, ".", baseSbom, minSeverity);
  const headRes = await analyzeOneRef("HEAD", headDir, ".", headSbom, minSeverity);

  // Build normalized JSONs
  const now = new Date().toISOString();

  const baseJson = {
    schema_version: "2.0.0",
    generated_at: now,
    parameters: { min_severity: normSev(minSeverity) },
    tools,
    git: {
      repo, ref: baseRef, sha: baseInfo.sha, sha_short: baseInfo.sha_short,
      commit_subject: baseInfo.subject, author: baseInfo.author, authored_at: baseInfo.date,
    },
    sbom: { path: baseRes.sbomPath, format: "cyclonedx-json", tool: baseRes.sbomTool || "auto" },
    summary: summarizeBySeverity(baseRes.items),
    vulnerabilities: baseRes.items,
  };

  const headJson = {
    schema_version: "2.0.0",
    generated_at: now,
    parameters: { min_severity: normSev(minSeverity) },
    tools,
    git: {
      repo, ref: headRef, sha: headInfo.sha, sha_short: headInfo.sha_short,
      commit_subject: headInfo.subject, author: headInfo.author, authored_at: headInfo.date,
    },
    sbom: { path: headRes.sbomPath, format: "cyclonedx-json", tool: headRes.sbomTool || "auto" },
    summary: summarizeBySeverity(headRes.items),
    vulnerabilities: headRes.items,
  };

  // Diff by ID
  const diffRes = makeDiff(baseRes.items, headRes.items);

  const sevLevels = ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"];
  const by_sev_state = Object.fromEntries(sevLevels.map(s => [s, { NEW: 0, REMOVED: 0, UNCHANGED: 0 }]));
  for (const it of diffRes.news)      by_sev_state[normSev(it.severity)].NEW++;
  for (const it of diffRes.removed)   by_sev_state[normSev(it.severity)].REMOVED++;
  for (const it of diffRes.unchanged) by_sev_state[normSev(it.severity)].UNCHANGED++;

  const diffJson = {
    schema_version: "2.0.0",
    generated_at: now,
    parameters: { min_severity: normSev(minSeverity) },
    base: { ref: baseRef, sha: baseInfo.sha, short_sha: baseInfo.sha_short },
    head: { ref: headRef, sha: headInfo.sha, short_sha: headInfo.sha_short },
    tools,
    action: actionMeta,
    repo,
    summary: {
      totals: {
        NEW: diffRes.news.length,
        REMOVED: diffRes.removed.length,
        UNCHANGED: diffRes.unchanged.length,
      },
      by_severity_and_state: by_sev_state,
    },
    changes: {
      new: diffRes.news.map(v => ({ ...v, state: "NEW", branches: "HEAD" })),
      removed: diffRes.removed.map(v => ({ ...v, state: "REMOVED", branches: "BASE" })),
      unchanged: diffRes.unchanged.map(v => ({ ...v, state: "UNCHANGED", branches: "BOTH" })),
    },
    items: [
      ...diffRes.news.map(v => ({ ...v, state: "NEW", branches: "HEAD" })),
      ...diffRes.removed.map(v => ({ ...v, state: "REMOVED", branches: "BASE" })),
      ...diffRes.unchanged.map(v => ({ ...v, state: "UNCHANGED", branches: "BOTH" })),
    ],
  };

  // meta.json
  const meta = {
    generated_at: now,
    inputs: { base_ref: baseRef, head_ref: headRef, path: pathRoot, min_severity: normSev(minSeverity) },
    tools,
    action: actionMeta,
    repo,
    git: { base: baseJson.git, head: headJson.git },
  };

  // Persist
  await fsp.writeFile(path.join(outDir, "base.json"), JSON.stringify(baseJson, null, 2));
  await fsp.writeFile(path.join(outDir, "head.json"), JSON.stringify(headJson, null, 2));
  await fsp.writeFile(path.join(outDir, "diff.json"), JSON.stringify(diffJson, null, 2));
  await fsp.writeFile(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

  return { baseJson, headJson, diffJson };
}

/* ---------------- Exports ---------------- */

module.exports = analyzeRefs;                // default
module.exports.analyzeRefs = analyzeRefs;    // named
module.exports.analyzeOneRef = analyzeOneRef;
module.exports.makeDiff = makeDiff;
