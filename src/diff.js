const { normalizeSeverity, cmpSeverity, meetsThreshold } = require("./severity");

/**
 * Normalize a grype match into a key and record
 * Key: `${vulnerability.id}__${package.name}:${package.version}`
 */
function normalizeMatch(m) {
  const vulnId = m.vulnerability?.id || "UNKNOWN";
  const pkg = m.artifact || {};
  const name = pkg.name || "unknown";
  const version = pkg.version || "unknown";
  const pkgVer = `${name}:${version}`;
  const severity = normalizeSeverity(m.vulnerability?.severity);
  return {
    key: `${vulnId}__${pkgVer}`,
    vulnId,
    pkgVer,
    severity
  };
}

function toMap(matches, minSeverity) {
  const map = new Map();
  for (const m of matches || []) {
    const n = normalizeMatch(m);
    if (!meetsThreshold(n.severity, minSeverity)) continue;
    const prev = map.get(n.key);
    if (!prev || cmpSeverity(prev.severity, n.severity) > 0) {
      map.set(n.key, n);
    }
  }
  return map;
}

function diff(baseMatches, headMatches, minSeverity) {
  const baseMap = toMap(baseMatches, minSeverity);
  const headMap = toMap(headMatches, minSeverity);

  const news = [];
  const removed = [];
  const unchanged = [];

  for (const [k, v] of headMap) {
    if (!baseMap.has(k)) news.push(v);
    else unchanged.push(v);
  }
  for (const [k, v] of baseMap) {
    if (!headMap.has(k)) removed.push(v);
  }

  const sortFn = (a, b) => {
    const c = cmpSeverity(a.severity, b.severity);
    if (c !== 0) return c; // smaller index = higher severity
    return a.vulnId.localeCompare(b.vulnId);
  };
  news.sort(sortFn);
  removed.sort(sortFn);
  unchanged.sort(sortFn);

  return { news, removed, unchanged };
}

function renderMarkdownTable(news, removed, unchanged) {
  const rows = [];
  for (const n of news) rows.push(`| ${n.severity} | ${n.vulnId} | \`${n.pkgVer}\` | HEAD |`);
  for (const r of removed) rows.push(`| ${r.severity} | ${r.vulnId} | \`${r.pkgVer}\` | BASE |`);
  for (const u of unchanged) rows.push(`| ${u.severity} | ${u.vulnId} | \`${u.pkgVer}\` | **BOTH** |`);

  const header = `| Severity | VulnerabilityID | package:version | branches |
|---|---|---|---|`;
  return [header, ...rows].join("\n");
}

module.exports = { diff, renderMarkdownTable };
