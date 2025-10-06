// Upload ONLY Phase-1 outputs — compatible with @actions/artifact v1/v2/v3
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

  // Detect the proper upload function depending on artifact version
  const uploadFn =
    (artifact?.uploadArtifact) ||
    (artifact?.default?.uploadArtifact) ||
    (typeof artifact.create === 'function'
      ? artifact.create().uploadArtifact
      : null);

  if (!uploadFn) {
    throw new Error('Cannot find uploadArtifact() in @actions/artifact API');
  }

  const response = await uploadFn(
    name,
    files,
    root,
    { continueOnError: false }
  );

  return response;
}

module.exports = { uploadPhase1Artifact };
