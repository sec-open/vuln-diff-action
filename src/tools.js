/**
 * Tool bootstrapper: ensure Syft & Grype & (optionally) Java/Maven are installed.
 * - Syft/Grype: install via official install.sh to /usr/local/bin (fallback to a local bin dir).
 * - Java/Maven: try apt-get first (Ubuntu runners), otherwise download and unpack.
 * - You can pin versions via env:
 *     SYFT_VERSION="v1.0.1"  GRYPE_VERSION="v0.79.0"
 *     MAVEN_VERSION="3.9.9"  JDK_MAJOR="17"
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);
const fs = require("fs/promises");
const path = require("path");

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
 * Install syft & grype if missing. Tries /usr/local/bin, then a local bin dir.
 */
async function ensureSyftGrype() {
  if (!(await commandExists("syft")) || !(await commandExists("grype"))) {
    let binDir = "/usr/local/bin";
    try {
      await fs.mkdir(binDir, { recursive: true });
      await fs.access(binDir);
    } catch {
      // fallback to workspace local bin
      binDir = path.resolve(process.cwd(), ".vulndiff", "bin");
      await fs.mkdir(binDir, { recursive: true });
      // add to PATH for this process
      process.env.PATH = `${binDir}:${process.env.PATH}`;
    }

    if (!(await commandExists("syft"))) {
      console.log("[tools] Installing Syft…");
      await installSyft(binDir);
    } else {
      console.log("[tools] Syft found:", await versionOf("syft"));
    }

    if (!(await commandExists("grype"))) {
      console.log("[tools] Installing Grype…");
      await installGrype(binDir);
    } else {
      console.log("[tools] Grype found:", await versionOf("grype"));
    }
  }

  // Final check
  if (!(await commandExists("syft"))) throw new Error("Syft not available after install");
  if (!(await commandExists("grype"))) throw new Error("Grype not available after install");
}

/* ---------------- Java / Maven ---------------- */

async function ensureJavaMavenIfNeeded({ hasMavenProject }) {
  // If no Maven project, skip Java/Maven (Syft fallback will be used).
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

  // 2) Fallback: download Apache Maven and Temurin JDK to a local tool dir
  const toolsDir = path.resolve(process.cwd(), ".vulndiff", "tools");
  const binDir = path.join(toolsDir, "bin");
  await fs.mkdir(binDir, { recursive: true });

  // Temurin JDK (Linux x64) – simple heuristic via apt fallback already; here we try SDKMAN-like install is overkill.
  // Instead, try to use 'which javac' again; if still missing, warn but allow Syft fallback to run.
  if (!postAptJava) {
    console.warn("[tools] Java JDK not installed via apt; Maven may fail. Consider installing JDK manually if needed.");
  }

  // Maven download (pick version from env or default)
  const MAVEN_VERSION = process.env.MAVEN_VERSION || "3.9.9";
  const mUrl = `https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/apache-maven-${MAVEN_VERSION}-bin.tar.gz`;
  try {
    await fs.mkdir(path.join(toolsDir, "maven"), { recursive: true });
    const tar = path.join(toolsDir, `apache-maven-${MAVEN_VERSION}-bin.tar.gz`);
    await sh(`curl -fsSL "${mUrl}" -o "${tar}"`);
    await sh(`tar -xzf "${tar}" -C "${toolsDir}/maven" --strip-components=1`);
    // symlink mvn to binDir and prepend PATH
    await sh(`ln -sf "${toolsDir}/maven/bin/mvn" "${binDir}/mvn"`);
    process.env.PATH = `${binDir}:${process.env.PATH}`;
    console.log("[tools] Maven installed from archive:", await versionOf("mvn"));
  } catch (e) {
    console.warn("[tools] Maven archive install failed:", e?.message || e);
  }
}

module.exports = {
  ensureSyftGrype,
  ensureJavaMavenIfNeeded,
  commandExists,
  versionOf,
};
