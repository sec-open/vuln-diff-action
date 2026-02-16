// filepath: /home/juanfe/Documentos/sec-open/vuln-diff-action/src/analysis/pom.js
const fs = require('fs/promises');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// @actions/core is optional (for GitHub Actions environment)
let core;
try {
  core = require('@actions/core');
} catch {
  core = {
    debug: (msg) => console.debug(`[DEBUG] ${msg}`),
    warning: (msg) => console.warn(`[WARNING] ${msg}`),
    info: (msg) => console.log(`[INFO] ${msg}`)
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  allowBooleanAttributes: true,
  parseTagValue: false // Keep values as strings to preserve structure
});

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

function collectDependenciesFromModel(model, filePath = '') {
  try {
    const props = model?.project?.properties || {};

    // Intentar acceder a las propiedades en diferentes ubicaciones
    let depsNode = model?.project?.dependencies || {};

    // Las propiedades pueden estar en varios formatos
    const propsObj = {};
    if (props) {
      // Si properties es un objeto con múltiples propiedades
      for (const [key, val] of Object.entries(props)) {
        if (typeof val === 'string') {
          propsObj[key] = val;
        }
      }
    }

    // Extraer lista de dependencias
    let list = [];
    if (Array.isArray(depsNode?.dependency)) {
      list = depsNode.dependency;
    } else if (depsNode?.dependency) {
      list = [depsNode.dependency];
    }

    const out = [];
    for (const d of list) {
      if (!d || typeof d !== 'object') continue;

      // Intentar extraer groupId y artifactId en diferentes formas
      let groupId = d.groupId || d.groupid || '';
      let artifactId = d.artifactId || d.artifactid || '';
      let version = d.version || d.VERSION || '';

      // Resolver variables en las versiones
      version = resolveVersion(version, propsObj);

      if (!groupId || !artifactId) continue;

      out.push({ groupId, artifactId, version: version || '' });
    }

    return out;
  } catch (err) {
    core.debug(`[pom.js] Error parsing dependencies from ${filePath}: ${err.message}`);
    return [];
  }
}

async function parsePom(file) {
  try {
    const xml = await fs.readFile(file, 'utf8');
    const parsed = parser.parse(xml);
    core.debug(`[pom.js] Successfully parsed: ${file}`);
    return parsed;
  } catch (err) {
    core.debug(`[pom.js] Error parsing pom.xml at ${file}: ${err.message}`);
    return null;
  }
}

async function extractPomDependencies(rootDir) {
  try {
    const files = await findPomFiles(rootDir);
    core.debug(`[pom.js] Found ${files.length} pom.xml files in ${rootDir}`);

    const all = [];
    for (const f of files) {
      const model = await parsePom(f);
      if (!model) {
        core.debug(`[pom.js] Skipping ${f}: parse failed`);
        continue;
      }

      const deps = collectDependenciesFromModel(model, f);
      core.debug(`[pom.js] Found ${deps.length} dependencies in ${f}`);

      for (const dep of deps) {
        all.push({ ...dep, pomFile: f });
      }
    }

    // Deduplicate by groupId:artifactId keeping first version encountered
    const map = new Map();
    for (const d of all) {
      const key = `${d.groupId}::${d.artifactId}`;
      if (!map.has(key)) {
        map.set(key, d);
      }
    }

    const result = Array.from(map.values()).map(d => ({ groupId: d.groupId, artifactId: d.artifactId, version: d.version }));
    core.debug(`[pom.js] Extracted ${result.length} unique dependencies from pom files`);

    return result;
  } catch (err) {
    core.warning(`[pom.js] Error in extractPomDependencies: ${err.message}`);
    return [];
  }
}

module.exports = { extractPomDependencies };
