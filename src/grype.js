/**
 * Run Grype against a CycloneDX SBOM and return parsed JSON findings.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

async function runGrypeOnSbom(sbomPath) {
  // grype sbom:/path/to.json -o json
  const { stdout } = await execFileP("grype", [`sbom:${sbomPath}`, "-o", "json"]);
  return JSON.parse(stdout);
}

module.exports = {
  runGrypeOnSbom,
};
