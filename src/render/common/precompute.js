// src/render/common/precompute.js
// Phase-3 pre-aggregations computed from Phase-2 diff.json.
// SOLO lee el objeto diff (ya parseado) y devuelve agregados.
// Añade agregados por módulo (según paths) y lista de vulnerabilidades multi-módulo.

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const RISK_WEIGHTS = { CRITICAL: 5, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

function safeNum(n) { const x = Number(n); return Number.isFinite(x) ? x : 0; }

// --------------------- utilidades existentes ---------------------
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
  const map = new Map(); // key=gav
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

// ---- Fix insights (best-effort) ----
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

// ---- Risk KPIs ponderados ----
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


function extractRootGroupIdFromFirstHop(firstHop) {
if (!firstHop || (Array.isArray(firstHop) && !firstHop.length)) return '';
// En view.js/ precompute.js llamas con pathArr[0], aquí asumimos string del primer hop
const first = typeof firstHop === 'string' ? parseHop(firstHop) : parseHop(Array.isArray(firstHop) ? firstHop[0] : '');
return first && first.groupId ? first.groupId : '';

}

function parseGav(hop) {
  if (!hop || typeof hop !== 'string') return null;
  const m = hop.match(/^([^:]+):([^:]+):([^:]+)$/);
  if (!m) return null;
  return { groupId: m[1], artifactId: m[2], version: m[3] };
}


function parsePurl(hop) {
  if (!hop || typeof hop !== 'string') return null;
  const m = hop.match(/^pkg:maven\/([^\/]+)\/([^@\/]+)@([^?]+)(?:\?.*)?$/i);
  if (!m) return null;
  return { groupId: m[1], artifactId: m[2], version: m[3] };
}


function parseHop(hop) {
  return parseGav(hop) || parsePurl(hop) || null;
}


function toGav(obj) {
  if (!obj) return '';
  const { groupId, artifactId, version } = obj;
  if (!groupId || !artifactId || !version) return '';
  return `${groupId}:${artifactId}:${version}`;
}


function extractModuleAndTailFromSinglePath(pathArr) {
if (!Array.isArray(pathArr) || pathArr.length < 2) return { module: '', tail: [] };

// 1) primer hop define group raíz
const first = parseHop(pathArr[0]);
const rootGroupId = first && first.groupId ? first.groupId : '';
if (!rootGroupId) return { module: '', tail: [] };

// 2) último hop cuyo groupId == raíz
let lastIdx = -1, module = '';
for (let i = 1; i < pathArr.length; i++) {
  const h = parseHop(pathArr[i]);
  if (h && h.groupId === rootGroupId) {
    lastIdx = i;
    module = h.artifactId || module;
  }
}
// si no hubo coincidencias más allá del primero, usamos el primero como módulo
if (!module) {
  module = (first && first.artifactId) || '';
  lastIdx = 0;
}

// 3) tail = hops detrás del módulo, en GAV (si no parsea, deja literal)
const tail = [];
for (let j = lastIdx + 1; j < pathArr.length; j++) {
  const h = parseHop(pathArr[j]);
  if (h) {
    const gav = toGav(h);
    tail.push(gav || pathArr[j]);
  } else {
    tail.push(pathArr[j]);
  }
}
return { module, tail };

}


function deriveModulesAndModulePaths(item) {
  const modSet = new Set();
  const map = new Map(); // module -> Set<string tail>
  try {
    const paths = Array.isArray(item?.paths) ? item.paths : [];
    for (const p of paths) {
      const { module, tail } = extractModuleAndTailFromSinglePath(p);
      if (!module) continue;
      modSet.add(module);
      const key = module;
      const tailStr = tail.join(' -> ');
      if (!map.has(key)) map.set(key, new Set());
      // Deduplicar tails iguales
      map.get(key).add(tailStr);
    }
  } catch (_) {}
  const modules = Array.from(modSet);
  const module_paths = {};
  for (const [mod, set] of map.entries()) module_paths[mod] = Array.from(set);
  return { modules, module_paths };
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

// --------------------- MAIN ---------------------
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

      // Fix insights
      fixes_head: fixesHeadAggregates(items),
      fixes_new: fixesNewAggregates(items),

      // Risk KPIs
      risk: netRiskKpis(bySevState),

      // NEW: módulo × severidad × estado
      by_module_severity_state: aggregatesByModuleSeverityState(items),

      // NEW: vulnerabilidades que afectan a >1 módulo
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

    // NEW helpers
    extractRootGroupIdFromFirstHop,
    parseGav,
    extractModuleAndTailFromSinglePath,
    deriveModulesAndModulePaths,
    aggregatesByModuleSeverityState,
    listMultiModuleItems,
  },
};
