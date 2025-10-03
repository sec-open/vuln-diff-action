/**
 * Markdown renderers:
 *  - PR comment table (with GitHub hovercards for GHSA links).
 *  - Job Summary table (with HTML anchors + title tooltips) + header summary block.
 *
 * Columns: Severity | Vulnerability | Package | Branch
 * Package format: `name:version`
 */

const { ORDER: SEV_ORDER, STATUS_ORDER, severityRank } = require("../severity");

function formatPkg(name, version) {
  const n = name || "unknown";
  const v = (version && String(version).trim()) ? String(version).trim() : "-";
  return `\`${n}:${v}\``;
}

function advisoryLink(v) {
  if (v?.ids?.ghsa) return `https://github.com/advisories/${v.ids.ghsa}`;
  if (v?.ids?.cve) return `https://nvd.nist.gov/vuln/detail/${v.ids.cve}`;
  if (v?.url) return v.url;
  return "#";
}

function idText(v) {
  return v?.ids?.ghsa || v?.ids?.cve || v?.id || "UNKNOWN-ID";
}

function rowsFromDiff(diff) {
  const rows = [];
  for (const it of (diff?.changes?.new || [])) rows.push({ item: it, status: "NEW" });
  for (const it of (diff?.changes?.removed || [])) rows.push({ item: it, status: "REMOVED" });
  // UNCHANGED are not listed individually; we could add if needed from head∩base
  // Sort by severity then id+package
  rows.sort((a, b) => {
    const s = severityRank(a.item.severity) - severityRank(b.item.severity);
    if (s !== 0) return s;
    const ka = `${idText(a.item)}::${a.item.package?.name || ""}::${a.item.package?.version || ""}`;
    const kb = `${idText(b.item)}::${b.item.package?.name || ""}::${b.item.package?.version || ""}`;
    return ka.localeCompare(kb);
  });
  return rows;
}

// --- PR renderer (hovercards) ---
function renderPrTableMarkdown(diff, baseLabel, headLabel, options = {}) {
  const rows = rowsFromDiff(diff);
  const header = `| Severity | Vulnerability | Package | Branch |\n|---|---|---|---|`;
  const lines = [header];
  for (const { item, status } of rows) {
    const sev = `**${item.severity || "UNKNOWN"}**`;
    const id = idText(item);
    const url = advisoryLink(item);
    // For PR: use standard Markdown link => GitHub hovercard for GHSA
    const vuln = `[${id}](${url})`;
    const pkg = formatPkg(item.package?.name, item.package?.version);
    const branch = status === "NEW" ? headLabel || "HEAD" : "BASE";
    lines.push(`| ${sev} | ${vuln} | ${pkg} | ${status === "NEW" ? "HEAD" : status === "REMOVED" ? "BASE" : "BOTH"} |`);
  }

  // Optionally add UNCHANGED total line
  const unchanged = diff?.summary?.totals?.UNCHANGED ?? 0;
  if (unchanged > 0) {
    lines.push(`\n> Unchanged: **${unchanged}**`);
  }

  return lines.join("\n");
}

// --- Summary renderer (tooltips + header summary) ---
function renderSummaryTableMarkdown(diff, base, head, actionMeta, baseLabel, headLabel, options = { includeHeaderSummary: true }) {
  const parts = [];
  if (options.includeHeaderSummary !== false) {
    const lines = [];
    const baseLine = `- Base: \`${base?.git?.ref || baseLabel || "BASE"}\` @ \`${base?.git?.sha_short || ""}\` — ${base?.git?.commit_subject || ""}`;
    const headLine = `- Head: \`${head?.git?.ref || headLabel || "HEAD"}\` @ \`${head?.git?.sha_short || ""}\` — ${head?.git?.commit_subject || ""}`;
    const tools = `- Syft ${head?.tools?.syft || ""} · Grype ${head?.tools?.grype || ""} · CycloneDX Maven ${head?.tools?.cyclonedx_maven || ""} · Node ${head?.tools?.node || ""}\n- Action: ${actionMeta?.name || "sec-open/vuln-diff-action"} ${actionMeta?.version || ""} (\`${(actionMeta?.commit || "").slice(0,7)}\`)`;
    lines.push(`**Summary**`, baseLine, headLine, ``, `**Tools**`, tools, ``);
    parts.push(lines.join("\n"));
  }

  const rows = rowsFromDiff(diff);
  const header = `| Severity | Vulnerability | Package | Branch |\n|---|---|---|---|`;
  const lines = [header];
  for (const { item, status } of rows) {
    const sev = `**${item.severity || "UNKNOWN"}**`;
    const id = idText(item);
    const url = advisoryLink(item);
    // For Summary: use HTML anchor with title to show tooltip
    const title = `${id} — ${item.package?.name || "unknown"}:${item.package?.version || "-"}`;
    const vuln = `<a href="${url}" title="${escapeHtml(title)}">${id}</a>`;
    const pkg = formatPkg(item.package?.name, item.package?.version);
    lines.push(`| ${sev} | ${vuln} | ${pkg} | ${status === "NEW" ? "HEAD" : status === "REMOVED" ? "BASE" : "BOTH"} |`);
  }
  const unchanged = diff?.summary?.totals?.UNCHANGED ?? 0;
  if (unchanged > 0) {
    lines.push(`\n> Unchanged: **${unchanged}**`);
  }
  parts.push(lines.join("\n"));
  return parts.join("\n");
}

function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

module.exports = {
  renderPrTableMarkdown,
  renderSummaryTableMarkdown,
};
