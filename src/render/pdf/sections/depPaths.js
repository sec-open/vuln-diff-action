// src/render/pdf/sections/depPaths.js
function gavFromAny(x){
  if (!x) return '';
  if (typeof x === 'string') return x;
  const g = x.groupId || x.group || x.namespace || '';
  const a = x.artifactId || x.artifact || x.name || x.package || '';
  const v = x.version || '';
  const ga = [g,a].filter(Boolean).join(':');
  return v ? (ga ? `${ga}:${v}` : v) : ga;
}

// Busca el índice del artifactId del módulo dentro del path (array de nodos)
function findModuleIdxInPath(path, moduleName){
  if (!Array.isArray(path)) return -1;
  // módulo puede venir como "group:artifact" o "artifact" a secas
  const modGA = String(moduleName || '');
  const modArtifact = modGA.split(':').pop();
  for (let i=0;i<path.length;i++){
    const node = path[i];
    const a = (node && (node.artifactId || node.artifact || node.name || '')).toString();
    if (a && a === modArtifact) return i;
    const gav = gavFromAny(node);
    if (gav.endsWith(':' + modArtifact) || gav.split(':')[1] === modArtifact) return i;
  }
  return -1;
}

// Construye "Module → hop1 → hop2 → …" empezando desde el módulo
function renderPathWithModuleFirst(moduleName, path){
  const mod = String(moduleName || '—');
  const list = Array.isArray(path) ? path.map(gavFromAny) : [];
  const idx = findModuleIdxInPath(path, moduleName);
  if (idx >= 0) {
    const tail = list.slice(idx + 1);
    return [mod].concat(tail).join(' → ');
  }
  return [mod].concat(list).join(' → ');
}

// Genera tabla para un "side" (base/head) deduplicando por (vulnId, module, pathString)
function dependencyPathsHtml(items = [], side = 'base'){
  const rows = [];
  for (const it of items || []){
    const id = it.id || it.vulnerabilityId || it.ghsa || it.cve || '';
    const mp = it.module_paths || {};
    const modules = Object.keys(mp);
    for (const mod of modules){
      const paths = Array.isArray(mp[mod]) ? mp[mod] : [];
      for (const p of paths){
        const pathStr = renderPathWithModuleFirst(mod, p);
        rows.push({
          id,
          severity: String(it.severity || 'UNKNOWN').toUpperCase(),
          state: String(it.state || '').toUpperCase(),
          module: mod,
          pathStr
        });
      }
    }
  }
  // dedupe
  const seen = new Set();
  const dedup = [];
  for (const r of rows){
    const k = [r.id, r.module, r.pathStr, side].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(r);
  }
  dedup.sort((a,b)=>{
    if (a.module !== b.module) return a.module.localeCompare(b.module,'en',{sensitivity:'base'});
    if (a.id !== b.id) return a.id.localeCompare(b.id,'en',{sensitivity:'base'});
    if (a.severity !== b.severity) return a.severity.localeCompare(b.severity,'en',{sensitivity:'base'});
    return a.state.localeCompare(b.state,'en',{sensitivity:'base'});
  });

  const thead = `
  <thead>
    <tr>
      <th>Module</th>
      <th>Vulnerability</th>
      <th>Severity</th>
      <th>State</th>
      <th>Dependency Path</th>
    </tr>
  </thead>`.trim();

  const tbody = dedup.map(r => `
    <tr>
      <td>${r.module}</td>
      <td>${r.id}</td>
      <td>${r.severity}</td>
      <td>${r.state}</td>
      <td>${r.pathStr}</td>
    </tr>
  `.trim()).join('');

  return `<table class="compact">${thead}<tbody>${tbody||'<tr><td colspan="5">No dependency paths</td></tr>'}</tbody></table>`;
}

module.exports = { dependencyPathsHtml };
