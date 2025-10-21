// src/render/common/precompute.js
// Pre-aggregaciones a partir de diff.json.

const {
  deriveModulesAndModulePaths,
  extractModuleAndTailFromSinglePath,
  extractRootGroupIdFromFirstHop,
  parseGav,
  parseHop,
} = require('./path-helpers');

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const RISK_WEIGHTS = { CRITICAL: 5, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

function safeNum(n) { const x = Number(n); return Number.isFinite(x) ? x : 0; }

function bySeverityInHead(bySevState = {}) {
  const out = {};
  for (const sev of SEVERITIES) {
    const row = bySevState[sev] || {};
    out[sev] = safeNum(row.NEW) + safeNum(row.UNCHANGED);
  }
  return out;
}
function bySeverityInBase(bySevState = {}) {
  const out = {};
  for (const sev of SEVERITIES) {
    const row = bySevState[sev] || {};
    out[sev] = safeNum(row.REMOVED) + safeNum(row.UNCHANGED);
  }
  return out;
}
function headVsBaseBySeverity(bySevState = {}) {
  const head = bySeverityInHead(bySevState);
  const base = bySeverityInBase(bySevState);
  const out = {};
  for (const sev of SEVERITIES) out[sev] = { head: safeNum(head[sev]), base: safeNum(base[sev]) };
  return out;
}
function severityTotalsOverall(bySevState = {}) {
  const out = {};
  for (const sev of SEVERITIES) {
    const row = bySevState[sev] || {};
    out[sev] = safeNum(row.NEW) + safeNum(row.REMOVED) + safeNum(row.UNCHANGED);
  }
  return out;
}
function topComponentsHead(items = [], topN = 10) {
  const map = new Map();
  for (const it of items) {
    const state = String(it.state || '').toUpperCase();
    if (state !== 'NEW' && state !== 'UNCHANGED') continue;
    const pkg = it.package || {};
    const gav = `${pkg.groupId ?? 'unknown'}:${pkg.artifactId ?? 'unknown'}:${pkg.version ?? 'unknown'}`;
    const prev = map.get(gav) || { gav, componentRef: it.componentRef, count: 0 };
    prev.count += 1;
    if (!prev.componentRef && it.componentRef) prev.componentRef = it.componentRef;
    map.set(gav, prev);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, topN);
}

function inferHasFix(item) {
  if (typeof item.has_fix === 'boolean') return item.has_fix;
  const candidates = [ item.fixed_versions, item.fix_versions, item.fix?.versions, item.fixes ];
  for (const c of candidates) if (Array.isArray(c) && c.length) return true;
  return false;
}
function fixesHeadAggregates(items = []) {
  const bySev = {}; let withFix = 0, withoutFix = 0;
  for (const sev of SEVERITIES) bySev[sev] = { with_fix: 0, without_fix: 0 };
  for (const it of items) {
    const s = String(it.state || '').toUpperCase();
    if (s !== 'NEW' && s !== 'UNCHANGED') continue;
    const sev = String(it.severity || 'UNKNOWN').toUpperCase();
    const hasFix = inferHasFix(it);
    if (hasFix) { bySev[sev].with_fix++; withFix++; } else { bySev[sev].without_fix++; withoutFix++; }
  }
  return { by_severity: bySev, totals: { with_fix: withFix, without_fix: withoutFix } };
}
function fixesNewAggregates(items = []) {
  const bySev = {}; let withFix = 0, withoutFix = 0;
  for (const sev of SEVERITIES) bySev[sev] = { with_fix: 0, without_fix: 0 };
  for (const it of items) {
    const s = String(it.state || '').toUpperCase();
    if (s !== 'NEW') continue;
    const sev = String(it.severity || 'UNKNOWN').toUpperCase();
    const hasFix = inferHasFix(it);
    if (hasFix) { bySev[sev].with_fix++; withFix++; } else { bySev[sev].without_fix++; withoutFix++; }
  }
  return { by_severity: bySev, totals: { with_fix: withFix, without_fix: withoutFix } };
}

function weightedSumBySeverity(mapSevCount = {}) {
  let total = 0;
  for (const sev of SEVERITIES) total += (RISK_WEIGHTS[sev] || 0) * safeNum(mapSevCount[sev]);
  return total;
}
function netRiskKpis(bySevState = {}) {
  const newBySev = {}, removedBySev = {}, headBySev = {}, baseBySev = {};
  for (const sev of SEVERITIES) {
    const row = bySevState[sev] || {};
    const NEW = safeNum(row.NEW), REMOVED = safeNum(row.REMOVED), UNCHANGED = safeNum(row.UNCHANGED);
    newBySev[sev] = NEW;
    removedBySev[sev] = REMOVED;
    headBySev[sev] = NEW + UNCHANGED;
    baseBySev[sev] = REMOVED + UNCHANGED;
  }
  return {
    weights: { ...RISK_WEIGHTS },
    components: {
      newWeighted: weightedSumBySeverity(newBySev),
      removedWeighted: weightedSumBySeverity(removedBySev),
    },
    kpis: {
      netRisk: weightedSumBySeverity(newBySev) - weightedSumBySeverity(removedBySev),
      baseStockRisk: weightedSumBySeverity(baseBySev),
      headStockRisk: weightedSumBySeverity(headBySev),
    },
  };
}

function aggregatesByModuleSeverityState(items = []) {
  const out = {};
  for (const it of items) {
    const { modules } = deriveModulesAndModulePaths(it);
    const sev = String(it.severity || 'UNKNOWN').toUpperCase();
    const st  = String(it.state || '').toUpperCase();
    for (const m of modules) {
      out[m] = out[m] || {};
      out[m][sev] = out[m][sev] || { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
      if (st === 'NEW' || st === 'REMOVED' || st === 'UNCHANGED') out[m][sev][st]++;
    }
  }
  return out;
}

function listMultiModuleItems(items = []) {
  const res = [];
  for (const it of items) {
    const { modules } = deriveModulesAndModulePaths(it);
    if (modules.length > 1) {
      res.push({
        id: it.id || it.vulnerabilityId || '',
        severity: String(it.severity || 'UNKNOWN').toUpperCase(),
        state: String(it.state || '').toUpperCase(),
        modules,
      });
    }
  }
  return { total: res.length, items: res };
}

function precomputeFromDiff(diff) {
  if (!diff || typeof diff !== 'object') throw new Error('[precompute] invalid diff object');

  const bySevState = diff?.summary?.by_severity_and_state || {};
  const items = Array.isArray(diff.items) ? diff.items : [];

  return {
    summary: {
      by_severity_in_head: bySeverityInHead(bySevState),
      by_severity_in_base: bySeverityInBase(bySevState),
      severity_totals_overall: severityTotalsOverall(bySevState),
    },
    aggregates: {
      head_vs_base_by_severity: headVsBaseBySeverity(bySevState),
      top_components_head: topComponentsHead(items, 10),
      fixes_head: fixesHeadAggregates(items),
      fixes_new: fixesNewAggregates(items),
      risk: netRiskKpis(bySevState),
      by_module_severity_state: aggregatesByModuleSeverityState(items),
      multi_module: listMultiModuleItems(items),
    },
  };
}

module.exports = {
  precomputeFromDiff,
  _internals: {
    bySeverityInHead,
    bySeverityInBase,
    headVsBaseBySeverity,
    severityTotalsOverall,
    topComponentsHead,
    inferHasFix,
    fixesHeadAggregates,
    fixesNewAggregates,
    weightedSumBySeverity,
    netRiskKpis,
    // Helpers re-exportados
    extractRootGroupIdFromFirstHop,
    parseGav,
    parseHop,
    extractModuleAndTailFromSinglePath,
    deriveModulesAndModulePaths,
    aggregatesByModuleSeverityState,
    listMultiModuleItems,
  },
};
