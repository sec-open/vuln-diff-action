// Generate CycloneDX SBOM: try Maven reactor first; fallback to syft
const path = require('path');
const { execCmd } = require('./exec');
const { writeFile } = require('./fsx');

async function hasMavenReactor(cwd, mvnPath) {
  if (!mvnPath) return false;
  // quick heuristic: presence of pom.xml in root
  const { stdout } = await execCmd('bash', ['-lc', 'test -f pom.xml && echo yes || echo no'], { cwd });
  return stdout.trim() === 'yes';
}

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

async function generateSbomWithSyft(cwd, syftPath) {
  const { stdout } = await execCmd(syftPath, ['dir:.', '-o', 'cyclonedx-json'], { cwd });
  // syft prints the SBOM to stdout
  const outPath = path.join(cwd, 'sbom.syft.json');
  await writeFile(outPath, Buffer.from(stdout, 'utf8'));
  return outPath;
}

async function generateSbom(opts) {
  const { checkoutDir, tools } = opts;
  const useMaven = await hasMavenReactor(checkoutDir, tools.paths.mvn);
  if (useMaven) {
    try {
      return await generateSbomWithMaven(checkoutDir);
    } catch (e) {
      // fall through to syft
    }
  }
  if (!tools.paths.syft) throw new Error('Syft not available and Maven SBOM generation failed or not applicable.');
  return await generateSbomWithSyft(checkoutDir, tools.paths.syft);
}

module.exports = { generateSbom };
