// Upload ONLY Phase-1 outputs (modern @actions/artifact API)
const artifact = require('@actions/artifact');
const path = require('path');
const { layout, sanitizeName } = require('./paths');

async function uploadPhase1Artifact({ baseRef, headRef }) {
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
  ];

  const root = l.root;
  const uploadResponse = await artifact.uploadArtifact(
    name,        // artifact name
    files,       // files array
    root,        // root directory
    { continueOnError: false }
  );

  return uploadResponse;
}

module.exports = { uploadPhase1Artifact };
