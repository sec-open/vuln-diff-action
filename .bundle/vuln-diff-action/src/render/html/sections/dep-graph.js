// src/render/html/sections/dep-graph.js
// Renders Mermaid dependency graphs for Base and Head from Phase-2 paths.
// No JSON reads here; uses the strict "view" injected by the orchestrator.

function sanitizeId(s) {
  // Mermaid node ids: letters, digits, underscore. Keep it deterministic.
  return String(s).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 80);
}
function nodeDef(id, label) {
  // Rounded box looks nice for components
  return `${id}["${label}"]`;
}
function buildMermaidFromPaths(items) {
  const nodes = new Map();  // id -> def
  const edges = new Set();  // "idA-->idB"

  for (const it of items) {
    const paths = Array.isArray(it.paths) ? it.paths : [];
    for (const chain of paths) {
      if (!Array.isArray(chain) || chain.length < 2) continue;
      // Define nodes
      const ids = chain.map((seg) => {
        const label = String(seg);
        const id = sanitizeId(label);
        if (!nodes.has(id)) nodes.set(id, nodeDef(id, label));
        return id;
      });
      // Edges along the chain
      for (let i = 0; i < ids.length - 1; i++) {
        edges.add(`${ids[i]}-->${ids[i + 1]}`);
      }
    }
  }

  const header = 'graph LR';
  const body = [
    ...nodes.values(),
    ...edges.values(),
  ].join('\n');

  return `${header}\n${body}`;
}

function renderGraphCard(title, mermaidCode) {
  return `
<div class="card">
  <p class="small">Graph built from calculated dependency <em>paths</em>.</p>
  <pre class="mermaid">${mermaidCode}</pre>
</div>`;
}

/** Base: show paths for vulnerabilities present in BASE (REMOVED or UNCHANGED). */
function renderDepGraphBase({ view } = {}) {
  if (!view) throw new Error('[render/html/dep-graph] Missing view');
  const items = (view.items || []).filter((v) => {
    const s = String(v.state || '').toUpperCase();
    return s === 'REMOVED' || s === 'UNCHANGED';
  });
  const code = buildMermaidFromPaths(items);
  return renderGraphCard('Dependency Graph — Base', code);
}

/** Head: show paths for vulnerabilities present in HEAD (NEW or UNCHANGED). */
function renderDepGraphHead({ view } = {}) {
  if (!view) throw new Error('[render/html/dep-graph] Missing view');
  const items = (view.items || []).filter((v) => {
    const s = String(v.state || '').toUpperCase();
    return s === 'NEW' || s === 'UNCHANGED';
  });
  const code = buildMermaidFromPaths(items);
  return renderGraphCard('Dependency Graph — Head', code);
}

module.exports = { renderDepGraphBase, renderDepGraphHead };
