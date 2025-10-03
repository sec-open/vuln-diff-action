// path: src/git.js
/**
 * Git helpers (robust ref resolution)
 * - fetchAll(): best-effort general fetch (safe to call)
 * - resolveRef(ref): resolve to full SHA, fetching from origin if missing
 * - commitInfo(sha): basic metadata
 * - prepareCheckout(refOrSha, destDir): isolated tree via worktree or archive
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

function isSha(ref) {
  return /^[0-9a-f]{7,40}$/i.test(String(ref || ""));
}

/** Best-effort full fetch of branches & tags. Safe to ignore failures in shallow clones. */
async function fetchAll() {
  try {
    await sh("git remote -v");
  } catch {
    throw new Error("Not a git repository (cannot run git commands in this working directory).");
  }
  try {
    // Fetch heads & tags; avoid blowing up if repository is already up-to-date
    await sh("git fetch --no-tags --prune origin +refs/heads/*:refs/remotes/origin/*");
    await sh("git fetch --tags --prune origin");
  } catch (e) {
    // Keep going: we’ll do targeted fetches in resolveRef if needed
    console.log("[git] fetchAll warning:", e?.message || e);
  }
}

/** Try rev-parse; if missing, fetch the exact refspec from origin and retry. */
async function resolveRef(ref) {
  if (!ref) throw new Error("resolveRef: empty ref");
  // Direct SHA
  if (isSha(ref)) {
    const { stdout } = await sh(`git rev-parse ${ref}`);
    return stdout.trim();
  }

  // Candidates to try directly
  const candidates = [
    ref,                          // as-is (could be 'develop' or 'refs/heads/develop')
    `origin/${ref}`,              // remote-tracking branch
    ref.startsWith("refs/") ? ref : `refs/heads/${ref}`, // explicit heads
    ref.startsWith("refs/") ? ref : `refs/tags/${ref}`,  // explicit tags
  ];

  for (const c of candidates) {
    try {
      const { stdout } = await sh(`git rev-parse ${c}`);
      const sha = stdout.trim();
      if (sha) return sha;
    } catch {}
  }

  // Targeted fetch attempts (origin only)
  const fetchSpecs = [];
  if (ref.startsWith("refs/")) {
    fetchSpecs.push(`+${ref}:${ref}`);
  } else {
    // try as branch
    fetchSpecs.push(`+refs/heads/${ref}:refs/remotes/origin/${ref}`);
    // try as tag
    fetchSpecs.push(`+refs/tags/${ref}:refs/tags/${ref}`);
  }

  for (const spec of fetchSpecs) {
    try {
      await sh(`git fetch --prune origin '${spec}'`);
      // After fetch, retry usual candidates
      for (const c of candidates) {
        try {
          const { stdout } = await sh(`git rev-parse ${c}`);
          const sha = stdout.trim();
          if (sha) return sha;
        } catch {}
      }
    } catch (e) {
      // continue trying other refspecs
      console.log("[git] targeted fetch failed:", spec, e?.message || e);
    }
  }

  // Last attempt: show-ref search
  try {
    const { stdout } = await sh("git show-ref --heads --tags");
    const line = stdout.split(/\r?\n/).find(l => l.endsWith(` ${ref}`) || l.endsWith(` refs/heads/${ref}`) || l.endsWith(` refs/tags/${ref}`));
    if (line) return line.split(" ")[0];
  } catch {}

  throw new Error(`Unable to resolve ref '${ref}'. Ensure the branch/tag exists in origin and is fetchable.`);
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
    "%ad", // author date (human)
    "%cI", // committer date ISO
  ].join("%x1f");
  const { stdout } = await sh(`git show -s --format='${fmt}' ${sha}`);
  const [full, short, subject, author, date, committerIso] = stdout.trim().split("\x1f");
  return { sha: full, sha_short: short, subject, author, date, committer_iso: committerIso };
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
    // Fallback: archive snapshot
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
