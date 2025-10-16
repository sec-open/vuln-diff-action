// src/render/pdf/sections/depPaths.js

const SEV_ORDER = { CRITICAL:5, HIGH:4, MEDIUM:3, LOW:2, UNKNOWN:1 };
const STATE_ORDER = { NEW:3, REMOVED:2, UNCHANGED:1 };

// ---------- helpers idénticos a los que funcionaban ----------
const pkgStr = (p) => {
  if (!p) return '—';
  const g = p.groupId || ''; const a = p.artifactId || ''; const v = p.version || '';
  if (g && a && v) return `${g}:${a}:${v}`;
  if (a && v) return `${a}:${v}`;
  return a || v || '—';
};

const vulnLink = (it) => {
  const url = Array.isArray(it.urls) && it.urls[0] ? it.urls[0] : (it.url || '');
  const id = it.id || it.vulnerabilityId || '—';
  return url ? `<a href="${url}">${id}</a>` : id;
};

// ---------- renderer por lado (BASE/HEAD) ----------
function buildDependencyPathsSection(items, side) {
  const keep = (it) => {
    const st = String(it.state || '').toUpperCase();
    if (side === 'base') return st === 'REMOVED' || st === 'UNCHANGED';
    if (side === 'head') return st === 'NEW' || st === 'UNCHANGED';
    return true;
  };

  const triples = [];
  for (const it of (items || [])) {
    if (!keep(it)) continue;
    const sev = String(it.severity || 'UNKNOWN').toUpperCase();
    const gav = pkgStr(it.package);
    const vhtml = vulnLink(it);
    const vid = it.id || it.vulnerabilityId || '';
    const mp = it.module_paths || {};
    const mods = Object.keys(mp);

    if (!mods.length) {
      triples.push({ sev, module:'', tail:'', gav, vhtml, vid });
      continue;
    }

    for (const mod of mods) {
      const tails = Array.isArray(mp[mod]) ? mp[mod] : [];
      if (!tails.length) {
        triples.push({ sev, module:mod, tail:'', gav, vhtml, vid });
      } else {
        for (const t of tails) {
          const tail = t || '';
          triples.push({ sev, module:mod, tail, gav, vhtml, vid });
        }
      }
    }
  }

  // dedupe intra-vuln
  const uniq = new Map();
  for (const r of triples) {
    const key = `${r.vid}||${r.module}||${Array.isArray(r.tail) ? r.tail.join('>') : r.tail}`;
    if (!uniq.has(key)) uniq.set(key, r);
  }
  const rows = Array.from(uniq.values());
  if (!rows.length) return `<p>No dependency paths to display for ${side === 'base' ? 'Base' : 'Head'}.</p>`;

  // orden: severidad desc, luego vuln, pkg, módulo, path
  rows.sort((a, b) => {
    const ra = SEV_ORDER[a.sev] || 0, rb = SEV_ORDER[b.sev] || 0;
    if (ra !== rb) return rb - ra;
    const ia = a.vid||'', ib = b.vid||''; if (ia!==ib) return ia.localeCompare(ib,'en',{sensitivity:'base'});
    const pa = a.gav||'', pb = b.gav||''; if (pa!==pb) return pa.localeCompare(pb,'en',{sensitivity:'base'});
    const ma = a.module||'', mb = b.module||''; if (ma!==mb) return ma.localeCompare(mb,'en',{sensitivity:'base'});
    const ta = Array.isArray(a.tail) ? a.tail.join('>') : (a.tail||'');
    const tb = Array.isArray(b.tail) ? b.tail.join('>') : (b.tail||'');
    return ta.localeCompare(tb,'en',{sensitivity:'base'});
  });

  // agrupa por severidad
  const groups = rows.reduce((acc, r) => ((acc[r.sev] ||= []).push(r), acc), {});
  const sevOrderArr = Object.keys(SEV_ORDER).sort((s1, s2) => (SEV_ORDER[s2] - SEV_ORDER[s1]));

  const sections = sevOrderArr
    .filter(sev => Array.isArray(groups[sev]) && groups[sev].length)
    .map(sev => {
      const trs = groups[sev].map(r => {
        // “poner en primera posición el módulo y el resto de hop detrás del artifactId que coincide con el módulo”
        // Aquí la ‘tail’ viene tal cual desde diff (array o string). Si es array, pintamos tal cual detrás del módulo.
        const tailStr = Array.isArray(r.tail) ? r.tail.join(' -> ') : (r.tail || '');
        const right = tailStr ? `${r.module} -> ${tailStr}` : (r.module || '—');
        return `<tr>
          <td>${r.vhtml}</td>
          <td>${r.gav}</td>
          <td>${right}</td>
        </tr>`;
      }).join('');

      return `
        <h4 class="subsection-title">${sev}</h4>
        <table class="dep-paths-table">
          <thead><tr><th>Vulnerability</th><th>Package</th><th>Module → Path tail</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      `;
    }).join('\n');

  return `<div class="dep-paths">${sections}</div>`;
}

// ---------- orquestador: devuelve las DOS secciones completas (7 y 8) ----------
function dependencyPathsHtml(itemsOrView) {
  // acepta directamente items[] o un objeto { diff: { items: [...] } }
  const items = Array.isArray(itemsOrView)
    ? itemsOrView
    : (Array.isArray(itemsOrView?.diff?.items) ? itemsOrView.diff.items : []);

  const depBase = buildDependencyPathsSection(items, 'base');
  const depHead = buildDependencyPathsSection(items, 'head');

  const css = `
<style>
  .section-wrap { page-break-inside: avoid; break-inside: avoid; }
  h2.section-title { margin: 0 0 8px 0; }
  .dep-paths-table { width: 100%; border-collapse: collapse; }
  .dep-paths-table th, .dep-paths-table td { padding: 4px 8px; font-size: 10px; line-height: 1.25; border-bottom: 1px solid #e5e7eb; }
  .subsection-title { margin: 10px 0 6px 0; font-size: 12px; }
</style>`.trim();

  const sec7 = `
<div class="page section-wrap" id="dep-paths-base">
  <h2 class="section-title">7. Dependency Paths — Base</h2>
  ${depBase}
</div>`.trim();

  const sec8 = `
<div class="page section-wrap" id="dep-paths-head">
  <h2 class="section-title">8. Dependency Paths — Head</h2>
  ${depHead}
</div>`.trim();

  return [css, sec7, sec8].join('\n');
}

module.exports = { dependencyPathsHtml };
