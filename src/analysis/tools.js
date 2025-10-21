// Tool detection and installation strategy: prefer system packages (APT) then fallback to GitHub tarballs.
const os = require('os');
const path = require('path');
const { execCmd, which } = require('./exec');
const { ensureDir } = require('./fsx');

const DEFAULTS = {
  syft: process.env.SYFT_VERSION || 'v1.13.0',
  grype: process.env.GRYPE_VERSION || 'v0.79.2',
};

// Returns true if running on Linux.
function isLinux() { return os.platform() === 'linux'; }

// Maps Node.js arch to release asset architecture tag.
function archTag() {
  const a = os.arch();
  if (a === 'x64') return 'amd64';
  if (a === 'arm64') return 'arm64';
  return 'amd64';
}

// Checks if apt-get exists (permission not guaranteed).
async function aptExists() {
  try { await execCmd('bash', ['-lc', 'command -v apt-get >/dev/null 2>&1']); return true; }
  catch { return false; }
}

// Executes apt command with sudo fallback; propagates combined error details if both attempts fail.
async function runApt(cmd) {
  // try sudo first, then without (algunos runners no necesitan sudo)
  try { return await execCmd('bash', ['-lc', `sudo ${cmd}`]); } catch (e1) {
    try { return await execCmd('bash', ['-lc', cmd]); } catch (e2) {
      // re-lanza con info para detectar "Permission denied"/locks
      const err = new Error(`APT failed: ${e1.stderr || e1.message}\n${e2.stderr || e2.message}`);
      err._aptFailed = true;
      throw err;
    }
  }
}

// Ensures Anchore APT repository is configured (trusted) before installing syft/grype.
async function ensureAnchoreAptRepo() {
  await runApt('apt-get update -y');
  await runApt('apt-get install -y curl gpg');
  await runApt(`bash -lc "echo 'deb [trusted=yes] https://apt.anchore.io stable main' > /etc/apt/sources.list.d/anchore.list"`);
  await runApt('apt-get update -y');
}

// Prepends a directory to PATH for current process execution context.
async function addToPath(dir) {
  // prepend to PATH for current process
  process.env.PATH = `${dir}:${process.env.PATH || ''}`;
}

// Downloads and extracts a GitHub release tar.gz for a tool; returns binary path.
async function downloadTarballTool({ repo, ver, binName, toolsDir }) {
  const arch = archTag();
  const plat = isLinux() ? 'linux' : (os.platform() === 'darwin' ? 'darwin' : null);
  if (!plat) return null;

  const fileVer = String(ver).replace(/^v/, ''); // <- quitar la 'v' para el nombre del asset
  const url = `https://github.com/anchore/${repo}/releases/download/${ver}/${binName}_${fileVer}_${plat}_${arch}.tar.gz`;

  const toolDir = path.join(toolsDir, binName);
  const tarPath = path.join(toolDir, `${binName}.tar.gz`);
  const binPath = path.join(toolDir, binName);

  await ensureDir(toolDir);
  await execCmd('bash', ['-lc', `curl -sSLf -o "${tarPath}" "${url}"`]);
  await execCmd('bash', ['-lc', `tar -xzf "${tarPath}" -C "${toolDir}"`]);
  await execCmd('chmod', ['+x', binPath]);
  await addToPath(toolDir);
  return binPath;
}

// Ensures Syft binary is available (tries existing, then APT, then tarball fallback).
async function ensureSyft(toolsDir) {
  let syft = await which('syft');
  if (syft) return syft;

  if (isLinux() && await aptExists()) {
    try {
      await ensureAnchoreAptRepo();
      await runApt('apt-get install -y syft');
      syft = await which('syft');
      if (syft) return syft;
    } catch (eAPT) {
      // Fallback sin sudo
      try {
        if (!toolsDir) toolsDir = path.resolve(process.cwd(), '.tools');
        return await downloadTarballTool({ repo: 'syft', ver: DEFAULTS.syft, binName: 'syft', toolsDir });
      } catch (eDL) {
        throw new Error(`Syft install failed.\nAPT error:\n${eAPT.stderr || eAPT.message}\n\nTarball error:\n${eDL.stderr || eDL.message}`);
      }
    }
  }

  if (!toolsDir) toolsDir = path.resolve(process.cwd(), '.tools');
  return await downloadTarballTool({ repo: 'syft', ver: DEFAULTS.syft, binName: 'syft', toolsDir });
}

// Ensures Grype binary is available (tries existing, then APT, then tarball fallback).
async function ensureGrype(toolsDir) {
  let grype = await which('grype');
  if (grype) return grype;

  if (isLinux() && await aptExists()) {
    try {
      await ensureAnchoreAptRepo();
      await runApt('apt-get install -y grype');
      grype = await which('grype');
      if (grype) return grype;
    } catch (eAPT) {
      try {
        if (!toolsDir) toolsDir = path.resolve(process.cwd(), '.tools');
        return await downloadTarballTool({ repo: 'grype', ver: DEFAULTS.grype, binName: 'grype', toolsDir });
      } catch (eDL) {
        throw new Error(`Grype install failed.\nAPT error:\n${eAPT.stderr || eAPT.message}\n\nTarball error:\n${eDL.stderr || eDL.message}`);
      }
    }
  }

  if (!toolsDir) toolsDir = path.resolve(process.cwd(), '.tools');
  return await downloadTarballTool({ repo: 'grype', ver: DEFAULTS.grype, binName: 'grype', toolsDir });
}

// Attempts Maven installation via APT; returns path or null if unavailable.
async function ensureMaven() {
  // Maven es opcional (fallback Syft ya lo cubre); si APT no está disponible o no hay permisos, seguimos sin Maven
  let mvn = await which('mvn');
  if (mvn) return mvn;

  if (isLinux() && await aptExists()) {
    try {
      await runApt('apt-get update -y');
      await runApt('apt-get install -y maven');
      return await which('mvn');
    } catch {
      return null; // sin Maven, usaremos Syft para SBOM
    }
  }
  return null;
}

// Extracts version from JSON-formatted CLI output (Syft/Grype).
async function tryGetJsonVersion(bin, args) {
  try {
    const { stdout } = await execCmd(bin, args);
    const j = JSON.parse(stdout);
    return j.Version || j.version || null;
  } catch { return null; }
}

// Extracts Maven version string from mvn -v output.
async function tryGetMavenVersion(mvnPath) {
  if (!mvnPath) return null;
  try { const { stdout } = await execCmd(mvnPath, ['-v']); return stdout.split('\n')[0].trim(); }
  catch { return null; }
}

// Detects/installs required tools and returns their paths and versions.
async function detectTools() {
  const toolsDir = path.resolve(process.cwd(), '.tools');

  const mvnPath   = await ensureMaven();
  const syftPath  = await ensureSyft(toolsDir);
  const grypePath = await ensureGrype(toolsDir);

  const versions = {
    node: process.version,
    cyclonedx_maven: await tryGetMavenVersion(mvnPath),
    syft: syftPath ? await tryGetJsonVersion(syftPath, ['version', '-o', 'json']) : null,
    grype: grypePath ? await tryGetJsonVersion(grypePath, ['version', '-o', 'json']) : null,
  };

  return {
    paths: { syft: syftPath, grype: grypePath, mvn: mvnPath },
    versions
  };
}

module.exports = { detectTools };
