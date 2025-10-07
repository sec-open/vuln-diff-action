const core = require('@actions/core');
const fs = require('fs/promises');
const path = require('path');
const { analysis } = require('./analysis/analysis');
const { uploadDistAsSingleArtifact } = require('./utils/artifact');

let normalization;
try {
  ({ normalization } = require('./normalization/normalization')); // Normalization may not exist in early builds
} catch (e) {
  core.warning(`[vuln-diff] Normalization not available in this build: ${e?.message || e}`);
}

let render;
try {
  ({ render } = require('./render/render')); // new: render orchestrator (Render entrypoint)
} catch (e) {
  core.warning(`[vuln-diff] Render not available in this build: ${e?.message || e}`);
}

module.exports = {
  analysis,
  ...(normalization ? { normalization } : {}),
  ...(render ? { render } : {}),
};

async function runMain() {
  const distDir = './dist';
  const absDist = path.resolve(distDir);

  // Analysis
  try {
    core.info('[vuln-diff] Analysis: start');
    await analysis();
    core.info('[vuln-diff] Analysis: done');
  } catch (e) {
    core.setFailed(`[vuln-diff] Analysis failed: ${e?.message || e}`);
    return;
  }

  // Normalization
  if (!normalization) {
    core.info('[vuln-diff] Normalization: skipped (not available in this build)');
  } else {
    try {
      core.info('[vuln-diff] Normalization: start');
      await normalization();
      core.info('[vuln-diff] Normalization: done');
    } catch (e) {
      core.setFailed(`[vuln-diff] Normalization failed: ${e?.message || e}`);
      return;
    }
  }

  // Render (Render) — always attempt if available
  if (!render) {
    core.info('[vuln-diff] Render: skipped (not available in this build)');
  } else {
    try {
      core.info('[vuln-diff] Render: start');
      await render({ distDir });
      core.info('[vuln-diff] Render: done');
    } catch (e) {
      core.setFailed(`[vuln-diff] Render failed: ${e?.message || e}`);
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

  // Upload single artifact with the entire ./dist (includes Analysis + 2 + 3 outputs)
  try {
    core.info('[vuln-diff][upload] uploading single artifact…');
    const response = await uploadDistAsSingleArtifact({
      distDir,
      name: 'report-files', // ensure fixed artifact name
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
