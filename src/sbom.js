/**
 * SBOM generation: prefer CycloneDX Maven when a Maven reactor is detected
 * AND mvn/java are available (we will try to auto-install them).
 * Otherwise fallback to Syft scanning a path.
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
 * @returns {Promise<string>} path to generated sbom file
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
 * Will attempt to auto-install Maven/Java if a Maven project is detected.
 */
async function generateSbom(rootDir, outDir) {
  const mavenDetected = await hasMavenProject(rootDir);
  if (mavenDetected) {
    await ensureJavaMavenIfNeeded({ hasMavenProject: true });
  }
  const mvnAvailable = await commandExists("mvn");

  if (mavenDetected && mvnAvailable) {
    const p = await genSbomCycloneDx(rootDir, outDir);
    return { path: p, tool: "cyclonedx_maven" };
  }
  // Fallback to Syft
  const p = await genSbomSyft(rootDir, outDir);
  return { path: p, tool: "syft" };
}

module.exports = { generateSbom };
