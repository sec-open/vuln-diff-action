// src/render/markdown.js
// Phase 3 — Markdown-only components (job summary, PR text, Slack text helpers)

// --- inline helpers (markdown) ---
function bold(s) { return `**${s}**`; }
function code(s) { return `\`${s}\``; }

/**
 * Linkify known vulnerability identifiers in free text.
 * - GHSA-XXXX → GitHub Advisories
 * - CVE-YYYY-NNNN → NVD
 */
function linkifyIdsMarkdown(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, (_m, id) => `[${id}](https://github.com/advisories/${id})`);
  out = out.replace(/\b(CVE-\d{4}-\d{4,7})\b/g, (_m, id) => `[${id}](https://nvd.nist.gov/vuln/detail/${id})`);
  return out;
}

/**
 * Build the rows for a vulnerability diff table.
 * This internal helper is reused by both summary and (optionally) PDF/HTML markdown tables,
 * but the SUMMARY should call ONLY `renderSummaryTableMarkdown`.
 */
function buildDiffRows(diff, baseLabel, headLabel) {
  const rows = [];
  // Header
  rows.push("| Severity | Vulnerability | Package | Version | Branch |");
  rows.push("|---|---|---|---|---|");

  // row builder
  const push = (arr, branchLabel) => {
    for (const x of arr) {
      // IMPORTANT: do NOT wrap vulnerability in backticks, or Markdown will not render the link.
      const vulnCell = linkifyIdsMarkdown(x.id || "UNKNOWN");
      const pkg = x.package ? `\`${x.package}\`` : "`unknown`";
      const ver = x.version ? `\`${x.version}\`` : "`-`";
      rows.push(`| ${bold(x.severity || "UNKNOWN")} | ${vulnCell} | ${pkg} | ${ver} | ${branchLabel} |`);
    }
  };

  // Order assumed pre-sorted in analyze; we keep grouping by category here
  push(diff.news || [], headLabel);
  push(diff.removed || [], baseLabel);
  push(diff.unchanged || [], "BOTH");

  return rows;
}

/**
 * SUMMARY TABLE (Job summary): single, dedicated entry point.
 * Use this ONLY for the GitHub Job Summary. Do not reuse in other renders.
 */
function renderSummaryTableMarkdown(diff, baseLabel, headLabel) {
  const rows = buildDiffRows(diff, baseLabel, headLabel);
  return rows.join("\n");
}

/**
 * General diff table in Markdown (kept for non-summary uses like converting to HTML for PDF).
 * If you prefer total separation, you can remove this and build tables elsewhere;
 * for now we keep it, but the summary **must** use `renderSummaryTableMarkdown`.
 */
function renderDiffTableMarkdown(diff, baseLabel, headLabel) {
  const rows = buildDiffRows(diff, baseLabel, headLabel);
  return rows.join("\n");
}

module.exports = {
  // Summary (exclusive)
  renderSummaryTableMarkdown,

  // Other helpers (kept for compatibility in the rest of the pipeline)
  renderDiffTableMarkdown,
  linkifyIdsMarkdown,
  bold,
  code,
};
