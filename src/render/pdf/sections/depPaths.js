// src/render/pdf/sections/depPaths.js

function parsePurlToGAV(purl){
  // ej: pkg:maven/group/artifact@version?type=jar
  try{
    if (!purl || typeof purl !== 'string') return purl || '';
    const m = purl.match(/^pkg:maven\/([^/]+)\/([^@]+)@([^?]+)/i);
    if (m) return `${m[1]}:${m[2]}:${m[3]}`;
  }catch(_){}
  return purl || '';
}

function toGAV(pkg){
  if (!pkg) return '';
  const g = pkg.groupId || pkg.group || pkg.namespace || '';
  const a = pkg.artifactId || pkg.artifact || pkg.name || '';
  const v = pkg.version || '';
  const ga = [g,a].filter(Boolean).join(':');
  return v ? (ga ? `${ga}:${v}` : v) : ga;
}

function uniq(arr){ return Array.from(new Set(arr)); }

function makeTable(headers, rows){
  const thead = `<thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = rows.length
    ? rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">—</td></tr>`;
  return `<table class="compact">${thead}<tbody>${tbody}</tbody></table>`;
}

function formatPathRow({ vulnId, pkgGav, moduleName, hops }){
  // regla pedida: “poner en primera posición el módulo y el resto de hop detrás”
  const pathStr = [moduleName].concat(hops || []).join(' → ');
  return [vulnId, pkgGav, moduleName, pathStr];
}

// Extrae paths por ítem (base/head) a partir del campo module_paths
function extractRowsFromItems(items = []){
  const rows = [];
  for (const it of items){
    const vulnId = it.id || it.vulnerabilityId || it.ghsa || it.cve || '-';
    const pkgGav = toGAV(it.package || {});
    const mp = it.module_paths || {}; // { "<moduleName>": [ [purl, purl, ...], ... ] }
    const modules = Object.keys(mp || {});
    for (const mod of modules){
      const paths = Array.isArray(mp[mod]) ? mp[mod] : [];
      for (const p of paths){
        const hops = (Array.isArray(p) ? p : []).map(parsePurlToGAV).filter(Boolean);
        // quita hop inicial si repite el módulo (si el array trae también el módulo duplicado)
        let finalHops = hops.slice();
        if (finalHops.length && typeof finalHops[0] === 'string' && finalHops[0].startsWith(mod + ':')){
          finalHops = finalHops.slice(1);
        }
        rows.push(formatPathRow({ vulnId, pkgGav, moduleName: mod, hops: finalHops }));
      }
    }
  }
  return rows;
}

// Dedup por (vulnId, moduleName, pathStr). Si hay URLs GHSA duplicadas en referencias,
// esto no las repite ya que deduplicamos por fila.
function dedupRows(rows){
  const seen = new Set();
  const out = [];
  for (const r of rows){
    const key = r.join('||');
    if (!seen.has(key)){ seen.add(key); out.push(r); }
  }
  return out;
}

function section(title, id, inner){
  return `
<section class="page" id="${id}">
  <h2>${title}</h2>
  ${inner}
</section>`.trim();
}

function depPathsHtml(view){
  // Base y Head por separado; si no hay, mostramos —.
  const baseItems = Array.isArray(view?.base?.items) ? view.base.items : [];
  const headItems = Array.isArray(view?.head?.items) ? view.head.items : [];

  const baseRows = dedupRows(extractRowsFromItems(baseItems));
  const headRows = dedupRows(extractRowsFromItems(headItems));

  const headers = ['Vulnerability','Package','Module','Dependency Path'];

  const style = `
<style>
  #dep-paths-base, #dep-paths-head { page-break-inside: avoid; break-inside: avoid; }
  #dep-paths-base table.compact, #dep-paths-head table.compact { font-size: 10px; }
  #dep-paths-base th, #dep-paths-base td, #dep-paths-head th, #dep-paths-head td { padding: 3px 6px; }
</style>`.trim();

  const baseHtml = `
<div id="dep-paths-base">
  <h3>7. Dependency Paths (BASE)</h3>
  ${makeTable(headers, baseRows)}
</div>`.trim();

  const headHtml = `
<div id="dep-paths-head">
  <h3>8. Dependency Paths (HEAD)</h3>
  ${makeTable(headers, headRows)}
</div>`.trim();

  return [style, section('7–8. Dependency Paths', 'dep-paths', baseHtml + '\n' + headHtml)].join('\n');
}

module.exports = { depPathsHtml };
