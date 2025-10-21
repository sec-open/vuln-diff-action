// Executes Grype against a CycloneDX SBOM file and returns raw JSON output.
const { execCmd } = require('./exec');

// Runs Grype with sbom:<path> format; throws if binary path missing.
async function scanSbomWithGrype(grypePath, sbomPath, cwd) {
  if (!grypePath) throw new Error('Grype not available.');
  const { stdout } = await execCmd(grypePath, [`sbom:${sbomPath}`, '-o', 'json'], { cwd });
  return stdout;
}

module.exports = { scanSbomWithGrype };
