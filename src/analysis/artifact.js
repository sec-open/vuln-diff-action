// Upload ONLY Phase-1 outputs
const artifact = require('@actions/artifact');
const path = require('path');
const { layout, sanitizeName } = require('./paths');

async function uploadPhase1Artifact({ baseRef, headRef }) {
  const client = artifact.create();
  const l = layout();
  const name = `vulnerability-diff-${sanitizeName(baseRef)}-vs-${sanitizeName(headRef)}-phase1`;

  const files = [
    l.meta,
    l.git.base,
    l.git.head,
    l.sbom.base,
    l.sbom.head,
    l.grype.base,
    l.grype.head,
    // NOTE: dist/refs/* are checkouts, not uploaded (per spec). Only Phase-1 files.
  ];

  const root = l.root;
  const uploadResponse = await client.uploadArtifact(name, files, root, {
    continueOnError: false,
    retentionDays: undefined,
  });
  return uploadResponse;
}

module.exports = { uploadPhase1Artifact };
