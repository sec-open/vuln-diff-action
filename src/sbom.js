/**
 * SBOM generation:
 *  - Prefer CycloneDX Maven if a reactor is detected and mvn/java are available
 *    (we auto-install them when necessary).
 *  - Otherwise fallback to Syft using provided absolute syft binary path.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);
const path = require("path");
const fs = require("fs/promises");
const { ensureJavaMavenIfNeeded, commandExists } = require("./tools");

async function fileExists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function hasMavenProject(rootDir) { return fileExists(path.join(rootDir, "pom.xml")); }
async function run(cmd, args, opts = {}) {
  const { stdout, stderr } = await execFileP(cmd, args, { ...opts });
  return { stdout, stderr };
}

/**
 * Generate SBOM with CycloneDX Maven (json).
 */
async function genSbomCycloneDx(rootDir, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  await run("mvn", ["-q", "-DskipTests", "org.cyclonedx:cyclonedx-maven-plugin:2.7.10:makeAggregateBom"], { cwd: rootDir });
  const candidate = path.join(rootDir, "target", "bom.json");
  const dst = path.join(outDir, "sbom-cyclonedx.json");
  await fs.copyFile(candidate, dst);
  return dst;
}

/**
 * Generate SBOM with Syft scanning the directory using an absolute syft path.
 */
async function genSbomSyftWith(syftBin, rootDir, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const out = path.join(outDir, "sbom-syft.json");
  await run(syftBin, ["dir:"+rootDir, "-o", "cyclonedx-json", "--file", out]);
  return out;
}

/**
 * Decide SBOM path and return { path, tool }.
 * @param {string} rootDir
 * @param {string} outDir
 * @param {{ syftPath: string }} bins
 */
async function generateSbom(rootDir, outDir, bins) {
  const mavenDetected = await hasMavenProject(rootDir);
  if (mavenDetected) {
    await ensureJavaMavenIfNeeded({ hasMavenProject: true });
  }
  const mvnAvailable = await commandExists("mvn");

  if (mavenDetected && mvnAvailable) {
    const p = await genSbomCycloneDx(rootDir, outDir);
    return { path: p, tool: "cyclonedx_maven" };
  }
  const p = await genSbomSyftWith(bins.syftPath, rootDir, outDir);
  return { path: p, tool: "syft" };
}

module.exports = { generateSbom };
