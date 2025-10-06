// Git helpers: resolve refs, author info, isolated checkouts via worktree
const path = require('path');
const { execCmd } = require('./exec');
const { ensureDir } = require('./fsx');

async function gitFetchAll(cwd) {
  await execCmd('git', ['fetch', '--all', '--tags', '--prune'], { cwd });
}

async function resolveRefToSha(ref, cwd) {
  const { stdout } = await execCmd('git', ['rev-parse', ref], { cwd });
  return stdout.trim();
}

function shortSha(sha) { return sha.slice(0, 7); }

async function commitInfo(sha, cwd) {
  const fmt = [
    '%H', // full sha
    '%h', // short sha
    '%an', // author
    '%ai', // authored_at (ISO-ish)
    '%s', // subject
  ].join('%n');
  const { stdout } = await execCmd('git', ['show', '-s', `--format=${fmt}`, sha], { cwd });
  const [full, short, author, authored_at, subject] = stdout.trim().split('\n');
  return {
    ref: sha,
    sha: full,
    sha_short: short,
    author,
    authored_at,
    commit_subject: subject,
  };
}

async function prepareIsolatedCheckout(sha, targetDir, repoRoot) {
  await ensureDir(path.dirname(targetDir));
  // Use a detached worktree at the specific commit, read-only operations
  await execCmd('git', ['worktree', 'add', '--detach', targetDir, sha], { cwd: repoRoot });
  return targetDir;
}

async function cleanupWorktree(dir, repoRoot) {
  try {
    await execCmd('git', ['worktree', 'remove', dir, '--force'], { cwd: repoRoot });
  } catch {
    // best-effort cleanup; not fatal for Phase 1
  }
}

module.exports = {
  gitFetchAll,
  resolveRefToSha,
  shortSha,
  commitInfo,
  prepareIsolatedCheckout,
  cleanupWorktree,
};
