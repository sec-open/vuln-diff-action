// CycloneDX indexer + path finder from roots to a target component. :contentReference[oaicite:2]{index=2}
const { uniqueByJSON } = require('./utils');

function buildSbomIndex(bom) {
  const components = new Map(); // key: bom-ref or purl
  const byRef = new Map(); // bom-ref -> component
  const byPurl = new Map(); // purl -> component
  const idForNode = new Map(); // nodeId -> label "artifact:version" or GAV

  const list = Array.isArray(bom?.components) ? bom.components : [];
  for (const c of list) {
    const keyRef = c['bom-ref'] || c.bomRef || c.ref || null;
    const keyPurl = c.purl || null;
    if (keyRef) byRef.set(keyRef, c);
    if (keyPurl) byPurl.set(keyPurl, c);
  }

  // Build dependency graph (parent -> children by bom-ref). CycloneDX uses dependencies[].ref + dependsOn[].
  const depEntries = Array.isArray(bom?.dependencies) ? bom.dependencies : [];
  const childrenByRef = new Map(); // parentRef -> Set(childRef)
  const parentByRef = new Map();   // childRef -> Set(parentRef)

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

  // Identify roots: components which never appear as a child
  const allRefs = new Set([...byRef.keys()]);
  const childRefs = new Set([...parentByRef.keys()]);
  const rootRefs = [...allRefs].filter(r => !childRefs.has(r));

  // Node label helper (for paths)
  function labelForComponent(c) {
    const name = c?.name || '';
    const version = c?.version || '';
    // Try Maven GAV where possible
    let groupId, artifactId;
    // CycloneDX maven extension: group can be in c.group, artifact in c.name
    if (c?.purl?.startsWith('pkg:maven/')) {
      const after = c.purl.slice('pkg:maven/'.length);
      const atIdx = after.indexOf('@');
      const gavPart = atIdx >= 0 ? after.slice(0, atIdx) : after;
      const parts = gavPart.split('/');
      if (parts.length >= 2) {
        groupId = parts[0];
        artifactId = parts.slice(1).join('/'); // in case artifact includes slashes
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

  // BFS backtracking from target to roots via parentByRef; then reverse path to get root->...->target
  function computePathsToTarget(targetRef, limit = 5) {
    if (!targetRef) return [];
    const paths = [];

    // If no parent edges, consider standalone: path = [targetLabel]
    if (!parentByRef.has(targetRef) || parentByRef.get(targetRef).size === 0) {
      const lbl = idForNode.get(targetRef) || targetRef;
      return [[lbl]];
    }

    // We do a bounded DFS from target to roots (parents), collecting up to limit paths
    function dfs(currentRef, acc) {
      if (paths.length >= limit) return;
      const parents = parentByRef.get(currentRef);
      if (!parents || parents.size === 0 || rootRefs.includes(currentRef)) {
        // hit a root or no parents
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
    // Ensure uniqueness and cap
    return uniqueByJSON(paths, limit);
  }

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
    // Fallbacks
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

module.exports = { buildSbomIndex };
