// src/render/common/view.js
// Fase-3 View builder: lee SOLO ./dist/diff.json (contrato Fase-2),
// valida schema y construye el objeto "view" que consumen Markdown/HTML/PDF.
// Enriquecemos ADITIVAMENTE cada item con:
//   - modules: string[] (módulos únicos por vulnerabilidad)
//   - module_paths: { [module]: string[] } (tails únicos desde el módulo)

const fs = require('fs');
const path = require('path');
const { precomputeFromDiff } = require('./precompute');

// --- Helpers locales (mismo algoritmo que en precompute) ---
function extractRootGroupIdFromFirstHop(firstHop) {
  if (!firstHop || typeof firstHop !== 'string') return '';
  const m = firstHop.match(/^pkg:maven\/([^\/]+)\/([^@\/]+)@/);
  if (m) return m[1] || '';
  const g = firstHop.match(/^([^:]+):([^:]+):([^:]+)$/);
  if (g) return g[1] || '';
  return '';
}
function parseGav(hop) {
  if (!hop || typeof hop !== 'string') return null;
  const m = hop.match(/^([^:]+):([^:]+):([^:]+)$/);
  if (!m) return null;
  return { groupId: m[1], artifactId: m[2], version: m[3] };
}
function extractModuleAndTailFromSinglePath(pathArr) {
  if (!Array.isArray(pathArr) || pathArr.length < 2) return { module: '', tail: [] };
  const rootGroupId = extractRootGroupIdFromFirstHop(pathArr[0]);
  if (!rootGroupId) return { module: '', tail: [] };
  let lastIdx = -1, module = '';
  for (let i = 1; i < pathArr.length; i++) {
    const gav = parseGav(pathArr[i]);
    if (gav && gav.groupId === rootGroupId) {
      lastIdx = i;
      module = gav.artifactId || module;
    }
  }
  if (!module) return { module: '', tail: [] };
  const tail = pathArr.slice(lastIdx + 1);
  return { module, tail };
}
function deriveModulesAndModulePaths(item) {
  const modSet = new Set();
  const map = new Map(); // module -> Set<string tail>
  try {
    const paths = Array.isArray(item?.paths) ? item.paths : [];
    for (const p of paths) {
      const { module, tail } = extractModuleAndTailFromSinglePath(p);
      if (!module) continue;
      modSet.add(module);
      const tailStr = tail.join(' -> ');
      if (!map.has(module)) map.set(module, new Set());
      map.get(module).add(tailStr);
    }
  } catch (_) {}
  const modules = Array.from(modSet);
  const module_paths = {};
  for (const [mod, set] of map.entries()) module_paths[mod] = Array.from(set);
  return { modules, module_paths };
}

// --- utilidades view ---
function requireJson(file) {
  if (!fs.existsSync(file)) throw new Error(`[render/common/view] Missing file: ${file}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`[render/common/view] Invalid JSON: ${file} (${e.message})`); }
}
function assertPath(obj, p, fileLabel) {
  const ok = p.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), obj);
  if (ok === undefined) throw new Error(`[render/common/view] ${fileLabel} missing path: ${p}`);
}

function buildView(distDir = './dist') {
  const abs = path.resolve(distDir);
  const diffFile = path.join(abs, 'diff.json');
  const diff = requireJson(diffFile);

  // Validación estricta (contrato Fase-2)
  [
    'schema_version', 'generated_at', 'repo',
    'inputs.base_ref', 'inputs.head_ref', 'inputs.path',
    'tools',
    'base.ref', 'base.sha_short', 'base.sha', 'base.author', 'base.authored_at', 'base.commit_subject',
    'head.ref', 'head.sha_short', 'head.sha', 'head.author', 'head.authored_at', 'head.commit_subject',
    'summary.totals.NEW', 'summary.totals.REMOVED', 'summary.totals.UNCHANGED',
    'summary.by_severity_and_state',
    'items'
  ].forEach((p) => assertPath(diff, p, 'diff.json'));

  // Construcción del view (Fase-2 espejo) + enriquecimiento ADITIVO "modules" y "module_paths"
  const view = {
    schemaVersion: diff.schema_version,
    generatedAt: diff.generated_at,
    repo: diff.repo,
    inputs: {
      baseRef: diff.inputs.base_ref,
      headRef: diff.inputs.head_ref,
      path: diff.inputs.path,
    },
    tools: { ...diff.tools },
    base: {
      ref: diff.base.ref,
      sha: diff.base.sha,
      shaShort: diff.base.sha_short,
      author: diff.base.author,
      authoredAt: diff.base.authored_at,
      commitSubject: diff.base.commit_subject,
    },
    head: {
      ref: diff.head.ref,
      sha: diff.head.sha,
      shaShort: diff.head.sha_short,
      author: diff.head.author,
      authoredAt: diff.head.authored_at,
      commitSubject: diff.head.commit_subject,
    },
    summary: {
      totals: {
        NEW: diff.summary.totals.NEW,
        REMOVED: diff.summary.totals.REMOVED,
        UNCHANGED: diff.summary.totals.UNCHANGED,
      },
      bySeverityAndState: { ...diff.summary.by_severity_and_state },
    },

    // ADITIVO: por ítem añadimos "modules" y "module_paths"
    items: Array.isArray(diff.items)
      ? diff.items.map((it) => {
          const { modules, module_paths } = deriveModulesAndModulePaths(it);
          return { ...it, modules, module_paths };
        })
      : [],
  };

  // Precomputados Fase-3 (también ADITIVOS; no rompen si nadie los lee)
  view.precomputed = precomputeFromDiff(diff);

  return view;
}

module.exports = { buildView };
