// src/render/common/precompute.js
// Phase-3-only pre-aggregations computed from Phase-2 diff.json.
// Do not read files here; accept the parsed diff object and return derived aggregates.

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const RISK_WEIGHTS = { CRITICAL: 5, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

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
    if (!prev.componentRef && it.componentRef) prev.componentRef = it.componentRef;
    map.set(gav, prev);
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

// ---- Fix insights (best-effort inference if fields exist) ----
function inferHasFix(item) {
  // Accept common shapes: item.has_fix (boolean) OR arrays with fixed versions.
  if (typeof item.has_fix === 'boolean') return item.has_fix;
  const candidates = [
    item.fixed_versions,
    item.fix_versions,
    item.fix?.versions,
    item.fixes,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return true;
  }
  return false;
}

function fixesHeadAggregates(items = []) {
  // Only head-visible items: NEW or UNCHANGED
  const bySev = {};
  let withFix = 0, withoutFix = 0;

  for (const sev of SEVERITIES) bySev[sev] = { with_fix: 0, without_fix: 0 };

  for (const it of items) {
    const s = String(it.state || '').toUpperCase();
    if (s !== 'NEW' && s !== 'UNCHANGED') continue;

    const sev = (String(it.severity || 'UNKNOWN').toUpperCase());
    const hasFix = inferHasFix(it);

    if (hasFix) {
      bySev[sev].with_fix += 1;
      withFix += 1;
    } else {
      bySev[sev].without_fix += 1;
      withoutFix += 1;
    }
  }

  return {
    by_severity: bySev,
    totals: { with_fix: withFix, without_fix: withoutFix },
  };
}

function fixesNewAggregates(items = []) {
  // Focus only on NEW (for PR-review actionability)
  const bySev = {};
  let withFix = 0, withoutFix = 0;

  for (const sev of SEVERITIES) bySev[sev] = { with_fix: 0, without_fix: 0 };

  for (const it of items) {
    const s = String(it.state || '').toUpperCase();
    if (s !== 'NEW') continue;

    const sev = (String(it.severity || 'UNKNOWN').toUpperCase());
    const hasFix = inferHasFix(it);

    if (hasFix) {
      bySev[sev].with_fix += 1;
      withFix += 1;
    } else {
      bySev[sev].without_fix += 1;
      withoutFix += 1;
    }
  }

  return {
    by_severity: bySev,
    totals: { with_fix: withFix, without_fix: withoutFix },
  };
}

// ---- Weighted risk KPIs ----
function weightedSumBySeverity(mapSevCount = {}) {
  // mapSevCount: { SEV: count }
  let total = 0;
  for (const sev of SEVERITIES) {
    const w = RISK_WEIGHTS[sev] || 0;
    const c = safeNum(mapSevCount[sev]);
    total += w * c;
  }
  return total;
}

function netRiskKpis(bySevState = {}) {
  // NEW weighted minus REMOVED weighted; and HEAD stock weighted (NEW+UNCHANGED)
  const newBySev = {};
  const removedBySev = {};
  const headBySev = {};

  for (const sev of SEVERITIES) {
    const row = bySevState[sev] || {};
    newBySev[sev] = safeNum(row.NEW);
    removedBySev[sev] = safeNum(row.REMOVED);
    headBySev[sev] = safeNum(row.NEW) + safeNum(row.UNCHANGED);
  }

  const newWeighted = weightedSumBySeverity(newBySev);
  const removedWeighted = weightedSumBySeverity(removedBySev);
  const headStockWeighted = weightedSumBySeverity(headBySev);

  const netRisk = newWeighted - removedWeighted;

  return {
    weights: { ...RISK_WEIGHTS },
    components: { newWeighted, removedWeighted },
    kpis: { netRisk, headStockRisk: headStockWeighted }
  };
}

function precomputeFromDiff(diff) {
  if (!diff || typeof diff !== 'object') {
    throw new Error('[precompute] invalid diff object');
  }
  const bySevState = diff?.summary?.by_severity_and_state || {};
  const items = Array.isArray(diff.items) ? diff.items : [];

  const out = {
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
    },
  };
  return out;
}

module.exports = {
  precomputeFromDiff,
  _internals: {
    bySeverityInHead, bySeverityInBase, headVsBaseBySeverity,
    severityTotalsOverall, topComponentsHead,
    inferHasFix, fixesHeadAggregates, fixesNewAggregates,
    weightedSumBySeverity, netRiskKpis,
  }
};
