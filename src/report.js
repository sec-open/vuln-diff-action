// report.js
// Build a comprehensive markdown report and a vulnerability dependency graph (Mermaid)

const fs = require("fs");
const path = require("path");

// Severity order (desc)
const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function shortSha(sha) { return (sha || "").substring(0, 12); }

function groupBySeverity(matches) {
  // returns { severity -> Set of "name:version" }
  const map = new Map(ORDER.map(s => [s, new Set()]));
  for (const m of matches || []) {
    const sev = (m?.vulnerability?.severity || "UNKNOWN").toUpperCase();
    const pkg = m?.artifact || {};
    const key = `${pkg.name || "unknown"}:${pkg.version || "unknown"}`;
    if (!map.has(sev)) map.set(sev, new Set());
    map.get(sev).add(key);
  }
  return map;
}

/**
 * Build a filtered dependency graph (Mermaid) from CycloneDX BOM + Grype matches
 * We keep only vulnerable nodes + their parents up to roots to show transitivity.
 * Limit total nodes with graphMax to avoid huge diagrams.
 */
function buildMermaidGraphFromBOM(bomJson, grypeMatches, title, graphMax = 150) {
  const compByPurlOrNameVer = new Map(); // key: name:version (best effort for Maven)
  const nameVer = (c) => `${c?.name || "unknown"}:${c?.version || "unknown"}`;

  for (const c of (bomJson.components || [])) {
    compByPurlOrNameVer.set(nameVer(c), c);
  }

  // Build adjacency from BOM dependencies (componentRef -> [dependsOnRefs])
  // We match by "name:version" where possible (purl could be available too).
  const depsSection = bomJson.dependencies || [];
  const adj = new Map(); // node -> Set(children)
  const parents = new Map(); // child -> Set(parents)

  function ensure(map, key) { if (!map.has(key)) map.set(key, new Set()); return map.get(key); }

  // Helper to map "ref" to name:version if possible (CycloneDX refs often match components' bom-ref; fallback to ref)
  const refToLabel = new Map();
  for (const c of (bomJson.components || [])) {
    const label = nameVer(c);
    if (c["bom-ref"]) refToLabel.set(c["bom-ref"], label);
    if (c.purl) refToLabel.set(c.purl, label);
  }

  for (const d of depsSection) {
    const parentRef = refToLabel.get(d.ref) || d.ref;
    const children = d.dependsOn || [];
    for (const ch of children) {
      const childRef = refToLabel.get(ch) || ch;
      ensure(adj, parentRef).add(childRef);
      ensure(parents, childRef).add(parentRef);
      ensure(adj, childRef); // ensure node exists
      ensure(parents, parentRef);
    }
  }

  // Vulnerable nodes from grype (HEAD)
  const vulnerable = new Set();
  for (const m of grypeMatches || []) {
    const a = m?.artifact || {};
    vulnerable.add(`${a.name || "unknown"}:${a.version || "unknown"}`);
  }

  // Collect subgraph: vulnerable nodes and all ancestors up to roots
  const keep = new Set();
  const queue = [];
  for (const v of vulnerable) {
    if (!keep.has(v)) { keep.add(v); queue.push(v); }
    // also ensure node present
    ensure(adj, v);
    ensure(parents, v);
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

  // Build Mermaid graph
  let lines = [];
  lines.push("%% Mermaid dependency graph (vulnerable nodes highlighted)");
  lines.push("graph LR");
  // Styling: highlight vulnerable nodes
  const styleLines = [];
  let idx = 0;
  const idMap = new Map(); // label -> mermaid id
  function idFor(label) {
    if (!idMap.has(label)) idMap.set(label, `n${idx++}`);
    return idMap.get(label);
  }

  for (const [parent, children] of adj) {
    if (!keep.has(parent)) continue;
    const pid = idFor(parent);
    lines.push(`${pid}["${parent}"]`);
    for (const ch of children) {
      if (!keep.has(ch)) continue;
      const cid = idFor(ch);
      lines.push(`${pid} --> ${cid}`);
    }
  }

  for (const v of vulnerable) {
    if (keep.has(v)) {
      const vid = idFor(v);
      styleLines.push(`style ${vid} fill:#ffe0e0,stroke:#d33,stroke-width:2px`);
    }
  }

  const header = title ? `%% ${title}` : "";
  const mermaid = [header, ...lines, ...styleLines].join("\n");
  return mermaid;
}

function buildMarkdownReport({
  baseLabel, baseInput, baseSha, baseCommitLine,
  headLabel, headInput, headSha, headCommitLine,
  minSeverity, counts, table,
  headGrype, headBOM, graphMaxNodes
}) {
  const sevGroups = groupBySeverity(headGrype.matches || []);
  const maxSev = ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"].find(s => (sevGroups.get(s) || new Set()).size > 0) || "UNKNOWN";

  // Mermaid graph (only if BOM has dependencies)
  let mermaid = "";
  try {
    if ((headBOM?.dependencies || []).length > 0) {
      mermaid = buildMermaidGraphFromBOM(headBOM, headGrype.matches || [], "HEAD dependency graph (vulnerable nodes highlighted)", graphMaxNodes);
    }
  } catch (e) {
    mermaid = `> Graph generation failed: ${e.message}`;
  }

  const md = [];
  md.push("### Vulnerability Diff (Syft + Grype)\n");
  md.push(`- **Base**: \`${baseLabel}\` (_input:_ \`${baseInput}\`) → \`${shortSha(baseSha)}\``);
  md.push(`  - ${baseCommitLine}`);
  md.push(`- **Head**: \`${headLabel}\` (_input:_ \`${headInput}\`) → \`${shortSha(headSha)}\``);
  md.push(`  - ${headCommitLine}`);
  md.push(`- **Min severity**: \`${minSeverity}\``);
  md.push(`- **Counts**: NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}`);
  md.push("");
  md.push("#### Diff Table");
  md.push(table);
  md.push("");
  md.push("#### Vulnerable libraries in HEAD (grouped by severity)");
  for (const sev of ORDER) {
    const set = sevGroups.get(sev) || new Set();
    if (set.size === 0) continue;
    md.push(`- **${sev}** (${set.size})`);
    // List limited to avoid crazy long reports
    const list = Array.from(set).sort().slice(0, 200);
    for (const x of list) md.push(`  - \`${x}\``);
  }
  if (mermaid) {
    md.push("");
    md.push("#### Dependency graph (HEAD)");
    md.push("```mermaid");
    md.push(mermaid);
    md.push("```");
  }
  return md.join("\n");
}

module.exports = { buildMarkdownReport };
