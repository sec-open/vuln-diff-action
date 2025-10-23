// src/render/common/view.js
// Builds the view from diff.json and enriches items with derived modules.

const fs = require('fs');
const path = require('path');
const { precomputeFromDiff } = require('./precompute');
const {
  deriveModulesAndModulePaths,
} = require('./path-helpers');

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
    items: Array.isArray(diff.items)
      ? diff.items.map((it) => {
          const { modules, module_paths } = deriveModulesAndModulePaths(it);
          return { ...it, modules, module_paths };
        })
      : [],
    dependencyDiff: diff.dependency_diff ? {
      totals: {
        ADDED: diff.dependency_diff.totals?.ADDED || 0,
        REMOVED: diff.dependency_diff.totals?.REMOVED || 0,
        VERSION_CHANGED: diff.dependency_diff.totals?.VERSION_CHANGED || 0,
        NEW_VULNS: diff.dependency_diff.totals?.NEW_VULNS || 0,
        REMOVED_VULNS: diff.dependency_diff.totals?.REMOVED_VULNS || 0,
      },
      items: Array.isArray(diff.dependency_diff.items) ? diff.dependency_diff.items : []
    } : { totals:{ ADDED:0, REMOVED:0, VERSION_CHANGED:0, NEW_VULNS:0, REMOVED_VULNS:0 }, items:[] },
    directDependencyChanges: diff.direct_dependency_changes ? {
      totals: diff.direct_dependency_changes.totals || {},
      changes: Array.isArray(diff.direct_dependency_changes.changes) ? diff.direct_dependency_changes.changes : []
    } : { totals:{}, changes:[] },
  };

  view.precomputed = precomputeFromDiff(diff);
  return view;
}

module.exports = { buildView };
