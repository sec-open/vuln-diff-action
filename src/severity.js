const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function normalizeSeverity(s) {
  if (!s) return "UNKNOWN";
  const up = String(s).toUpperCase();
  if (ORDER.includes(up)) return up;
  return "UNKNOWN";
}

// order comparator: CRITICAL > HIGH > MEDIUM > LOW > UNKNOWN
function cmpSeverity(a, b) {
  return ORDER.indexOf(a) - ORDER.indexOf(b);
}

function meetsThreshold(sev, min) {
  return cmpSeverity(normalizeSeverity(min), normalizeSeverity(sev)) >= 0;
}

module.exports = { normalizeSeverity, cmpSeverity, meetsThreshold, ORDER };
