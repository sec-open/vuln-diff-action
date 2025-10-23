// Phase 2.2 diff between base.json and head.json using match_key and states NEW/REMOVED/UNCHANGED. :contentReference[oaicite:8]{index=8}
const { normalizeSeverity } = require('./utils');
const { buildDiffSummary } = require('./summarize');

// Builds a map keyed by match_key for quick lookup.
function mapByKey(arr) {
  const m = new Map();
  for (const v of arr || []) m.set(v.match_key, v);
  return m;
}

// Compute dependency inventory diff: identifies ADDED, REMOVED, VERSION_CHANGED libs.
// baseComponents/headComponents: arrays with at least { key, groupId, artifactId, version, purl }
function computeDependencyDiff(baseComponents = [], headComponents = [], diffItems = []) {
  const idxBase = new Map();
  const idxHead = new Map();

  function ingest(list, target) {
    for (const c of list) {
      if (!c || !c.key) continue;
      if (!target.has(c.key)) target.set(c.key, { key: c.key, groupId: c.groupId, artifactId: c.artifactId, versions: new Set(), purls: new Set() });
      const rec = target.get(c.key);
      if (c.version) rec.versions.add(c.version);
      if (c.purl) rec.purls.add(c.purl);
    }
  }
  ingest(baseComponents, idxBase);
  ingest(headComponents, idxHead);

  const allKeys = new Set([...idxBase.keys(), ...idxHead.keys()]);
  const items = [];
  let added = 0, removed = 0, versionChanged = 0;
  let totalNewVulns = 0, totalRemovedVulns = 0;

  // Pre-index vulnerabilities NEW and REMOVED by (groupId::artifactId::version)
  const newVulnsByKeyVersion = new Map();
  const removedVulnsByKeyVersion = new Map();
  for (const v of diffItems) {
    const pkg = v.package || {}; const g = pkg.groupId; const a = pkg.artifactId; const ver = pkg.version; if (!g || !a || !ver) continue;
    const base = `${g}::${a}::${ver}`;
    if (v.state === 'NEW') {
      if (!newVulnsByKeyVersion.has(base)) newVulnsByKeyVersion.set(base, []);
      newVulnsByKeyVersion.get(base).push({ id: v.id, severity: v.severity, version: ver });
    } else if (v.state === 'REMOVED') {
      if (!removedVulnsByKeyVersion.has(base)) removedVulnsByKeyVersion.set(base, []);
      removedVulnsByKeyVersion.get(base).push({ id: v.id, severity: v.severity, version: ver });
    }
  }

  for (const key of [...allKeys].sort()) {
    const b = idxBase.get(key);
    const h = idxHead.get(key);
    if (b && !h) {
      removed++;
      // All removed vulnerabilities for versions present in base side
      const removed_vulns = [...b.versions].flatMap(ver => removedVulnsByKeyVersion.get(`${b.groupId}::${b.artifactId}::${ver}`) || []);
      totalRemovedVulns += removed_vulns.length;
      items.push({
        state: 'REMOVED',
        key,
        groupId: b.groupId,
        artifactId: b.artifactId,
        baseVersions: [...b.versions].sort(),
        headVersions: [],
        baseVersion: [...b.versions][0] || null,
        headVersion: null,
        removed_vulns,
        new_vulns: [],
        new_vulns_count: 0,
        removed_vulns_count: removed_vulns.length,
      });
    } else if (!b && h) {
      added++;
      const new_vulns = [...h.versions].flatMap(ver => newVulnsByKeyVersion.get(`${h.groupId}::${h.artifactId}::${ver}`) || []);
      totalNewVulns += new_vulns.length;
      items.push({
        state: 'ADDED',
        key,
        groupId: h.groupId,
        artifactId: h.artifactId,
        baseVersions: [],
        headVersions: [...h.versions].sort(),
        baseVersion: null,
        headVersion: [...h.versions][0] || null,
        new_vulns,
        removed_vulns: [],
        new_vulns_count: new_vulns.length,
        removed_vulns_count: 0,
      });
    } else if (b && h) {
      const bVers = [...b.versions].sort();
      const hVers = [...h.versions].sort();
      const same = bVers.length === hVers.length && bVers.every((v, i) => v === hVers[i]);
      if (!same) {
        versionChanged++;
        const baseSet = new Set(bVers); const headSet = new Set(hVers);
        const newVersions = hVers.filter(v => !baseSet.has(v));
        const removedVersions = bVers.filter(v => !headSet.has(v));
        const new_vulns = newVersions.flatMap(ver => newVulnsByKeyVersion.get(`${h.groupId}::${h.artifactId}::${ver}`) || []);
        const removed_vulns = removedVersions.flatMap(ver => removedVulnsByKeyVersion.get(`${b.groupId}::${b.artifactId}::${ver}`) || []);
        totalNewVulns += new_vulns.length;
        totalRemovedVulns += removed_vulns.length;
        items.push({
          state: 'VERSION_CHANGED',
          key,
          groupId: h.groupId || b.groupId,
          artifactId: h.artifactId || b.artifactId,
          baseVersions: bVers,
          headVersions: hVers,
          baseVersion: bVers[0] || null,
          headVersion: hVers[0] || null,
          new_versions: newVersions,
          removed_versions: removedVersions,
          new_vulns,
          removed_vulns,
          new_vulns_count: new_vulns.length,
          removed_vulns_count: removed_vulns.length,
        });
      }
    }
  }

  return {
    totals: { ADDED: added, REMOVED: removed, VERSION_CHANGED: versionChanged, NEW_VULNS: totalNewVulns, REMOVED_VULNS: totalRemovedVulns },
    items,
  };
}

// Computes diff states (NEW / REMOVED / UNCHANGED) between base and head vulnerability sets.
// - UNCHANGED: present in both; takes HEAD side data for freshness.
// - REMOVED: present only in BASE.
// - NEW: present only in HEAD.
// Attaches normalized severity and builds a summary object.
const SEVERITY_ORDER = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
const SEVERITY_WEIGHT = { CRITICAL:5, HIGH:4, MEDIUM:3, LOW:2, UNKNOWN:1 };

function sortVulnsBySeverity(arr = []) {
  return arr.slice().sort((a,b)=> (SEVERITY_WEIGHT[String(b.severity||'UNKNOWN').toUpperCase()]||0) - (SEVERITY_WEIGHT[String(a.severity||'UNKNOWN').toUpperCase()]||0));
}

function computeDirectDependencyChanges(moduleChanges = [], diffItems = []) {
  const acc = new Map(); // key -> { groupId, artifactId, baseVersions:Set, headVersions:Set }
  for (const mod of moduleChanges || []) {
    for (const ch of mod.changes || []) {
      const key = `${ch.groupId}::${ch.artifactId}`;
      if (!acc.has(key)) acc.set(key, { groupId: ch.groupId, artifactId: ch.artifactId, baseVersions: new Set(), headVersions: new Set() });
      const rec = acc.get(key);
      (ch.baseVersions||[]).forEach(v=> rec.baseVersions.add(v));
      (ch.headVersions||[]).forEach(v=> rec.headVersions.add(v));
    }
  }
  const changes = [];
  const itemsByGA = new Map();
  for (const it of diffItems || []) {
    const pkg = it.package || {}; const g = pkg.groupId; const a = pkg.artifactId; const v = pkg.version; if (!g||!a||!v) continue;
    const k = `${g}::${a}::${v}`;
    if (!itemsByGA.has(k)) itemsByGA.set(k, []);
    itemsByGA.get(k).push(it);
  }
  for (const [key, rec] of acc.entries()) {
    const baseArr = [...rec.baseVersions].sort();
    const headArr = [...rec.headVersions].sort();
    let change_type;
    if (baseArr.length && headArr.length) {
      const same = baseArr.length === headArr.length && baseArr.every((v,i)=>v===headArr[i]);
      change_type = same ? 'UNCHANGED' : 'UPDATED';
      if (same) continue; // omit unchanged dependencies
    } else if (baseArr.length && !headArr.length) {
      change_type = 'REMOVED';
    } else if (!baseArr.length && headArr.length) {
      change_type = 'ADDED';
    } else { continue; }

    const NEW = []; const REMOVED = []; const UNCHANGED = [];
    const baseSet = new Set(baseArr); const headSet = new Set(headArr); const commonSet = new Set([...baseArr.filter(v=>headSet.has(v))]);
    for (const v of headArr) {
      const list = itemsByGA.get(`${rec.groupId}::${rec.artifactId}::${v}`) || [];
      for (const it of list) {
        if (it.state === 'NEW') NEW.push({ id: it.id, severity: it.severity, state: it.state, version: v });
        if (it.state === 'UNCHANGED' && commonSet.has(v)) UNCHANGED.push({ id: it.id, severity: it.severity, state: it.state, version: v });
      }
    }
    for (const v of baseArr) {
      const list = itemsByGA.get(`${rec.groupId}::${rec.artifactId}::${v}`) || [];
      for (const it of list) {
        if (it.state === 'REMOVED') REMOVED.push({ id: it.id, severity: it.severity, state: it.state, version: v });
        if (it.state === 'UNCHANGED' && commonSet.has(v)) UNCHANGED.push({ id: it.id, severity: it.severity, state: it.state, version: v });
      }
    }
    const change = {
      groupId: rec.groupId,
      artifactId: rec.artifactId,
      change_type,
      baseVersions: baseArr,
      headVersions: headArr,
      vulnerabilities: {
        NEW: sortVulnsBySeverity(NEW),
        REMOVED: sortVulnsBySeverity(REMOVED),
        UNCHANGED: sortVulnsBySeverity(UNCHANGED),
      },
      counts: { NEW: NEW.length, REMOVED: REMOVED.length, UNCHANGED: UNCHANGED.length },
    };
    changes.push(change);
  }
  changes.sort((a,b)=>`${a.groupId}:${a.artifactId}`.localeCompare(`${b.groupId}:${b.artifactId}`,'en',{sensitivity:'base'}));
  const totals = changes.reduce((acc,c)=>{ acc.CHANGES=(acc.CHANGES||0)+1; acc.NEW_VULNS=(acc.NEW_VULNS||0)+c.counts.NEW; acc.REMOVED_VULNS=(acc.REMOVED_VULNS||0)+c.counts.REMOVED; acc.UNCHANGED_VULNS=(acc.UNCHANGED_VULNS||0)+c.counts.UNCHANGED; return acc; }, {});
  return { totals, changes };
}

// Computes per-module direct dependency differences (POM-like) between base and head inventories.
// Each inventory entry: { module:{groupId,artifactId}, dependencies:[{groupId,artifactId,versions:[]}] }
function computeModuleDependencyDiff(baseModules = [], headModules = []) {
  function toMap(mods) {
    const m = new Map();
    for (const entry of mods || []) {
      if (!entry?.module) continue;
      const { groupId, artifactId } = entry.module;
      const key = `${groupId}::${artifactId}`;
      m.set(key, entry);
    }
    return m;
  }
  const B = toMap(baseModules);
  const H = toMap(headModules);
  const allModuleKeys = new Set([...B.keys(), ...H.keys()]);
  const modules = [];
  let depAdded = 0, depRemoved = 0, depVersionChanged = 0;

  function indexDeps(entry) {
    const map = new Map();
    for (const d of entry?.dependencies || []) {
      const dKey = `${d.groupId}::${d.artifactId}`;
      map.set(dKey, d);
    }
    return map;
  }

  for (const modKey of [...allModuleKeys].sort()) {
    const b = B.get(modKey);
    const h = H.get(modKey);
    const changes = [];

    if (b && !h) {
      const bDeps = indexDeps(b);
      for (const dep of bDeps.values()) {
        depRemoved++;
        changes.push({ state: 'REMOVED', groupId: dep.groupId, artifactId: dep.artifactId, baseVersions: dep.versions || [], headVersions: [] });
      }
    } else if (!b && h) {
      const hDeps = indexDeps(h);
      for (const dep of hDeps.values()) {
        depAdded++;
        changes.push({ state: 'ADDED', groupId: dep.groupId, artifactId: dep.artifactId, baseVersions: [], headVersions: dep.versions || [] });
      }
    } else if (b && h) {
      const bDeps = indexDeps(b);
      const hDeps = indexDeps(h);
      const allDepKeys = new Set([...bDeps.keys(), ...hDeps.keys()]);
      for (const dKey of allDepKeys) {
        const bd = bDeps.get(dKey);
        const hd = hDeps.get(dKey);
        if (bd && !hd) {
          depRemoved++;
          changes.push({ state: 'REMOVED', groupId: bd.groupId, artifactId: bd.artifactId, baseVersions: bd.versions || [], headVersions: [] });
        } else if (!bd && hd) {
          depAdded++;
          changes.push({ state: 'ADDED', groupId: hd.groupId, artifactId: hd.artifactId, baseVersions: [], headVersions: hd.versions || [] });
        } else if (bd && hd) {
          const bVers = [...(bd.versions || [])].sort();
          const hVers = [...(hd.versions || [])].sort();
          const same = bVers.length === hVers.length && bVers.every((v,i)=>v===hVers[i]);
          if (!same) {
            depVersionChanged++;
            changes.push({ state: 'VERSION_CHANGED', groupId: hd.groupId || bd.groupId, artifactId: hd.artifactId || bd.artifactId, baseVersions: bVers, headVersions: hVers });
          }
        }
      }
    }

    if (changes.length) {
      const [moduleGroupId, moduleArtifactId] = modKey.split('::');
      modules.push({ moduleKey: modKey, moduleGroupId, moduleArtifactId, changes });
    }
  }

  return {
    totals: { MODULES_CHANGED: modules.length, DEP_ADDED: depAdded, DEP_REMOVED: depRemoved, DEP_VERSION_CHANGED: depVersionChanged },
    modules,
  };
}

function buildDiff(baseDoc, headDoc, meta, { baseComponents, headComponents, baseModulesInv, headModulesInv } = {}) {
  const B = mapByKey(baseDoc?.vulnerabilities || []);
  const H = mapByKey(headDoc?.vulnerabilities || []);

  const items = [];
  const seen = new Set();

  // Iterate base side to mark UNCHANGED or REMOVED.
  for (const [k, b] of B.entries()) {
    if (H.has(k)) {
      const h = H.get(k);
      items.push({
        state: 'UNCHANGED',
        branches: 'BOTH',
        ...h,
        severity: normalizeSeverity(h.severity),
      });
    } else {
      items.push({
        state: 'REMOVED',
        branches: 'BASE',
        ...b,
        severity: normalizeSeverity(b.severity),
      });
    }
    seen.add(k);
  }

  // Add remaining head entries as NEW.
  for (const [k, h] of H.entries()) {
    if (seen.has(k)) continue;
    items.push({
      state: 'NEW',
      branches: 'HEAD',
      ...h,
      severity: normalizeSeverity(h.severity),
    });
  }

  // Build diff summary aggregations.
  const summary = buildDiffSummary(items);

  // Compute dependency difference if inventories provided (after items so we can correlate vuln states).
  const dependency_diff = (baseComponents || headComponents)
    ? computeDependencyDiff(baseComponents, headComponents, items)
    : null;
  const dependency_module_diff = (baseModulesInv || headModulesInv)
    ? computeModuleDependencyDiff(baseModulesInv, headModulesInv)
    : null;
  const direct_dependency_changes = dependency_module_diff
    ? computeDirectDependencyChanges(dependency_module_diff.modules, items)
    : null;

  // Final diff document payload.
  const out = {
    schema_version: '2.0.0',
    generated_at: new Date().toISOString(),
    inputs: meta?.inputs || null,
    repo: meta?.repo || null,
    tools: meta?.tools || null,
    base: baseDoc?.git || null,
    head: headDoc?.git || null,
    summary,
    dependency_diff,
    dependency_module_diff,
    direct_dependency_changes,
    items,
  };

  return out;
}

module.exports = { buildDiff, computeDependencyDiff, computeModuleDependencyDiff, computeDirectDependencyChanges };
