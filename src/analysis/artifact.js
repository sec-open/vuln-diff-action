// Sube un ÚNICO artifact que contiene TODO el contenido de ./dist
// Compatible con @actions/artifact v1/v2/v3

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

function resolveUploadFunction() {
  let artifactLib;
  try {
    artifactLib = require('@actions/artifact');
  } catch {
    return null;
  }
  if (typeof artifactLib?.uploadArtifact === 'function') {
    return artifactLib.uploadArtifact.bind(artifactLib);
  }
  if (typeof artifactLib?.default?.uploadArtifact === 'function') {
    return artifactLib.default.uploadArtifact.bind(artifactLib.default);
  }
  if (typeof artifactLib?.create === 'function') {
    const client = artifactLib.create();
    if (typeof client?.uploadArtifact === 'function') {
      return client.uploadArtifact.bind(client);
    }
  }
  return null;
}

/**
 * Sube un ÚNICO artifact con TODO ./dist
 * Nombre por defecto: vulnerability-diff-<base>-vs-<head>-phase2
 */
async function uploadDistAsSingleArtifact({
  baseRef,
  headRef,
  distDir = './dist',
  nameOverride,               // opcional: fuerza el nombre del artifact
  continueOnError = false,
} = {}) {
  const root = path.resolve(distDir);
  const files = await collectAllFiles(root);
  if (!files.length) {
    throw new Error(`Artifact upload: no files found under ${root}`);
  }

  const name =
    nameOverride ||
    `vulnerability-diff-${sanitizeName(baseRef)}-vs-${sanitizeName(headRef)}-phase2`;

  const uploadFn = resolveUploadFunction();
  if (!uploadFn) {
    throw new Error('Cannot find uploadArtifact() in @actions/artifact API');
  }

  // Sube TODO dist como un ÚNICO artifact
  return await uploadFn(name, files, root, { continueOnError });
}

module.exports = {
  sanitizeName,
  uploadDistAsSingleArtifact,
};
