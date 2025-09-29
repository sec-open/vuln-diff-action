// src/render/markdown.js
// Phase 3 — Markdown-only components (job summary, PR, Slack text helpers)

function bold(s) { return `**${s}**`; }
function code(s) { return `\`${s}\``; }

function linkifyIdsMarkdown(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, (_m, id) => `[${id}](https://github.com/advisories/${id})`);
  out = out.replace(/\b(CVE-\d{4}-\d{4,7})\b/g, (_m, id) => `[${id}](https://nvd.nist.gov/vuln/detail/${id})`);
  return out;
}

function renderDiffTableMarkdown(diff, baseLabel, headLabel) {
  const rows = [];
  rows.push("| Severity | Vulnerability | Package | Version | Branch |");
  rows.push("|---|---|---|---|---|");

  const push = (arr, label) => {
    for (const x of arr) {
      rows.push(
        `| ${bold(x.severity || "UNKNOWN")} | ${code(x.id)} | \`${x.package}\` | \`${x.version}\` | ${label} |`
      );
    }
  };

  // Order by severity then branch group inside severity (you already pre-sorted in analyze)
  push(diff.news, headLabel);
  push(diff.removed, baseLabel);
  push(diff.unchanged, "BOTH");

  return linkifyIdsMarkdown(rows.join("\n"));
}

module.exports = {
  renderDiffTableMarkdown,
  linkifyIdsMarkdown,
};
