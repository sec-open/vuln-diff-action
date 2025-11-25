const { execCmd } = require('./exec');
const { writeFile } = require('./fsx');

// Ejecuta `npm audit` y transforma los resultados al formato de Grype.
async function scanWithNpmAudit(cwd, outputPath) {
  try {
    // Ejecuta `npm audit --json`
    const { stdout } = await execCmd('npm', ['audit', '--json'], { cwd });
    const auditResults = JSON.parse(stdout);

    // Transforma los resultados al formato de Grype
    const vulnerabilities = [];
    if (auditResults.vulnerabilities) {
      for (const [packageName, vuln] of Object.entries(auditResults.vulnerabilities)) {
        vulnerabilities.push({
          id: vuln.id || vuln.advisory,
          source: 'npm-audit',
          package: {
            name: packageName,
            version: vuln.version,
          },
          severity: vuln.severity.toUpperCase(),
          description: vuln.title || vuln.overview,
          urls: vuln.url ? [vuln.url] : [],
          fix: vuln.fixAvailable ? { versions: [vuln.fixAvailable.version] } : null,
        });
      }
    }

    // Guarda los resultados en el archivo de salida
    await writeFile(outputPath, JSON.stringify({ vulnerabilities }, null, 2));
  } catch (err) {
    throw new Error(`npm audit failed: ${err.message}`);
  }
}

module.exports = { scanWithNpmAudit };

