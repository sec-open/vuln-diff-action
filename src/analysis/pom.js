// filepath: /home/juanfe/Documentos/sec-open/vuln-diff-action/src/analysis/pom.js
const fs = require('fs/promises');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', allowBooleanAttributes: true });

async function findPomFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'target' || e.name === '.git' || e.name === 'node_modules') continue;
        await walk(p);
      } else if (e.isFile() && e.name === 'pom.xml') {
        out.push(p);
      }
    }
  }
  await walk(root);
  return out;
}

function resolveVersion(rawVersion, props) {
  if (!rawVersion || typeof rawVersion !== 'string') return rawVersion || '';
  const m = rawVersion.match(/\$\{([^}]+)\}/);
  if (m) {
    const key = m[1];
    if (props && props[key]) return String(props[key]);
  }
  return rawVersion;
}

function collectDependenciesFromModel(model) {
  const props = model?.project?.properties || {};
  const depsNode = model?.project?.dependencies || {};
  // dependencies may be an array or an object with dependency
  let list = [];
  if (Array.isArray(depsNode?.dependency)) list = depsNode.dependency;
  else if (depsNode?.dependency) list = [depsNode.dependency];
  const out = [];
  for (const d of list) {
    if (!d) continue;
    const groupId = d.groupId || d.groupid || '';
    const artifactId = d.artifactId || d.artifactid || '';
    let version = d.version || '';
    version = resolveVersion(version, props);
    if (!groupId || !artifactId) continue;
    out.push({ groupId, artifactId, version: version || '' });
  }
  return out;
}

async function parsePom(file) {
  try {
    const xml = await fs.readFile(file, 'utf8');
    return parser.parse(xml);
  } catch {
    return null;
  }
}

async function extractPomDependencies(rootDir) {
  const files = await findPomFiles(rootDir);
  const all = [];
  for (const f of files) {
    const model = await parsePom(f);
    if (!model) continue;
    const deps = collectDependenciesFromModel(model);
    for (const dep of deps) all.push({ ...dep, pomFile: f });
  }
  // Deduplicate by groupId:artifactId keeping first version encountered.
  const map = new Map();
  for (const d of all) {
    const key = `${d.groupId}::${d.artifactId}`;
    if (!map.has(key)) map.set(key, d);
  }
  return Array.from(map.values()).map(d => ({ groupId: d.groupId, artifactId: d.artifactId, version: d.version }));
}

module.exports = { extractPomDependencies };

