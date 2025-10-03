/**
 * Severity utilities: ordering, normalization, comparators.
 * States: CRITICAL > HIGH > MEDIUM > LOW > UNKNOWN.
 */

const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

/** Normalize an arbitrary severity string into one of ORDER. */
function normalizeSeverity(s) {
  if (!s) return "UNKNOWN";
  const up = String(s).toUpperCase();
  if (ORDER.includes(up)) return up;
  // Map common variants
  if (up.startsWith("CRIT")) return "CRITICAL";
  if (up.startsWith("HI")) return "HIGH";
  if (up.startsWith("MED")) return "MEDIUM";
  if (up.startsWith("LO")) return "LOW";
  return "UNKNOWN";
}

/** Severity rank (lower is more severe for sorting). */
function severityRank(s) {
  const sev = normalizeSeverity(s);
  const idx = ORDER.indexOf(sev);
  return idx >= 0 ? idx : ORDER.length - 1;
}

/** Comparator for severities (ascending by rank: CRITICAL first). */
function compareSeverity(a, b) {
  return severityRank(a) - severityRank(b);
}

/** Fixed order for statuses: NEW, REMOVED, UNCHANGED. */
const STATUS_ORDER = ["NEW", "REMOVED", "UNCHANGED"];
function statusRank(st) {
  const up = String(st || "").toUpperCase();
  const idx = STATUS_ORDER.indexOf(up);
  return idx >= 0 ? idx : STATUS_ORDER.length - 1;
}
function compareStatus(a, b) {
  return statusRank(a) - statusRank(b);
}

module.exports = {
  ORDER,
  STATUS_ORDER,
  normalizeSeverity,
  severityRank,
  compareSeverity,
  statusRank,
  compareStatus,
};
