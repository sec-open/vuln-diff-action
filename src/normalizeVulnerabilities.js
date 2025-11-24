function normalizeVulnerabilities(rawVulns) {
    const deduplicated = deduplicateVulnerabilities(rawVulns);
    return deduplicated.map(vuln => ({
        id: vuln.id,
        severity: vuln.severity,
        description: vuln.description,
        package: {
            groupId: vuln.packageName,
            artifactId: vuln.packageName,
            version: vuln.version,
            purl: vuln.purl,
            component_ref: vuln.purl
        },
        fix: {
            state: vuln.fixVersion ? 'fixed' : 'not_fixed',
            versions: vuln.fixVersion ? [vuln.fixVersion] : []
        },
        urls: vuln.urls,
        paths: vuln.locations,
        cvss_max: vuln.cvssScore ? { score: vuln.cvssScore, vector: vuln.cvssVector } : null,
        match_key: vuln.matchKey
    }));
}
