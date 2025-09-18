// src/report.js
// Build a comprehensive markdown report with:
// - Diff table
// - Severity groups
// - Dependency PATHS table (Depth0..DepthN)
// - Improved Mermaid graph (clustered by roots)
// Comments in English.

const fs = require("fs");

// Severity order
const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function shortSha(sha) { return (sha || "").substring(0, 12); }

// Group vulnerable libs by severity from Grype matches
function groupBySeverity(matches) {
  const map = new Map(ORDER.map(s => [s, new Set()]));
  for (const m of matches || []) {
    const sev = (m?.vulnerability?.severity || "UNKNOWN").toUpperCase();
    const a = m?.artifact || {};
    const key = `${a.name || "unknown"}:${a.version || "unknown"}`;
    if (!map.has(sev)) map.set(sev, new Set());
    map.get(sev).add(key);
  }
  return map;
}

// Build adjacency/parents from CycloneDX BOM (component ref graph)
function buildGraphFromBOM(bomJson) {
  const dependencies = bomJson?.dependencies || [];
  const components = bomJson?.components || [];

  // Map bom-ref/purl -> display label "name:version"
  const refToLabel = new Map();
  const labelToRef = new Map();
  const nameVer = (c) => `${c?.name || "unknown"}:${c?.version || "unknown"}`;

  for (const c of components) {
    const label = nameVer(c);
    const refs = new Set();
    if (c["bom-ref"]) refs.add(c["bom-ref"]);
    if (c.purl) refs.add(c.purl);
    // prefer bom-ref as canonical
    const canonical = c["bom-ref"] || c.purl || label;
    for (const r of refs) refToLabel.set(r, label);
    labelToRef.set(label, canonical);
  }

  // Build adjacency (parents -> children) and parents map (child -> parents)
  const adj = new Map();     // label -> Set(label)
  const parents = new Map(); // label -> Set(label)
  const ensure = (map, key) => { if (!map.has(key)) map.set(key, new Set()); return map.get(key); };

  // Ensure nodes for all components
  for (const c of components) {
    const l = nameVer(c);
    ensure(adj, l); ensure(parents, l);
  }

  for (const d of dependencies) {
    const parentLabel = refToLabel.get(d.ref) || d.ref || "unknown";
    ensure(adj, parentLabel); ensure(parents, parentLabel);
    for (const ch of (d.dependsOn || [])) {
      const childLabel = refToLabel.get(ch) || ch || "unknown";
      ensure(adj, childLabel); ensure(parents, childLabel);
      adj.get(parentLabel).add(childLabel);
      parents.get(childLabel).add(parentLabel);
    }
  }

  // Roots = nodes with no parents
  const roots = [];
  for (const [node, ps] of parents.entries()) {
    if (!ps || ps.size === 0) roots.push(node);
  }

  return { adj, parents, roots, refToLabel, labelToRef };
}

// Find paths from roots -> target node (limited)
function findPathsToTarget(target, parents, maxPaths = 5, maxDepth = 10) {
  const res = [];
  const stack = [[target]];
  const seen = new Set();

  while (stack.length && res.length < maxPaths) {
    const path = stack.pop(); // current path from target back to root
    const node = path[path.length - 1];

    // If root (no parents) or depth limit reached
    const ps = parents.get(node) || new Set();
    if (ps.size === 0 || path.length >= maxDepth) {
      // We want root -> ... -> target (reverse current path)
      res.push([...path].reverse());
      continue;
    }

    for (const p of ps) {
      const key = `${p}|${path.join(">")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push([...path, p]);
      if (res.length >= maxPaths) break;
    }
  }
  return res;
}

// Build PATHS table rows for all vulnerable nodes
function buildDependencyPathsTable(bomJson, grypeMatches, options = {}) {
  const { adj, parents, roots } = buildGraphFromBOM(bomJson);
  const vulnerable = new Set(
    (grypeMatches || []).map(m => `${m?.artifact?.name || "unknown"}:${m?.artifact?.version || "unknown"}`)
  );

  const maxPathsPerPkg = options.maxPathsPerPkg ?? 3;
  const maxDepth = options.maxDepth ?? 10;

  // Collect rows as arrays: [Pkg, Severity, Depth0, Depth1, ..., DepthN]
  const rows = [];
  for (const m of (grypeMatches || [])) {
    const sev = (m?.vulnerability?.severity || "UNKNOWN").toUpperCase();
    const pkg = `${m?.artifact?.name || "unknown"}:${m?.artifact?.version || "unknown"}`;
    if (!vulnerable.has(pkg)) continue;

    const paths = findPathsToTarget(pkg, parents, maxPathsPerPkg, maxDepth);
    if (paths.length === 0) {
      // No path (maybe it's itself a root)
      rows.push([pkg, sev, pkg]);
      continue;
    }
    for (const p of paths) {
      // p is [Root, ..., pkg]
      const row = [pkg, sev, ...p];
      rows.push(row);
    }
  }

  // Compute max depth to define columns
  let maxLen = 0;
  for (const r of rows) if (r.length > maxLen) maxLen = r.length;
  const depthCols = Array.from({ length: Math.max(3, maxLen - 2) }, (_, i) => `Depth${i}`);

  return { rows, depthCols };
}

function renderPathsMarkdownTable(paths) {
  const { rows, depthCols } = paths;
  const headers = ["Package", "Severity", ...depthCols];
  const sep = headers.map(() => "---");

  const lines = [];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${sep.join(" | ")} |`);

  for (const r of rows) {
    const pkg = r[0];
    const sev = r[1];
    const cells = r.slice(2);
    // Normalize to depthCols length (pad if shorter)
    const padded = [...cells, ...Array(Math.max(0, depthCols.length - cells.length)).fill("")].slice(0, depthCols.length);
    lines.push(`| \`${pkg}\` | **${sev}** | ${padded.map(x => (x ? `\`${x}\`` : "")).join(" | ")} |`);
  }
  return lines.join("\n");
}

// Improved Mermaid graph: cluster by roots and highlight vulnerable nodes
function buildMermaidGraphFromBOMImproved(bomJson, grypeMatches, graphMax = 150) {
  const { adj, parents, roots } = buildGraphFromBOM(bomJson);

  const vulnerable = new Set(
    (grypeMatches || []).map(m => `${m?.artifact?.name || "unknown"}:${m?.artifact?.version || "unknown"}`)
  );

  // Collect subgraph keep-set: vulnerable nodes and ancestors
  const keep = new Set();
  const queue = [];
  for (const v of vulnerable) {
    if (!keep.has(v)) { keep.add(v); queue.push(v); }
  }
  while (queue.length && keep.size < graphMax) {
    const cur = queue.shift();
    for (const p of (parents.get(cur) || [])) {
      if (!keep.has(p)) {
        keep.add(p);
        queue.push(p);
        if (keep.size >= graphMax) break;
      }
    }
  }

  // Assign an id to each kept node
  let idx = 0;
  const idMap = new Map();
  const idFor = (label) => { if (!idMap.has(label)) idMap.set(label, `n${idx++}`); return idMap.get(label); };

  // Group kept nodes by their nearest root (for subgraphs)
  const rootOf = new Map();
  function nearestRoot(node) {
    // BFS up to a root
    const visited = new Set();
    const q = [node];
    while (q.length) {
      const x = q.shift();
      if (visited.has(x)) continue;
      visited.add(x);
      const ps = parents.get(x) || new Set();
      if (ps.size === 0) return x;
      for (const p of ps) q.push(p);
    }
    return node;
  }
  for (const node of keep) {
    const r = nearestRoot(node);
    if (!rootOf.has(r)) rootOf.set(r, new Set());
    rootOf.get(r).add(node);
  }

  // Build Mermaid with subgraphs (one per root cluster)
  const lines = [];
  lines.push("graph LR");

  // Emit nodes & edges per cluster
  for (const [root, nodes] of rootOf.entries()) {
    const clusterId = idFor(`cluster_${root}`);
    lines.push(`subgraph "${root}"`);
    for (const n of nodes) {
      const nid = idFor(n);
      lines.push(`${nid}["${n}"]`);
    }
    // edges within this cluster
    for (const n of nodes) {
      const nid = idFor(n);
      for (const ch of (adj.get(n) || [])) {
        if (!nodes.has(ch)) continue;
        const cid = idFor(ch);
        lines.push(`${nid} --> ${cid}`);
      }
    }
    lines.push("end");
  }

  // Highlight vulnerable nodes
  for (const v of vulnerable) {
    if (keep.has(v)) {
      const vid = idFor(v);
      lines.push(`style ${vid} fill:#ffe0e0,stroke:#d33,stroke-width:2px`);
    }
  }

  return lines.join("\n");
}

function buildMarkdownReport({
  baseLabel, baseInput, baseSha, baseCommitLine,
  headLabel, headInput, headSha, headCommitLine,
  minSeverity, counts, table,
  headGrype, headBOM, graphMaxNodes
}) {
  const sevGroups = groupBySeverity(headGrype.matches || []);

  // Dependency PATH table (Depth0..DepthN)
  let pathsMd = "";
  try {
    const paths = buildDependencyPathsTable(headBOM, headGrype.matches || [], {
      maxPathsPerPkg: 3,
      maxDepth: 10
    });
    if (paths.rows.length > 0) {
      pathsMd = renderPathsMarkdownTable(paths);
    }
  } catch (e) {
    pathsMd = `> Dependency paths table generation failed: ${e.message}`;
  }

  // Mermaid graph (improved)
  let mermaid = "";
  try {
    if ((headBOM?.dependencies || []).length > 0) {
      mermaid = buildMermaidGraphFromBOMImproved(headBOM, headGrype.matches || [], graphMaxNodes);
    }
  } catch (e) {
    mermaid = `%% Graph generation failed: ${e.message}`;
  }

  const md = [];
  md.push("### Vulnerability Diff (Syft + Grype)\n");
  md.push(`- **Base**: \`${baseLabel}\` (_input:_ \`${baseInput}\`) → \`${shortSha(baseSha)}\``);
  md.push(`  - ${baseCommitLine}`);
  md.push(`- **Head**: \`${headLabel}\` (_input:_ \`${headInput}\`) → \`${shortSha(headSha)}\``);
  md.push(`  - ${headCommitLine}`);
  md.push(`- **Min severity**: \`${minSeverity}\``);
  md.push(`- **Counts**: NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}\n`);

  md.push("#### Diff Table");
  md.push(table);

  md.push("\n#### Vulnerable libraries in HEAD (grouped by severity)");
  for (const sev of ORDER) {
    const set = sevGroups.get(sev) || new Set();
    if (set.size === 0) continue;
    md.push(`- **${sev}** (${set.size})`);
    const list = Array.from(set).sort().slice(0, 200);
    for (const x of list) md.push(`  - \`${x}\``);
  }

  if (pathsMd) {
    md.push("\n#### Dependency paths (root → … → vulnerable)");
    md.push(pathsMd);
  }

  if (mermaid) {
    md.push("\n#### Dependency graph (HEAD)");
    md.push("```mermaid");
    md.push(mermaid);
    md.push("```");
  }

  return md.join("\n");
}

module.exports = { buildMarkdownReport };
