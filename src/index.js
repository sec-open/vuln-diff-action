// src/index.js
const core = require('@actions/core');
const fs = require('fs/promises');
const path = require('path');

const { phase1 } = require('./analysis/orchestrator');
const { uploadDistAsSingleArtifact } = require('./utils/artifact');

let phase2;
try {
  ({ phase2 } = require('./normalization/orchestrator')); // phase 2 may not exist in early builds
} catch (e) {
  core.warning(`[vuln-diff] Phase 2 not available in this build: ${e?.message || e}`);
}

let phase3;
try {
  ({ phase3 } = require('./render/orchestrator')); // new: render orchestrator (Phase 3 entrypoint)
} catch (e) {
  core.warning(`[vuln-diff] Phase 3 not available in this build: ${e?.message || e}`);
}

module.exports = {
  phase1,
  ...(phase2 ? { phase2 } : {}),
  ...(phase3 ? { phase3 } : {}),
};

async function runMain() {
  const distDir = './dist';
  const absDist = path.resolve(distDir);

  // Phase 1
  try {
    core.info('[vuln-diff] Phase 1: start');
    await phase1();
    core.info('[vuln-diff] Phase 1: done');
  } catch (e) {
    core.setFailed(`[vuln-diff] Phase 1 failed: ${e?.message || e}`);
    return;
  }

  // Phase 2
  if (!phase2) {
    core.info('[vuln-diff] Phase 2: skipped (not available in this build)');
  } else {
    try {
      core.info('[vuln-diff] Phase 2: start');
      await phase2();
      core.info('[vuln-diff] Phase 2: done');
    } catch (e) {
      core.setFailed(`[vuln-diff] Phase 2 failed: ${e?.message || e}`);
      return;
    }
  }

  // Phase 3 (Render) — always attempt if available
  if (!phase3) {
    core.info('[vuln-diff] Phase 3: skipped (not available in this build)');
  } else {
    try {
      core.info('[vuln-diff] Phase 3: start');
      await phase3({ distDir });
      core.info('[vuln-diff] Phase 3: done');
    } catch (e) {
      core.setFailed(`[vuln-diff] Phase 3 failed: ${e?.message || e}`);
      return;
    }
  }

  // Count files before upload (diagnostics)
  let fileCount = 0;
  async function countFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) fileCount += await countFiles(p);
      else fileCount++;
    }
    return fileCount;
  }
  await countFiles(absDist);
  core.info(`[vuln-diff][upload] files to upload in artifact: ${fileCount}`);

  // Upload single artifact with the entire ./dist (includes Phase 1 + 2 + 3 outputs)
  try {
    core.info('[vuln-diff][upload] uploading single artifact…');
    const response = await uploadDistAsSingleArtifact({
      distDir,
      nameOverride: 'report-files', // ensure fixed artifact name
    });
    core.info(`[vuln-diff][upload] artifact upload OK: ${JSON.stringify(response)}`);
  } catch (e) {
    core.warning(`[vuln-diff][upload] artifact upload FAILED: ${e?.message || e}`);
    throw e;
  }
}

// Executed directly by Node in GitHub Actions
if (require.main === module) {
  runMain().catch((err) => core.setFailed(err?.message || String(err)));
}
