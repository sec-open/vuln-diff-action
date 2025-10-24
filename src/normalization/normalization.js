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
// 1. Validates Phase 1 output presence.
// 2. Reads meta, git, sbom, and grype data for base/head.
// 3. Indexes SBOM components for each side.
// 4. Normalizes vulnerabilities per side into occurrence documents.
// 5. Writes base.json and head.json.
// 6. Builds diff.json comparing both sides.
// 7. Returns paths to written artifacts.
async function normalization(options = {}) {
  const distDir = options.distDir || './dist';
  const absDist = path.resolve(distDir);

  core.info(`[vuln-diff][normalization] dist directory: ${absDist}`);

  // Ensure meta.json exists (Phase 1 completion check).
  try {
    await fs.access(path.join(absDist, 'meta.json'));
  } catch {
    throw new Error(`[normalization] dist not ready: missing ${path.join(absDist, 'meta.json')}. Was Phase 1 executed?`);
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
  const diffDoc = buildDiff(baseDoc, headDoc, meta, { pomBaseDeps: basePomDeps, pomHeadDeps: headPomDeps });
  const diffOut = path.join(distDir, 'diff.json');
  await writeJSON(diffOut, diffDoc);
  core.info(
    `[vuln-diff][normalization] wrote diff.json — totals: ` +
    `NEW=${diffDoc.summary.totals.NEW}, ` +
    `REMOVED=${diffDoc.summary.totals.REMOVED}, ` +
    `UNCHANGED=${diffDoc.summary.totals.UNCHANGED}`
  );

  return { baseOut, headOut, diffOut };
}

module.exports = { normalization };
