const fs = require('fs');
const path = require('path');

/**
 * Detect project type based on the presence of common build/manifest files.
 * Returns one of: "javascript", "java", "mixed", "unknown".
 *
 * - javascript: package.json
 * - java:       pom.xml
 * - mixed:      ambos
 */
function detectProjectType(workdir) {
  const hasPackageJson = fs.existsSync(path.join(workdir, 'package.json'));
  const hasPomXml = fs.existsSync(path.join(workdir, 'pom.xml'));

  if (hasPackageJson && hasPomXml) return 'mixed';
  if (hasPackageJson) return 'javascript';
  if (hasPomXml) return 'java';
  return 'unknown';
}

module.exports = { detectProjectType };
