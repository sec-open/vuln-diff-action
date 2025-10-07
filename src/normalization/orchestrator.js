// src/normalization/orchestrator.js
const core = require('@actions/core');
const fs = require('fs/promises');
const path = require('path');
const { readPhase1Dist } = require('./readers');
const { buildSbomIndex } = require('./sbom');
const { normalizeOneSide } = require('./normalize');
const { buildDiff } = require('./diff');
const { writeJSON } = require('./utils');

/**
 * Phase 2 entrypoint.
 * - Reads ONLY ./dist/ outputs from Phase 1 (meta.json, sbom/*.json, grype/*.json, git/*.json)
 * - Writes base.json, head.json, diff.json into ./dist/
 * - Uploads a SINGLE artifact containing the entire ./dist directory (Phase 1 + Phase 2)
 */
async function phase2(options = {}) {
  const distDir = options.distDir || '../dist';
  const absDist = path.resolve(distDir);

  core.info(`[vuln-diff][phase2] dist directory: ${absDist}`);

  // Sanity check: Phase 1 must have produced meta.json
  try {
    await fs.access(path.join(absDist, 'meta.json'));
  } catch {
    throw new Error(`[phase2] dist not ready: missing ${path.join(absDist, 'meta.json')}. Was Phase 1 executed?`);
  }

  // Read Phase 1 outputs
  core.info('[vuln-diff][phase2] reading Phase 1 outputs…');
  const ctx = await readPhase1Dist(distDir);
  const { meta, git, sbom, grype } = ctx;

  // Index SBOM for each side
  core.info('[vuln-diff][phase2] indexing SBOM (base)…');
  const sbomBaseIdx = buildSbomIndex(sbom.base);
  core.info('[vuln-diff][phase2] indexing SBOM (head)…');
  const sbomHeadIdx = buildSbomIndex(sbom.head);

  // Phase 2.1 — Normalize per side (per-occurrence model)
  core.info('[vuln-diff][phase2] normalizing BASE…');
  const baseDoc = normalizeOneSide(grype.base, sbomBaseIdx, meta, git.base, { limitPaths: 5 });
  core.info(`[vuln-diff][phase2] BASE occurrences: ${baseDoc.summary.total}`);

  core.info('[vuln-diff][phase2] normalizing HEAD…');
  const headDoc = normalizeOneSide(grype.head, sbomHeadIdx, meta, git.head, { limitPaths: 5 });
  core.info(`[vuln-diff][phase2] HEAD occurrences: ${headDoc.summary.total}`);

  // Persist normalized outputs
  const baseOut = path.join(distDir, 'base.json');
  const headOut = path.join(distDir, 'head.json');
  await writeJSON(baseOut, baseDoc);
  await writeJSON(headOut, headDoc);
  core.info('[vuln-diff][phase2] wrote base.json and head.json');

  // Phase 2.2 — Build diff (NEW/REMOVED/UNCHANGED)
  core.info('[vuln-diff][phase2] computing diff…');
  const diffDoc = buildDiff(baseDoc, headDoc, meta);
  const diffOut = path.join(distDir, 'diff.json');
  await writeJSON(diffOut, diffDoc);
  core.info(
    `[vuln-diff][phase2] wrote diff.json — totals: ` +
    `NEW=${diffDoc.summary.totals.NEW}, ` +
    `REMOVED=${diffDoc.summary.totals.REMOVED}, ` +
    `UNCHANGED=${diffDoc.summary.totals.UNCHANGED}`
  );



  return { baseOut, headOut, diffOut };
}

module.exports = { phase2 };
