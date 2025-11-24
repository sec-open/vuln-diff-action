// ...existing code...
if (projectType === 'javascript') {
    const rawVulnerabilities = await runAllScanners({ repoPath, sbomPath, projectType });
    const normalizedVulnerabilities = normalizeVulnerabilities(rawVulnerabilities);
    report.vulnerabilities.push(...normalizedVulnerabilities);
    updateSummary(report.summary, normalizedVulnerabilities);
}
// ...existing code...
