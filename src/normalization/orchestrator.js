const core = require('@actions/core');
const fs = require('fs/promises');
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
 * - Sube un ÚNICO artifact con TODO el directorio ./dist
 */
async function phase2(options = {}) {
  const distDir = options.distDir || './dist';
  const absDist = path.resolve(distDir);

  core.info(`[vuln-diff][phase2] dist dir: ${absDist}`);

  // Sanity check: dist existe y tiene meta.json
  try {
    await fs.access(path.join(absDist, 'meta.json'));
  } catch {
    throw new Error(`[phase2] dist no preparado: falta ${path.join(absDist, 'meta.json')}. ¿Se ejecutó Phase 1?`);
  }

  // Cargar salidas de Fase 1
  core.info('[vuln-diff][phase2] leyendo salidas de Phase 1…');
  const ctx = await readPhase1Dist(distDir);
  const { meta, git, sbom, grype } = ctx;

  // Indexar SBOM por rama
  core.info('[vuln-diff][phase2] indexando SBOM (base)…');
  const sbomBaseIdx = buildSbomIndex(sbom.base);
  core.info('[vuln-diff][phase2] indexando SBOM (head)…');
  const sbomHeadIdx = buildSbomIndex(sbom.head);

  // 2.1: Normalización por rama (per-occurrence model)
  core.info('[vuln-diff][phase2] normalizando BASE…');
  const baseDoc = normalizeOneSide(grype.base, sbomBaseIdx, meta, git.base, { limitPaths: 5 });
  core.info(`[vuln-diff][phase2] BASE: ${baseDoc.summary.total} ocurrencias`);

  core.info('[vuln-diff][phase2] normalizando HEAD…');
  const headDoc = normalizeOneSide(grype.head, sbomHeadIdx, meta, git.head, { limitPaths: 5 });
  core.info(`[vuln-diff][phase2] HEAD: ${headDoc.summary.total} ocurrencias`);

  // Guardar
  const baseOut = path.join(distDir, 'base.json');
  const headOut = path.join(distDir, 'head.json');
  await writeJSON(baseOut, baseDoc);
  await writeJSON(headOut, headDoc);
  core.info('[vuln-diff][phase2] escritos base.json y head.json');

  // 2.2: Diff NEW/REMOVED/UNCHANGED
  core.info('[vuln-diff][phase2] calculando diff…');
  const diffDoc = buildDiff(baseDoc, headDoc, meta);
  const diffOut = path.join(distDir, 'diff.json');
  await writeJSON(diffOut, diffDoc);
  core.info(`[vuln-diff][phase2] escrito diff.json — totales: NEW=${diffDoc.summary.totals.NEW}, REMOVED=${diffDoc.summary.totals.REMOVED}, UNCHANGED=${diffDoc.summary.totals.UNCHANGED}`);

  // Conteo de ficheros en dist (útil para diagnosticar por qué no sube)
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
  core.info(`[vuln-diff][phase2] ficheros a subir en artifact: ${fileCount}`);

  // Upload results as single artifact (TODO: si quieres nombre único por refs, quita nameOverride)
  const baseRef = meta?.inputs?.base_ref || git?.base?.ref || 'base';
  const headRef = meta?.inputs?.head_ref || git?.head?.ref || 'head';

  try {
    core.info(`[vuln-diff][phase2] subiendo artifact único (base=${baseRef}, head=${headRef})…`);
    const response = await uploadDistAsSingleArtifact({
      baseRef,
      headRef,
      distDir: './dist',
      // nameOverride: `vulnerability-diff-${baseRef}-vs-${headRef}-phase2`, // si prefieres el nombre “oficial”
      nameOverride: 'report-files', // como tienes ahora
    });
    core.info(`[vuln-diff][phase2] artifact subido OK: ${JSON.stringify(response)}`);
  } catch (e) {
    // Esto ayuda si el problema está en @actions/artifact (v1/v2/v3) o si hay ficheros ausentes.
    core.warning(`[vuln-diff][phase2] artifact upload FAILED: ${e?.message || e}`);
    throw e;
  }

  return { baseOut, headOut, diffOut };
}

module.exports = { phase2 };
