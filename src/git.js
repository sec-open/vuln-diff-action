// path: src/git.js
/**
 * Git helpers: resolve refs to SHAs, get commit metadata, short SHA.
 * More tolerant resolveRef: tries multiple candidate ref spellings.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

async function git(args, opts = {}) {
  const { stdout } = await execFileP("git", args, { ...opts });
  return stdout.trim();
}

async function fetchAll() {
  // Bring all branches and tags from origin
  try {
    await git(["fetch", "--tags", "--force", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
  } catch {
    // Fallback: best-effort
    await git(["fetch", "--all", "--tags", "--prune", "--force"]);
  }
}

/**
 * Try to resolve a ref to a full SHA:
 * - raw ref (as-is)
 * - origin/<ref>
 * - refs/heads/<ref>
 * - refs/tags/<ref>
 * - remotes/origin/<ref>
 */
async function resolveRef(ref) {
  const candidates = dedup([
    ref,
    `origin/${ref}`,
    `refs/heads/${ref}`,
    `refs/tags/${ref}`,
    `remotes/origin/${ref}`,
  ]);

  const errors = [];
  for (const c of candidates) {
    try {
      const sha = await git(["rev-parse", c]);
      if (sha) return sha;
    } catch (e) {
      errors.push(`${c}: ${e?.stderr || e?.message || "unknown error"}`);
    }
  }
  const hint = `Could not resolve ref "${ref}". Make sure checkout uses fetch-depth: 0 or pass a full SHA. Tried: ${candidates.join(", ")}`;
  const err = new Error(hint);
  err.details = errors;
  throw err;
}

function shortSha(sha, len = 7) {
  return String(sha || "").substring(0, len);
}

async function commitInfo(sha) {
  const fmt = "%H%x1f%an%x1f%ae%x1f%ad%x1f%s";
  const out = await git(["show", "-s", `--format=${fmt}`, "--date=iso-strict", sha]);
  const [full, author, email, date, subject] = out.split("\x1f");
  return {
    sha: full,
    sha_short: shortSha(full),
    author,
    author_email: email,
    date,
    subject,
  };
}

function dedup(arr) {
  return [...new Set(arr.filter(Boolean))];
}

module.exports = {
  git,
  fetchAll,
  resolveRef,
  shortSha,
  commitInfo,
};
