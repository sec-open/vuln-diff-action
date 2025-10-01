// src/render/markdown.js
// Phase 3 — Markdown-only components (job summary, PR text, Slack text helpers)
//
// IMPORTANT:
// - Do NOT wrap vulnerability IDs in backticks. GitHub hovercards only appear
//   on regular links like https://github.com/advisories/GHSA-xxxx.
// - Avoid `title` attributes on links: browsers show their own tooltip which
//   obscures GitHub's hovercard experience.

function bold(s) { return `**${String(s || "")}**`; }
function code(s) { return `\`${String(s || "")}\``; }

// Plain Markdown link WITHOUT `title` to avoid browser tooltips.
function mdLink(text, href) {
  const safeText = String(text || "");
  const safeHref = String(href || "#");
  return `[${safeText}](${safeHref})`;
}

// Prefer a GHSA alias for richer GitHub hovercards. If x.id is already GHSA, use it.
function pickGhsaAlias(x) {
  const id = x?.id || "";
  if (/^GHSA-[A-Za-z0-9-]+$/.test(id)) return id;
  const aliases = Array.isArray(x?.aliases) ? x.aliases : [];
  for (const a of aliases) {
    if (typeof a === "string" && /^GHSA-[A-Za-z0-9-]+$/.test(a)) return a;
  }
  return null;
}

// Canonical URL for a vulnerability ID.
function hrefForId(id) {
  if (!id) return "#";
  if (/^GHSA-[A-Za-z0-9-]+$/.test(id)) return `https://github.com/advisories/${id}`;
  if (/^CVE-\d{4}-\d{4,7}$/.test(id)) return `https://nvd.nist.gov/vuln/detail/${id}`;
  return "#";
}

// Build the "Vulnerability" cell prioritizing GHSA links for GitHub hovercards.
function vulnLinkCell(x) {
  const ghsa = pickGhsaAlias(x);
  const id = ghsa || x?.id || "UNKNOWN";
  const href = x?.url && /^https:\/\/github\.com\/advisories\/GHSA-/.test(x.url) ? x.url : hrefForId(id);
  // No `title` attr -> no browser tooltip; if the context supports hovercards, GitHub will show it.
  return mdLink(id, href);
}

// Linkify IDs in free text (kept for compatibility with other markdown blocks).
function linkifyIdsMarkdown(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, (_m, id) => `[${id}](https://github.com/advisories/${id})`);
  out = out.replace(/\b(CVE-\d{4}-\d{4,7})\b/g, (_m, id) => `[${id}](https://nvd.nist.gov/vuln/detail/${id})`);
  return out;
}

// Internal: build rows for the diff table (used by both summary and generic render).
function buildDiffRows(diff, baseLabel, headLabel) {
  const rows = [];
  rows.push("| Severity | Vulnerability | Package | Version | Branch |");
  rows.push("|---|---|---|---|---|");

  const pushRows = (arr, branchLabel) => {
    for (const x of arr || []) {
      const vulnCell = vulnLinkCell(x); // GHSA-first -> GitHub hovercard (if context supports it)
      const pkg = x?.package ? code(x.package) : "`unknown`";
      const ver = x?.version ? code(x.version) : "`-`";
      rows.push(`| ${bold(x?.severity || "UNKNOWN")} | ${vulnCell} | ${pkg} | ${ver} | ${branchLabel} |`);
    }
  };

  // Order: new (head), removed (base), unchanged (BOTH)
  pushRows(diff?.news, headLabel);
  pushRows(diff?.removed, baseLabel);
  pushRows(diff?.unchanged, "BOTH");
  return rows;
}

// Entry point for the Job Summary table (Actions step summary).
function renderSummaryTableMarkdown(diff, baseLabel, headLabel) {
  return buildDiffRows(diff, baseLabel, headLabel).join("\n");
}

// Generic Markdown table (used wherever a full diff table is needed).
function renderDiffTableMarkdown(diff, baseLabel, headLabel) {
  return buildDiffRows(diff, baseLabel, headLabel).join("\n");
}

module.exports = {
  renderSummaryTableMarkdown,
  renderDiffTableMarkdown,
  linkifyIdsMarkdown,
  bold,
  code,
};
