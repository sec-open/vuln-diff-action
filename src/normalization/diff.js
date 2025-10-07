// Phase 2.2 diff between base.json and head.json using match_key and states NEW/REMOVED/UNCHANGED. :contentReference[oaicite:8]{index=8}
const { normalizeSeverity } = require('./utils');
const { buildDiffSummary } = require('./summarize');

function mapByKey(arr) {
  const m = new Map();
  for (const v of arr || []) m.set(v.match_key, v);
  return m;
}

function buildDiff(baseDoc, headDoc, meta) {
  const B = mapByKey(baseDoc?.vulnerabilities || []);
  const H = mapByKey(headDoc?.vulnerabilities || []);

  const items = [];
  const seen = new Set();

  // From BASE
  for (const [k, b] of B.entries()) {
    if (H.has(k)) {
      const h = H.get(k);
      items.push({
        state: 'UNCHANGED',
        branches: 'BOTH',
        ...h, // For unchanged, take HEAD side severity/details. :contentReference[oaicite:9]{index=9}
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

  // From HEAD that were not seen
  for (const [k, h] of H.entries()) {
    if (seen.has(k)) continue;
    items.push({
      state: 'NEW',
      branches: 'HEAD',
      ...h,
      severity: normalizeSeverity(h.severity),
    });
  }

  const summary = buildDiffSummary(items);

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
