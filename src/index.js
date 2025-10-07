// src/index.js
const core = require('@actions/core');
const { phase1 } = require('./analysis/orchestrator');

let phase2;
try {
  ({ phase2 } = require('./normalization/orchestrator')); // ruta correcta (index.js está en src/)
} catch (e) {
  // Si construyes una release sólo con fase 1, no queremos romper la ejecución.
  core.warning(`[vuln-diff] Phase 2 no disponible en esta versión: ${e?.message || e}`);
}

module.exports = { phase1, ...(phase2 ? { phase2 } : {}) };

async function runMain() {
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
    await phase2(); // lee ./dist, genera base.json/head.json/diff.json y sube TODO ./dist
    core.info('[vuln-diff] Phase 2: done');
  } catch (e) {
    core.setFailed(`[vuln-diff] Phase 2 failed: ${e?.message || e}`);
  }
}

// Ejecutado directamente por Node en GitHub Actions
if (require.main === module) {
  runMain().catch((err) => core.setFailed(err?.message || String(err)));
}
