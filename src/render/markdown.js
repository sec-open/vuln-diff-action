// src/render/markdown.js
// Phase 3 — Markdown-only components (job summary, PR text, Slack text helpers)

// --- inline helpers (markdown) ---
function bold(s) { return `**${s}**`; }
function code(s) { return `\`${s}\``; }

// Link con título (tooltip)
function mdLinkWithTitle(text, href, title) {
  const safeText = String(text || "");
  const safeHref = String(href || "#");
  const safeTitle = String(title || "").replace(/"/g, "&quot;"); // evitar romper el atributo
  return `[${safeText}](${safeHref} "${safeTitle}")`;
}

// URL canónica según tipo de ID
function vulnHrefFromId(id) {
  if (!id) return "#";
  if (/^GHSA-[A-Za-z0-9-]+$/.test(id)) return `https://github.com/advisories/${id}`;
  if (/^CVE-\d{4}-\d{4,7}$/.test(id)) return `https://nvd.nist.gov/vuln/detail/${id}`;
  return "#";
}

// Construye el contenido de la celda "Vulnerability" con tooltip
// Acepta el objeto de diff (x) para poder extraer summary/description/url si existen.
function vulnLinkCell(x) {
  const id = x?.id || "UNKNOWN";
  const href = x?.url || vulnHrefFromId(id);

  // Intentamos coger un resumen si existe en el item (por compatibilidad con tus estructuras)
  const summary = x?.summary || x?.title || x?.description || "";
  const pkg = x?.package || "";
  const ver = x?.version || "";

  // Texto del tooltip (máx ~160 chars para que sea legible)
  const parts = [
    id,
    x?.severity ? `Severity: ${x.severity}` : null,
    pkg ? `Package: ${pkg}${ver ? "@" + ver : ""}` : null,
    summary ? `— ${summary}` : null,
  ].filter(Boolean);

  let title = parts.join(" • ");
  if (title.length > 160) title = title.slice(0, 157) + "…";

  return mdLinkWithTitle(id, href, title);
}

/**
 * Linkify known vulnerability identifiers in free text.
 * - GHSA-XXXX → GitHub Advisories
 * - CVE-YYYY-NNNN → NVD
 * (No añade tooltips; se mantiene para otros usos fuera del summary)
 */
function linkifyIdsMarkdown(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/\b(GHSA-[A-Za-z0-9-]{9,})\b/g, (_m, id) => `[${id}](https://github.com/advisories/${id})`);
  out = out.replace(/\b(CVE-\d{4}-\d{4,7})\b/g, (_m, id) => `[${id}](https://nvd.nist.gov/vuln/detail/${id})`);
  return out;
}

/**
 * Construye filas para la tabla diff.
 * El SUMMARY debe usar únicamente `renderSummaryTableMarkdown`.
 */
function buildDiffRows(diff, baseLabel, headLabel) {
  const rows = [];
  rows.push("| Severity | Vulnerability | Package | Version | Branch |");
  rows.push("|---|---|---|---|---|");

  const pushRows = (arr, branchLabel) => {
    for (const x of arr || []) {
      const vulnCell = vulnLinkCell(x);                 // <- con tooltip
      const pkg = x?.package ? code(x.package) : "`unknown`";
      const ver = x?.version ? code(x.version) : "`-`";
      rows.push(`| ${bold(x?.severity || "UNKNOWN")} | ${vulnCell} | ${pkg} | ${ver} | ${branchLabel} |`);
    }
  };

  // Mantén el orden que uses (aquí: new, removed, unchanged)
  pushRows(diff?.news,     headLabel);
  pushRows(diff?.removed,  baseLabel);
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
 * Tabla genérica (se mantiene para compatibilidad con el resto del pipeline).
 * Si quieres separación total, podrías eliminarla y construir tablas específicas en cada render.
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
