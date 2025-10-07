// Append Phase-2 outputs to artifact, keeping Phase-1 files. :contentReference[oaicite:10]{index=10}
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

async function collectAllFiles(dir) {
  const out = [];
  async function walk(d) {
    const entries = await fsp.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(p);
    }
  }
  await walk(dir);
  return out;
}

async function uploadArtifactAll(distDir, artifactName) {
  // If running inside GitHub Actions, use @actions/artifact; otherwise no-op.
  try {
    const artifact = require('@actions/artifact');
    const client = artifact.create();
    const files = await collectAllFiles(distDir);
    const root = path.resolve(distDir);
    await client.uploadArtifact(artifactName, files, root, {
      continueOnError: true,
      retentionDays: 7,
    });
  } catch (e) {
    // Local run or artifact lib not available – just log.
    console.warn(`[phase2] artifact upload skipped (${e.message || e})`);
  }
}

module.exports = { uploadArtifactAll };
