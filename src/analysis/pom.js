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

function collectDependenciesFromModel(model, filePath = '') {
  try {
    // Extraer propiedades del pom
    const propsObj = {};
    const propsNode = model?.project?.properties;

    core.debug(`[pom.js] Properties node type: ${typeof propsNode}, keys: ${propsNode ? Object.keys(propsNode).join(',') : 'null'}`);

    if (propsNode && typeof propsNode === 'object') {
      // Las propiedades pueden estar como objeto con claves
      for (const [key, val] of Object.entries(propsNode)) {
        // Ignorar atributos internos del parser
        if (!key.startsWith('#')) {
          const strVal = String(val);
          // Las versiones normalmente no tienen newlines, así que trim
          propsObj[key] = strVal.trim();
          core.debug(`[pom.js] Property ${key} = ${strVal.trim()}`);
        }
      }
    }

    core.debug(`[pom.js] Extracted ${Object.keys(propsObj).length} properties`);

    // Extraer dependencias
    const depsNode = model?.project?.dependencies;
    let depsList = [];

    if (!depsNode) {
      core.warning(`[pom.js] No dependencies node found in ${filePath}`);
      return [];
    }

    // Las dependencias pueden venir como array o como single object
    if (Array.isArray(depsNode?.dependency)) {
      depsList = depsNode.dependency;
    } else if (depsNode?.dependency) {
      depsList = [depsNode.dependency];
    }

    core.debug(`[pom.js] Found ${depsList.length} dependency elements`);

    const out = [];
    for (const d of depsList) {
      if (!d || typeof d !== 'object') {
        core.debug(`[pom.js] Skipping invalid dependency element`);
        continue;
      }

      // Extraer groupId, artifactId, version
      let groupId = d.groupId || d.groupid || '';
      let artifactId = d.artifactId || d.artifactid || '';
      let version = d.version || d.VERSION || '';

      // DEBUG: Log raw values
      core.debug(`[pom.js] Raw values - groupId type: ${typeof groupId} value: "${groupId}"`);
      core.debug(`[pom.js] Raw values - artifactId type: ${typeof artifactId} value: "${artifactId}"`);
      core.debug(`[pom.js] Raw values - version type: ${typeof version} value: "${version}"`);

      // Ensure strings
      groupId = String(groupId).trim();
      artifactId = String(artifactId).trim();
      version = String(version).trim();

      core.debug(`[pom.js] After trim - version: "${version}"`);

      // Solo incluir si tiene groupId y artifactId
      if (!groupId || !artifactId) {
        core.debug(`[pom.js] Skipping - no groupId or artifactId`);
        continue;
      }

      // Resolver propiedades en la versión
      const resolvedVersion = resolvePropertiesRecursive(version, propsObj);
      core.debug(`[pom.js] Version after resolve: "${version}" -> "${resolvedVersion}"`);

      out.push({ groupId, artifactId, version: resolvedVersion || '' });
      core.debug(`[pom.js] Added dependency: ${groupId}:${artifactId}:${resolvedVersion}`);
    }

    core.info(`[pom.js] Total dependencies from file: ${out.length}`);
    return out;
  } catch (err) {
    core.warning(`[pom.js] Error parsing dependencies from ${filePath}: ${err.message}`);
    core.debug(`[pom.js] Stack: ${err.stack}`);
    return [];
  }
}

function resolvePropertiesRecursive(value, props, maxDepth = 5) {
  if (!value || typeof value !== 'string') return value || '';
  if (maxDepth <= 0) return value;

  // Regex para encontrar ${property.name}
  const regex = /\$\{([^}]+)\}/g;
  let result = value;
  let matches;
  let hasChanges = false;

  while ((matches = regex.exec(value)) !== null) {
    const propName = matches[1];
    const propValue = props[propName];

    if (propValue && propValue !== value) {
      result = result.replace(`\${${propName}}`, propValue);
      hasChanges = true;
    }
  }

  // Si hubo cambios, recursivamente resolver de nuevo (en caso de propiedades anidadas)
  if (hasChanges && result !== value) {
    return resolvePropertiesRecursive(result, props, maxDepth - 1);
  }

  return result;
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
    core.info(`[pom.js] Found ${files.length} pom.xml files in ${rootDir}`);

    if (files.length === 0) {
      core.warning(`[pom.js] No pom.xml files found in ${rootDir}`);
      return [];
    }

    const all = [];
    for (const f of files) {
      core.debug(`[pom.js] Processing pom.xml: ${f}`);
      const model = await parsePom(f);
      if (!model) {
        core.warning(`[pom.js] Failed to parse ${f}`);
        continue;
      }

      const deps = collectDependenciesFromModel(model, f);
      core.info(`[pom.js] Extracted ${deps.length} dependencies from ${f}`);

      if (deps.length > 0) {
        core.debug(`[pom.js] First 3 deps from ${f}:`);
        deps.slice(0, 3).forEach(d => {
          core.debug(`  ${d.groupId}:${d.artifactId}:${d.version}`);
        });
      }

      for (const dep of deps) {
        all.push({ ...dep, pomFile: f });
      }
    }

    core.info(`[pom.js] Total dependencies collected from all poms: ${all.length}`);

    // Deduplicate by groupId:artifactId keeping first version encountered
    const map = new Map();
    for (const d of all) {
      const key = `${d.groupId}::${d.artifactId}`;
      if (!map.has(key)) {
        map.set(key, d);
      }
    }

    const result = Array.from(map.values()).map(d => ({ groupId: d.groupId, artifactId: d.artifactId, version: d.version }));
    core.info(`[pom.js] Final unique dependencies after dedup: ${result.length}`);

    if (result.length > 0) {
      core.debug(`[pom.js] Unique dependencies:`);
      result.slice(0, 5).forEach(d => {
        core.debug(`  ${d.groupId}:${d.artifactId}:${d.version}`);
      });
    }

    return result;
  } catch (err) {
    core.warning(`[pom.js] Error in extractPomDependencies: ${err.message}`);
    core.debug(`[pom.js] Stack: ${err.stack}`);
    return [];
  }
}

module.exports = { extractPomDependencies };
