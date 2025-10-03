/**
 * Common helpers for building normalized JSON objects (schema v2.0.0).
 */

const { normalizeSeverity, severityRank } = require("./severity");

function pickPreferredUrl(ids = {}, urls = []) {
  // Prefer GHSA → GitHub Advisory; else CVE → NVD; else first url.
  if (ids.ghsa) return `https://github.com/advisories/${ids.ghsa}`;
  if (ids.cve) return `https://nvd.nist.gov/vuln/detail/${ids.cve}`;
  return urls && urls.length ? urls[0] : "";
}

function shortSha(sha) {
  return String(sha || "").slice(0, 7);
}

function cvssMax(scores = []) {
  // scores: [{ source, score, vector, severity }]
  let max = null;
  for (const s of scores) {
    if (!s || typeof s.score !== "number") continue;
    if (!max || s.score > max.score) max = s;
  }
  return max ? { score: max.score, severity: normalizeSeverity(max.severity || "") } : null;
}

function matchKey(id, pkg) {
  const name = pkg?.name || "unknown";
  const ver = (pkg?.version && String(pkg.version).trim()) || "-";
  return `${id}::${name}::${ver}`;
}

/**
 * Normalize a single Grype match into our schema item.
 */
function normalizeFinding(raw) {
  // Adapt to Grype JSON shape (v0.80+)
  // We expect fields like: vulnerability.id, artifact.name/version, related, fix, cvss, severity...
  const v = raw?.vulnerability || {};
  const a = raw?.artifact || raw?.package || {};
  const ids = {
    ghsa: (v.id || "").startsWith("GHSA-") ? v.id : (Array.isArray(v.aliases) ? v.aliases.find(x => x.startsWith("GHSA-")) : undefined),
    cve: (v.id || "").startsWith("CVE-") ? v.id : (Array.isArray(v.aliases) ? v.aliases.find(x => x.startsWith("CVE-")) : undefined),
  };
  const id = v.id || ids.ghsa || ids.cve || "UNKNOWN-ID";
  const aliases = Array.isArray(v.aliases) ? v.aliases : [];
  const severity = normalizeSeverity(v.severity);
  const cvss = Array.isArray(v.cvss) ? v.cvss.map(c => ({
    source: c.source,
    score: typeof c.metrics?.baseScore === "number" ? c.metrics.baseScore : c.baseScore || c.score,
    vector: c.vector || c.vectorString,
    severity: normalizeSeverity(c.severity || v.severity),
  })) : [];
  const pkg = {
    name: a.name || a.pkgName || a.package || "unknown",
    version: a.version || a.pkgVersion || a.versionConstraint || "-",
    type: a.type || a.pkgType || a.language || undefined,
    purl: a.purl || undefined,
  };
  const item = {
    id,
    aliases,
    url: pickPreferredUrl(ids, v.dataSource ? [v.dataSource] : []),
    severity,
    cvss,
    cvss_max: cvssMax(cvss),
    description: v.description || "",
    data_source: v.dataSource || "",
    fix: v.fix ? {
      available: v.fix.state === "fixed" || (Array.isArray(v.fix.versions) && v.fix.versions.length > 0),
      fixed_in: Array.isArray(v.fix.versions) ? v.fix.versions : [],
    } : undefined,
    package: pkg,
    locations: Array.isArray(raw.matchDetails) ? raw.matchDetails.map(d => d.searchedBy?.location || d.matcher || "").filter(Boolean) : [],
    match_key: matchKey(id, pkg),
    related: Array.isArray(v.relatedVulnerabilities) ? v.relatedVulnerabilities : [],
  };
  return item;
}

/**
 * Summaries by severity for an array of normalized items.
 */
function summarizeBySeverity(items) {
  const sum = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const it of items) sum[normalizeSeverity(it.severity)]++;
  const total = items.length;
  return { total, by_severity: sum };
}

/**
 * Compute diff between two arrays of normalized items (by match_key).
 * Returns { new:[], removed:[], unchanged_count:number }
 */
function computeDiff(baseItems, headItems) {
  const baseMap = new Map(baseItems.map(it => [it.match_key, it]));
  const headMap = new Map(headItems.map(it => [it.match_key, it]));
  const NEW = [];
  const REMOVED = [];
  let UNCHANGED = 0;

  for (const [k, hv] of headMap.entries()) {
    if (!baseMap.has(k)) NEW.push(hv);
    else UNCHANGED++;
  }
  for (const [k, bv] of baseMap.entries()) {
    if (!headMap.has(k)) REMOVED.push(bv);
  }

  // Deterministic ordering: severity desc (critical first), then id+package
  const keyStr = (it) => `${it.id}::${it.package?.name || ""}::${it.package?.version || ""}`;
  const sortFn = (a, b) => {
    const s = severityRank(a.severity) - severityRank(b.severity);
    if (s !== 0) return s;
    return keyStr(a).localeCompare(keyStr(b));
    };
  NEW.sort(sortFn);
  REMOVED.sort(sortFn);

  return { new: NEW, removed: REMOVED, unchanged_count: UNCHANGED };
}

module.exports = {
  normalizeFinding,
  summarizeBySeverity,
  computeDiff,
  matchKey,
  shortSha,
  pickPreferredUrl,
};
