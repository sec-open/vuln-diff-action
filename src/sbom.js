const core = require("@actions/core");
const exec = require("@actions/exec");
const fs = require("fs");
const path = require("path");

async function ensureSyft() {
  await exec.exec("bash", ["-lc", "command -v syft >/dev/null 2>&1 || curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin"]);
}

// Pure Syft directory scan (fallback)
async function generateSbomSyftDir(sourceDir, outFile) {
  await ensureSyft();
  await exec.exec("bash", ["-lc", `syft packages dir:${sourceDir} -o cyclonedx-json > ${outFile}`], { cwd: sourceDir });
  core.info(`SBOM (Syft dir) written: ${outFile}`);
}

// Try Maven CycloneDX plugin for accurate dependency SBOM
async function generateSbomMaven(rootDir, outFile) {
  // Use a pinned plugin version for reproducibility
  const cmd = [
    "mvn",
    "-q",
    "-DskipTests",
    "-Dcyclonedx.skipAttach=true",
    "org.cyclonedx:cyclonedx-maven-plugin:2.7.10:makeAggregateBom",
    "-DoutputFormat=json",
    "-DoutputName=sbom"
  ].join(" ");

  await exec.exec("bash", ["-lc", cmd], { cwd: rootDir });

  // Look for the resulting SBOM (target/sbom.json preferred; fallback to any target/{sbom,bom}.json)
  const candidateA = path.join(rootDir, "target", "sbom.json");
  if (fs.existsSync(candidateA)) {
    await exec.exec("bash", ["-lc", `cp ${JSON.stringify(candidateA)} ${JSON.stringify(outFile)}`]);
    core.info(`SBOM (Maven CycloneDX) written: ${outFile}`);
    return;
  }

  let found = "";
  await exec.exec("bash", ["-lc", `set -e; find . -type f \\( -name sbom.json -o -name bom.json \\) -path '*/target/*' | head -n1`], {
    cwd: rootDir,
    listeners: { stdout: d => (found += d.toString()) }
  });
  found = found.trim();
  if (found && fs.existsSync(path.resolve(rootDir, found))) {
    await exec.exec("bash", ["-lc", `cp ${JSON.stringify(path.resolve(rootDir, found))} ${JSON.stringify(outFile)}`]);
    core.info(`SBOM (Maven CycloneDX) written: ${outFile}`);
    return;
  }

  core.warning("CycloneDX Maven plugin did not produce sbom.json; falling back to Syft directory scan.");
  await generateSbomSyftDir(rootDir, outFile);
}

// Auto: if pom.xml exists, use Maven CycloneDX; else Syft dir
async function generateSbomAuto(rootDir, outFile) {
  if (fs.existsSync(path.join(rootDir, "pom.xml"))) {
    try {
      await generateSbomMaven(rootDir, outFile);
      return;
    } catch (e) {
      core.warning(`Maven CycloneDX failed (${e.message}). Falling back to Syft dir scan.`);
    }
  }
  await generateSbomSyftDir(rootDir, outFile);
}

module.exports = { generateSbomAuto };
