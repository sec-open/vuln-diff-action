// src/diff.js
// Compute vulnerability diff and render a Markdown table.
// Now supports custom branch labels and sorting by severity, then by branch group.
// Comments in English.

const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

/**
 * Build a map key for an occurrence: (vulnId, packageName, packageVersion)
 */
function keyOf(m) {
  const vid = m?.vulnerability?.id || "";
  const a = m?.artifact || {};
  const name = a.name || "";
  const ver = a.version || "";
  return `${vid}::${name}::${ver}`;
}

/**
 * Normalize severity to one of our buckets
 */
function sevOf(m) {
  const s = (m?.vulnerability?.severity || "UNKNOWN").toUpperCase();
  return SEV_ORDER.includes(s) ? s : "UNKNOWN";
}

/**
 * Filter by minimum severity (inclusive)
 */
function passesMinSeverity(m, minSeverity = "LOW") {
  const minIdx = SEV_ORDER.indexOf((minSeverity || "LOW").toUpperCase());
  const curIdx = SEV_ORDER.indexOf(sevOf(m));
  if (minIdx < 0) return true;
  return curIdx <= minIdx;
}

/**
 * Build a simplified record for rendering.
 */
function toRow(m, branchLabel) {
  const v = m?.vulnerability || {};
  const a = m?.artifact || {};
  return {
    severity: sevOf(m),
    vulnId: v.id || "",
    pkg: `${a.name || "unknown"}:${a.version || "unknown"}`,
    branch: branchLabel
  };
}

/**
 * Diff two match arrays (base vs head) with min severity filter.
 * Returns { news, removed, unchanged } of simplified rows.
 * baseLabel/headLabel are human-friendly names (e.g., 'develop', 'TASK-7908').
 */
function diff(baseMatches, headMatches, minSeverity = "LOW", baseLabel = "BASE", headLabel = "HEAD") {
  const baseFiltered = (baseMatches || []).filter(m => passesMinSeverity(m, minSeverity));
  const headFiltered = (headMatches || []).filter(m => passesMinSeverity(m, minSeverity));

  const baseMap = new Map();
  for (const m of baseFiltered) baseMap.set(keyOf(m), m);
  const headMap = new Map();
  for (const m of headFiltered) headMap.set(keyOf(m), m);

  const news = [];
  const removed = [];
  const unchanged = [];

  // New or unchanged
  for (const [k, m] of headMap.entries()) {
    if (!baseMap.has(k)) news.push(toRow(m, headLabel));
    else unchanged.push(toRow(m, "BOTH"));
  }

  // Removed
  for (const [k, m] of baseMap.entries()) {
    if (!headMap.has(k)) removed.push(toRow(m, baseLabel));
  }

  // Sort: by severity (CRITICAL..LOW), then by branch (lexicographic; BOTH goes detrás)
  const sevIndex = s => SEV_ORDER.indexOf(s);
  const bySevThenBranch = (a, b) => {
    const d = sevIndex(a.severity) - sevIndex(b.severity);
    if (d !== 0) return d; // CRITICAL first (index 0)
    if (a.branch === "BOTH" && b.branch !== "BOTH") return 1; // put BOTH after concrete branches
    if (b.branch === "BOTH" && a.branch !== "BOTH") return -1;
    return a.branch.localeCompare(b.branch);
  };

  news.sort(bySevThenBranch);
  removed.sort(bySevThenBranch);
  unchanged.sort(bySevThenBranch);

  return { news, removed, unchanged };
}

/**
 * Render a Markdown table using the simplified rows.
 * Branch column shows the exact branch label passed in (e.g., 'develop', 'TASK-7908').
 * Order: grouped by severity (desc), then by branch (lexicographic).
 */
function renderMarkdownTable(news, removed, unchanged) {
  const rows = [
    ...news.map(r => ({ ...r, status: "NEW" })),
    ...removed.map(r => ({ ...r, status: "REMOVED" })),
    ...unchanged.map(r => ({ ...r, status: "UNCHANGED" })),
  ];

  if (rows.length === 0) {
    return "_No vulnerabilities found for the selected severity range._";
  }

  const lines = [];
  lines.push("| Severity | Vulnerability | Package | Branches | Status |");
  lines.push("| --- | --- | --- | --- | --- |");

  for (const r of rows) {
    const branches = r.branch === "BOTH" ? "BOTH" : r.branch;
    lines.push(`| **${r.severity}** | \`${r.vulnId}\` | \`${r.pkg}\` | ${branches} | ${r.status} |`);
  }

  return lines.join("\n");
}

module.exports = { diff, renderMarkdownTable, SEV_ORDER };
