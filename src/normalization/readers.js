const path = require('path');
const { readJSON } = require('./utils');

// Reads Phase 1 output files (meta, git, sbom, grype) and returns structured context.
// Paths are resolved relative to provided dist directory.
async function readPhase1Dist(distDir = './dist') {
  const files = {
    meta: path.join(distDir, 'meta.json'),
    git: {
      base: path.join(distDir, 'git', 'base.json'),
      head: path.join(distDir, 'git', 'head.json'),
    },
    sbom: {
      base: path.join(distDir, 'sbom', 'base.sbom.json'),
      head: path.join(distDir, 'sbom', 'head.sbom.json'),
    },
    grype: {
      base: path.join(distDir, 'grype', 'base.grype.json'),
      head: path.join(distDir, 'grype', 'head.grype.json'),
    },
    pom: {
      base: path.join(distDir, 'pom', 'base-deps.json'),
      head: path.join(distDir, 'pom', 'head-deps.json'),
    },
    js: { // JS SUPPORT START
      base: path.join(distDir, 'js', 'base-deps.json'),
      head: path.join(distDir, 'js', 'head-deps.json'),
    }, // JS SUPPORT END
  };

  const [meta, gitBase, gitHead, sbomBase, sbomHead, grypeBase, grypeHead, pomBase, pomHead, jsBase, jsHead] = await Promise.all([
    readJSON(files.meta),
    readJSON(files.git.base),
    readJSON(files.git.head),
    readJSON(files.sbom.base),
    readJSON(files.sbom.head),
    readJSON(files.grype.base),
    readJSON(files.grype.head),
    readJSON(files.pom.base).catch(() => ({ dependencies: [] })),
    readJSON(files.pom.head).catch(() => ({ dependencies: [] })),
    readJSON(files.js.base).catch(() => ({ dependencies: [] })), // JS SUPPORT
    readJSON(files.js.head).catch(() => ({ dependencies: [] })), // JS SUPPORT
  ]);

  return {
    files,
    meta,
    git: { base: gitBase, head: gitHead },
    sbom: { base: sbomBase, head: sbomHead },
    grype: { base: grypeBase, head: grypeHead },
    pom: { base: pomBase, head: pomHead },
    js: { base: jsBase, head: jsHead }, // JS SUPPORT
  };
}

module.exports = { readPhase1Dist };
