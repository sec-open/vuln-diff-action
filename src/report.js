// src/report.js
// Build a comprehensive markdown report.

const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function shortSha(sha) { return (sha || "").substring(0, 12); }

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

function buildGraphFromBOM(bomJson) {
  const dependencies = bomJson?.dependencies || [];
  const components = bomJson?.components || [];

  const refToLabel = new Map();
  const nameVer = (c) => `${c?.name || "unknown"}:${c?.version || "unknown"}`;
  for (const c of components) {
    const label = nameVer(c);
    if (c["bom-ref"]) refToLabel.set(c["bom-ref"], label);
    if (c.purl) refToLabel.set(c.purl, label);
  }

  const adj = new Map();
  const parents = new Map();
  const ensure = (map, key) => { if (!map.has(key)) map.set(key, new Set()); return map.get(key); };

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

  // Ensure nodes for orphans
  for (const [p, cs] of adj) { ensure(parents, p); for (const c of cs) ensure(adj, c); }

  // Roots
  const roots = [];
  for (const [node, ps] of parents.entries()) if (!ps || ps.size === 0) roots.push(node);

  return { adj, parents, roots };
}

function findPathsToTarget(target, parents, maxPaths = 5, maxDepth = 10) {
  const res = [];
  const stack = [[target]];
  const seen = new Set();

  while (stack.length && res.length < maxPaths) {
    const path = stack.pop();
    const node = path[path.length - 1];
    const ps = parents.get(node) || new Set();
    if (ps.size === 0 || path.length >= maxDepth) {
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

function buildDependencyPathsTable(bomJson, grypeMatches, options = {}) {
  const { parents } = buildGraphFromBOM(bomJson);

  const vulnerable = new Set(
    (grypeMatches || []).map(m => `${m?.artifact?.name || "unknown"}:${m?.artifact?.version || "unknown"}`)
  );

  const maxPathsPerPkg = options.maxPathsPerPkg ?? 3;
  const maxDepth = options.maxDepth ?? 10;

  const rows = [];
  for (const m of (grypeMatches || [])) {
    const sev = (m?.vulnerability?.severity || "UNKNOWN").toUpperCase();
    const pkg = `${m?.artifact?.name || "unknown"}:${m?.artifact?.version || "unknown"}`;
    if (!vulnerable.has(pkg)) continue;

    const paths = findPathsToTarget(pkg, parents, maxPathsPerPkg, maxDepth);
    if (paths.length === 0) {
      rows.push([pkg, sev, pkg]);
      continue;
    }
    for (const p of paths) rows.push([pkg, sev, ...p]);
  }

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
    const padded = [...cells, ...Array(Math.max(0, depthCols.length - cells.length)).fill("")].slice(0, depthCols.length);
    lines.push(`| \`${pkg}\` | **${sev}** | ${padded.map(x => (x ? `\`${x}\`` : "")).join(" | ")} |`);
  }
  return lines.join("\n");
}

function buildMermaidGraphFromBOMImproved(bomJson, grypeMatches, graphMax = 150) {
  const { adj, parents } = buildGraphFromBOM(bomJson);
  const vulnerable = new Set((grypeMatches || []).map(m => `${m?.artifact?.name || "unknown"}:${m?.artifact?.version || "unknown"}`));

  const keep = new Set(); const queue = [];
  for (const v of vulnerable) { if (!keep.has(v)) { keep.add(v); queue.push(v); } }
  while (queue.length && keep.size < graphMax) {
    const cur = queue.shift();
    for (const p of (parents.get(cur) || [])) {
      if (!keep.has(p)) { keep.add(p); queue.push(p); if (keep.size >= graphMax) break; }
    }
  }

  let idx = 0; const idMap = new Map(); const idFor = (l)=>{ if(!idMap.has(l)) idMap.set(l,`n${idx++}`); return idMap.get(l); };
  const lines = []; lines.push("graph LR");
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
  for (const v of vulnerable) { if (keep.has(v)) { const vid = idFor(v); lines.push(`style ${vid} fill:#ffe0e0,stroke:#d33,stroke-width:2px`); } }
  return lines.join("\n");
}

function buildMarkdownReport({
  baseLabel, baseInput, baseSha, baseCommitLine,
  headLabel, headInput, headSha, headCommitLine,
  minSeverity, counts, table,
  headGrype, headBOM, graphMaxNodes
}) {
  const sevGroups = groupBySeverity(headGrype.matches || []);
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
  return md.join("\n");
}

module.exports = {
  buildMarkdownReport,
  buildDependencyPathsTable,
  renderPathsMarkdownTable,
  buildMermaidGraphFromBOMImproved
};

