function parseScannerOutput(source, output) {
    const rawResults = JSON.parse(output);
    const vulnerabilities = [];

    if (source === 'npm-audit') {
        for (const [key, vuln] of Object.entries(rawResults.advisories || {})) {
            vulnerabilities.push({
                id: vuln.id,
                source,
                packageName: vuln.module_name,
                version: vuln.findings[0]?.version,
                severity: mapSeverity(vuln.severity),
                description: vuln.overview,
                urls: [vuln.url],
                fixVersion: vuln.fix_available ? vuln.fix_version : null,
                locations: vuln.findings.map(f => f.paths).flat(),
                matchKey: `${vuln.id}:${vuln.module_name}:${vuln.findings[0]?.version}`
            });
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
