// SBOM generation helper: prefers Maven CycloneDX aggregate, falls back to Syft.
const path = require('path');
const fs = require('fs');
const { execCmd } = require('./exec');
const { writeFile } = require('./fsx');

// Detects presence of a Maven reactor (pom.xml at root); returns boolean.
async function hasMavenReactor(cwd, mvnPath) {
  if (!mvnPath) return false;
  // quick heuristic: presence of pom.xml in root
  const { stdout } = await execCmd('bash', ['-lc', 'test -f pom.xml && echo yes || echo no'], { cwd });
  return stdout.trim() === 'yes';
}

// Detects presence of package.json in the root; returns boolean.
async function hasPackageJson(cwd) {
  return fs.existsSync(require('path').join(cwd, 'package.json'));
}

// Detects presence of pom.xml in the root; returns boolean.
async function hasPomXml(cwd) {
  return fs.existsSync(require('path').join(cwd, 'pom.xml'));
}

// Invokes CycloneDX Maven plugin to generate aggregate JSON SBOM; returns file path.
async function generateSbomWithMaven(cwd) {
  // Produces target/sbom.json (we’ll read it back)
  const args = [
    '-q',
    '-DskipTests',
    'org.cyclonedx:cyclonedx-maven-plugin:makeAggregateBom',
    '-DoutputFormat=json',
    '-DoutputName=sbom',
  ];
  await execCmd('mvn', args, { cwd });
  const sbomPath = path.join(cwd, 'target', 'sbom.json');
  return sbomPath;
}

// Uses Syft to scan a directory and emits CycloneDX JSON SBOM (writes to temp file).
async function generateSbomWithSyft(cwd, syftPath) {
  const { stdout } = await execCmd(syftPath, ['dir:.', '-o', 'cyclonedx-json'], { cwd });
  // syft prints the SBOM to stdout
  const outPath = path.join(cwd, 'sbom.syft.json');
  await writeFile(outPath, Buffer.from(stdout, 'utf8'));
  return outPath;
}

// NEW estricto: instalación dependencias; cualquier fallo aborta
async function ensureNodeDependencies(cwd, includeDev) {
  if (!await hasPackageJson(cwd)) return;
  if (process.env.VULN_DIFF_SKIP_NPM_INSTALL === 'true') {
    throw new Error('VULN_DIFF_SKIP_NPM_INSTALL=true impide instalar dependencias necesarias para SBOM NPM estricto.');
  }
  const lockExists = fs.existsSync(path.join(cwd, 'package-lock.json'));
  const modulesDir = path.join(cwd, 'node_modules');
  const needInstall = process.env.VULN_DIFF_FORCE_NPM_INSTALL === 'true' || !fs.existsSync(modulesDir);
  if (!needInstall && lockExists && fs.existsSync(modulesDir)) return;
  const baseArgs = lockExists ? ['ci'] : ['install'];
  if (!includeDev) baseArgs.push('--omit=dev');
  baseArgs.push('--no-audit', '--no-fund');
  await execCmd('npm', baseArgs, { cwd }); // si falla lanza
}

// Usa CycloneDX-NPM de forma estricta; si falla ambos intentos, aborta
async function generateSbomWithNpm(cwd, opts = {}) {
  await ensureNodeDependencies(cwd, !!opts.includeDevDependencies);
  const outPath = path.join(cwd, 'sbom.npm.json');
  const baseArgs = [
    '@cyclonedx/cyclonedx-npm',
    '--ignore-npm-errors',
    '--output-format', 'JSON',
    '--output-file', outPath
  ];
  if (opts.includeDevDependencies) baseArgs.push('--include-dev-dependencies');
  let firstErr = null;
  // Intento 1 rápido
  try {
    await execCmd('npx', [...baseArgs, '--package-lock-only'], { cwd });
    if (!fs.existsSync(outPath)) throw new Error('CycloneDX-NPM no produjo fichero tras intento --package-lock-only.');
    return outPath;
  } catch (e) {
    firstErr = e;
  }
  // Intento 2 completo
  await execCmd('npx', baseArgs, { cwd }).catch(e2 => {
    throw new Error(
      `Fallo SBOM NPM estricto.\nIntento 1 (--package-lock-only):\n${firstErr.stderr || firstErr.message}\n\nIntento 2 (completo):\n${e2.stderr || e2.message}`
    );
  });
  if (!fs.existsSync(outPath)) {
    throw new Error('CycloneDX-NPM no produjo fichero tras intento completo.');
  }
  return outPath;
}

// Orquestación estricta
async function generateSbom(opts) {
  const { checkoutDir, tools } = opts;
  const includeDev = !!(opts.includeDevDependencies || process.env.VULN_DIFF_INCLUDE_DEV_DEPS === 'true');
  const hasPackage = await hasPackageJson(checkoutDir);
  const hasPom = await hasPomXml(checkoutDir);
  // Java estricto
  if (hasPom) {
    if (!tools.paths.mvn) {
      throw new Error('Proyecto Java con pom.xml requiere Maven (mvn) para SBOM agregada, no disponible.');
    }
    return await generateSbomWithMaven(checkoutDir); // si falla lanza
  }
  // JavaScript estricto
  if (hasPackage && !hasPom) {
    return await generateSbomWithNpm(checkoutDir, { includeDevDependencies: includeDev }); // si falla lanza
  }
  // Caso genérico (sin pom.xml ni package.json)
  if (!tools.paths.syft) {
    throw new Error('Syft requerido para proyectos sin pom.xml ni package.json.');
  }
  return await generateSbomWithSyft(checkoutDir, tools.paths.syft);
}

module.exports = { generateSbom };
