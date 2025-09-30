// src/render/markdown.js
// Phase 3 — Markdown-only components (job summary, PR text, Slack text helpers)

// --- inline helpers (markdown) ---
function bold(s) { return `**${s}**`; }
function code(s) { return `\`${s}\``; }

// Markdown link with optional title (title no es necesario para el hovercard)
function mdLinkWithTitle(text, href, title) {
  const safeText = String(text || "");
  const safeHref = String(href || "#");
  if (title && title.trim()) {
    const safeTitle = String(title).replace(/"/g, "&quot;");
    return `[${safeText}](${safeHref} "${safeTitle}")`;
  }
  return `[${safeText}](${safeHref})`;
}

// Busca un alias GHSA en x.aliases (array de strings) o devuelve null
function pickGhsaAlias(x) {
  const id = x?.id || "";
  if (/^GHSA-[A-Za-z0-9-]+$/.test(id)) return id;
  const aliases = Array.isArray(x?.aliases) ? x.aliases : [];
  for (const a of aliases) {
    if (typeof a === "string" && /^GHSA-[A-Za-z0-9-]+$/.test(a)) return a;
  }
  return null;
}

// URL canónica para ID GHSA/CVE
function hrefForId(id) {
  if (!id) return "#";
  if (/^GHSA-[A-Za-z0-9-]+$/.test(id)) return `https://github.com/advisories/${id}`;
  if (/^CVE-\d{4}-\d{4,7}$/.test(id)) return `https://nvd.nist.gov/vuln/detail/${id}`;
  return "#";
}

// Construye la celda "Vulnerability" maximizando el hovercard de GitHub:
// - Si hay GHSA (id o alias), usar GHSA como texto y como URL → hovercard rico.
// - Si no, usar CVE→NVD (sin hovercard GitHub).
function vulnLinkCell(x) {
  const ghsa = pickGhsaAlias(x);
  const id = ghsa || x?.id || "UNKNOWN";
  const href = x?.url && /^https:\/\/github\.com\/advisories\/GHSA-/.test(x.url)
    ? x.url
    : hrefForId(id);

  // Tooltip opcional (no necesario para hovercard, pero útil en otros visores)
  const pkg = x?.package || "";
  const ver = x?.version || "";
  const summary = x?.summary || x?.title || x?.description || "";
  let title = [
    id,
    x?.severity ? `Severity: ${x.severity}` : null,
    pkg ? `Package: ${pkg}${ver ? "@" + ver : ""}` : null,
    summary ? `— ${summary}` : null,
  ].filter(Boolean).join(" • ");
  if (title.length > 160) title = title.slice(0, 157) + "…";

  // IMPORTANT: no usar backticks aquí, para que GitHub reconozca el patrón y pinte hovercard
  return mdLinkWithTitle(id, href, title);
}

/**
 * Linkify en texto libre (se mantiene para otros renders, no usado en la tabla del summary).
 */
function linkifyIdsMarkdown(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, (_m, id) => `[${id}](https://github.com/advisories/${id})`);
  out = out.replace(/\b(CVE-\d{4}-\d{4,7})\b/g, (_m, id) => `[${id}](https://nvd.nist.gov/vuln/detail/${id})`);
  return out;
}

/**
 * Construye filas para la tabla diff (Job Summary).
 * El SUMMARY debe usar únicamente `renderSummaryTableMarkdown`.
 */
function buildDiffRows(diff, baseLabel, headLabel) {
  const rows = [];
  rows.push("| Severity | Vulnerability | Package | Version | Branch |");
  rows.push("|---|---|---|---|---|");

  const pushRows = (arr, branchLabel) => {
    for (const x of arr || []) {
      const vulnCell = vulnLinkCell(x);                 // <- GHSA first → hovercard
      const pkg = x?.package ? code(x.package) : "`unknown`";
      const ver = x?.version ? code(x.version) : "`-`";
      rows.push(`| ${bold(x?.severity || "UNKNOWN")} | ${vulnCell} | ${pkg} | ${ver} | ${branchLabel} |`);
    }
  };

  // Orden: new (head), removed (base), unchanged (BOTH)
  pushRows(diff?.news,      headLabel);
  pushRows(diff?.removed,   baseLabel);
  pushRows(diff?.unchanged, "BOTH");

  return rows;
}

/**
 * SUMMARY TABLE (Job summary): único punto de entrada para el resumen del job.
 * No reutilizar en otros renders (PDF/HTML tienen su propio flujo).
 */
function renderSummaryTableMarkdown(diff, baseLabel, headLabel) {
  const rows = buildDiffRows(diff, baseLabel, headLabel);
  return rows.join("\n");
}

/**
 * Tabla genérica (compatibilidad con otras partes del pipeline).
 */
function renderDiffTableMarkdown(diff, baseLabel, headLabel) {
  const rows = buildDiffRows(diff, baseLabel, headLabel);
  return rows.join("\n");
}

module.exports = {
  // Summary
  renderSummaryTableMarkdown,

  // Otros (compatibilidad)
  renderDiffTableMarkdown,
  linkifyIdsMarkdown,
  bold,
  code,
};
