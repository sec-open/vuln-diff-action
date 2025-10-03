/**
 * Git helpers: resolve refs to SHAs, get commit metadata, short SHA.
 * Uses `git` CLI available in Actions runners.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

async function git(args, opts = {}) {
  const { stdout } = await execFileP("git", args, { ...opts });
  return stdout.trim();
}

async function resolveRef(ref) {
  // Returns full SHA or throws.
  const sha = await git(["rev-parse", ref]);
  return sha;
}

function shortSha(sha, len = 7) {
  return String(sha || "").substring(0, len);
}

async function commitInfo(sha) {
  // Subject and ISO date
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

async function fetchAll() {
  await git(["fetch", "--all", "--tags", "--prune", "--force"]);
}

module.exports = {
  git,
  resolveRef,
  shortSha,
  commitInfo,
  fetchAll,
};
