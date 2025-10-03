// path: src/git.js
/**
 * Git helpers
 * - fetchAll(): ensure remote refs are available
 * - resolveRef(ref): resolve to full SHA
 * - commitInfo(sha): basic metadata (subject, author, date, short)
 * - prepareCheckout(refOrSha, destDir): create an isolated tree for that ref
 *    * try git worktree (fast, preserves metadata)
 *    * fallback to git archive (portable)
 * All comments in English (project guideline).
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);
const fs = require("fs/promises");
const path = require("path");

async function sh(cmd, opts = {}) {
  return execFileP("bash", ["-lc", cmd], { maxBuffer: 64 * 1024 * 1024, ...opts });
}

async function fetchAll() {
  try {
    await sh("git fetch --all --prune --tags --force");
  } catch (e) {
    // best-effort: ignore if shallow; most runners already have remote
    // rethrow only if message indicates repo missing
    if (/not a git repository/i.test(String(e?.message || ""))) throw e;
  }
}

async function resolveRef(ref) {
  const { stdout } = await sh(`git rev-parse ${ref}`);
  return stdout.trim();
}

function shortSha(sha) {
  return String(sha || "").slice(0, 7);
}

async function commitInfo(sha) {
  const fmt = [
    "%H", // full sha
    "%h", // short
    "%s", // subject
    "%an", // author
    "%ad", // author date (default format)
    "%cI", // committer date ISO
  ].join("%x1f");
  const { stdout } = await sh(`git show -s --format='${fmt}' ${sha}`);
  const [full, short, subject, author, date, committerIso] = stdout.trim().split("\x1f");
  return {
    sha: full, sha_short: short, subject, author, date, committer_iso: committerIso,
  };
}

/**
 * Create an isolated checkout of the given ref (branch/tag/sha) into destDir.
 * Prefers 'git worktree'. If unavailable, falls back to 'git archive'.
 */
async function prepareCheckout(refOrSha, destDir) {
  await fs.mkdir(destDir, { recursive: true });

  // Try worktree first (fast & accurate)
  try {
    await sh(`git worktree add --detach '${destDir}' '${refOrSha}'`);
    return { path: destDir, method: "worktree" };
  } catch (e) {
    // Fallback: archive
    await sh(`git archive --format=tar '${refOrSha}' | tar -x -C '${destDir}'`);
    return { path: destDir, method: "archive" };
  }
}

module.exports = {
  fetchAll,
  resolveRef,
  commitInfo,
  shortSha,
  prepareCheckout,
};
