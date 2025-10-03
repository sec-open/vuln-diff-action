/**
 * SBOM generation: prefer CycloneDX Maven when a Maven reactor is detected,
 * otherwise fallback to Syft scanning a path.
 *
 * Outputs a path to a CycloneDX JSON SBOM file.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);
const path = require("path");
const fs = require("fs/promises");

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function hasMavenProject(rootDir) {
  // Simple heuristic: any pom.xml in root or submodule triggers Maven path.
  const pom = path.join(rootDir, "pom.xml");
  return fileExists(pom);
}

async function run(cmd, args, opts = {}) {
  const { stdout, stderr } = await execFileP(cmd, args, { ...opts });
  return { stdout, stderr };
}

/**
 * Generate SBOM with CycloneDX Maven (json).
 * @returns {Promise<string>} path to generated sbom file
 */
async function genSbomCycloneDx(rootDir, outDir) {
  // Ensure outDir
  await fs.mkdir(outDir, { recursive: true });
  // Use cyclonedx-maven-plugin if available
  // Generate at target/sbom-cyclonedx.json then copy into outDir
  await run("mvn", ["-q", "-DskipTests", "org.cyclonedx:cyclonedx-maven-plugin:2.7.10:makeAggregateBom"], { cwd: rootDir });
  // Default output by plugin:
  const candidate = path.join(rootDir, "target", "bom.json");
  const dst = path.join(outDir, "sbom-cyclonedx.json");
  await fs.copyFile(candidate, dst);
  return dst;
}

/**
 * Generate SBOM with Syft scanning the directory.
 */
async function genSbomSyft(rootDir, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const out = path.join(outDir, "sbom-syft.json");
  await run("syft", ["dir:"+rootDir, "-o", "cyclonedx-json", "--file", out]);
  return out;
}

/**
 * Decide which SBOM path to use and return { path, tool }.
 */
async function generateSbom(rootDir, outDir) {
  if (await hasMavenProject(rootDir)) {
    const p = await genSbomCycloneDx(rootDir, outDir);
    return { path: p, tool: "cyclonedx_maven" };
  } else {
    const p = await genSbomSyft(rootDir, outDir);
    return { path: p, tool: "syft" };
  }
}

module.exports = {
  generateSbom,
};
