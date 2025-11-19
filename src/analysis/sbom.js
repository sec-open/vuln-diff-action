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
async function generateSbomWithNpm(cwd) {
  const outPath = require('path').join(cwd, 'sbom.npm.json');
  await execCmd('npx', [
    '@cyclonedx/cyclonedx-npm',
    '--package-lock-only',
    '--ignore-npm-errors',
    '--output-format', 'JSON',
    '--output-file', outPath
  ], { cwd });
  return outPath;
}

// Orchestrates SBOM generation: attempt Maven, fallback to NPM if applicable, then to Syft.
async function generateSbom(opts) {
  const { checkoutDir, tools } = opts;
  const useMaven = await hasMavenReactor(checkoutDir, tools.paths.mvn);
  const hasPackage = await hasPackageJson(checkoutDir);
  const hasPom = await hasPomXml(checkoutDir);

  if (useMaven) {
    try {
      return await generateSbomWithMaven(checkoutDir);
    } catch (e) {
      // fall through
    }
  }
  // If package.json exists and pom.xml does not, use npx CycloneDX-NPM
  if (hasPackage && !hasPom) {
    try {
      return await generateSbomWithNpm(checkoutDir);
    } catch (e) {
      // fall through
    }
  }
  // Fallback to Syft
  if (!tools.paths.syft) throw new Error('Syft not available and Maven/NPM SBOM generation failed or not applicable.');
  return await generateSbomWithSyft(checkoutDir, tools.paths.syft);
}

module.exports = { generateSbom };
