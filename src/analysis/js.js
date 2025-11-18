// JavaScript dependency extraction (package.json) for Phase 1.
// Recursively finds package.json files (excluding node_modules, .git, dist) and extracts direct dependencies.
// Output shape: Array<{ name, version, type, packagePath }>
const fs = require('fs/promises');
const path = require('path');

async function findPackageJsonFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'target') continue;
        await walk(p);
      } else if (e.isFile() && e.name === 'package.json') {
        out.push(p);
      }
    }
  }
  await walk(root);
  return out;
}

async function parsePackageJson(file) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function collectDepsFromModel(model, packageFile, { includeDev = false }) {
  if (!model) return [];
  const deps = model.dependencies || {};
  const devDeps = includeDev ? (model.devDependencies || {}) : {};
  const relDir = path.dirname(packageFile);
  const baseDir = model._rootDir || ''; // not used but placeholder
  const list = [];
  for (const [name, version] of Object.entries(deps)) {
    list.push({ name, version: String(version), type: 'prod', packagePath: relDir });
  }
  if (includeDev) {
    for (const [name, version] of Object.entries(devDeps)) {
      list.push({ name, version: String(version), type: 'dev', packagePath: relDir });
    }
  }
  return list;
}

async function extractJsDependencies(rootDir, { includeDev = false } = {}) {
  const files = await findPackageJsonFiles(rootDir);
  const all = [];
  for (const f of files) {
    const model = await parsePackageJson(f);
    if (!model) continue;
    const deps = collectDepsFromModel(model, path.relative(rootDir, f), { includeDev });
    for (const d of deps) all.push(d);
  }
  // Deduplicate by packagePath::name::type
  const map = new Map();
  for (const d of all) {
    const key = `${d.packagePath}::${d.name}::${d.type}`;
    if (!map.has(key)) map.set(key, d);
  }
  return Array.from(map.values()).map(d => ({ name: d.name, version: d.version, type: d.type, packagePath: d.packagePath }));
}

module.exports = { extractJsDependencies };

