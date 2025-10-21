// Phase 2.2 diff between base.json and head.json using match_key and states NEW/REMOVED/UNCHANGED. :contentReference[oaicite:8]{index=8}
const { normalizeSeverity } = require('./utils');
const { buildDiffSummary } = require('./summarize');

// Builds a map keyed by match_key for quick lookup.
function mapByKey(arr) {
  const m = new Map();
  for (const v of arr || []) m.set(v.match_key, v);
  return m;
}

// Computes diff states (NEW / REMOVED / UNCHANGED) between base and head vulnerability sets.
// - UNCHANGED: present in both; takes HEAD side data for freshness.
// - REMOVED: present only in BASE.
// - NEW: present only in HEAD.
// Attaches normalized severity and builds a summary object.
function buildDiff(baseDoc, headDoc, meta) {
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
    items,
  };

  return out;
}

module.exports = { buildDiff };
