const { execSync } = require('child_process');
const { parseScannerOutput } = require('../utils/scannerUtils');

async function scanJavaScriptVulnerabilities(repoPath, sbomPath) {
    const vulnerabilities = [];

    // Instalar dependencias antes de ejecutar npm audit
    try {
        console.log('Installing dependencies...');
        execSync('npm install', { cwd: repoPath });
        console.log('Dependencies installed successfully.');
    } catch (err) {
        console.error('npm install failed:', err);
        return vulnerabilities; // No continuar si las dependencias no están instaladas
    }

    // npm audit
    try {
        console.log('Running npm audit...');
        const npmAuditOutput = execSync('npm audit --json', { cwd: repoPath }).toString();
        console.log('npm audit output:', npmAuditOutput);
        vulnerabilities.push(...parseScannerOutput('npm-audit', npmAuditOutput));
    } catch (err) {
        console.error('npm audit failed:', err);
    }

    // Grype
    try {
        console.log('Running Grype...');
        const grypeOutput = execSync(`grype sbom:${sbomPath} -o json`).toString();
        vulnerabilities.push(...parseScannerOutput('grype', grypeOutput));
    } catch (err) {
        console.error('Grype scan failed:', err);
    }

    // OSV-Scanner
    try {
        console.log('Running OSV-Scanner...');
        const osvOutput = execSync(`osv-scanner --sbom=${sbomPath} --format json`).toString();
        vulnerabilities.push(...parseScannerOutput('osv', osvOutput));
    } catch (err) {
        console.error('OSV-Scanner failed:', err);
    }

    // Trivy
    try {
        console.log('Running Trivy...');
        const trivyOutput = execSync(`trivy sbom --input ${sbomPath} --format json`).toString();
        vulnerabilities.push(...parseScannerOutput('trivy', trivyOutput));
    } catch (err) {
        console.error('Trivy scan failed:', err);
    }

    console.log('Total vulnerabilities found:', vulnerabilities.length);
    return vulnerabilities;
}

module.exports = { scanJavaScriptVulnerabilities };
