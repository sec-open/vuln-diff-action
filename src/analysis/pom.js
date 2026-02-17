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
  parseTagValue: false
});

async function findPomFiles(root) {
  const out = [];
  async function walk(dir, relativePrefix = '') {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      const relativePath = relativePrefix ? path.join(relativePrefix, e.name) : e.name;
      if (e.isDirectory()) {
        if (e.name === 'target' || e.name === '.git' || e.name === 'node_modules') continue;
        await walk(p, relativePath);
      } else if (e.isFile() && e.name === 'pom.xml') {
        out.push({ absolute: p, relative: relativePath });
      }
    }
  }
  await walk(root);
  return out;
}

function resolvePropertiesRecursive(value, props, maxDepth = 5) {
  if (!value || typeof value !== 'string') return value || '';
  if (maxDepth <= 0) return value;

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

  if (hasChanges && result !== value) {
    return resolvePropertiesRecursive(result, props, maxDepth - 1);
  }

  return result;
}

function extractPropertiesFromModel(model) {
  const propsObj = {};
  const propsNode = model?.project?.properties;

  if (propsNode && typeof propsNode === 'object') {
    for (const [key, val] of Object.entries(propsNode)) {
      if (!key.startsWith('#')) {
        const strVal = String(val).trim();
        propsObj[key] = strVal;
      }
    }
  }

  return propsObj;
}

function extractDependenciesFromModel(model, filePath = '') {
  try {
    const propsObj = extractPropertiesFromModel(model);
    const depsNode = model?.project?.dependencies;

    if (!depsNode) {
      return [];
    }

    let depsList = [];
    if (Array.isArray(depsNode?.dependency)) {
      depsList = depsNode.dependency;
    } else if (depsNode?.dependency) {
      depsList = [depsNode.dependency];
    }

    const out = [];
    let depsProcessed = 0;
    for (const d of depsList) {
      if (!d || typeof d !== 'object') continue;

      let groupId = String(d.groupId || d.groupid || '').trim();
      let artifactId = String(d.artifactId || d.artifactid || '').trim();
      let version = String(d.version || d.VERSION || '').trim();

      if (!groupId || !artifactId) continue;

      depsProcessed++;

      // Log antes de resolver
      if (depsProcessed <= 3) {
        core.debug(`[pom.js] ${filePath} - Dependency ${depsProcessed}: ${groupId}:${artifactId} raw version: "${version}"`);
      }

      // Resolver propiedades en la versión
      const resolvedVersion = resolvePropertiesRecursive(version, propsObj);

      if (depsProcessed <= 3) {
        core.debug(`[pom.js] ${filePath} - After resolution: "${resolvedVersion}"`);
      }

      out.push({
        groupId,
        artifactId,
        version: resolvedVersion || '',
        scope: String(d.scope || '').trim() || 'compile'
      });
    }

    core.debug(`[pom.js] ${filePath}: Extracted ${out.length} dependencies (${depsProcessed} processed)`);

    return out;
  } catch (err) {
    core.warning(`[pom.js] Error extracting dependencies from ${filePath}: ${err.message}`);
    return [];
  }
}

async function parsePom(file) {
  try {
    const xml = await fs.readFile(file, 'utf8');
    const parsed = parser.parse(xml);
    return parsed;
  } catch (err) {
    core.debug(`[pom.js] Error parsing pom.xml at ${file}: ${err.message}`);
    return null;
  }
}

/**
 * Compara dependencias entre dos directorios (base y head) archivo por archivo
 */
async function comparePomDependencies(baseDir, headDir) {
  try {
    // Encontrar todos los pom.xml en ambas ramas
    const baseFiles = await findPomFiles(baseDir);
    const headFiles = await findPomFiles(headDir);

    core.info(`[pom.js] Found ${baseFiles.length} pom.xml files in BASE`);
    core.info(`[pom.js] Found ${headFiles.length} pom.xml files in HEAD`);

    // Crear mapas por ruta relativa
    const baseMap = new Map();
    const headMap = new Map();

    for (const f of baseFiles) {
      baseMap.set(f.relative, f);
    }
    for (const f of headFiles) {
      headMap.set(f.relative, f);
    }

    const allDifferences = [];

    // Comparar archivos que existen en BASE
    for (const [relPath, baseFile] of baseMap.entries()) {
      const basePom = await parsePom(baseFile.absolute);
      if (!basePom) continue;

      const baseDeps = extractDependenciesFromModel(basePom, relPath);
      const baseProps = extractPropertiesFromModel(basePom);

      if (headMap.has(relPath)) {
        // El archivo existe en ambas ramas - comparar
        const headFile = headMap.get(relPath);
        const headPom = await parsePom(headFile.absolute);
        if (!headPom) continue;

        const headDeps = extractDependenciesFromModel(headPom, relPath);
        const headProps = extractPropertiesFromModel(headPom);

        core.debug(`[pom.js] Comparing ${relPath}`);

        // Crear mapas de dependencias
        const baseDepsMap = new Map();
        const headDepsMap = new Map();

        for (const d of baseDeps) {
          const key = `${d.groupId}:${d.artifactId}`;
          baseDepsMap.set(key, d);
        }

        for (const d of headDeps) {
          const key = `${d.groupId}:${d.artifactId}`;
          headDepsMap.set(key, d);
        }

        // Encontrar cambios en dependencias
        for (const [key, baseDep] of baseDepsMap.entries()) {
          if (headDepsMap.has(key)) {
            const headDep = headDepsMap.get(key);
            if (baseDep.version !== headDep.version) {
              allDifferences.push({
                type: 'DEPENDENCY_UPDATED',
                pomFile: relPath,
                groupId: baseDep.groupId,
                artifactId: baseDep.artifactId,
                baseVersion: baseDep.version,
                headVersion: headDep.version
              });
              core.info(`[pom.js] UPDATED: ${relPath} -> ${key} (${baseDep.version} -> ${headDep.version})`);
            }
          } else {
            allDifferences.push({
              type: 'DEPENDENCY_REMOVED',
              pomFile: relPath,
              groupId: baseDep.groupId,
              artifactId: baseDep.artifactId,
              baseVersion: baseDep.version,
              headVersion: null
            });
            core.info(`[pom.js] REMOVED: ${relPath} -> ${key} (was ${baseDep.version})`);
          }
        }

        // Encontrar nuevas dependencias
        for (const [key, headDep] of headDepsMap.entries()) {
          if (!baseDepsMap.has(key)) {
            allDifferences.push({
              type: 'DEPENDENCY_ADDED',
              pomFile: relPath,
              groupId: headDep.groupId,
              artifactId: headDep.artifactId,
              baseVersion: null,
              headVersion: headDep.version
            });
            core.info(`[pom.js] ADDED: ${relPath} -> ${key} (now ${headDep.version})`);
          }
        }

        // Comparar propiedades
        for (const [propKey, baseVal] of Object.entries(baseProps)) {
          if (headProps.hasOwnProperty(propKey)) {
            const headVal = headProps[propKey];
            if (baseVal !== headVal) {
              allDifferences.push({
                type: 'PROPERTY_CHANGED',
                pomFile: relPath,
                propertyName: propKey,
                baseValue: baseVal,
                headValue: headVal
              });
              core.info(`[pom.js] PROPERTY: ${relPath} -> ${propKey} (${baseVal} -> ${headVal})`);

              // Encontrar dependencias que usan esta propiedad
              const propPlaceholder = `\${${propKey}}`;
              for (const [key, baseDep] of baseDepsMap.entries()) {
                if (baseDep.version.includes(propPlaceholder)) {
                  // Esta dependencia usa la propiedad que cambió
                  const headDep = headDepsMap.get(key);
                  if (headDep) {
                    const resolvedBaseVersion = baseDep.version.replace(propPlaceholder, baseVal);
                    const resolvedHeadVersion = headDep.version.replace(propPlaceholder, headVal);

                    if (resolvedBaseVersion !== resolvedHeadVersion) {
                      allDifferences.push({
                        type: 'DEPENDENCY_UPDATED_BY_PROPERTY',
                        pomFile: relPath,
                        groupId: baseDep.groupId,
                        artifactId: baseDep.artifactId,
                        propertyName: propKey,
                        baseVersion: resolvedBaseVersion,
                        headVersion: resolvedHeadVersion
                      });
                      core.info(`[pom.js] DEPENDENCY UPDATED (via property ${propKey}): ${relPath} -> ${key} (${resolvedBaseVersion} -> ${resolvedHeadVersion})`);
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        // Archivo removido en HEAD
        core.warning(`[pom.js] POM REMOVED: ${relPath}`);
      }
    }

    // Buscar nuevos archivos en HEAD
    for (const [relPath, headFile] of headMap.entries()) {
      if (!baseMap.has(relPath)) {
        core.warning(`[pom.js] POM ADDED: ${relPath}`);
        const headPom = await parsePom(headFile.absolute);
        if (headPom) {
          const headDeps = extractDependenciesFromModel(headPom, relPath);
          core.info(`[pom.js] New pom.xml has ${headDeps.length} dependencies`);
        }
      }
    }

    core.info(`[pom.js] Total differences found: ${allDifferences.length}`);
    return allDifferences;
  } catch (err) {
    core.warning(`[pom.js] Error in comparePomDependencies: ${err.message}`);
    core.debug(`[pom.js] Stack: ${err.stack}`);
    return [];
  }
}

/**
 * Legacy function - mantener para compatibility
 */
async function extractPomDependencies(rootDir) {
  try {
    const files = await findPomFiles(rootDir);
    core.info(`[pom.js] Found ${files.length} pom.xml files in ${rootDir}`);

    if (files.length === 0) {
      return [];
    }

    const all = [];
    for (const f of files) {
      const model = await parsePom(f.absolute);
      if (!model) continue;

      const deps = extractDependenciesFromModel(model, f.relative);
      for (const dep of deps) {
        all.push(dep);
      }
    }

    core.info(`[pom.js] Total dependencies collected: ${all.length}`);
    return all;
  } catch (err) {
    core.warning(`[pom.js] Error in extractPomDependencies: ${err.message}`);
    return [];
  }
}

module.exports = { extractPomDependencies, comparePomDependencies };

