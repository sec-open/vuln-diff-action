// src/render/pdf/sections/results.js
const fs = require('fs');
const path = require('path');

// PDF results tables: diff, base-only view, head-only view (sorted by severity → id → package → state).

/** Safe JSON file read; returns null if unreadable. */
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
/** Normalizes severity key. */
function sevKey(s) { return String(s || 'UNKNOWN').toUpperCase(); }
/** Normalizes state key. */
function stateKey(s) { return String(s || '').toUpperCase(); }

/** Produces group:artifact:version string from package object. */
function gavStr(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  const g = p.groupId || p.group || p.namespace || '';
  const a = p.artifactId || p.artifact || p.name || p.package || '';
  const v = p.version || '';
  const ga = [g, a].filter(Boolean).join(':');
  return v ? (ga ? `${ga}:${v}` : v) : ga;
}

const SEV_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

/** Sorts items by severity priority then id then package then state. */
function sortItems(items) {
  return items.sort((a, b) => {
    const sa = SEV_ORDER[sevKey(a.severity)] || 0;
    const sb = SEV_ORDER[sevKey(b.severity)] || 0;
    if (sb !== sa) return sb - sa;
    const ia = String(a.id || a.vulnerabilityId || '');
    const ib = String(b.id || b.vulnerabilityId || '');
    if (ia !== ib) return ia.localeCompare(ib, 'en', { sensitivity: 'base' });
    const pa = gavStr(a.package);
    const pb = gavStr(b.package);
    if (pa !== pb) return pa.localeCompare(pb, 'en', { sensitivity: 'base' });
    const sta = stateKey(a.state);
    const stb = stateKey(b.state);
    return sta.localeCompare(stb, 'en', { sensitivity: 'base' });
  });
}

/** Builds HTML table from headers and row cell arrays. */
function tableHtml(headers, rows) {
  const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="compact">${thead}<tbody>${tbody}</tbody></table>`;
}

/** Converts one vulnerability item to a row array. */
function makeRow(o) {
  return [
    sevKey(o.severity),
    o.id || o.vulnerabilityId || '',
    gavStr(o.package),
    stateKey(o.state)
  ];
}

function rowsDiff(items) {
  return sortItems(items.slice()).map(makeRow);
}
function rowsBase(items) {
  const f = items.filter(x => ['REMOVED','UNCHANGED'].includes(stateKey(x.state)));
  return sortItems(f).map(makeRow);
}
function rowsHead(items) {
  const f = items.filter(x => ['NEW','UNCHANGED'].includes(stateKey(x.state)));
  return sortItems(f).map(makeRow);
}

/**
 * Builds all vulnerability table sections for PDF.
 * @param {string} distDir
 * @param {Object} view
 */
async function resultsHtml(distDir, view) {
  const diff = readJsonSafe(path.join(distDir, 'diff.json')) || {};
  const items = Array.isArray(diff.items) ? diff.items : (Array.isArray(view?.diff?.items) ? view.diff.items : []);

  const headers = ['Severity','Vulnerability','Package','State'];

  const sec3_1 = `
<section class="page" id="results">
  <h2>3. Vulnerability tables</h2>
  <h3>3.1 Vulnerability Diff Table</h3>
  ${tableHtml(headers, rowsDiff(items))}
</section>
`.trim();

  const sec3_2 = `
<section class="page" id="results-base">
  <h3>3.2 Vulnerability Base Table</h3>
  ${tableHtml(headers, rowsBase(items))}
</section>
`.trim();

  const sec3_3 = `
<section class="page" id="results-head">
  <h3>3.3 Vulnerability Head Table</h3>
  ${tableHtml(headers, rowsHead(items))}
</section>
`.trim();

  return `${sec3_1}\n${sec3_2}\n${sec3_3}`;
}

module.exports = { resultsHtml };
