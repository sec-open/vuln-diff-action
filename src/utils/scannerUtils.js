const fs = require('fs');

/**
 * Parse raw scanner output (string) into a normalized array of vulnerability-like objects.
 * This is a lightweight, best-effort parser for:
 *   - npm audit        (scanner = "npm-audit")
 *   - Grype SBOM JSON  (scanner = "grype")
 *   - OSV-Scanner      (scanner = "osv")
 *   - Trivy SBOM JSON  (scanner = "trivy")
 *
 * For now, these objects are mainly used in Phase 1 (JavaScript pipeline)
 * and will later be adapted/merged into the normalization model.
 */
function parseScannerOutput(scanner, rawOutput) {
  if (!rawOutput || typeof rawOutput !== 'string') {
    return [];
  }

  let json;
  try {
    json = JSON.parse(rawOutput);
  } catch (e) {
    console.error(`[scannerUtils] Failed to parse JSON from ${scanner}:`, e.message || e);
    return [];
  }

  switch (scanner) {
    case 'npm-audit':
      return parseNpmAudit(json);
    case 'grype':
      return parseGrype(json);
    case 'osv':
      return parseOsv(json);
    case 'trivy':
      return parseTrivy(json);
    default:
      console.warn(`[scannerUtils] Unknown scanner "${scanner}", returning empty list.`);
      return [];
  }
}

// ---------- npm audit ----------

function parseNpmAudit(json) {
  const results = [];

  // Newer npm audit format (npm v7+): json.vulnerabilities is an object keyed by package
  if (json && json.vulnerabilities && typeof json.vulnerabilities === 'object') {
    for (const [pkgName, vuln] of Object.entries(json.vulnerabilities)) {
      // vuln example fields: severity, via, range, nodes, fixAvailable, ...
      const viaArray = Array.isArray(vuln.via) ? vuln.via : [];
      const firstVia = viaArray[0] || {};
      const id = firstVia.source || firstVia.name || `npm-audit:${pkgName}`;
      const description = firstVia.title || firstVia.url || '';

      results.push({
        id,
        source: 'npm-audit',
        packageName: pkgName,
        version: vuln.version || null,
        ecosystem: 'npm',
        severity: (vuln.severity || 'unknown').toUpperCase(),
        description,
        urls: viaArray
          .map(v => v.url)
          .filter(Boolean),
        raw: vuln,
      });
    }
    return results;
  }

  // Older format with "advisories" (npm v6)
  if (json && json.advisories && typeof json.advisories === 'object') {
    for (const adv of Object.values(json.advisories)) {
      results.push({
        id: adv.id || adv.module_name || `npm-audit:${adv.module_name}`,
        source: 'npm-audit',
        packageName: adv.module_name || null,
        version: adv.findings?.[0]?.version || null,
        ecosystem: 'npm',
        severity: (adv.severity || 'unknown').toUpperCase(),
        description: adv.title || adv.overview || '',
        urls: (adv.references || '')
          .split(' ')
          .filter(u => u && u.startsWith('http')),
        raw: adv,
      });
    }
  }

  return results;
}

// ---------- Grype SBOM scanner ----------

function parseGrype(json) {
  const results = [];
  if (!json || !Array.isArray(json.matches)) return results;

  for (const match of json.matches) {
    const vuln = match.vulnerability || {};
    const art = match.artifact || {};
    const locations = Array.isArray(art.locations)
      ? art.locations.map(l => l.path).filter(Boolean)
      : [];

    // Try to get a CVSS with highest score
    let cvssScore = null;
    let cvssVector = null;
    if (Array.isArray(vuln.cvss) && vuln.cvss.length > 0) {
      const sorted = [...vuln.cvss].sort((a, b) => (b.metrics?.baseScore || 0) - (a.metrics?.baseScore || 0));
      const top = sorted[0];
      cvssScore = top.metrics?.baseScore || null;
      cvssVector = top.vector || null;
    }

    results.push({
      id: vuln.id || `grype:${art.name || ''}:${art.version || ''}`,
      source: 'grype',
      packageName: art.name || null,
      version: art.version || null,
      ecosystem: art.type || null, // e.g. "npm", "java-archive", etc.
      severity: (vuln.severity || 'unknown').toUpperCase(),
      description: vuln.description || '',
      urls: Array.isArray(vuln.dataSource) ? vuln.dataSource : vuln.links || [],
      cvssScore,
      cvssVector,
      locations,
      raw: match,
    });
  }

  return results;
}

// ---------- OSV-Scanner ----------

function parseOsv(json) {
  const results = [];

  // OSV-Scanner can output in different shapes; one common structure has "results"
  if (Array.isArray(json.results)) {
    for (const res of json.results) {
      const packages = res.packages || [];
      const vulns = res.vulnerabilities || [];

      for (const v of vulns) {
        // Try to associate with the first package when present
        const pkg = (v.affected && v.affected[0] && v.affected[0].package) || packages[0] || {};
        const id = v.id || `osv:${pkg.name || ''}`;

        results.push({
          id,
          source: 'osv',
          packageName: pkg.name || null,
          version: null, // OSV gives ranges; version resolution is left for later if needed
          ecosystem: pkg.ecosystem || null,
          severity: extractOsvSeverity(v),
          description: v.summary || v.details || '',
          urls: Array.isArray(v.references)
            ? v.references.map(r => r.url).filter(Boolean)
            : [],
          raw: v,
        });
      }
    }
  }

  // Some OSV outputs use "vulns" at the top level
  if (Array.isArray(json.vulns)) {
    for (const v of json.vulns) {
      results.push({
        id: v.id || `osv:${v.package?.name || ''}`,
        source: 'osv',
        packageName: v.package?.name || null,
        version: null,
        ecosystem: v.package?.ecosystem || null,
        severity: extractOsvSeverity(v),
        description: v.summary || v.details || '',
        urls: Array.isArray(v.references)
          ? v.references.map(r => r.url).filter(Boolean)
          : [],
        raw: v,
      });
    }
  }

  return results;
}

function extractOsvSeverity(v) {
  if (Array.isArray(v.severity) && v.severity.length > 0) {
    // OSV severity entries often have "type" (e.g. "CVSS_V3") and "score"
    const sev = v.severity[0];
    if (typeof sev.score === 'string') {
      // score can be like "CRITICAL" or "7.5"
      const upper = sev.score.toUpperCase();
      if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(upper)) return upper;
    }
  }
  return 'UNKNOWN';
}

// ---------- Trivy SBOM scanner ----------

function parseTrivy(json) {
  const results = [];
  if (!json || !Array.isArray(json.Results)) return results;

  for (const r of json.Results) {
    const vulns = r.Vulnerabilities || [];
    for (const v of vulns) {
      results.push({
        id: v.VulnerabilityID || `trivy:${v.PkgName || ''}:${v.InstalledVersion || ''}`,
        source: 'trivy',
        packageName: v.PkgName || null,
        version: v.InstalledVersion || null,
        ecosystem: r.Type || null, // e.g., "npm", "gomod", "os-pkgs"
        severity: (v.Severity || 'unknown').toUpperCase(),
        description: v.Title || v.Description || '',
        urls: Array.isArray(v.References) ? v.References : [],
        cvssScore: v.CVSS?.nvd?.V3Score || null,
        cvssVector: v.CVSS?.nvd?.Vectors || null,
        locations: [r.Target].filter(Boolean),
        raw: v,
      });
    }
  }

  return results;
}

module.exports = {
  parseScannerOutput,
};
