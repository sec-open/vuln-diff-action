const path = require('path');
const { readPhase1Dist } = require('./readers');
const { buildSbomIndex } = require('./sbom');
const { normalizeOneSide } = require('./normalize');
const { buildDiff } = require('./diff');
const { writeJSON } = require('./utils');
const { uploadDistAsSingleArtifact } = require('../utils/artifact');

/**
 * Phase 2 entrypoint.
 * - Lee únicamente ./dist/ (meta.json, sbom/*.json, grype/*.json, git/*.json)
 * - Escribe base.json, head.json, diff.json en ./dist/
 * - Sube/actualiza el artifact incluyendo también los ficheros de Fase 1
 */
async function phase2(options = {}) {
  const distDir = options.distDir || './dist';

  // Cargar salidas de Fase 1
  const ctx = await readPhase1Dist(distDir);
  const { meta, git, sbom, grype } = ctx;

  // Indexar SBOM por rama
  const sbomBaseIdx = buildSbomIndex(sbom.base);
  const sbomHeadIdx = buildSbomIndex(sbom.head);

  // 2.1: Normalización por rama (per-occurrence model)
  const baseDoc = normalizeOneSide(grype.base, sbomBaseIdx, meta, git.base, { limitPaths: 5 });
  const headDoc = normalizeOneSide(grype.head, sbomHeadIdx, meta, git.head, { limitPaths: 5 });

  // Guardar
  const baseOut = path.join(distDir, 'base.json');
  const headOut = path.join(distDir, 'head.json');
  await writeJSON(baseOut, baseDoc);
  await writeJSON(headOut, headDoc);

  // 2.2: Diff NEW/REMOVED/UNCHANGED
  const diffDoc = buildDiff(baseDoc, headDoc, meta);
  const diffOut = path.join(distDir, 'diff.json');
  await writeJSON(diffOut, diffDoc);

  // Upload results as artifact
  const baseRef = meta?.inputs?.base_ref || git?.base?.ref || 'base';
  const headRef = meta?.inputs?.head_ref || git?.head?.ref || 'head';


  await uploadDistAsSingleArtifact({
    baseRef,
    headRef,
    distDir: './dist',
    nameOverride: 'report-files',
  });

  return { baseOut, headOut, diffOut, artifactName };
}

module.exports = { phase2 };
