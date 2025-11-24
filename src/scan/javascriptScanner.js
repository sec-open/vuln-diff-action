const { execSync } = require('child_process');
const { parseScannerOutput } = require('../utils/scannerUtils');

async function scanJavaScriptVulnerabilities(repoPath, sbomPath) {
    const vulnerabilities = [];

    // Instalar dependencias antes de ejecutar npm audit
    try {
        execSync('npm install', { cwd: repoPath });
    } catch (err) {
        console.error('npm install failed:', err);
        return vulnerabilities; // No continuar si las dependencias no están instaladas
    }

    // npm audit
    try {
        const npmAuditOutput = execSync('npm audit --json', { cwd: repoPath }).toString();
        vulnerabilities.push(...parseScannerOutput('npm-audit', npmAuditOutput));
    } catch (err) {
        console.error('npm audit failed:', err);
    }

    // Grype
    try {
        const grypeOutput = execSync(`grype sbom:${sbomPath} -o json`).toString();
        vulnerabilities.push(...parseScannerOutput('grype', grypeOutput));
    } catch (err) {
        console.error('Grype scan failed:', err);
    }

    // OSV-Scanner
    try {
        const osvOutput = execSync(`osv-scanner --sbom=${sbomPath} --format json`).toString();
        vulnerabilities.push(...parseScannerOutput('osv', osvOutput));
    } catch (err) {
        console.error('OSV-Scanner failed:', err);
    }

    // Trivy
    try {
        const trivyOutput = execSync(`trivy sbom --input ${sbomPath} --format json`).toString();
        vulnerabilities.push(...parseScannerOutput('trivy', trivyOutput));
    } catch (err) {
        console.error('Trivy scan failed:', err);
    }

    return vulnerabilities;
}

module.exports = { scanJavaScriptVulnerabilities };
