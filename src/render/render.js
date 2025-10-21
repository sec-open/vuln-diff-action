// src/render/render.js
// Phase 3 Orchestrator: runs Markdown (3.1), HTML bundle (3.2), and PDF (3.3).
const core = require('@actions/core');
const path = require('path');

/** Executes Markdown rendering (summary, PR comment, Slack if implemented). */
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

/** Builds static HTML bundle (assets + sections) under ./dist/html. */
async function html_init({ distDir = './dist', logoUrl } = {}) {
  core.startGroup('[render] HTML');
  try {
    const { buildHtmlBundle } = require('./html/html');

    const resolvedDist = path.resolve(distDir);
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

/** Generates full printable HTML and exports PDF under ./dist/pdf. */
async function pdf_init({ distDir = './dist' } = {}) {
  core.startGroup('[render] PDF');
  try {
    const { pdf_init: runPdf } = require('./pdf/pdf'); // uses the skeleton module you created
    await runPdf({ distDir: path.resolve(distDir) });
    core.info('[render/pdf] PDF skeleton generated under ./dist/pdf');
  } catch (e) {
    core.setFailed(`[render] PDF failed: ${e?.message || e}`);
    throw e;
  } finally {
    core.endGroup();
  }
}

/** Entry point: sequentially runs Markdown → HTML → PDF. */
async function render(options = {}) {
  const distDir = options.distDir || './dist';

  core.info('[render] start');
  await markdown_init({ distDir });
  await html_init({ distDir }); // HTML after Markdown
  await pdf_init({ distDir });  // PDF after HTML
  core.info('[render] done');
}

module.exports = {
  render,
  markdown_init,
  html_init,
  pdf_init,
};
