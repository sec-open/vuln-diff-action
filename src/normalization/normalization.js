// src/normalization/orchestrator.js
const core = require('@actions/core');
const fs = require('fs/promises');
const path = require('path');
const { readPhase1Dist } = require('./readers');
const { buildSbomIndex, extractComponentInventory } = require('./sbom');
const { normalizeOneSide } = require('./normalize');
const { buildDiff } = require('./diff');
const { writeJSON } = require('./utils');

// Phase 2 orchestrator:
// 1. Validates Phase 1 output presence (meta.json). Falls back to Phase 1 if missing.
// 2. Reads meta, git, sbom, and grype data for base/head.
// 3. Indexes SBOM components for each side.
// 4. Normalizes vulnerabilities per side into occurrence documents.
// 5. Writes base.json and head.json.
// 6. Builds diff.json comparing both sides.
// 7. Returns paths to written artifacts.
async function normalization(options = {}) {
  const distDir = options.distDir || './dist';
  const absDist = path.resolve(distDir);
  const skipPhase1Fallback = options.skipPhase1Fallback === true; // allow explicit disable

  core.info(`[vuln-diff][normalization] dist directory: ${absDist}`);

  const metaPath = path.join(absDist, 'meta.json');
  let metaExists = false;
  try {
    await fs.access(metaPath);
    metaExists = true;
  } catch {
    metaExists = false;
  }

  if (!metaExists) {
    if (skipPhase1Fallback) {
      throw new Error(`[normalization] dist not ready: missing ${metaPath}. Was Phase 1 executed?`);
    }
    core.warning(`[vuln-diff][normalization] meta.json missing. Attempting Phase 1 analysis fallback…`);
    try {
      const { analysis } = require('../analysis/analysis');
      if (typeof analysis === 'function') {
        await analysis();
        // re-check
        try {
          await fs.access(metaPath);
          metaExists = true;
          core.info('[vuln-diff][normalization] Phase 1 fallback succeeded; meta.json present now.');
        } catch {
          throw new Error(`[normalization] dist not ready after fallback: missing ${metaPath}.`);
        }
      } else {
        throw new Error('[normalization] analysis() not available for fallback.');
      }
    } catch (e) {
      throw new Error(`[normalization] dist not ready: missing ${metaPath}. Phase 1 fallback failed: ${e?.message || e}`);
    }
  }

  // Read Phase 1 outputs.
  core.info('[vuln-diff][normalization] reading Phase 1 outputs…');
  const ctx = await readPhase1Dist(distDir);
  const { meta, git, sbom, grype } = ctx;

  // Build SBOM indices for dependency resolution and path computation.
  core.info('[vuln-diff][normalization] indexing SBOM (base)…');
  const sbomBaseIdx = buildSbomIndex(sbom.base);
  core.info('[vuln-diff][normalization] indexing SBOM (head)…');
  const sbomHeadIdx = buildSbomIndex(sbom.head);

  // Normalize base side vulnerabilities into occurrence model.
  core.info('[vuln-diff][normalization] normalizing BASE…');
  const baseDoc = normalizeOneSide(grype.base, sbomBaseIdx, meta, git.base, { limitPaths: 5 });
  core.info(`[vuln-diff][normalization] BASE occurrences: ${baseDoc.summary.total}`);

  // Normalize head side vulnerabilities into occurrence model.
  core.info('[vuln-diff][normalization] normalizing HEAD…');
  const headDoc = normalizeOneSide(grype.head, sbomHeadIdx, meta, git.head, { limitPaths: 5 });
  core.info(`[vuln-diff][normalization] HEAD occurrences: ${headDoc.summary.total}`);

  // Persist normalized side outputs.
  const baseOut = path.join(distDir, 'base.json');
  const headOut = path.join(distDir, 'head.json');
  await writeJSON(baseOut, baseDoc);
  await writeJSON(headOut, headDoc);
  core.info('[vuln-diff][normalization] wrote base.json and head.json');

  // Compute diff states and persist diff.json.
  core.info('[vuln-diff][normalization] computing diff…');
  const baseComponents = extractComponentInventory(sbom.base);
  const headComponents = extractComponentInventory(sbom.head);
  const basePomDeps = ctx.pom?.base?.dependencies || [];
  const headPomDeps = ctx.pom?.head?.dependencies || [];

  core.info(`[vuln-diff][normalization] BASE pom deps: ${basePomDeps.length} items`);
  if (basePomDeps.length > 0) {
    basePomDeps.slice(0, 3).forEach(d => {
      core.info(`  - ${d.groupId}:${d.artifactId}:${d.version}`);
    });
  } else {
    core.warning(`[vuln-diff][normalization] WARNING: No BASE dependencies in context`);
  }

  core.info(`[vuln-diff][normalization] HEAD pom deps: ${headPomDeps.length} items`);
  if (headPomDeps.length > 0) {
    headPomDeps.slice(0, 3).forEach(d => {
      core.info(`  - ${d.groupId}:${d.artifactId}:${d.version}`);
    });
  } else {
    core.warning(`[vuln-diff][normalization] WARNING: No HEAD dependencies in context`);
  }

  const diffDoc = buildDiff(baseDoc, headDoc, meta, { pomBaseDeps: basePomDeps, pomHeadDeps: headPomDeps });
  const diffOut = path.join(distDir, 'diff.json');
  await writeJSON(diffOut, diffDoc);

  core.info(`[vuln-diff][normalization] dependency diff totals: NEW=${diffDoc.dependency_pom_diff.totals.NEW}, UPDATED=${diffDoc.dependency_pom_diff.totals.UPDATED}, REMOVED=${diffDoc.dependency_pom_diff.totals.REMOVED}, UNCHANGED=${diffDoc.dependency_pom_diff.totals.UNCHANGED}`);

  core.info(
    `[vuln-diff][normalization] wrote diff.json — totals: ` +
    `NEW=${diffDoc.summary.totals.NEW}, ` +
    `REMOVED=${diffDoc.summary.totals.REMOVED}, ` +
    `UNCHANGED=${diffDoc.summary.totals.UNCHANGED}`
  );

  return { baseOut, headOut, diffOut };
}

module.exports = { normalization };
