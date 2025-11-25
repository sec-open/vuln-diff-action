function parseScannerOutput(source, output) {
    const rawResults = JSON.parse(output);
    const vulnerabilities = [];

    if (source === 'npm-audit') {
        console.log('Parsing npm audit output...');
        if (rawResults.vulnerabilities) {
            for (const [packageName, vuln] of Object.entries(rawResults.vulnerabilities)) {
                console.log(`Processing vulnerability for package: ${packageName}`);
                vulnerabilities.push({
                    id: vuln.id || vuln.advisory,
                    source,
                    packageName,
                    version: vuln.version,
                    severity: mapSeverity(vuln.severity),
                    description: vuln.title || vuln.overview,
                    urls: vuln.url ? [vuln.url] : [],
                    fixVersion: vuln.fixAvailable ? vuln.fixAvailable.version : null,
                    locations: vuln.nodes || [],
                    matchKey: `${vuln.id}:${packageName}:${vuln.version}`
                });
            }
        } else {
            console.log('No vulnerabilities found in npm audit output.');
        }
    }

    return vulnerabilities;
}

function mapSeverity(severity) {
    switch (severity.toLowerCase()) {
        case 'critical': return 'CRITICAL';
        case 'high': return 'HIGH';
        case 'medium': return 'MEDIUM';
        case 'low': return 'LOW';
        default: return 'UNKNOWN';
    }
}

module.exports = { parseScannerOutput };
