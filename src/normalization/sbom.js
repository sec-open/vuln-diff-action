const { uniqueByJSON } = require('./utils');

// Builds an index over CycloneDX components and dependency graph.
// Provides resolution by purl or ref, path computation to roots, and GAV extraction.
function buildSbomIndex(bom) {
  const components = new Map();
  const byRef = new Map();
  const byPurl = new Map();
  const idForNode = new Map();

  // Index components by bom-ref and purl.
  const list = Array.isArray(bom?.components) ? bom.components : [];
  for (const c of list) {
    const keyRef = c['bom-ref'] || c.bomRef || c.ref || null;
    const keyPurl = c.purl || null;
    if (keyRef) byRef.set(keyRef, c);
    if (keyPurl) byPurl.set(keyPurl, c);
  }

  // Build dependency graph edges (parent -> children) and reverse edges (child -> parents).
  const depEntries = Array.isArray(bom?.dependencies) ? bom.dependencies : [];
  const childrenByRef = new Map();
  const parentByRef = new Map();

  for (const d of depEntries) {
    const parentRef = d.ref || d['bom-ref'] || d.bomRef;
    if (!parentRef) continue;
    const arr = Array.isArray(d.dependsOn) ? d.dependsOn : [];
    for (const ch of arr) {
      if (!childrenByRef.has(parentRef)) childrenByRef.set(parentRef, new Set());
      childrenByRef.get(parentRef).add(ch);
      if (!parentByRef.has(ch)) parentByRef.set(ch, new Set());
      parentByRef.get(ch).add(parentRef);
    }
  }

  // Derive root components (never appear as a child).
  const allRefs = new Set([...byRef.keys()]);
  const childRefs = new Set([...parentByRef.keys()]);
  const rootRefs = [...allRefs].filter(r => !childRefs.has(r));

  // Produces a human-readable label for a component (tries Maven GAV, falls back to name:version).
  function labelForComponent(c) {
    const name = c?.name || '';
    const version = c?.version || '';
    let groupId, artifactId;
    if (c?.purl?.startsWith('pkg:maven/')) {
      const after = c.purl.slice('pkg:maven/'.length);
      const atIdx = after.indexOf('@');
      const gavPart = atIdx >= 0 ? after.slice(0, atIdx) : after;
      const parts = gavPart.split('/');
      if (parts.length >= 2) {
        groupId = parts[0];
        artifactId = parts.slice(1).join('/');
      }
    } else if (c?.group && c?.name) {
      groupId = c.group;
      artifactId = c.name;
    }
    if (groupId && artifactId) {
      return `${groupId}:${artifactId}:${version || ''}`;
    }
    return `${name}:${version || ''}`;
  }

  for (const [ref, comp] of byRef.entries()) {
    idForNode.set(ref, labelForComponent(comp));
  }

  // Resolves a component by purl or bom-ref returning component object and canonical reference.
  function resolveComponentByPurlOrRef({ purl, ref }) {
    let comp = null;
    let component_ref = null;
    if (purl && byPurl.has(purl)) {
      comp = byPurl.get(purl);
      component_ref = comp['bom-ref'] || comp.bomRef || ref || null;
    } else if (ref && byRef.has(ref)) {
      comp = byRef.get(ref);
      component_ref = ref;
    }
    if (!comp) return { comp: null, component_ref: null };
    const p = comp.purl || purl || null;
    return { comp, component_ref: component_ref || comp['bom-ref'] || comp.bomRef || null, purl: p };
  }

  // Computes root-to-target paths (each path is an ordered array of labels) using DFS backtracking, limited by count.
  function computePathsToTarget(targetRef, limit = 5) {
    if (!targetRef) return [];
    const paths = [];

    if (!parentByRef.has(targetRef) || parentByRef.get(targetRef).size === 0) {
      const lbl = idForNode.get(targetRef) || targetRef;
      return [[lbl]];
    }

    function dfs(currentRef, acc) {
      if (paths.length >= limit) return;
      const parents = parentByRef.get(currentRef);
      if (!parents || parents.size === 0 || rootRefs.includes(currentRef)) {
        const pathLabels = acc.slice().reverse().map(r => idForNode.get(r) || r);
        paths.push(pathLabels);
        return;
      }
      for (const p of parents) {
        acc.push(p);
        dfs(p, acc);
        acc.pop();
        if (paths.length >= limit) return;
      }
    }
    dfs(targetRef, [targetRef]);
    return uniqueByJSON(paths, limit);
  }

  // Derives Maven GAV coordinates from a component (purl or group/name fields).
  function gavFromComponent(comp) {
    let groupId, artifactId, version;
    version = comp?.version || null;

    if (comp?.purl?.startsWith('pkg:maven/')) {
      const after = comp.purl.slice('pkg:maven/'.length);
      const atIdx = after.indexOf('@');
      const gavPart = atIdx >= 0 ? after.slice(0, atIdx) : after;
      const parts = gavPart.split('/');
      if (parts.length >= 2) {
        groupId = parts[0];
        artifactId = parts.slice(1).join('/');
      }
    }
    if (!groupId && comp?.group && comp?.name) {
      groupId = comp.group;
      artifactId = comp.name;
    }
    groupId = groupId || comp?.publisher || 'unknown';
    artifactId = artifactId || comp?.name || 'unknown';
    version = version || 'unknown';
    return { groupId, artifactId, version };
  }

  return {
    byRef,
    byPurl,
    resolveComponentByPurlOrRef,
    computePathsToTarget,
    gavFromComponent,
  };
}

// Extrae un inventario simplificado de componentes del SBOM para comparación entre ramas.
// Devuelve array de objetos: { key, groupId, artifactId, version, purl }
function extractComponentInventory(bom) {
  const out = [];
  const list = Array.isArray(bom?.components) ? bom.components : [];
  for (const c of list) {
    const purl = c.purl || null;
    let groupId, artifactId, version;
    version = c.version || 'unknown';
    if (purl && purl.startsWith('pkg:maven/')) {
      const after = purl.slice('pkg:maven/'.length);
      const atIdx = after.indexOf('@');
      const gavPart = atIdx >= 0 ? after.slice(0, atIdx) : after;
      const parts = gavPart.split('/');
      if (parts.length >= 2) {
        groupId = parts[0];
        artifactId = parts.slice(1).join('/');
      }
      if (atIdx >= 0) version = after.slice(atIdx + 1) || version;
    }
    if (!groupId && c.group && c.name) {
      groupId = c.group;
      artifactId = c.name;
    }
    groupId = groupId || c.publisher || c.author || 'unknown';
    artifactId = artifactId || c.name || 'unknown';
    const key = `${groupId}::${artifactId}`;
    out.push({ key, groupId, artifactId, version, purl });
  }
  return out;
}

module.exports = { buildSbomIndex, extractComponentInventory };

