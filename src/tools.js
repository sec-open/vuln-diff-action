/**
 * Tool bootstrapper: ensure Syft & Grype & (optionally) Java/Maven are installed,
 * and return absolute binary paths so child_process.execFile does not depend on PATH.
 *
 * Exports:
 *  - ensureAndLocateScannerTools(): Promise<{ syftPath, grypePath }>
 *  - ensureJavaMavenIfNeeded({ hasMavenProject })
 *  - commandExists, versionOf
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

async function sh(cmd) {
  return execFileP("bash", ["-lc", cmd], { maxBuffer: 10 * 1024 * 1024 });
}

async function commandExists(cmd) {
  try { await sh(`command -v ${cmd}`); return true; } catch { return false; }
}
async function versionOf(cmd) {
  try {
    const { stdout, stderr } = await execFileP(cmd, ["-version"]);
    return (stdout || stderr || "").split(/\r?\n/)[0];
  } catch {
    try {
      const { stdout, stderr } = await execFileP(cmd, ["version"]);
      return (stdout || stderr || "").split(/\r?\n/)[0];
    } catch {
      return undefined;
    }
  }
}

/* ---------------- Syft / Grype ---------------- */

function candidateDirs() {
  const home = os.homedir();
  const wsBin = path.resolve(process.cwd(), ".vulndiff", "bin");
  return [
    "/usr/local/bin",
    "/usr/bin",
    path.join(home, ".local", "bin"),
    wsBin,
  ];
}

async function whichInDirs(binName) {
  const dirs = candidateDirs();
  for (const d of dirs) {
    const p = path.join(d, binName);
    try { await fs.access(p); return p; } catch {}
  }
  // As a last resort, try 'command -v'
  try {
    const out = await sh(`command -v ${binName} || true`);
    const p = out.stdout?.toString().trim() || out.toString().trim();
    if (p) return p;
  } catch {}
  return null;
}

async function installSyft(binDir) {
  const ver = process.env.SYFT_VERSION ? String(process.env.SYFT_VERSION) : "";
  const args = ver ? `-b "${binDir}" ${ver}` : `-b "${binDir}"`;
  await sh(`curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- ${args}`);
}
async function installGrype(binDir) {
  const ver = process.env.GRYPE_VERSION ? String(process.env.GRYPE_VERSION) : "";
  const args = ver ? `-b "${binDir}" ${ver}` : `-b "${binDir}"`;
  await sh(`curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- ${args}`);
}

/**
 * Ensure Syft & Grype are present; install them if missing.
 * Return absolute paths { syftPath, grypePath }.
 */
async function ensureAndLocateScannerTools() {
  // Prefer /usr/local/bin; fall back to workspace bin
  let targetBinDir = "/usr/local/bin";
  try { await fs.mkdir(targetBinDir, { recursive: true }); } catch {}
  try { await fs.access(targetBinDir); } catch {
    targetBinDir = path.resolve(process.cwd(), ".vulndiff", "bin");
    await fs.mkdir(targetBinDir, { recursive: true });
  }

  // Try to locate first
  let syftPath = await whichInDirs("syft");
  let grypePath = await whichInDirs("grype");

  if (!syftPath) {
    console.log("[tools] Syft not found in PATH. Installing…");
    await installSyft(targetBinDir);
    syftPath = await whichInDirs("syft");
  } else {
    console.log("[tools] Syft found:", await versionOf(syftPath));
  }

  if (!grypePath) {
    console.log("[tools] Grype not found in PATH. Installing…");
    await installGrype(targetBinDir);
    grypePath = await whichInDirs("grype");
  } else {
    console.log("[tools] Grype found:", await versionOf(grypePath));
  }

  if (!syftPath) throw new Error("Syft installation failed (binary not found).");
  if (!grypePath) throw new Error("Grype installation failed (binary not found).");

  // Ensure current process can find them too (for any shell-based calls)
  process.env.PATH = `${path.dirname(syftPath)}:${path.dirname(grypePath)}:${process.env.PATH}`;

  return { syftPath, grypePath };
}

/* ---------------- Java / Maven ---------------- */

async function ensureJavaMavenIfNeeded({ hasMavenProject }) {
  if (!hasMavenProject) return;

  const mvnExists = await commandExists("mvn");
  const javaExists = await commandExists("java");

  if (mvnExists && javaExists) {
    console.log("[tools] Maven found:", await versionOf("mvn"));
    console.log("[tools] Java found:", await versionOf("java"));
    return;
  }

  // 1) Try apt-get on Debian/Ubuntu
  try {
    await sh("if command -v apt-get >/dev/null; then sudo apt-get update -y && sudo apt-get install -y maven default-jdk; fi");
  } catch (e) {
    console.log("[tools] apt-get install failed or not available:", e?.message || e);
  }

  const postAptMvn = await commandExists("mvn");
  const postAptJava = await commandExists("java");
  if (postAptMvn && postAptJava) {
    console.log("[tools] Maven/Java installed via apt-get.");
    console.log("[tools] Maven:", await versionOf("mvn"));
    console.log("[tools] Java:", await versionOf("java"));
    return;
  }

  // 2) Fallback: Maven tarball (JDK aviso)
  const toolsDir = path.resolve(process.cwd(), ".vulndiff", "tools");
  const binDir = path.join(toolsDir, "bin");
  await fs.mkdir(binDir, { recursive: true });

  if (!postAptJava) {
    console.warn("[tools] Java JDK not installed via apt; Maven may fail. Consider installing JDK manually if needed.");
  }

  const MAVEN_VERSION = process.env.MAVEN_VERSION || "3.9.9";
  const mUrl = `https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/apache-maven-${MAVEN_VERSION}-bin.tar.gz`;
  try {
    await fs.mkdir(path.join(toolsDir, "maven"), { recursive: true });
    const tar = path.join(toolsDir, `apache-maven-${MAVEN_VERSION}-bin.tar.gz`);
    await sh(`curl -fsSL "${mUrl}" -o "${tar}"`);
    await sh(`tar -xzf "${tar}" -C "${toolsDir}/maven" --strip-components=1`);
    await sh(`ln -sf "${toolsDir}/maven/bin/mvn" "${binDir}/mvn"`);
    process.env.PATH = `${binDir}:${process.env.PATH}`;
    console.log("[tools] Maven installed from archive:", await versionOf("mvn"));
  } catch (e) {
    console.warn("[tools] Maven archive install failed:", e?.message || e);
  }
}

module.exports = {
  ensureAndLocateScannerTools,
  ensureJavaMavenIfNeeded,
  commandExists,
  versionOf,
};
