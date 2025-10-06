// Run grype against a CycloneDX SBOM; emit raw JSON
const { execCmd } = require('./exec');

async function scanSbomWithGrype(grypePath, sbomPath, cwd) {
  if (!grypePath) throw new Error('Grype not available.');
  const { stdout } = await execCmd(grypePath, [`sbom:${sbomPath}`, '-o', 'json'], { cwd });
  return stdout;
}

module.exports = { scanSbomWithGrype };
