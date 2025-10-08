// src/render/markdown/markdown.js
// Phase 3.1 — Markdown renderers (Summary, PR Comment, Slack), using the common Phase-2 view.
// Reads ONLY ./dist via buildView(). No schema fallbacks.

const core = require('@actions/core');
const path = require('path');
const fs = require('fs/promises');
const { buildView } = require('../common/view');

// ---------- helpers ----------
function mdSafe(s) {
  return (s === undefined || s === null || s === '') ? 'n/a' : String(s);
}
function hyperlinkId(id) {
  if (!id) return 'UNKNOWN';
  const up = String(id).toUpperCase();
  if (up.startsWith('CVE-')) return `[${id}](https://nvd.nist.gov/vuln/detail/${up})`;
  if (up.startsWith('GHSA-')) return `[${id}](https://github.com/advisories/${up})`;
  return String(id);
}
function asGav(v) {
  const pkg = v?.package || {};
  const g = pkg.groupId ?? 'unknown';
  const a = pkg.artifactId ?? 'unknown';
  const ver = pkg.version ?? 'unknown';
  return `${g}:${a}:${ver}`;
}
function branchFromState(state) {
  const s = String(state || '').toUpperCase();
  if (s === 'NEW') return 'Head';
  if (s === 'REMOVED') return 'Base';
  if (s === 'UNCHANGED') return 'Base & Head';
  return 'UNKNOWN';
}
// ---------- end helpers ----------

async function renderSummaryMarkdown(ctx = {}) {
  core.startGroup('[render/markdown] summary');
  try {
    const distDir = ctx.distDir || path.resolve('./dist');
    const view = buildView(distDir);

    const outDir = path.join(distDir, 'markdown');
    await fs.mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, 'summary.md');

    const lines = [];
    lines.push(`# Vulnerability Diff — Summary`);
    lines.push('');
    lines.push(`_Generated at ${view.generatedAt}_`);
    lines.push('');
    lines.push(`**Repo:** \`${view.repo}\``);
    lines.push('');
    // Cards: Branches (Base & Head), Tools, Inputs (NOT tables)
    lines.push('> **Base**');
    lines.push(`> - Ref: \`${view.base.ref}\``);
    lines.push(`> - SHA: \`${view.base.shaShort}\`  \`${view.base.sha}\``);
    lines.push(`> - Author: ${mdSafe(view.base.author)}`);
    lines.push(`> - Authored at: ${mdSafe(view.base.authoredAt)}`);
    lines.push(`> - Commit: ${mdSafe(view.base.commitSubject)}`);
    lines.push('>');
    lines.push('> **Head**');
    lines.push(`> - Ref: \`${view.head.ref}\``);
    lines.push(`> - SHA: \`${view.head.shaShort}\`  \`${view.head.sha}\``);
    lines.push(`> - Author: ${mdSafe(view.head.author)}`);
    lines.push(`> - Authored at: ${mdSafe(view.head.authoredAt)}`);
    lines.push(`> - Commit: ${mdSafe(view.head.commitSubject)}`);
    lines.push('');
    lines.push('> **Tools**');
    if (Object.keys(view.tools).length) {
      for (const [k, v] of Object.entries(view.tools)) {
        lines.push(`> - ${k}: ${typeof v === 'string' ? v : '`' + JSON.stringify(v) + '`'}`);
      }
    } else {
      lines.push('> - n/a');
    }
    lines.push('');
    lines.push('> **Inputs**');
    lines.push(`> - base_ref: \`${view.inputs.baseRef}\``);
    lines.push(`> - head_ref: \`${view.inputs.headRef}\``);
    lines.push(`> - path: \`${view.inputs.path}\``);
    lines.push('');

    // Totals line
    lines.push(`**Totals** — **NEW:** ${view.summary.totals.NEW} · **REMOVED:** ${view.summary.totals.REMOVED} · **UNCHANGED:** ${view.summary.totals.UNCHANGED}`);
    lines.push('');

    // REQUIRED: list ALL vulnerabilities with columns: Vulnerability | Package | Branch | State
    lines.push('## All Vulnerabilities');
    const header = `| Vulnerability | Package | Branch | State |
|---|---|---|---|`;
    const rows = (view.items || []).map((v) => {
      const id = v.id || v.ids?.ghsa || v.ids?.cve || 'UNKNOWN';
      const pkg = asGav(v);
      const state = String(v.state || 'UNKNOWN').toUpperCase();
      const branch = branchFromState(state);
      return `| ${hyperlinkId(id)} | \`${pkg}\` | ${branch} | ${state} |`;
    });
    lines.push(header);
    lines.push(...rows);
    lines.push('');

    const content = lines.join('\n');
    await fs.writeFile(outFile, content, 'utf8');
    core.info(`[render/markdown] wrote ${outFile}`);

    // Append to GitHub Step Summary
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

// No changes requested to these, keep stubs or your existing logic
async function renderPrCommentMarkdown(ctx = {}) {
  // (keep your existing implementation; not changed in this patch)
}
async function renderSlackMarkdown(ctx = {}) {
  // (keep your existing implementation; not changed in this patch)
}

module.exports = {
  renderSummaryMarkdown,
  renderPrCommentMarkdown,
  renderSlackMarkdown,
};
