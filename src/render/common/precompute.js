// src/render/common/precompute.js
// Phase-3-only pre-aggregations computed from Phase-2 diff.json.
// Do not read files here; accept the parsed diff object and return derived aggregates.

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

function safeNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function sum(a, b) { return a + b; }

function bySeverityInHead(bySevState = {}) {
  // head = NEW + UNCHANGED per severity
  const out = {};
  for (const sev of SEVERITIES) {
    const row = bySevState[sev] || {};
    out[sev] = safeNum(row.NEW) + safeNum(row.UNCHANGED);
  }
  return out;
}

function bySeverityInBase(bySevState = {}) {
  // base = REMOVED + UNCHANGED per severity
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
  for (const sev of SEVERITIES) {
    out[sev] = { head: safeNum(head[sev]), base: safeNum(base[sev]) };
  }
  return out;
}

function severityTotalsOverall(bySevState = {}) {
  // overall = NEW + REMOVED + UNCHANGED per severity
  const out = {};
  for (const sev of SEVERITIES) {
    const row = bySevState[sev] || {};
    out[sev] = safeNum(row.NEW) + safeNum(row.REMOVED) + safeNum(row.UNCHANGED);
  }
  return out;
}

function topComponentsHead(items = [], topN = 10) {
  // Count by GAV for items in HEAD (NEW or UNCHANGED)
  const map = new Map(); // key=gav -> { gav, componentRef?, count }
  for (const it of items) {
    const s = String(it.state || '').toUpperCase();
    if (s !== 'NEW' && s !== 'UNCHANGED') continue;
    const pkg = it.package || {};
    const gav = `${pkg.groupId ?? 'unknown'}:${pkg.artifactId ?? 'unknown'}:${pkg.version ?? 'unknown'}`;
    const prev = map.get(gav) || { gav, componentRef: it.componentRef, count: 0 };
    prev.count += 1;
    // prefer first non-empty componentRef
    if (!prev.componentRef && it.componentRef) prev.componentRef = it.componentRef;
    map.set(gav, prev);
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

function collectPathDepths(items = [], includeStates = new Set()) {
  const depths = [];
  for (const it of items) {
    const s = String(it.state || '').toUpperCase();
    if (!includeStates.has(s)) continue;
    const paths = Array.isArray(it.paths) ? it.paths : [];
    for (const p of paths) {
      const d = Array.isArray(p) ? p.length : 0;
      if (d > 0) depths.push(d);
    }
  }
  return depths;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function pathDepthStats(items = [], which /* 'head' | 'base' */) {
  const include = which === 'head'
    ? new Set(['NEW', 'UNCHANGED'])
    : new Set(['REMOVED', 'UNCHANGED']);
  const arr = collectPathDepths(items, include);
  if (arr.length === 0) return null;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const avg = arr.reduce(sum, 0) / arr.length;
  const p95 = percentile(arr, 95);
  return { min, max, avg: Number(avg.toFixed(2)), p95 };
}

function precomputeFromDiff(diff) {
  if (!diff || typeof diff !== 'object') {
    throw new Error('[precompute] invalid diff object');
  }
  const bySevState = diff?.summary?.by_severity_and_state || {};
  const items = Array.isArray(diff.items) ? diff.items : [];

  const out = {
    // minimal, always useful
    summary: {
      by_severity_in_head: bySeverityInHead(bySevState),
      by_severity_in_base: bySeverityInBase(bySevState),
      severity_totals_overall: severityTotalsOverall(bySevState),
    },
    aggregates: {
      head_vs_base_by_severity: headVsBaseBySeverity(bySevState),
      top_components_head: topComponentsHead(items, 10),
      path_depth_head: pathDepthStats(items, 'head'),
      path_depth_base: pathDepthStats(items, 'base'),
    },
  };
  return out;
}

module.exports = {
  precomputeFromDiff,
  // export helpers if you want unit tests at finer granularity
  _internals: {
    bySeverityInHead, bySeverityInBase, headVsBaseBySeverity,
    severityTotalsOverall, topComponentsHead, pathDepthStats,
  }
};
