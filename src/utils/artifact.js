// src/utils/artifact.js
const core = require('@actions/core');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

function sanitizeName(s) {
  return String(s ?? '')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'unknown';
}

async function collectAllFiles(dir) {
  const files = [];
  async function walk(d) {
    const entries = await fsp.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else files.push(p);
    }
  }
  await walk(dir);
  return files;
}

function resolveArtifactClient() {
  let artifactLib;
  try {
    artifactLib = require('@actions/artifact');
  } catch {
    return { client: null, meta: { source: 'require-failed' } };
  }

  // Intenta obtener versión para logging (no es crítico)
  let version = 'unknown';
  try {
    // En algunos runners no existe package.json; lo ignoramos si falla
    version = require('@actions/artifact/package.json')?.version || 'unknown';
  } catch {}

  // Siempre que sea posible, usa el cliente
  if (typeof artifactLib?.create === 'function') {
    const client = artifactLib.create();
    if (client && typeof client.uploadArtifact === 'function') {
      return { client, meta: { source: 'create().uploadArtifact', version } };
    }
  }

  // Fallbacks por si el runner expone directamente la función (poco común)
  if (typeof artifactLib?.uploadArtifact === 'function') {
    return { client: artifactLib, meta: { source: 'uploadArtifact (root export)', version } };
  }
  if (typeof artifactLib?.default?.uploadArtifact === 'function') {
    return { client: artifactLib.default, meta: { source: 'default.uploadArtifact', version } };
  }

  return { client: null, meta: { source: 'no-upload-fn', version } };
}

/**
 * Sube un ÚNICO artifact con TODO ./dist
 */
async function uploadDistAsSingleArtifact({
  baseRef,
  headRef,
  distDir = './dist',
  nameOverride,
  continueOnError = false,
} = {}) {
  const root = path.resolve(distDir);
  const { client, meta } = resolveArtifactClient();

  core.info(`[artifact] @actions/artifact: source=${meta.source}, version=${meta.version}`);
  core.info(`[artifact] rootDirectory=${root}`);

  if (!client) {
    throw new Error('Artifact client not available: cannot find uploadArtifact() in @actions/artifact');
  }

  const files = await collectAllFiles(root);
  core.info(`[artifact] files found: ${files.length}`);
  if (!files.length) {
    throw new Error(`Artifact upload: no files found under ${root}`);
  }

  // Validación básica: que cada file esté bajo root
  const invalid = files.filter(f => !path.resolve(f).startsWith(root + path.sep));
  if (invalid.length) {
    core.warning(`[artifact] some files are outside of root and will break upload:\n- ${invalid.join('\n- ')}`);
    throw new Error('Artifact upload aborted: files outside rootDirectory');
  }

  const name =
    nameOverride ||
    `vulnerability-diff-${sanitizeName(baseRef)}-vs-${sanitizeName(headRef)}-phase2`;

  core.info(`[artifact] uploading: name="${name}" (continueOnError=${continueOnError})`);

  // Siempre invocamos sobre el cliente (create().uploadArtifact), compatible v1/v2/v3
  const response = await client.uploadArtifact(
    name,
    files,
    root,
    { continueOnError }
  );

  core.info(`[artifact] upload result: ${JSON.stringify(response)}`);
  return response;
}

module.exports = {
  sanitizeName,
  uploadDistAsSingleArtifact,
};
