// Phase 3.1 (Markdown)
// - Reads ONLY ./dist/{diff.json, base.json, head.json}
// - Writes markdown outputs under ./dist/markdown/
// - Appends summary.md to $GITHUB_STEP_SUMMARY
// - Upserts a reusable PR comment (only on pull_request and NEW > 0)
// - Slack delivery only if slack_webhook_url input is provided

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs/promises');
const path = require('path');
const https = require('https');

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const REUSABLE_COMMENT_MARKER = '<!-- VULN-DIFF-PR-COMMENT -->';

function sevRank(s) {
  const idx = SEVERITY_ORDER.indexOf(String(s || '').toUpperCase());
  return idx >= 0 ? idx : SEVERITY_ORDER.length;
}

function sevIcon(sev) {
  const s = String(sev || 'UNKNOWN').toUpperCase();
  if (s === 'CRITICAL') return '🛑';
  if (s === 'HIGH') return '🟠';
  if (s === 'MEDIUM') return '🟡';
  if (s === 'LOW') return '🟢';
  return '⚪';
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJSON(p) {
  const text = await fs.readFile(p, 'utf8');
  return JSON.parse(text);
}

async function writeText(p, content) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, content, 'utf8');
}

function asGav(v) {
  const pkg = v?.package || {};
  const g = pkg.groupId ?? 'unknown';
  const a = pkg.artifactId ?? 'unknown';
  const ver = pkg.version ?? 'unknown';
  return `${g}:${a}:${ver}`;
}

function vulnerabilityUrl(id) {
  if (!id || typeof id !== 'string') return null;
  const up = id.toUpperCase();
  if (up.startsWith('CVE-')) {
    return `https://nvd.nist.gov/vuln/detail/${up}`;
  }
  if (up.startsWith('GHSA-')) {
    return `https://github.com/advisories/${up}`;
  }
  return null; // unknown scheme; caller can render plain text
}

function hyperlinkId(id) {
  const url = vulnerabilityUrl(id);
  return url ? `[${id}](${url})` : id || 'UNKNOWN';
}

function formatTotalsLine(totals) {
  return `**Totals** — NEW: ${totals?.NEW ?? 0} · REMOVED: ${totals?.REMOVED ?? 0} · UNCHANGED: ${totals?.UNCHANGED ?? 0}`;
}

function tableFromBySeverityAndState(by) {
  const header = `| Severity | NEW | REMOVED | UNCHANGED |
|---|---:|---:|---:|`;
  const lines = [];
  for (const sev of SEVERITY_ORDER) {
    const row = by?.[sev] || {};
    lines.push(`| ${sev} | ${row.NEW ?? 0} | ${row.REMOVED ?? 0} | ${row.UNCHANGED ?? 0} |`);
  }
  return [header, ...lines].join('\n');
}

function fullItemsTable(items) {
  const header = `| Severity | Vulnerability | Package | Status |
|---|---|---|---|`;
  const rows = (items || [])
    .slice()
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity))
    .map(v => {
      const sev = String(v.severity || 'UNKNOWN').toUpperCase();
      const id = v.id || v.ids?.ghsa || v.ids?.cve || 'UNKNOWN';
      const gav = asGav(v);
      const state = String(v.state || 'UNKNOWN').toUpperCase();
      return `| ${sev} | ${hyperlinkId(id)} | \`${gav}\` | ${state} |`;
    });
  return [header, ...rows].join('\n');
}

function renderNewItemsTable(newItems, limit = 1000) {
  if (!Array.isArray(newItems) || newItems.length === 0) return '_No NEW vulnerabilities._';
  const header = `| Severity | Vulnerability | Package | Status |
|---|---|---|---|`;
  const rows = newItems
    .slice(0, limit)
    .map(v => {
      const sev = String(v.severity || 'UNKNOWN').toUpperCase();
      const id = v.id || v.ids?.ghsa || v.ids?.cve || 'UNKNOWN';
      const gav = asGav(v);
      const state = String(v.state || 'NEW').toUpperCase();
      return `| ${sev} | ${hyperlinkId(id)} | \`${gav}\` | ${state} |`;
    });
  return [header, ...rows].join('\n');
}

function renderSimpleNewListForSlack(newItems, topN = 20) {
  if (!Array.isArray(newItems) || newItems.length === 0) return '• none';
  const arr = newItems.slice(0, topN).map(v => {
    const sev = String(v.severity || 'UNKNOWN').toUpperCase();
    const icon = sevIcon(sev);
    const id = v.id || v.ids?.ghsa || v.ids?.cve || 'UNKNOWN';
    const url = vulnerabilityUrl(id);
    const idChunk = url ? `<${url}|${id}>` : id;
    const gav = asGav(v);
    return `• ${icon}  ${sev} — ${idChunk}  →  \`${gav}\``;
  });
  return arr.join('\n');
}

async function appendToJobSummary(markdown) {
  try {
    await core.summary.addRaw(markdown, true).write();
  } catch {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
      await fs.appendFile(summaryFile, `\n${markdown}\n`, 'utf8');
    } else {
      core.warning('[render/markdown] Could not append to $GITHUB_STEP_SUMMARY');
    }
  }
}

function nowISO() {
  return new Date().toISOString();
}

function getEventName() {
  return process.env.GITHUB_EVENT_NAME || '';
}

function getGithubToken() {
  return core.getInput('github_token') || process.env.GITHUB_TOKEN || '';
}

async function upsertPrComment({ owner, repo, issue_number, body, octokit }) {
  const existing = await octokit.paginate(octokit.rest.issues.listComments, {
    owner, repo, issue_number, per_page: 100,
  });
  const mine = existing.find(c => typeof c.body === 'string' && c.body.includes(REUSABLE_COMMENT_MARKER));
  if (mine) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
    return { action: 'updated', id: mine.id };
  } else {
    const res = await octokit.rest.issues.createComment({ owner, repo, issue_number, body });
    return { action: 'created', id: res?.data?.id };
  }
}

async function postToSlackWebhook(webhookUrl, text) {
  if (!webhookUrl) {
    core.info('[render/markdown] Slack webhook not provided; skipping delivery');
    return { delivered: false, status: 'no-webhook' };
  }
  const payload = { text }; // Slack Incoming Webhook expects { text }
  if (typeof fetch === 'function') {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ok = res.ok;
    const body = await res.text().catch(() => '');
    if (!ok) {
      core.warning(`[render/markdown] Slack webhook failed: ${res.status} ${res.statusText} :: ${body}`);
      return { delivered: false, status: `http-${res.status}` };
    }
    core.info('[render/markdown] Slack delivery OK');
    return { delivered: true, status: 'ok' };
  }
  await new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const url = new URL(webhookUrl);
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c.toString('utf8')));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            core.info('[render/markdown] Slack delivery OK');
          } else {
            core.warning(`[render/markdown] Slack webhook failed: ${res.statusCode} :: ${body}`);
          }
          resolve();
        });
      }
    );
    req.on('error', (err) => {
      core.warning(`[render/markdown] Slack webhook error: ${err?.message || err}`);
      resolve();
    });
    req.write(data);
    req.end();
  });
  return { delivered: true, status: 'ok-https' };
}

// ===== Public API =====

/**
 * Build concise job summary for GitHub Action and write it to:
 * - ./dist/markdown/summary.md (always)
 * - $GITHUB_STEP_SUMMARY (append same content)
 * Now includes a full table of ALL vulnerabilities: | Severity | Vulnerability | Package | Status |
 */
async function renderSummaryMarkdown(ctx = {}) {
  core.startGroup('[render/markdown] summary');
  try {
    const distDir = ctx.distDir || path.resolve('./dist');
    const outDir = path.join(distDir, 'markdown');
    const outFile = path.join(outDir, 'summary.md');

    const diff = await readJSON(path.join(distDir, 'diff.json'));
    const base = await readJSON(path.join(distDir, 'base.json'));
    const head = await readJSON(path.join(distDir, 'head.json'));
    void base; void head;

    const totals = diff?.summary?.totals || { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
    const by = diff?.summary?.by_severity_and_state || {};
    const items = Array.isArray(diff?.items) ? diff.items : [];

    const lines = [];
    lines.push(`# Vulnerability Diff — Summary`);
    lines.push(`_Generated at ${nowISO()}_`);
    lines.push('');
    lines.push(formatTotalsLine(totals));
    lines.push('');
    lines.push('**By Severity and State**');
    lines.push(tableFromBySeverityAndState(by));
    lines.push('');
    lines.push('**All Vulnerabilities**');
    lines.push(fullItemsTable(items));
    lines.push('');

    const content = lines.join('\n');
    await writeText(outFile, content);
    core.info(`[render/markdown] wrote ${outFile}`);

    await appendToJobSummary(content);
    core.info('[render/markdown] appended summary to $GITHUB_STEP_SUMMARY');
  } finally {
    core.endGroup();
  }
}

/**
 * Generate PR comment ONLY if NEW > 0 and the event is pull_request.
 * Upsert a single reusable comment (identified by REUSABLE_COMMENT_MARKER).
 * Also writes the content to ./dist/markdown/pr-comment.md if generated.
 * Vulnerability IDs are hyperlinked to their advisory pages.
 */
async function renderPrCommentMarkdown(ctx = {}) {
  core.startGroup('[render/markdown] pr-comment');
  try {
    const eventName = ctx.eventName || (process.env.GITHUB_EVENT_NAME || '');
    if (eventName !== 'pull_request') {
      core.info(`[render/markdown] not a pull_request event; skipping PR comment`);
      return;
    }

    const distDir = ctx.distDir || path.resolve('./dist');
    const outDir = path.join(distDir, 'markdown');
    const outFile = path.join(outDir, 'pr-comment.md');

    const diff = await readJSON(path.join(distDir, 'diff.json'));
    const totals = diff?.summary?.totals || { NEW: 0 };
    const hasNew = Number(totals.NEW || 0) > 0;

    if (!hasNew) {
      core.info('[render/markdown] no NEW vulnerabilities; skipping PR comment');
      return;
    }

    const newItems = (diff?.items || [])
      .filter(v => String(v.state).toUpperCase() === 'NEW')
      .sort((a, b) => sevRank(a.severity) - sevRank(b.severity));

    const lines = [];
    lines.push(REUSABLE_COMMENT_MARKER);
    lines.push('');
    lines.push(`:rotating_light: **New vulnerabilities detected** :rotating_light:`);
    lines.push('');
    lines.push(formatTotalsLine(totals));
    lines.push('');
    lines.push(renderNewItemsTable(newItems, 1000));
    lines.push('');
    const content = lines.join('\n');

    await writeText(outFile, content);
    core.info(`[render/markdown] wrote ${outFile}`);

    const token = getGithubToken();
    if (!token) {
      core.warning('[render/markdown] GITHUB_TOKEN not available; cannot upsert PR comment');
      return;
    }

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pr = github.context.payload?.pull_request;
    const issue_number = pr?.number;

    if (!issue_number) {
      core.warning('[render/markdown] pull_request number not found in context; skipping comment');
      return;
    }

    const res = await upsertPrComment({ owner, repo, issue_number, body: content, octokit });
    core.info(`[render/markdown] PR comment ${res.action} (id=${res.id})`);
  } finally {
    core.endGroup();
  }
}

/**
 * Produce Slack-friendly message similar to the screenshot:
 * - Header with repo, base→head, PR link (when available)
 * - A bulleted list of NEW vulnerabilities with severity icons and advisory links
 * - Writes ./dist/markdown/slack.md (always)
 * - Delivery only if slack_webhook_url is provided
 */
async function renderSlackMarkdown(ctx = {}) {
  core.startGroup('[render/markdown] slack');
  try {
    const distDir = ctx.distDir || path.resolve('./dist');
    const outDir = path.join(distDir, 'markdown');
    const outFile = path.join(outDir, 'slack.md');

    const diff = await readJSON(path.join(distDir, 'diff.json'));
    const base = await readJSON(path.join(distDir, 'base.json'));
    const head = await readJSON(path.join(distDir, 'head.json'));
    void base; void head;

    const totals = diff?.summary?.totals || { NEW: 0, REMOVED: 0, UNCHANGED: 0 };

    const newItems = (diff?.items || [])
      .filter(v => String(v.state).toUpperCase() === 'NEW')
      .sort((a, b) => sevRank(a.severity) - sevRank(b.severity));

    // Context bits
    const { owner, repo } = github.context.repo || {};
    const baseRef = core.getInput('base_ref') || 'base';
    const headRef = core.getInput('head_ref') || 'head';
    const prNum = github.context.payload?.pull_request?.number;
    const prUrl = prNum
      ? `https://github.com/${owner}/${repo}/pull/${prNum}`
      : '';

    const lines = [];
    const emojiAlert = totals.NEW > 0 ? ':rotating_light:' : ':white_check_mark:';
    lines.push(`${emojiAlert}  *${totals.NEW} new vulnerabilities introduced*`);
    lines.push(`• Repo: \`${owner}/${repo}\``);
    lines.push(`• Base: \`${baseRef}\``);
    lines.push(`• Head: \`${headRef}\``);
    if (prUrl) lines.push(`• PR: ${prUrl}`);
    lines.push('');
    if (newItems.length > 0) {
      lines.push('*New Vulnerabilities:*');
      lines.push(renderSimpleNewListForSlack(newItems, 50));
    } else {
      lines.push('_No NEW vulnerabilities._');
    }
    lines.push('');
    const content = lines.join('\n');

    await writeText(outFile, content);
    core.info(`[render/markdown] wrote ${outFile}`);

    const webhook = (ctx.slackWebhookUrl || '').trim();
    if (webhook) {
      await postToSlackWebhook(webhook, content);
    } else {
      core.info('[render/markdown] Slack webhook not provided; skipping delivery');
    }
  } finally {
    core.endGroup();
  }
}

module.exports = {
  renderSummaryMarkdown,
  renderPrCommentMarkdown,
  renderSlackMarkdown,
};
