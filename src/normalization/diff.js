// Phase 2.2 diff between base.json and head.json using match_key and states NEW/REMOVED/UNCHANGED. :contentReference[oaicite:8]{index=8}
const { normalizeSeverity } = require('./utils');
const { buildDiffSummary } = require('./summarize');

// Computes POM dependency diff based ONLY on explicit dependencies declared in pom.xml files.
// Input arrays: [{ groupId, artifactId, version }]
function computePomDependencyDiff(pomBaseDeps = [], pomHeadDeps = []) {
  const baseMap = new Map();
  const headMap = new Map();
  for (const d of pomBaseDeps || []) {
    if (!d.groupId || !d.artifactId) continue;
    baseMap.set(`${d.groupId}::${d.artifactId}`, d.version || '');
  }
  for (const d of pomHeadDeps || []) {
    if (!d.groupId || !d.artifactId) continue;
    headMap.set(`${d.groupId}::${d.artifactId}`, d.version || '');
  }
  const allKeys = new Set([...baseMap.keys(), ...headMap.keys()]);
  const items = [];
  let NEW = 0, REMOVED = 0, UPDATED = 0, UNCHANGED = 0;
  for (const key of [...allKeys].sort()) {
    const [groupId, artifactId] = key.split('::');
    const bVer = baseMap.get(key);
    const hVer = headMap.get(key);
    let state; let baseVersion = bVer || null; let headVersion = hVer || null;
    if (bVer && hVer) {
      if (bVer === hVer) { state = 'UNCHANGED'; UNCHANGED++; }
      else { state = 'UPDATED'; UPDATED++; }
    } else if (bVer && !hVer) { state = 'REMOVED'; REMOVED++; }
    else if (!bVer && hVer) { state = 'NEW'; NEW++; }
    else continue;
    items.push({ groupId, artifactId, baseVersion, headVersion, state });
  }
  return { totals: { NEW, REMOVED, UPDATED, UNCHANGED }, items };
}

// Computes SBOM component dependency diff (includes transitive dependencies)
// Input arrays: [{ groupId, artifactId, version, key, purl }]
function computeSbomDependencyDiff(baseComponents = [], headComponents = []) {
  const baseMap = new Map();
  const headMap = new Map();

  for (const c of baseComponents || []) {
    if (!c.groupId || !c.artifactId) continue;
    const key = `${c.groupId}::${c.artifactId}`;
    baseMap.set(key, c.version || '');
  }

  for (const c of headComponents || []) {
    if (!c.groupId || !c.artifactId) continue;
    const key = `${c.groupId}::${c.artifactId}`;
    headMap.set(key, c.version || '');
  }

  const allKeys = new Set([...baseMap.keys(), ...headMap.keys()]);
  const items = [];
  let NEW = 0, REMOVED = 0, UPDATED = 0, UNCHANGED = 0;

  for (const key of [...allKeys].sort()) {
    const [groupId, artifactId] = key.split('::');
    const bVer = baseMap.get(key);
    const hVer = headMap.get(key);
    let state; let baseVersion = bVer || null; let headVersion = hVer || null;

    if (bVer && hVer) {
      if (bVer === hVer) { state = 'UNCHANGED'; UNCHANGED++; }
      else { state = 'UPDATED'; UPDATED++; }
    } else if (bVer && !hVer) { state = 'REMOVED'; REMOVED++; }
    else if (!bVer && hVer) { state = 'NEW'; NEW++; }
    else continue;

    items.push({ groupId, artifactId, baseVersion, headVersion, state });
  }

  return { totals: { NEW, REMOVED, UPDATED, UNCHANGED }, items };
}

function mapByKey(arr) { const m = new Map(); for (const v of arr || []) m.set(v.match_key, v); return m; }

function buildDiff(baseDoc, headDoc, meta, { pomBaseDeps = [], pomHeadDeps = [], sbomBaseComponents = [], sbomHeadComponents = [] } = {}) {
  const B = mapByKey(baseDoc?.vulnerabilities || []);
  const H = mapByKey(headDoc?.vulnerabilities || []);
  const items = []; const seen = new Set();
  for (const [k, b] of B.entries()) {
    if (H.has(k)) {
      const h = H.get(k);
      items.push({ state: 'UNCHANGED', branches: 'BOTH', ...h, severity: normalizeSeverity(h.severity) });
    } else {
      items.push({ state: 'REMOVED', branches: 'BASE', ...b, severity: normalizeSeverity(b.severity) });
    }
    seen.add(k);
  }
  for (const [k, h] of H.entries()) {
    if (seen.has(k)) continue;
    items.push({ state: 'NEW', branches: 'HEAD', ...h, severity: normalizeSeverity(h.severity) });
  }
  const summary = buildDiffSummary(items);

  // Compute dependency diffs: try SBOM components first (más completo), fallback a POM explicit deps
  let dependency_pom_diff = null;
  let dependency_changes = {};

  if (sbomBaseComponents?.length > 0 || sbomHeadComponents?.length > 0) {
    // Usar componentes SBOM (más completo, incluye transitivas)
    const sbomDiff = computeSbomDependencyDiff(sbomBaseComponents, sbomHeadComponents);
    dependency_changes.maven = sbomDiff;
    dependency_pom_diff = sbomDiff;
  } else if (pomBaseDeps?.length > 0 || pomHeadDeps?.length > 0) {
    // Fallback a POM explicit dependencies (legacy)
    const pomDiff = computePomDependencyDiff(pomBaseDeps, pomHeadDeps);
    dependency_changes.maven = pomDiff;
    dependency_pom_diff = pomDiff;
  } else {
    // No dependency data available
    dependency_changes = {};
    dependency_pom_diff = { totals: { NEW: 0, REMOVED: 0, UPDATED: 0, UNCHANGED: 0 }, items: [] };
  }

  return {
    schema_version: '2.0.0',
    generated_at: new Date().toISOString(),
    inputs: meta?.inputs || null,
    repo: meta?.repo || null,
    tools: meta?.tools || null,
    base: baseDoc?.git || null,
    head: headDoc?.git || null,
    summary,
    dependency_pom_diff,
    dependency_changes,
    items,
  };
}

module.exports = { buildDiff, computePomDependencyDiff, computeSbomDependencyDiff };
