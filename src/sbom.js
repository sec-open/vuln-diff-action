const core = require("@actions/core");
const exec = require("@actions/exec");

async function ensureSyft() {
  await exec.exec("bash", ["-lc", "command -v syft >/dev/null 2>&1 || curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin"]);
}

async function generateSbom(sourceDir, outFile) {
  await ensureSyft();
  await exec.exec("bash", ["-lc", `syft packages dir:${sourceDir} -o cyclonedx-json > ${outFile}`], { cwd: sourceDir });
  core.info(`SBOM written: ${outFile}`);
}

module.exports = { generateSbom };
