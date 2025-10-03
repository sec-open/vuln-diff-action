/**
 * Markdown renderers:
 * - Summary (Job Summary): plain Markdown/HTML, uses title tooltips (no hovercards)
 * - PR comment: allows GitHub hovercards on vulnerability IDs
 *
 * Notes
 * - Package column is single "<name>:<version>"
 * - Severity order: CRITICAL, HIGH, MEDIUM, LOW, UNKNOWN
 * - Status order: NEW, REMOVED, UNCHANGED
 */

function severityRank(s) {
  const map = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
  return map[String(s || "UNKNOWN").toUpperCase()] ?? 9;
}
function statusRank(s) {
  const map = { NEW: 0, REMOVED: 1, UNCHANGED: 2 };
  return map[String(s || "UNCHANGED").toUpperCase()] ?? 9;
}
function fmtInt(n) {
  return new Intl.NumberFormat("en-US").format(n || 0);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtPkg(name, version) {
  const n = name || "unknown";
  const v = (version && String(version).trim()) ? String(version).trim() : "-";
  return `${n}:${v}`;
}
function advisoryHref(vuln) {
  // Prefer GHSA, then CVE, finally fallback URL if any
  const ids = vuln?.ids || {};
  if (ids.ghsa) return `https://github.com/advisories/${ids.ghsa}`;
  if (ids.cve)  return `https://nvd.nist.gov/vuln/detail/${ids.cve}`;
  return vuln?.url || "#";
}
function vulnTitle(v) {
  const parts = [];
  if (v?.id) parts.push(v.id);
  if (v?.severity) parts.push(`Severity: ${v.severity}`);
  const p = v?.package;
  if (p?.name) parts.push(`Package: ${fmtPkg(p.name, p.version)}`);
  if (v?.cvss_max?.score != null) parts.push(`CVSS: ${v.cvss_max.score}`);
  if (v?.fix?.state) parts.push(`Fix: ${v.fix.state}`);
  return parts.join(" · ");
}

function branchLine(label, info) {
  const ref = info?.git?.ref || "";
  const sha = info?.git?.sha_short || "";
  const msg = info?.git?.commit_subject || "";
  return `- **${label}**: \`${escapeHtml(ref)}\` @ \`${escapeHtml(sha)}\` — ${escapeHtml(msg)}`;
}

function toolsLine(tools, actionMeta) {
  const t = [];
  if (tools?.syft) t.push(`Syft Application: ${inlineVersion(tools.syft)}`);
  if (tools?.grype) t.push(`Grype Application: ${inlineVersion(tools.grype)}`);
  if (tools?.cyclonedx_maven) t.push(`CycloneDX Maven`);
  if (tools?.node) t.push(`Node ${tools.node}`);
  if (actionMeta) t.push(`Action: ${actionMeta.name} (\`${(actionMeta.commit || "").slice(0,7)}\`)`);
  return `- ${t.join(" · ")}`;
}
function inlineVersion(line) {
  // show first line only, without ANSI noise
  return String(line || "").split(/\r?\n/)[0];
}

function sevTable(summary) {
  const s = summary?.by_severity || {};
  return [
    "",
    "<table>",
    "<thead><tr><th>Severity</th><th>Count</th></tr></thead>",
    "<tbody>",
    `<tr><td>CRITICAL</td><td>${fmtInt(s.CRITICAL || 0)}</td></tr>`,
    `<tr><td>HIGH</td><td>${fmtInt(s.HIGH || 0)}</td></tr>`,
    `<tr><td>MEDIUM</td><td>${fmtInt(s.MEDIUM || 0)}</td></tr>`,
    `<tr><td>LOW</td><td>${fmtInt(s.LOW || 0)}</td></tr>`,
    `<tr><td>UNKNOWN</td><td>${fmtInt(s.UNKNOWN || 0)}</td></tr>`,
    "</tbody>",
    "</table>",
    ""
  ].join("\n");
}

function totalsCards(diffSummary) {
  const t = diffSummary?.totals || {};
  return [
    "",
    "<table>",
    "<thead><tr><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr></thead>",
    `<tbody><tr><td>${fmtInt(t.NEW||0)}</td><td>${fmtInt(t.REMOVED||0)}</td><td>${fmtInt(t.UNCHANGED||0)}</td></tr></tbody>`,
    "</table>",
    ""
  ].join("\n");
}

function diffRows(diffJson) {
  const rows = [];
  for (const v of diffJson?.changes?.new || []) rows.push({ ...v, __status: "NEW", __branch: "HEAD" });
  for (const v of diffJson?.changes?.removed || []) rows.push({ ...v, __status: "REMOVED", __branch: "BASE" });

  rows.sort((a, b) => {
    const s = severityRank(a.severity) - severityRank(b.severity);
    if (s !== 0) return s;
    const st = statusRank(a.__status) - statusRank(b.__status);
    if (st !== 0) return st;
    return String(a.id).localeCompare(String(b.id));
  });
  return rows;
}

/* ---------------- Summary (Job Summary) ---------------- */

function renderSummaryTableMarkdown(diffJson, baseJson, headJson, actionMeta, baseLabel = "BASE", headLabel = "HEAD") {
  const lines = [];

  lines.push(`### compare-branches summary`);
  lines.push("");
  lines.push("**Summary**");
  lines.push("");
  lines.push(branchLine(baseLabel, baseJson));
  lines.push(branchLine(headLabel, headJson));
  lines.push("");
  lines.push("**Tools**");
  lines.push("");
  lines.push(toolsLine(diffJson?.tools || baseJson?.tools || headJson?.tools || {}, actionMeta));
  lines.push("");

  // Totals cards (NEW/REMOVED/UNCHANGED)
  lines.push(totalsCards(diffJson?.summary));

  // Branch severity tables
  lines.push(`**${baseLabel} severity counts**`);
  lines.push(sevTable(baseJson?.summary));
  lines.push(`**${headLabel} severity counts**`);
  lines.push(sevTable(headJson?.summary));

  // Diff table with title tooltips (no hovercards here)
  lines.push("");
  lines.push("<table>");
  lines.push("<thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Branch</th><th>Status</th></tr></thead>");
  lines.push("<tbody>");

  const rows = diffRows(diffJson);
  for (const r of rows) {
    const href = advisoryHref(r);
    const title = escapeHtml(vulnTitle(r));
    const pkg = escapeHtml(fmtPkg(r?.package?.name, r?.package?.version));
    const sev = escapeHtml(r.severity || "UNKNOWN");
    const id = escapeHtml(r.id || "");
    lines.push(
      `<tr><td>${sev}</td><td><a href="${href}" title="${title}" target="_blank" rel="noopener noreferrer">${id}</a></td><td><code>${pkg}</code></td><td>${r.__branch}</td><td>${r.__status}</td></tr>`
    );
  }

  lines.push("</tbody>");
  lines.push("</table>");
  lines.push("");
  lines.push(`_Unchanged_: **${fmtInt(diffJson?.summary?.totals?.UNCHANGED || 0)}**`);
  lines.push("");

  return lines.join("\n");
}

/* ---------------- PR comment (hovercards) ---------------- */

function renderPrTableMarkdown(diffJson, baseLabel = "BASE", headLabel = "HEAD") {
  const lines = [];
  lines.push(`### Vulnerability diff (${baseLabel} vs ${headLabel})`);
  lines.push("");

  lines.push("<table>");
  lines.push("<thead><tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>Branch</th><th>Status</th></tr></thead>");
  lines.push("<tbody>");

  const rows = diffRows(diffJson);
  for (const r of rows) {
    const href = advisoryHref(r);
    const pkg = escapeHtml(fmtPkg(r?.package?.name, r?.package?.version));
    const sev = escapeHtml(r.severity || "UNKNOWN");
    const id = escapeHtml(r.id || "");

    // GitHub advisory hovercard, if GHSA id exists
    let anchor = `<a href="${href}" target="_blank" rel="noopener noreferrer">${id}</a>`;
    if (r?.ids?.ghsa) {
      const ghsa = r.ids.ghsa;
      anchor =
        `<a href="https://github.com/advisories/${ghsa}" ` +
        `data-hovercard-type="advisory" ` +
        `data-hovercard-url="/advisories/${ghsa}/hovercard" ` +
        `target="_blank" rel="noopener noreferrer">${id}</a>`;
    }

    lines.push(
      `<tr><td>${sev}</td><td>${anchor}</td><td><code>${pkg}</code></td><td>${r.__branch}</td><td>${r.__status}</td></tr>`
    );
  }

  lines.push("</tbody>");
  lines.push("</table>");
  lines.push("");
  lines.push(`_Unchanged_: **${fmtInt(diffJson?.summary?.totals?.UNCHANGED || 0)}**`);
  lines.push("");

  return lines.join("\n");
}

module.exports = {
  renderSummaryTableMarkdown,
  renderPrTableMarkdown,
};
