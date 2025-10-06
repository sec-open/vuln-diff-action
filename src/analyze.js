// src/analyze.js
// Phase 1 — Analysis: produce normalized JS objects for base/head (SBOM + Grype)

const path = require("path");
const fs = require("fs");
const exec = require("@actions/exec");
const { generateSbomAuto } = require("./sbom");
const { scanSbom } = require("./grype");

// util
async function sh(cmd, opts = {}) {
  return exec.exec("bash", ["-lc", cmd], opts);
}

// severity helpers
const SEV_ORDER_LIST = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SEV_TO_RANK = new Map(SEV_ORDER_LIST.map((s, i) => [s, i]));
function normSev(s) {
  const v = String(s || "UNKNOWN").toUpperCase();
  return SEV_TO_RANK.has(v) ? v : "UNKNOWN";
}
function worseSeverity(a, b) {
  // pick the worst (higher rank index in our order list)
  const ra = SEV_TO_RANK.get(normSev(a)) ?? 0;
  const rb = SEV_TO_RANK.get(normSev(b)) ?? 0;
  return ra >= rb ? a : b;
}
function worseByScore(aScore, bScore) {
  return (bScore ?? 0) > (aScore ?? 0);
}

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

// Extract a “max CVSS” quick view from grype-like entry
function maxCvss(v) {
  const list = Array.isArray(v?.cvss) ? v.cvss : [];
  let best = null;
  for (const c of list) {
    const score = Number(c?.metrics?.score ?? c?.baseScore ?? 0);
    if (!best || score > best.score) {
      best = {
        score,
        vector: c?.vectorString || c?.vector || undefined,
      };
    }
  }
  return best || undefined;
}

// Normalize raw Grype matches -> flat objects we use everywhere
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
      // identity
      id,
      ids: {
        ghsa: ghsa || undefined,
        cve:  cve || undefined,
      },
      // display
      severity,
      dataSource: v.dataSource || "",
      description: v.description || "",
      urls: Array.isArray(v.urls) ? v.urls : [],
      cvss: Array.isArray(v.cvss) ? v.cvss : [],
      cvss_max: maxCvss(v),
      advisories: Array.isArray(v.advisories) ? v.advisories : [],
      // package (representative occurrence)
      package: a.name || "",
      version: a.version || "",
      type: a.type || "",
      purl: a.purl || "",
      locations: Array.isArray(a.locations) ? a.locations : [],
      // related IDs if any
      related: Array.isArray(m.relatedVulnerabilities) ? m.relatedVulnerabilities.map(r => r.id) : [],
      // stable match key by vulnerability ID only
      match_key: keyFromIds({ vulnerability: { id, ids: idsArr } }),
      // raw for traceability
      _raw: m,
    };
  });
}

// Deduplicate a list of normalized findings by match_key (ID only)
// Keep the "worst" instance: higher severity; tie -> higher cvss score
function dedupeByIdKeepingWorst(arr) {
  const map = new Map();
  for (const it of arr || []) {
    const k = it.match_key;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, it);
    } else {
      const prevSev = normSev(prev.severity);
      const curSev  = normSev(it.severity);
      const prevRank = SEV_TO_RANK.get(prevSev) ?? 0;
      const curRank  = SEV_TO_RANK.get(curSev) ?? 0;

      if (curRank > prevRank) {
        map.set(k, it);
      } else if (curRank === prevRank) {
        const prevScore = prev?.cvss_max?.score ?? 0;
        const curScore  = it?.cvss_max?.score ?? 0;
        if (curScore > prevScore) map.set(k, it);
      }
    }
  }
  return Array.from(map.values());
}

// Phase 1: analyze one ref (SBOM + Grype) -> normalized & deduped by ID
async function analyzeOneRef(refLabel, worktreeDir, scanPath, outSbomPath, minSeverity = "LOW") {
  // SBOM (CycloneDX if Maven; else Syft directory)
  await generateSbomAuto(path.join(worktreeDir, scanPath), outSbomPath);

  // Grype scan
  const grype = await scanSbom(outSbomPath);

  // Normalize, filter by min severity, dedupe by ID keeping worst occurrence
  const all = normalizeMatches(grype);

  const sevRank = (s) => {
    const i = SEV_ORDER_LIST.indexOf(normSev(s));
    return i >= 0 ? i : 0;
  };
  const threshold = sevRank(minSeverity);
  const meets = (s) => sevRank(s) >= threshold; // because list asc: UNKNOWN(0)..CRITICAL(4)

  const filtered = all.filter(x => meets(x.severity));
  const items = dedupeByIdKeepingWorst(filtered);

  return { sbomPath: outSbomPath, grypeRaw: grype, items };
}

// Phase 1 diff (ID-based): NEW/REMOVED/UNCHANGED
function makeDiff(baseItems, headItems, minSeverity) {
  // Build maps by ID after deduplication by ID (keep worst per ID again defensively)
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

  // Sort by severity (worst first), then id
  const sevRank = (s) => {
    const i = SEV_ORDER_LIST.indexOf(normSev(s));
    return i >= 0 ? i : 0;
  };
  const cmp = (a, b) => {
    const da = sevRank(a.severity);
    const db = sevRank(b.severity);
    if (da !== db) return db - da; // worst first
    return String(a.id || "").localeCompare(String(b.id || ""));
  };

  news.sort(cmp);
  removed.sort(cmp);
  unchanged.sort(cmp);

  return { news, removed, unchanged };
}

module.exports = { analyzeOneRef, makeDiff };
