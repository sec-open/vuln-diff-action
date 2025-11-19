// SBOM generation helper: strict mode chooses Maven, NPM, or Syft based on project type.
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
  // Strict: fail if dependencies cannot be installed
  if (!await hasPackageJson(cwd)) return;
  if (process.env.VULN_DIFF_SKIP_NPM_INSTALL === 'true') {
    throw new Error('VULN_DIFF_SKIP_NPM_INSTALL=true blocks required NPM install for strict SBOM.');
  }
  const lockExists = fs.existsSync(path.join(cwd, 'package-lock.json'));
  const modulesDir = path.join(cwd, 'node_modules');
  const needInstall = process.env.VULN_DIFF_FORCE_NPM_INSTALL === 'true' || !fs.existsSync(modulesDir);
  if (!needInstall && lockExists && fs.existsSync(modulesDir)) return;
  const baseArgs = lockExists ? ['ci'] : ['install'];
  if (!includeDev) baseArgs.push('--omit=dev');
  baseArgs.push('--no-audit', '--no-fund');
  await execCmd('npm', baseArgs, { cwd });
}

// Usa CycloneDX-NPM de forma estricta; si falla ambos intentos, aborta
async function generateSbomWithNpm(cwd, opts = {}) {
  // Strict NPM SBOM: two attempts, both must succeed producing file
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
  try {
    await execCmd('npx', [...baseArgs, '--package-lock-only'], { cwd });
    if (!fs.existsSync(outPath)) throw new Error('CycloneDX-NPM did not produce file after --package-lock-only attempt.');
    return outPath;
  } catch (e) {
    firstErr = e;
  }
  await execCmd('npx', baseArgs, { cwd }).catch(e2 => {
    throw new Error(
      `Strict NPM SBOM failed.\nAttempt 1 (--package-lock-only):\n${firstErr.stderr || firstErr.message}\n\nAttempt 2 (full):\n${e2.stderr || e2.message}`
    );
  });
  if (!fs.existsSync(outPath)) {
    throw new Error('CycloneDX-NPM did not produce file after full attempt.');
  }
  return outPath;
}

// Orquestación estricta
async function generateSbom(opts) {
  // Orchestrates strict SBOM selection based on presence of package.json or pom.xml
  const { checkoutDir, tools } = opts;
  const hasPackage = await hasPackageJson(checkoutDir);
  const hasPom = await hasPomXml(checkoutDir);
  const includeDev = hasPackage
    ? true // include dev dependencies for JS projects by default
    : !!(opts.includeDevDependencies || process.env.VULN_DIFF_INCLUDE_DEV_DEPS === 'true');

  // JavaScript strict (preferred if package.json present)
  if (hasPackage) {
    return await generateSbomWithNpm(checkoutDir, { includeDevDependencies: includeDev });
  }

  // Java strict (only when no package.json and pom.xml present)
  if (!hasPackage && hasPom) {
    if (!tools.paths.mvn) {
      throw new Error('Java project requires Maven (mvn) for SBOM generation, not available.');
    }
    return await generateSbomWithMaven(checkoutDir);
  }

  // Generic fallback (no package.json, no pom.xml)
  if (!tools.paths.syft) {
    throw new Error('Syft required for projects without package.json or pom.xml.');
  }
  return await generateSbomWithSyft(checkoutDir, tools.paths.syft);
}

module.exports = { generateSbom };
