// Git helpers: fetch refs, resolve revisions, extract commit metadata, manage isolated worktrees.
const path = require('path');
const { execCmd } = require('./exec');
const { ensureDir } = require('./fsx');

// Fetches all remote refs and tags (prunes stale references).
async function gitFetchAll(cwd) {
  await execCmd('git', ['fetch', '--all', '--tags', '--prune'], { cwd });
}

// Resolves a ref (branch/tag/SHA) to a full commit SHA; tries common prefixes.
async function resolveRefToSha(ref, cwd) {
  const trimmed = (ref || '').trim();
  if (!trimmed) throw new Error('Empty ref');

  // If it looks like a SHA, return it after validation
  if (/^[0-9a-f]{7,40}$/i.test(trimmed)) {
    const { stdout } = await execCmd('git', ['rev-parse', trimmed], { cwd });
    return stdout.trim();
  }

  const candidates = [
    trimmed,                    // e.g. "develop"
    `origin/${trimmed}`,        // e.g. "origin/develop"
    `refs/heads/${trimmed}`,    // e.g. "refs/heads/develop"
    `refs/tags/${trimmed}`,     // e.g. "refs/tags/v2.0.0"
  ];

  let lastErr;
  for (const c of candidates) {
    try {
      const { stdout } = await execCmd('git', ['rev-parse', c], { cwd });
      return stdout.trim();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Unable to resolve ref: ${ref}\nLast error: ${lastErr ? lastErr.message : 'unknown'}`);
}

// Returns short 7-char prefix of a commit SHA.
function shortSha(sha) { return sha.slice(0, 7); }

// Retrieves commit metadata (author, timestamps, subject) for a given SHA.
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

// Creates a detached worktree at the specified SHA (read-only operations).
async function prepareIsolatedCheckout(sha, targetDir, repoRoot) {
  await ensureDir(path.dirname(targetDir));
  // Use a detached worktree at the specific commit, read-only operations
  await execCmd('git', ['worktree', 'add', '--detach', targetDir, sha], { cwd: repoRoot });
  return targetDir;
}

// Removes a worktree (best-effort; ignores errors).
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
