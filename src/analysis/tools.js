// Tool detection & best-effort installers for syft/grype; record versions
const os = require('os');
const path = require('path');
const { execCmd, which } = require('./exec');
const { ensureDir } = require('./fsx');

const DEFAULTS = {
  syft: process.env.SYFT_VERSION || 'v1.13.0',
  grype: process.env.GRYPE_VERSION || 'v0.79.2',
};

function isLinux() { return os.platform() === 'linux'; }
function isMac() { return os.platform() === 'darwin'; }
function archTag() {
  // Map Node arch to release arch
  const a = os.arch();
  if (a === 'x64') return 'amd64';
  if (a === 'arm64') return 'arm64';
  return 'amd64'; // fallback
}

async function tryGetNodeVersion() {
  try {
    const { stdout } = await execCmd('node', ['-v']);
    return stdout.trim();
  } catch { return null; }
}

async function tryGetMavenVersion() {
  const mvn = await which('mvn');
  if (!mvn) return null;
  try {
    const { stdout } = await execCmd(mvn, ['-v']);
    // first line like: Apache Maven 3.9.6 ...
    const line = stdout.split('\n')[0].trim();
    return line || stdout.trim();
  } catch { return null; }
}

async function tryGetJsonVersion(bin, args) {
  try {
    const { stdout } = await execCmd(bin, args);
    const j = JSON.parse(stdout);
    // syft/grype both have .Version
    return j.Version || j.version || null;
  } catch { return null; }
}

async function detectOrInstallSyft(toolsDir) {
  let syftPath = await which('syft');
  if (syftPath) return syftPath;

  // best-effort download (Linux/macOS only, curl required)
  const curl = await which('curl');
  if (!curl || (!isLinux() && !isMac())) return null;

  const arch = archTag();
  const plat = isLinux() ? 'linux' : 'darwin';
  const ver = DEFAULTS.syft;
  const url = `https://github.com/anchore/syft/releases/download/${ver}/syft_${plat}_${arch}`;
  const binDir = path.join(toolsDir, 'syft');
  const binPath = path.join(binDir, 'syft');

  await ensureDir(binDir);
  await execCmd(curl, ['-sSLf', '-o', binPath, url]);
  await execCmd('chmod', ['+x', binPath]);
  return binPath;
}

async function detectOrInstallGrype(toolsDir) {
  let grypePath = await which('grype');
  if (grypePath) return grypePath;

  const curl = await which('curl');
  if (!curl || (!isLinux() && !isMac())) return null;

  const arch = archTag();
  const plat = isLinux() ? 'linux' : 'darwin';
  const ver = DEFAULTS.grype;
  const url = `https://github.com/anchore/grype/releases/download/${ver}/grype_${plat}_${arch}`;
  const binDir = path.join(toolsDir, 'grype');
  const binPath = path.join(binDir, 'grype');

  await ensureDir(binDir);
  await execCmd(curl, ['-sSLf', '-o', binPath, url]);
  await execCmd('chmod', ['+x', binPath]);
  return binPath;
}

async function detectTools() {
  const toolsDir = path.resolve(process.cwd(), '.tools');
  const node = await tryGetNodeVersion();
  const mvnVersion = await tryGetMavenVersion();

  const syftPath = await detectOrInstallSyft(toolsDir);
  const grypePath = await detectOrInstallGrype(toolsDir);

  const syftVersion = syftPath ? await tryGetJsonVersion(syftPath, ['version', '-o', 'json']) : null;
  const grypeVersion = grypePath ? await tryGetJsonVersion(grypePath, ['version', '-o', 'json']) : null;

  return {
    paths: { syft: syftPath, grype: grypePath, mvn: mvnVersion ? 'mvn' : null },
    versions: {
      node: node,
      cyclonedx_maven: mvnVersion,
      syft: syftVersion,
      grype: grypeVersion,
    },
  };
}

module.exports = { detectTools };
