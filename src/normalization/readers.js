const path = require('path');
const { readJSON } = require('./utils');

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
  };

  const [meta, gitBase, gitHead, sbomBase, sbomHead, grypeBase, grypeHead] = await Promise.all([
    readJSON(files.meta),
    readJSON(files.git.base),
    readJSON(files.git.head),
    readJSON(files.sbom.base),
    readJSON(files.sbom.head),
    readJSON(files.grype.base),
    readJSON(files.grype.head),
  ]);

  return {
    files,
    meta,
    git: { base: gitBase, head: gitHead },
    sbom: { base: sbomBase, head: sbomHead },
    grype: { base: grypeBase, head: grypeHead },
  };
}

module.exports = { readPhase1Dist };
