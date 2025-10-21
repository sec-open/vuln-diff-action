const { normalizeSeverity, worstSeverity, pickMaxCvss, ensureStringArray, uniqueByJSON } = require('./utils');

// Extracts prioritized vulnerability identifiers (prefers GHSA, then CVE, then fallback IDs).
function primaryIdFrom(match) {
  const ids = match?.vulnerability?.ids || [];
  let ghsa = null, cve = null;
  for (const id of ids) {
    const v = (id?.id || id)?.toString();
    if (!v) continue;
    if (v.startsWith('GHSA-')) ghsa = ghsa || v;
    else if (v.startsWith('CVE-')) cve = cve || v;
  }
  const rawId = match?.vulnerability?.id || match?.vulnerability?.dataSource || match?.vulnerability?.name;
  const id = ghsa || cve || rawId || 'UNKNOWN';
  return { id, ghsa: ghsa || null, cve: cve || null };
}

// Extracts fix information (state and fixed versions) from vulnerability object.
function extractFixInfo(vuln) {
  const fixedIns = vuln?.fix ?? vuln?.fixes ?? {};
  return {
    state: fixedIns?.state || null,
    versions: Array.isArray(fixedIns?.versions) ? fixedIns.versions : [],
  };
}

// Resolves package coordinates (purl, component reference, and GAV) using SBOM index resolution.
function resolvePackageInfo(artifact, sbomIndex) {
  let purl = artifact?.purl || artifact?.metadata?.purl || null;
  let component_ref = artifact?.metadata?.bomRef || artifact?.bomRef || artifact?.componentRef || null;

  const { comp, component_ref: resolvedRef, purl: resolvedPurl } =
    sbomIndex.resolveComponentByPurlOrRef({ purl, ref: component_ref });

  const finalRef = resolvedRef || component_ref || null;
  const finalPurl = resolvedPurl || purl || null;

  let gav;
  if (comp) {
    gav = sbomIndex.gavFromComponent(comp);
  } else {
    if (finalPurl && finalPurl.startsWith('pkg:maven/')) {
      const after = finalPurl.slice('pkg:maven/'.length);
      const atIdx = after.indexOf('@');
      const gavPart = atIdx >= 0 ? after.slice(0, atIdx) : after;
      const parts = gavPart.split('/');
      const version = atIdx >= 0 ? after.slice(atIdx + 1) : (artifact?.version || 'unknown');
      gav = { groupId: parts[0] || 'unknown', artifactId: parts.slice(1).join('/') || 'unknown', version: version || 'unknown' };
    } else {
      gav = {
        groupId: artifact?.group || artifact?.name || 'unknown',
        artifactId: artifact?.name || 'unknown',
        version: artifact?.version || 'unknown',
      };
    }
  }

  return {
    package: {
      groupId: gav.groupId,
      artifactId: gav.artifactId,
      version: gav.version,
      purl: finalPurl,
      component_ref: finalRef || finalPurl || null,
    },
    targetRef: finalRef || null,
  };
}

// Computes dependency paths (root-to-target) via SBOM index, honoring limit.
function computePaths(targetRef, sbomIndex, limitPaths) {
  if (!targetRef) return [];
  const paths = sbomIndex.computePathsToTarget(targetRef, limitPaths);
  return paths;
}

// Normalizes raw grype matches into consolidated occurrence entries keyed by match_key.
// Performs severity merging, CVSS tie-breaking, URL and path aggregation, and per-side summary.
function normalizeOneSide(grypeJson, sbomIndex, meta, gitInfo, { limitPaths = 5 } = {}) {
  const matches = Array.isArray(grypeJson?.matches) ? grypeJson.matches : [];
  const acc = new Map();

  for (const m of matches) {
    const { id, ghsa, cve } = primaryIdFrom(m);
    const severity = normalizeSeverity(m?.vulnerability?.severity);
    const cvss_max = pickMaxCvss(m?.vulnerability?.cvss) || null;
    const fix = extractFixInfo(m?.vulnerability);
    const urls = ensureStringArray(m?.vulnerability?.urls);
    const description = typeof m?.vulnerability?.description === 'string' ? m.vulnerability.description : undefined;

    const art = m?.artifact || m?.package || {};
    const pkgInfo = resolvePackageInfo(art, sbomIndex);
    const paths = computePaths(pkgInfo.targetRef, sbomIndex, limitPaths);

    const match_key = `${id}::${pkgInfo.package.groupId}:${pkgInfo.package.artifactId}:${pkgInfo.package.version}`;

    const entry = {
      id,
      ids: { ghsa, cve },
      severity,
      cvss_max,
      fix,
      urls,
      ...(description ? { description } : {}),
      package: pkgInfo.package,
      paths,
      match_key,
    };

    // Consolidate duplicates by match_key merging severity, CVSS, URLs, and paths.
    if (!acc.has(match_key)) {
      acc.set(match_key, entry);
    } else {
      const prev = acc.get(match_key);
      const sev = worstSeverity(prev.severity, severity);

      let cvssChosen = prev.cvss_max;
      if (sev === normalizeSeverity(prev.severity) && prev.cvss_max?.score !== undefined) {
        const prevScore = Number(prev.cvss_max.score);
        const curScore = Number(cvss_max?.score ?? -1);
        if (curScore > prevScore) cvssChosen = cvss_max;
      } else if (sev === severity) {
        if (!prev.cvss_max && cvss_max) cvssChosen = cvss_max;
      }

      const merged = {
        ...prev,
        severity: sev,
        cvss_max: cvssChosen || prev.cvss_max || null,
        urls: Array.from(new Set([...(prev.urls || []), ...urls])),
        paths: uniqueByJSON([...(prev.paths || []), ...paths], 5),
      };
      acc.set(match_key, merged);
    }
  }

  const vulnerabilities = [...acc.values()];

  // Build severity distribution summary.
  const by_severity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const v of vulnerabilities) {
    by_severity[normalizeSeverity(v.severity)]++;
  }

  // Final normalized side document.
  const out = {
    schema_version: '2.0.0',
    generated_at: new Date().toISOString(),
    inputs: meta?.inputs || null,
    repo: meta?.repo || null,
    tools: meta?.tools || null,
    git: gitInfo || null,
    sbom: { format: 'cyclonedx-json' },
    summary: {
      total: vulnerabilities.length,
      by_severity,
    },
    vulnerabilities,
  };
  return out;
}

module.exports = { normalizeOneSide };
