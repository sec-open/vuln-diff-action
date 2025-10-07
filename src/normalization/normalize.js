// Normalize grype matches into per-occurrence model keyed by <vuln_id>::<GAV>. :contentReference[oaicite:3]{index=3}
const { normalizeSeverity, worstSeverity, pickMaxCvss, ensureStringArray, uniqueByJSON } = require('./utils');

function primaryIdFrom(match) {
  // Order: GHSA > CVE > raw id. :contentReference[oaicite:4]{index=4}
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

function extractFixInfo(vuln) {
  const fixedIns = vuln?.fix ?? vuln?.fixes ?? {};
  // grype uses { state, versions: [] }
  return {
    state: fixedIns?.state || null,
    versions: Array.isArray(fixedIns?.versions) ? fixedIns.versions : [],
  };
}

function resolvePackageInfo(artifact, sbomIndex) {
  // Try grype artifact purl/componentRef first
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
    // fallback from purl itself
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

function computePaths(targetRef, sbomIndex, limitPaths) {
  if (!targetRef) return [];
  const paths = sbomIndex.computePathsToTarget(targetRef, limitPaths);
  return paths;
}

function normalizeOneSide(grypeJson, sbomIndex, meta, gitInfo, { limitPaths = 5 } = {}) {
  // Build occurrences map by match_key (consolidated). :contentReference[oaicite:5]{index=5}
  const matches = Array.isArray(grypeJson?.matches) ? grypeJson.matches : [];
  const acc = new Map();

  for (const m of matches) {
    const { id, ghsa, cve } = primaryIdFrom(m);
    const severity = normalizeSeverity(m?.vulnerability?.severity);

    const cvss_max = pickMaxCvss(m?.vulnerability?.cvss) || null;

    const fix = extractFixInfo(m?.vulnerability);

    const urls = ensureStringArray(m?.vulnerability?.urls);

    const description = typeof m?.vulnerability?.description === 'string' ? m.vulnerability.description : undefined;

    // artifact / package info
    const art = m?.artifact || m?.package || {};
    const pkgInfo = resolvePackageInfo(art, sbomIndex);

    // paths from CycloneDX deps
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

    // consolidate
    if (!acc.has(match_key)) {
      acc.set(match_key, entry);
    } else {
      const prev = acc.get(match_key);
      // 1) worst severity
      const sev = worstSeverity(prev.severity, severity);
      // 2) tie-break by higher cvss score if severities equivalent after normalization
      let cvssChosen = prev.cvss_max;
      if (sev === normalizeSeverity(prev.severity) && prev.cvss_max?.score !== undefined) {
        const prevScore = Number(prev.cvss_max.score);
        const curScore = Number(cvss_max?.score ?? -1);
        if (curScore > prevScore) cvssChosen = cvss_max;
      } else if (sev === severity) {
        // if severity comes from current but prev had none
        if (!prev.cvss_max && cvss_max) cvssChosen = cvss_max;
      }

      const merged = {
        ...prev,
        severity: sev,
        cvss_max: cvssChosen || prev.cvss_max || null,
        // merge urls, versions, paths
        urls: Array.from(new Set([...(prev.urls || []), ...urls])),
        paths: uniqueByJSON([...(prev.paths || []), ...paths], 5),
      };
      acc.set(match_key, merged);
    }
  }

  // Build final array
  const vulnerabilities = [...acc.values()];

  // Summary. :contentReference[oaicite:6]{index=6}
  const by_severity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const v of vulnerabilities) {
    by_severity[normalizeSeverity(v.severity)]++;
  }

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
