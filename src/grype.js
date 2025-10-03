/**
 * Run Grype against a CycloneDX SBOM and return parsed JSON findings.
 * Accepts absolute path to the grype binary to avoid PATH issues.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

/**
 * @param {string} grypeBin absolute path to grype
 * @param {string} sbomPath path to SBOM file
 */
async function runGrypeOnSbomWith(grypeBin, sbomPath) {
  const { stdout } = await execFileP(grypeBin, [`sbom:${sbomPath}`, "-o", "json"]);
  return JSON.parse(stdout);
}

module.exports = {
  runGrypeOnSbomWith,
};
