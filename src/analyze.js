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
  return { sbomPath: outSbomPath, grypeRaw: grype, items: normalized };
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

  for (const [k, v] of mh) {
    if (!mb.has(k)) news.push(v);
    else unchanged.push(v);
  }
  for (const [k, v] of mb) {
    if (!mh.has(k)) removed.push(v);
  }

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

module.exports = {
  analyzeOneRef,
  makeDiff,
};
