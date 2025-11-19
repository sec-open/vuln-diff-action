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

// Uses npx @cyclonedx/cyclonedx-npm to generate SBOM if package.json is present
async function generateSbomWithNpm(cwd, opts = {}) {
  await ensureNodeDependencies(cwd, !!opts.includeDevDependencies);
  const outPath = require('path').join(cwd, 'sbom.npm.json');
  const baseArgs = [
    '@cyclonedx/cyclonedx-npm',
    '--ignore-npm-errors',
    '--output-format', 'JSON',
    '--output-file', outPath
  ];
  if (opts.includeDevDependencies) {
    // Flag documentada por la herramienta; si no existe se ignora silenciosamente
    baseArgs.push('--include-dev-dependencies');
  }

  // Primer intento: usando package-lock-only (rápido)
  let generated = false;
  try {
    await execCmd('npx', [...baseArgs, '--package-lock-only'], { cwd });
    generated = true;
  } catch (e1) {
    // Si fallo ELSPROBLEMS reintentar sin --package-lock-only
    const stderr = (e1.stderr || e1.message || '');
    if (/ELSPROBLEMS/i.test(stderr) || /invalid:/i.test(stderr)) {
      try {
        await execCmd('npx', baseArgs, { cwd });
        generated = true;
      } catch (e2) {
        // Último recurso: si el fichero existe aunque haya error, usarlo
        if (fs.existsSync(outPath)) {
          generated = true;
        } else {
          throw new Error(`CycloneDX NPM failed.\nFirst attempt:\n${stderr}\nSecond attempt:\n${e2.stderr || e2.message}`);
        }
      }
    } else {
      // Error distinto: si no hay fichero abortar
      if (!fs.existsSync(outPath)) throw e1;
      generated = true;
    }
  }
  if (!generated) throw new Error('CycloneDX NPM SBOM not generated');
  return outPath;
}

// Orchestrates SBOM generation: attempt Maven, fallback to NPM if applicable, then to Syft.
async function generateSbom(opts) {
  const { checkoutDir, tools } = opts;
  const includeDev = !!(opts.includeDevDependencies || process.env.VULN_DIFF_INCLUDE_DEV_DEPS === 'true');
  const useMaven = await hasMavenReactor(checkoutDir, tools.paths.mvn);
  const hasPackage = await hasPackageJson(checkoutDir);
  const hasPom = await hasPomXml(checkoutDir);

  if (useMaven) {
    try {
      return await generateSbomWithMaven(checkoutDir);
    } catch {
      // fall through
    }
  }
  if (hasPackage && !hasPom) {
    try {
      return await generateSbomWithNpm(checkoutDir, { includeDevDependencies: includeDev });
    } catch {
      // continúa al fallback
    }
  }
  // Fallback to Syft
  if (!tools.paths.syft) throw new Error('Syft not available and Maven/NPM SBOM generation failed or not applicable.');
  return await generateSbomWithSyft(checkoutDir, tools.paths.syft);
}

// NEW: asegura que las dependencias de node estén instaladas (npm install) antes de generar el SBOM
async function ensureNodeDependencies(cwd, includeDev) {
  if (!await hasPackageJson(cwd)) return;
  if (process.env.VULN_DIFF_SKIP_NPM_INSTALL === 'true') return;

  const lockExists = fs.existsSync(path.join(cwd, 'package-lock.json'));
  const modulesDir = path.join(cwd, 'node_modules');
  const needInstall = process.env.VULN_DIFF_FORCE_NPM_INSTALL === 'true' || !fs.existsSync(modulesDir);

  if (!needInstall && lockExists) return; // ya instaladas

  const baseArgs = lockExists ? ['ci'] : ['install'];
  if (!includeDev) {
    // npm v7+ soporta --omit=dev para excluir devDependencies
    baseArgs.push('--omit=dev');
  }
  // evitar auditorías y fondos para rapidez
  baseArgs.push('--no-audit', '--no-fund');
  try {
    await execCmd('npm', baseArgs, { cwd });
  } catch (e) {
    // si falla pero existe node_modules lo toleramos
    if (!fs.existsSync(modulesDir)) throw new Error(`npm install failed: ${e.stderr || e.message}`);
  }
}

module.exports = { generateSbom };
