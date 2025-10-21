// src/render/common/path-helpers.js
// Shared helpers for parsing hops and deriving modules.

function parseGav(hop) {
  if (!hop || typeof hop !== 'string') return null;
  const m = hop.match(/^([^:]+):([^:]+):([^:]+)$/);
  if (!m) return null;
  return { groupId: m[1], artifactId: m[2], version: m[3] };
}

function parsePurl(hop) {
  if (!hop || typeof hop !== 'string') return null;
  const m = hop.match(/^pkg:maven\/([^\/]+)\/([^@\/]+)@([^?]+)(?:\?.*)?$/i);
  if (!m) return null;
  return { groupId: m[1], artifactId: m[2], version: m[3] };
}

function parseHop(hop) {
  return parseGav(hop) || parsePurl(hop) || null;
}

function toGav(obj) {
  if (!obj) return '';
  const { groupId, artifactId, version } = obj;
  if (!groupId || !artifactId || !version) return '';
  return `${groupId}:${artifactId}:${version}`;
}

function extractRootGroupIdFromFirstHop(firstHop) {
  if (!firstHop || (Array.isArray(firstHop) && !firstHop.length)) return '';
  const first = typeof firstHop === 'string'
    ? parseHop(firstHop)
    : parseHop(Array.isArray(firstHop) ? firstHop[0] : '');
  return first && first.groupId ? first.groupId : '';
}

function extractModuleAndTailFromSinglePath(pathArr) {
  if (!Array.isArray(pathArr) || !pathArr.length) return { module: '', tail: [] };

  const first = parseHop(pathArr[0]);
  if (!first) return { module: '', tail: [] };
  const rootGroupId = first.groupId || '';

  // Si solo hay un hop, el módulo es el artifact y tail vacío:
  if (pathArr.length === 1) {
    return { module: first.artifactId || '', tail: [] };
  }

  let lastIdx = -1, module = '';
  for (let i = 1; i < pathArr.length; i++) {
    const h = parseHop(pathArr[i]);
    if (h && h.groupId === rootGroupId) {
      lastIdx = i;
      module = h.artifactId || module;
    }
  }
  if (!module) {
    module = first.artifactId || '';
    lastIdx = 0;
  }

  const tail = [];
  for (let j = lastIdx + 1; j < pathArr.length; j++) {
    const h = parseHop(pathArr[j]);
    tail.push(h ? (toGav(h) || pathArr[j]) : pathArr[j]);
  }
  return { module, tail };
}

function deriveModulesAndModulePaths(item) {
  const modSet = new Set();
  const map = new Map();
  try {
    const paths = Array.isArray(item?.paths) ? item.paths : [];
    for (const p of paths) {
      const { module, tail } = extractModuleAndTailFromSinglePath(p);
      if (!module) continue;
      modSet.add(module);
      const tailStr = tail.join(' → '); // separador estandarizado
      if (!map.has(module)) map.set(module, new Set());
      map.get(module).add(tailStr);
    }
  } catch (_) {}
  const modules = Array.from(modSet);
  const module_paths = {};
  for (const [mod, set] of map.entries()) module_paths[mod] = Array.from(set);
  return { modules, module_paths };
}

module.exports = {
  parseGav,
  parsePurl,
  parseHop,
  toGav,
  extractRootGroupIdFromFirstHop,
  extractModuleAndTailFromSinglePath,
  deriveModulesAndModulePaths,
};
