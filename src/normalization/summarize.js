const { normalizeSeverity, SEV_ORDER } = require('./utils');

// Aggregates diff items into totals by state and matrix by severity + state.
// Returns overall totals and severity/state breakdown.
function buildDiffSummary(items) {
  const totals = { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
  const by = {
    CRITICAL: { NEW: 0, REMOVED: 0, UNCHANGED: 0 },
    HIGH: { NEW: 0, REMOVED: 0, UNCHANGED: 0 },
    MEDIUM: { NEW: 0, REMOVED: 0, UNCHANGED: 0 },
    LOW: { NEW: 0, REMOVED: 0, UNCHANGED: 0 },
    UNKNOWN: { NEW: 0, REMOVED: 0, UNCHANGED: 0 },
  };
  for (const it of items) {
    const s = normalizeSeverity(it.severity);
    by[s][it.state]++;
    totals[it.state]++;
  }
  return { totals, by_severity_and_state: by };
}

module.exports = { buildDiffSummary };
