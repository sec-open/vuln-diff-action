// Defines dist folder layout and sanitization utility.
const path = require('path');

// Resolves canonical dist root (under current working directory).
function distRoot() { return path.resolve(process.cwd(), 'dist'); }

// Returns structured paths for all Phase 1 artifacts.
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

// Sanitizes arbitrary string into filesystem-friendly token.
function sanitizeName(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]/g, '_');
}

module.exports = { layout, sanitizeName };
