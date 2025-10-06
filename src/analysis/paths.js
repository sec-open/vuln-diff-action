const path = require('path');

function distRoot() { return path.resolve(process.cwd(), 'dist'); }

function layout() {
  const root = distRoot();
  return {
    root,
    meta: path.join(root, 'meta.json'),
    git: {
      base: path.join(root, 'git', 'base.json'),
      head: path.join(root, 'git', 'head.json'),
    },
    refs: (sha7) => path.join(root, 'refs', sha7),
    sbom: {
      base: path.join(root, 'sbom', 'base.sbom.json'),
      head: path.join(root, 'sbom', 'head.sbom.json'),
    },
    grype: {
      base: path.join(root, 'grype', 'base.grype.json'),
      head: path.join(root, 'grype', 'head.grype.json'),
    },
  };
}

function sanitizeName(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]/g, '_');
}

module.exports = { layout, sanitizeName };
