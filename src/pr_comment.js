// src/pr_comment.js
// Post or update a sticky PR comment with the vulnerability summary table.
// This enables GitHub GHSA hovercards (PR comments support them; job summary may not).

const core = require("@actions/core");
const github = require("@actions/github");

/**
 * Post or update a sticky comment in a PR, identified by a marker.
 * Does nothing if not running on a PR or if token/flag are missing.
 *
 * @param {Object} opts
 * @param {string} opts.token           GitHub token (secrets.GITHUB_TOKEN)
 * @param {boolean} opts.enabled        Whether PR comment feature is enabled
 * @param {string} [opts.marker]        Marker base name (without :start/:end)
 * @param {string} opts.tableMarkdown   The markdown table to publish
 * @param {string} opts.baseLabel       Base branch label (for info text)
 * @param {string} opts.headLabel       Head branch label (for info text)
 */
async function maybePostPrComment(opts) {
  try {
    const pr = github.context.payload?.pull_request;
    if (!opts?.enabled) {
      core.info("PR comment skipped (feature disabled).");
      return;
    }
    if (!opts?.token) {
      core.info("PR comment skipped (no token).");
      return;
    }
    if (!pr || !pr.number) {
      core.info("PR comment skipped (not a pull_request event).");
      return;
    }

    const octokit = github.getOctokit(opts.token);
    const { owner, repo } = github.context.repo;
    const issue_number = pr.number;

    const markerBase = (opts.marker && String(opts.marker)) || "vuln-diff-action:summary";
    const markerStart = `<!-- ${markerBase}:start -->`;
    const markerEnd = `<!-- ${markerBase}:end -->`;

    const body =
`${markerStart}
### Vulnerability Diff (for GH hovercards)

Base: \`${opts.baseLabel}\` • Head: \`${opts.headLabel}\`

${opts.tableMarkdown}

> GHSA links point to GitHub Advisories. Hover to see details.
${markerEnd}`;

    const { data: comments } = await octokit.rest.issues.listComments({
      owner, repo, issue_number, per_page: 100,
    });

    const existing = comments.find(
      c => c.user?.type === "Bot" && typeof c.body === "string" && c.body.includes(markerStart)
    );

    if (existing) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
      core.info(`Updated PR comment (id=${existing.id}).`);
    } else {
      const { data: created } = await octokit.rest.issues.createComment({ owner, repo, issue_number, body });
      core.info(`Created PR comment (id=${created.id}).`);
    }
  } catch (err) {
    core.warning(`Failed to post PR comment: ${err.message}`);
  }
}

module.exports = { maybePostPrComment };
