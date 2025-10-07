// src/render/orchestrator.js
// Markdown Orchestrator: kicks off Markdown.1 (Markdown) and will later drive 3.2 (HTML) and 3.3 (PDF)
const core = require('@actions/core');
const path = require('path');

/**
 * Markdown.1 (Markdown) init:
 * - Calls the markdown orchestrator (three outputs: summary.md, pr-comment.md, slack.md).
 * - summary.md should always be generated and appended to $GITHUB_STEP_SUMMARY.
 * - pr-comment.md is generated/used only if NEW > 0 (upsert one reusable PR comment).
 * - slack.md is always generated, and delivered ONLY if slack_webhook_url input is provided.
 */
async function markdown_init({ distDir = './dist' } = {}) {
  core.startGroup('[render] Markdown');
  try {
    // This module should export the three functions as per the Markdown.1 prompt:
    // renderSummaryMarkdown(ctx), renderPrCommentMarkdown(ctx), renderSlackMarkdown(ctx)
    const markdown = require('./markdown/markdown');

    const ctx = {
      distDir: path.resolve(distDir),
      slackWebhookUrl: core.getInput('slack_webhook_url') || '',
      // you may pass additional context here later (e.g., event name) if needed by the markdown module
      eventName: process.env.GITHUB_EVENT_NAME || '',
    };

    // Summary (always; also append to $GITHUB_STEP_SUMMARY inside the function or here after writing the file)
    if (typeof markdown.renderSummaryMarkdown === 'function') {
      await markdown.renderSummaryMarkdown(ctx);
    } else {
      core.warning('[render/markdown] renderSummaryMarkdown() not implemented');
    }

    // PR comment (only if NEW > 0; the function should decide based on diff.json)
    if (typeof markdown.renderPrCommentMarkdown === 'function') {
      await markdown.renderPrCommentMarkdown(ctx);
    } else {
      core.info('[render/markdown] renderPrCommentMarkdown() not present; skipping');
    }

    // Slack (always generate slack.md; deliver only if webhook is provided)
    if (typeof markdown.renderSlackMarkdown === 'function') {
      await markdown.renderSlackMarkdown(ctx);
    } else {
      core.info('[render/markdown] renderSlackMarkdown() not present; skipping');
    }

    core.info('[render] Markdown completed');
  } catch (e) {
    core.setFailed(`[render] Markdown.1 (Markdown) failed: ${e?.message || e}`);
    throw e;
  } finally {
    core.endGroup();
  }
}

/**
 * Markdown entrypoint:
 * - For now, runs only Markdown.1 (Markdown).
 * - Later, this function will also call Markdown.2 (HTML) and Markdown.3 (PDF).
 */
async function render(options = {}) {
  const distDir = options.distDir || './dist';

  core.info('[render] Markdown: start');
  await markdown_init({ distDir });

  // TODO HTML: call HTML builder here, e.g., await html_init({ distDir });
  // TODO PDF: call PDF builder here, e.g., await pdf_init({ distDir });

  core.info('[render] Markdown: done');
}

module.exports = {
  render,
  markdown_init, // exposed explicitly as requested
};
