// src/index.js
const core = require('@actions/core');
const { phase1 } = require('./analysis/orchestrator');
const { uploadDistAsSingleArtifact } = require('./utils/artifact');

let phase2;
try {
  ({ phase2 } = require('./normalization/orchestrator')); // ruta correcta (index.js está en src/)
} catch (e) {
  // Si construyes una release sólo con fase 1, no queremos romper la ejecución.
  core.warning(`[vuln-diff] Phase 2 no disponible en esta versión: ${e?.message || e}`);
}

module.exports = { phase1, ...(phase2 ? { phase2 } : {}) };

async function runMain() {
    const distDir = './dist';
    const absDist = path.resolve(distDir);

  try {
    core.info('[vuln-diff] Phase 1: start');
    await phase1();
    core.info('[vuln-diff] Phase 1: done');
  } catch (e) {
    core.setFailed(`[vuln-diff] Phase 1 failed: ${e?.message || e}`);
    return;
  }

  if (!phase2) {
    core.info('[vuln-diff] Phase 2: skipped (no disponible en esta build)');
    return;
  }

  try {
    core.info('[vuln-diff] Phase 2: start');
    await phase2();
    core.info('[vuln-diff] Phase 2: done');
  } catch (e) {
    core.setFailed(`[vuln-diff] Phase 2 failed: ${e?.message || e}`);
  }

    // Count files under dist (useful when diagnosing artifact uploads)
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

    // Upload results as a single artifact
    const baseRef = meta?.inputs?.base_ref || git?.base?.ref || 'base';
    const headRef = meta?.inputs?.head_ref || git?.head?.ref || 'head';

    try {
      core.info(`[vuln-diff][upload] uploading single artifact (base=${baseRef}, head=${headRef})…`);
      const response = await uploadDistAsSingleArtifact({
        baseRef,
        headRef,
        distDir, // use the provided distDir
        // If you want reference-based artifact names, remove nameOverride and let the uploader compute it:
        // nameOverride: `vulnerability-diff-${baseRef}-vs-${headRef}-phase2`,
        nameOverride: 'report-files', // keep current fixed name if preferred
      });
      core.info(`[vuln-diff][upload] artifact upload OK: ${JSON.stringify(response)}`);
    } catch (e) {
      core.warning(`[vuln-diff][upload] artifact upload FAILED: ${e?.message || e}`);
      throw e;
    }

}

// Ejecutado directamente por Node en GitHub Actions
if (require.main === module) {
  runMain().catch((err) => core.setFailed(err?.message || String(err)));
}
