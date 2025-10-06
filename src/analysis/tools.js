// Tool detection & Linux APT installers for syft/grype/maven
const os = require('os');
const path = require('path');
const { execCmd, which } = require('./exec');

function isLinux() { return os.platform() === 'linux'; }

async function aptExists() {
  try { await execCmd('bash', ['-lc', 'command -v apt-get >/dev/null 2>&1']); return true; }
  catch { return false; }
}

async function runApt(cmd) {
  // Try with sudo, then without (self-hosted runners may not need sudo)
  try { return await execCmd('bash', ['-lc', `sudo ${cmd}`]); } catch { /* try without sudo */ }
  return await execCmd('bash', ['-lc', cmd]);
}

async function ensureAnchoreAptRepo() {
  // idempotent: si ya existe, no pasa nada
  await runApt('apt-get update -y');
  await runApt('apt-get install -y curl gpg');
  // repo estable de anchore (trusted=yes evita manejar llaves por separado en runners efímeros)
  await runApt(`bash -lc "echo 'deb [trusted=yes] https://apt.anchore.io stable main' > /etc/apt/sources.list.d/anchore.list"`);
  await runApt('apt-get update -y');
}

async function ensureSyft() {
  let syft = await which('syft');
  if (syft || !isLinux() || !(await aptExists())) return syft;
  await ensureAnchoreAptRepo();
  await runApt('apt-get install -y syft');
  return await which('syft');
}

async function ensureGrype() {
  let grype = await which('grype');
  if (grype || !isLinux() || !(await aptExists())) return grype;
  await ensureAnchoreAptRepo();
  await runApt('apt-get install -y grype');
  return await which('grype');
}

async function ensureMaven() {
  let mvn = await which('mvn');
  if (mvn || !isLinux() || !(await aptExists())) return mvn;
  await runApt('apt-get install -y maven');
  return await which('mvn');
}

async function tryGetJsonVersion(bin, args) {
  try {
    const { stdout } = await execCmd(bin, args);
    const j = JSON.parse(stdout);
    return j.Version || j.version || null;
  } catch { return null; }
}

async function tryGetMavenVersion(mvnPath) {
  if (!mvnPath) return null;
  try {
    const { stdout } = await execCmd(mvnPath, ['-v']);
    return stdout.split('\n')[0].trim();
  } catch { return null; }
}

async function detectTools() {
  // Ensure tools if possible (Linux/Ubuntu with APT)
  const mvnPath  = await ensureMaven();
  const syftPath = await ensureSyft();
  const grypePath= await ensureGrype();

  // Versions
  const node = process.version;
  const cyclonedx_maven = await tryGetMavenVersion(mvnPath);
  const syft = syftPath ? await tryGetJsonVersion(syftPath, ['version', '-o', 'json']) : null;
  const grype = grypePath ? await tryGetJsonVersion(grypePath, ['version', '-o', 'json']) : null;

  return {
    paths: { syft: syftPath, grype: grypePath, mvn: mvnPath },
    versions: { node, cyclonedx_maven, syft, grype },
  };
}

module.exports = { detectTools };
