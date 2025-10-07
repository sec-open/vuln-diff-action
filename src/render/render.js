// src/render/render.js
// Render Orchestrator: kicks off 3.1 (Markdown) and 3.2 (HTML). 3.3 (PDF) will be added later.
const core = require('@actions/core');
const path = require('path');

/**
 * Markdown init (3.1):
 * - Calls the markdown renderer (summary.md, pr-comment.md, slack.md).
 * - summary.md should always be generated and appended to $GITHUB_STEP_SUMMARY.
 * - pr-comment.md is generated/used only if NEW > 0 (upsert one reusable PR comment).
 * - slack.md is always generated, and delivered ONLY if slack_webhook_url input is provided.
 */
async function markdown_init({ distDir = './dist' } = {}) {
  core.startGroup('[render] Markdown');
  try {
    const markdown = require('./markdown/markdown');

    const ctx = {
      distDir: path.resolve(distDir),
      slackWebhookUrl: core.getInput('slack_webhook_url') || '',
      eventName: process.env.GITHUB_EVENT_NAME || '',
    };

    if (typeof markdown.renderSummaryMarkdown === 'function') {
      await markdown.renderSummaryMarkdown(ctx);
    } else {
      core.warning('[render/markdown] renderSummaryMarkdown() not implemented');
    }

    if (typeof markdown.renderPrCommentMarkdown === 'function') {
      await markdown.renderPrCommentMarkdown(ctx);
    } else {
      core.info('[render/markdown] renderPrCommentMarkdown() not present; skipping');
    }

    if (typeof markdown.renderSlackMarkdown === 'function') {
      await markdown.renderSlackMarkdown(ctx);
    } else {
      core.info('[render/markdown] renderSlackMarkdown() not present; skipping');
    }

    core.info('[render] Markdown completed');
  } catch (e) {
    core.setFailed(`[render] Markdown failed: ${e?.message || e}`);
    throw e;
  } finally {
    core.endGroup();
  }
}

/**
 * HTML init (3.2):
 * - Calls the HTML bundle builder. Output must be written under ./dist/html.
 * - Optional input: html_logo_url to place a logo in the header (can be a relative path inside the bundle or an absolute URL).
 */
async function html_init({ distDir = './dist', logoUrl } = {}) {
  core.startGroup('[render] HTML');
  try {
    const { buildHtmlBundle } = require('./html/html');

    const resolvedDist = path.resolve(distDir);
    // Allow explicit param to override action input
    const logo = (logoUrl !== undefined ? logoUrl : (core.getInput('html_logo_url') || ''));

    await buildHtmlBundle({ distDir: resolvedDist, logoUrl: logo });

    core.info(`[render/html] bundle generated at ${path.join(resolvedDist, 'html')}`);
  } catch (e) {
    core.setFailed(`[render] HTML failed: ${e?.message || e}`);
    throw e;
  } finally {
    core.endGroup();
  }
}

/**
 * Render entrypoint (Phase 3):
 * - Runs Markdown (3.1) and HTML (3.2). PDF (3.3) will be added later.
 */
async function render(options = {}) {
  const distDir = options.distDir || './dist';

  core.info('[render] start');
  await markdown_init({ distDir });
  await html_init({ distDir }); // HTML always attempted after Markdown
  core.info('[render] done');
}

module.exports = {
  render,
  markdown_init,
  html_init,
};
