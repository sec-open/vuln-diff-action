// src/render/markdown/markdown.js
// Phase 3.1 — Markdown renderers (Summary, PR Comment, Slack). Builds a markdown summary from the normalized view.
// Reads ONLY ./dist via buildView().

// ---------- imports ----------
const core = require('@actions/core');
const path = require('path');
const fs = require('fs/promises');
const { buildView } = require('../common/view');
// ---------- end imports ----------

// ---------- helpers ----------
// Markdown renderer: creates summary markdown (side-by-side refs, totals, flat vulnerability table, tool metadata).

// Safely converts potentially undefined/null/empty values to a printable markdown-safe string.
function mdSafe(s) {
  return (s === undefined || s === null || s === '') ? 'n/a' : String(s);
}
// Generates hyperlink for common vulnerability IDs (CVE/GHSA).
function hyperlinkId(id) {
  if (!id) return 'UNKNOWN';
  const up = String(id).toUpperCase();
  if (up.startsWith('CVE-')) return `[${id}](https://nvd.nist.gov/vuln/detail/${up})`;
  if (up.startsWith('GHSA-')) return `[${id}](https://github.com/advisories/${up})`;
  return String(id);
}
// Formats package data into group:artifact:version.
function asGav(v) {
  const pkg = v?.package || {};
  const g = pkg.groupId ?? 'unknown';
  const a = pkg.artifactId ?? 'unknown';
  const ver = pkg.version ?? 'unknown';
  return `${g}:${a}:${ver}`;
}
// Orden para severidades y estados (mayor a menor / prioridad para desempate).
const SEVERITY_ORDER = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 1 };
const STATE_ORDER = { NEW: 3, REMOVED: 2, UNCHANGED: 1 };
// ---------- end helpers ----------

// Renders the main summary markdown file: header, repo info, side-by-side base/head blocks,
// totals table (NEW / REMOVED / UNCHANGED), vulnerability listing (Vulnerability | Package | State),
// and tool metadata at the end.
async function renderSummaryMarkdown(ctx = {}) {
  core.startGroup('[render/markdown] summary');
  try {
    // Resolve dist directory and build the unified view object.
    const distDir = ctx.distDir || path.resolve('./dist');
    const view = buildView(distDir);

    // Prepare output directory and file path.
    const outDir = path.join(distDir, 'markdown');
    await fs.mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, 'summary.md');

    // Collect markdown lines progressively.
    const lines = [];
    lines.push('# Vulnerability Diff — Summary');
    lines.push('');
    lines.push(`_Generated at ${view.generatedAt}_`);
    lines.push('');
    lines.push(`**Repo:** \`${view.repo}\``);
    lines.push('');

    // Build framed HTML blocks for base and head commit metadata to display side-by-side.
    const baseBlock = `<div style="border:1px solid #d0d7de;padding:8px;border-radius:6px;">
<strong>Base</strong><br>
Ref: <code>${view.base.ref}</code><br>
SHA: <code>${view.base.shaShort}</code> <code>${view.base.sha}</code><br>
Author: ${mdSafe(view.base.author)}<br>
Authored at: ${mdSafe(view.base.authoredAt)}<br>
Commit: ${mdSafe(view.base.commitSubject)}
</div>`;
    const headBlock = `<div style="border:1px solid #d0d7de;padding:8px;border-radius:6px;">
<strong>Head</strong><br>
Ref: <code>${view.head.ref}</code><br>
SHA: <code>${view.head.shaShort}</code> <code>${view.head.sha}</code><br>
Author: ${mdSafe(view.head.author)}<br>
Authored at: ${mdSafe(view.head.authoredAt)}<br>
Commit: ${mdSafe(view.head.commitSubject)}
</div>`;

    // Side-by-side layout via a simple HTML table (markdown fallback when rendered by GitHub).
    lines.push('<table><tr>');
    lines.push(`<td valign="top">${baseBlock}</td>`);
    lines.push(`<td valign="top">${headBlock}</td>`);
    lines.push('</tr></table>');
    lines.push('');

    // Totals table summarizing vulnerability state counts.
    lines.push('| NEW | REMOVED | UNCHANGED |');
    lines.push('| --- | --- | --- |');
    lines.push(`| ${view.summary.totals.NEW} | ${view.summary.totals.REMOVED} | ${view.summary.totals.UNCHANGED} |`);
    lines.push('');

    // Vulnerability listing (flattened) con columna Severity y ordenado.
    lines.push('## All Vulnerabilities');
    const header = '| Severity | Vulnerability | Package | State |\n|---|---|---|---|';
    const sorted = (view.items || []).slice().sort((a, b) => {
      const sa = SEVERITY_ORDER[String(a.severity || 'UNKNOWN').toUpperCase()] || 0;
      const sb = SEVERITY_ORDER[String(b.severity || 'UNKNOWN').toUpperCase()] || 0;
      if (sa !== sb) return sb - sa; // severidad desc
      const sta = STATE_ORDER[String(a.state || 'UNKNOWN').toUpperCase()] || 0;
      const stb = STATE_ORDER[String(b.state || 'UNKNOWN').toUpperCase()] || 0;
      if (sta !== stb) return stb - sta; // state desc
      // desempate adicional por id
      const ida = (a.id || a.ids?.ghsa || a.ids?.cve || '').toString();
      const idb = (b.id || b.ids?.ghsa || b.ids?.cve || '').toString();
      return ida.localeCompare(idb, 'en', { sensitivity: 'base' });
    });
    const rows = sorted.map(v => {
      const sev = String(v.severity || 'UNKNOWN').toUpperCase();
      const id = v.id || v.ids?.ghsa || v.ids?.cve || 'UNKNOWN';
      const pkg = asGav(v);
      const state = String(v.state || 'UNKNOWN').toUpperCase();
      return `| ${sev} | ${hyperlinkId(id)} | \`${pkg}\` | ${state} |`;
    });
    lines.push(header);
    lines.push(...rows);
    lines.push('');

    // Tools metadata moved to end of document; prints key-value pairs or n/a.
    lines.push('> **Tools**');
    if (Object.keys(view.tools).length) {
      for (const [k, val] of Object.entries(view.tools)) {
        lines.push(`> - ${k}: ${typeof val === 'string' ? val : '`' + JSON.stringify(val) + '`'}`);
      }
    } else {
      lines.push('> - n/a');
    }
    lines.push('');

    // Join all lines and write to file.
    const content = lines.join('\n');
    await fs.writeFile(outFile, content, 'utf8');
    core.info(`[render/markdown] wrote ${outFile}`);

    // Attempt to append the content to the GitHub Actions step summary (best-effort).
    try {
      await core.summary.addRaw(content, true).write();
      core.info('[render/markdown] appended to $GITHUB_STEP_SUMMARY');
    } catch (e) {
      core.warning(`[render/markdown] Could not append to $GITHUB_STEP_SUMMARY: ${e.message || e}`);
    }
  } catch (e) {
    core.setFailed(`[render/markdown] summary failed: ${e?.message || e}`);
    throw e;
  } finally {
    core.endGroup();
  }
}

/** Placeholder kept for external compatibility (no implementation). */
async function renderPrCommentMarkdown(ctx = {}) {
  // ...existing code...
}

/** Placeholder kept for external compatibility (no implementation). */
async function renderSlackMarkdown(ctx = {}) {
  // ...existing code...
}

// Exports public rendering functions.
module.exports = {
  renderSummaryMarkdown,
  renderPrCommentMarkdown,
  renderSlackMarkdown,
};
