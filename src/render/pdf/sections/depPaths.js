// src/render/pdf/sections/depPaths.js

function parsePurlToGAV(purl){
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

function makeTable(headers, rows){
  const thead = `<thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = rows.length
    ? rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">—</td></tr>`;
  return `<table class="compact">${thead}<tbody>${tbody}</tbody></table>`;
}

function rowsFromItems(items = []){
  const out = [];
  for (const it of items){
    const vulnId = it.id || it.vulnerabilityId || it.ghsa || it.cve || '-';
    const pkgGav = toGAV(it.package || {});
    const mp = it.module_paths || {};                 // { "<module>": [ [purl, ...], ... ] }
    const fallbackModule = it.module ? String(it.module) : null;
    const modules = Object.keys(mp || {});
    if (modules.length === 0 && Array.isArray(it.paths) && fallbackModule){
      // fallback: algunos normalizadores usan `paths` y `module`
      for (const p of it.paths){
        const hops = (Array.isArray(p) ? p : []).map(parsePurlToGAV).filter(Boolean);
        out.push([vulnId, pkgGav, fallbackModule, [fallbackModule].concat(hops).join(' → ')]);
      }
      continue;
    }
    for (const mod of modules){
      const paths = Array.isArray(mp[mod]) ? mp[mod] : [];
      for (const p of paths){
        const hops = (Array.isArray(p) ? p : []).map(parsePurlToGAV).filter(Boolean);
        let finalHops = hops.slice();
        if (finalHops.length && typeof finalHops[0] === 'string' && finalHops[0].startsWith(mod + ':')){
          finalHops = finalHops.slice(1);
        }
        out.push([vulnId, pkgGav, mod, [mod].concat(finalHops).join(' → ')]);
      }
    }
  }
  // dedup
  const seen = new Set(); const dedup = [];
  for (const r of out){ const k = r.join('||'); if (!seen.has(k)){ seen.add(k); dedup.push(r); } }
  return dedup;
}

function section(id, title, inner){
  return `<section class="page" id="${id}"><h2>${title}</h2>${inner}</section>`;
}

function dependencyPathsHtml(view){
  const baseItems = Array.isArray(view?.base?.items) ? view.base.items : [];
  const headItems = Array.isArray(view?.head?.items) ? view.head.items : [];
  // fallback si no llegan base/head:
  const diffItems = Array.isArray(view?.diff?.items) ? view.diff.items : [];

  const headers = ['Vulnerability','Package','Module','Dependency Path'];
  const baseRows = rowsFromItems(baseItems);
  const headRows = rowsFromItems(headItems.length ? headItems : diffItems);

  const style = `
<style>
  #dep-paths { page-break-inside: avoid; break-inside: avoid; }
  #dep-paths .block { margin: 10px 0 14px; page-break-inside: avoid; break-inside: avoid; }
  #dep-paths table.compact { font-size: 10px; }
  #dep-paths th, #dep-paths td { padding: 3px 6px; vertical-align: top; }
</style>`.trim();

  const baseHtml = `
<div class="block" id="dep-paths-base">
  <h3>7. Dependency Paths (BASE)</h3>
  ${makeTable(headers, baseRows)}
</div>`.trim();

  const headHtml = `
<div class="block" id="dep-paths-head">
  <h3>8. Dependency Paths (HEAD)</h3>
  ${makeTable(headers, headRows)}
</div>`.trim();

  return [
    `<section class="page" id="dep-paths"><h2>7–8. Dependency Paths</h2>`,
    style,
    baseHtml,
    headHtml,
    `</section>`
  ].join('\n');
}

module.exports = { dependencyPathsHtml };
