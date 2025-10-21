// src/render/pdf/sections/depPaths.js

const { deriveModulesAndModulePaths } = require('../../common/path-helpers');

const SEV_ORDER = { CRITICAL:5, HIGH:4, MEDIUM:3, LOW:2, UNKNOWN:1 };

// helpers (idénticos a los que ya te funcionaban)
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

// render por lado (base/head), devuelve SOLO el bloque interno (sin <section> ni <h2>)
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
          triples.push({ sev, module:mod, tail:(t||''), gav, vhtml, vid });
        }
      }
    }
  }

  // dedupe
  const uniq = new Map();
  for (const r of triples) {
    const key = `${r.vid}||${r.module}||${Array.isArray(r.tail) ? r.tail.join('>') : r.tail}`;
    if (!uniq.has(key)) uniq.set(key, r);
  }
  const rows = Array.from(uniq.values());
  if (!rows.length) return `<p>No dependency paths to display for ${side === 'base' ? 'Base' : 'Head'}.</p>`;

  // orden
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

  // grupos por severidad
  const groups = rows.reduce((acc, r) => ((acc[r.sev] ||= []).push(r), acc), {});
  const order = Object.keys(SEV_ORDER).sort((s1, s2) => SEV_ORDER[s2]-SEV_ORDER[s1]);

  const sections = order
    .filter(sev => Array.isArray(groups[sev]) && groups[sev].length)
    .map(sev => {
      const trs = groups[sev].map(r => {
        const tailStr = Array.isArray(r.tail) ? r.tail.join(' → ') : (r.tail || '');
        const right = tailStr ? `${r.module} → ${tailStr}` : (r.module || '—');
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

// orquestador con firma compatible: (itemsOrView, side) → INNER HTML (sin numerar ni envolver)
function dependencyPathsHtml(itemsOrView, side) {
  const items = Array.isArray(itemsOrView)
    ? itemsOrView
    : (Array.isArray(itemsOrView?.items) ? itemsOrView.items : []);
  // Recalcular module_paths si faltan
  for (const it of items) {
    if (!it.module_paths) {
      const { modules, module_paths } = deriveModulesAndModulePaths(it);
      it.modules = modules;
      it.module_paths = module_paths;
    }
  }
  return buildDependencyPathsSection(items, side);
}

module.exports = { dependencyPathsHtml };
