// src/git.js
// Git helpers isolated from index.js to keep orchestration clean.

const exec = require("@actions/exec");

// ---- tiny shell helper ----
async function sh(cmd, opts = {}) {
  return exec.exec("bash", ["-lc", cmd], opts);
}

// ---- low-level helpers ----
async function tryRevParse(ref) {
  let out = "";
  try {
    await exec.exec("bash", ["-lc", `git rev-parse ${ref}`], {
      listeners: { stdout: (d) => (out += d.toString()) },
    });
    return out.trim();
  } catch {
    return null;
  }
}

function isSha(ref) {
  return /^[0-9a-f]{7,40}$/i.test(ref || "");
}

// Ensure a branch/tag/sha exists locally (idempotent if it already exists).
// This avoids "unknown revision" or "invalid reference" when worktrees are created.
async function ensureRefLocal(ref) {
  // already a local ref? ok
  if (await tryRevParse(ref)) return;

  // try remote-tracking names
  if (await tryRevParse(`refs/remotes/origin/${ref}`)) return;
  let remotes = "";
  await exec.exec("bash", ["-lc", "git remote"], {
    listeners: { stdout: (d) => (remotes += d.toString()) },
  });
  if (remotes.split(/\s+/).includes("upstream")) {
    if (await tryRevParse(`refs/remotes/upstream/${ref}`)) return;
  }

  // last resort: fetch it explicitly from origin into a local ref of the same name
  try {
    await sh(`git fetch origin ${ref}:${ref} --tags --prune`);
  } catch {
    // swallow; caller will fail on resolveRefToSha if still missing
  }
}

// Resolve branch/tag/sha to a commit SHA, after trying to ensure it locally.
async function resolveRefToSha(ref) {
  // First, try to ensure we have it locally
  await ensureRefLocal(ref);

  if (isSha(ref)) {
    const sha = await tryRevParse(ref);
    if (sha) return sha;
    throw new Error(`Input '${ref}' looks like a SHA but does not exist locally.`);
  }

  // 1) as-is
  let sha = await tryRevParse(ref);
  if (sha) return sha;

  // 2) origin/<ref>
  sha = await tryRevParse(`refs/remotes/origin/${ref}`);
  if (sha) return sha;

  // 3) upstream/<ref>
  let remotes = "";
  await exec.exec("bash", ["-lc", "git remote"], {
    listeners: { stdout: (d) => (remotes += d.toString()) },
  });
  if (remotes.split(/\s+/).includes("upstream")) {
    sha = await tryRevParse(`refs/remotes/upstream/${ref}`);
    if (sha) return sha;
  }

  // 4) try one more fetch (handles refs like 'main' on shallow clones)
  try {
    await sh(`git fetch origin ${ref}:${ref} --tags --prune`);
    sha = await tryRevParse(ref);
    if (sha) return sha;
  } catch {
    // ignore
  }

  throw new Error(`Cannot resolve ref '${ref}' to a commit SHA in this runner.`);
}

// Short commit
function shortSha(sha) {
  return (sha || "").slice(0, 12);
}

// Pretty label from ref
function guessLabel(ref) {
  const m = (ref || "").match(/^(?:refs\/remotes\/\w+\/|origin\/)?(.+)$/);
  return m ? m[1] : ref || "";
}

// One-line commit info: "<sha> <subject>"
async function commitLine(sha) {
  let out = "";
  await exec.exec("bash", ["-lc", `git --no-pager log -1 --format="%H %s" ${sha}`], {
    listeners: { stdout: (d) => (out += d.toString()) },
  });
  return out.trim();
}

// Worktree helpers
async function addWorktree(dir, refOrSha) {
  await sh(`git worktree add --detach ${dir} ${refOrSha}`);
}
async function removeWorktree(dir) {
  await sh(`git worktree remove ${dir} --force || true`);
}

module.exports = {
  sh,
  tryRevParse,
  isSha,
  ensureRefLocal,
  resolveRefToSha,
  shortSha,
  guessLabel,
  commitLine,
  addWorktree,
  removeWorktree,
};
