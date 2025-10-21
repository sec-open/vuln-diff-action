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
// Safely converts potentially undefined/null/empty values to a printable markdown-safe string.
function mdSafe(s) {
  return (s === undefined || s === null || s === '') ? 'n/a' : String(s);
}
// Builds a hyperlink for known vulnerability ID formats (CVE / GHSA); returns plain text otherwise.
function hyperlinkId(id) {
  if (!id) return 'UNKNOWN';
  const up = String(id).toUpperCase();
  if (up.startsWith('CVE-')) return `[${id}](https://nvd.nist.gov/vuln/detail/${up})`;
  if (up.startsWith('GHSA-')) return `[${id}](https://github.com/advisories/${up})`;
  return String(id);
}
// Formats a vulnerability's package coordinates as group:artifact:version (fallbacks to 'unknown').
function asGav(v) {
  const pkg = v?.package || {};
  const g = pkg.groupId ?? 'unknown';
  const a = pkg.artifactId ?? 'unknown';
  const ver = pkg.version ?? 'unknown';
  return `${g}:${a}:${ver}`;
}
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

    // Vulnerability listing (flattened) without any branch column.
    lines.push('## All Vulnerabilities');
    const header = '| Vulnerability | Package | State |\n|---|---|---|';
    const rows = (view.items || []).map(v => {
      const id = v.id || v.ids?.ghsa || v.ids?.cve || 'UNKNOWN';
      const pkg = asGav(v);
      const state = String(v.state || 'UNKNOWN').toUpperCase();
      return `| ${hyperlinkId(id)} | \`${pkg}\` | ${state} |`;
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

// Placeholder: PR comment renderer (kept for compatibility if invoked externally).
async function renderPrCommentMarkdown(ctx = {}) {
  // ...existing code...
}

// Placeholder: Slack message renderer (kept for compatibility if invoked externally).
async function renderSlackMarkdown(ctx = {}) {
  // ...existing code...
}

// Exports public rendering functions.
module.exports = {
  renderSummaryMarkdown,
  renderPrCommentMarkdown,
  renderSlackMarkdown,
};
