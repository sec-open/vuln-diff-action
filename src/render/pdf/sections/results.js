// src/render/pdf/sections/results.js
const fs = require('fs');
const path = require('path');

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function sevKey(s) { return String(s || 'UNKNOWN').toUpperCase(); }
function stateKey(s) { return String(s || '').toUpperCase(); }
function pkgStr(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  const n = p.name || '';
  const v = p.version || '';
  return v ? `${n}:${v}` : n;
}

const SEV_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

function sortRows(rows) {
  return rows.sort((a, b) => {
    const sa = SEV_ORDER[sevKey(a.severity)] || 0;
    const sb = SEV_ORDER[sevKey(b.severity)] || 0;
    if (sb !== sa) return sb - sa;
    const ia = String(a.id || a.vulnerabilityId || '');
    const ib = String(b.id || b.vulnerabilityId || '');
    if (ia !== ib) return ia.localeCompare(ib, 'en', { sensitivity: 'base' });
    const pa = pkgStr(a.package);
    const pb = pkgStr(b.package);
    if (pa !== pb) return pa.localeCompare(pb, 'en', { sensitivity: 'base' });
    const sta = stateKey(a.state);
    const stb = stateKey(b.state);
    return sta.localeCompare(stb, 'en', { sensitivity: 'base' });
  });
}

function tableHtml(headers, rows) {
  const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = rows.map(r => {
    return `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`;
  }).join('');
  return `<table class="compact">${thead}<tbody>${tbody}</tbody></table>`;
}

function makeRow(o) {
  const sev = sevKey(o.severity);
  const id = o.id || o.vulnerabilityId || '';
  const pkg = pkgStr(o.package);
  const st = stateKey(o.state);
  return [sev, id, pkg, st];
}

function buildDiffRows(items) {
  return sortRows(items.slice());
}

function buildBaseRows(items) {
  return sortRows(items.filter(x => {
    const st = stateKey(x.state);
    return st === 'REMOVED' || st === 'UNCHANGED';
  }));
}

function buildHeadRows(items) {
  return sortRows(items.filter(x => {
    const st = stateKey(x.state);
    return st === 'NEW' || st === 'UNCHANGED';
  }));
}

async function resultsHtml(distDir, view) {
  const diff = readJsonSafe(path.join(distDir, 'diff.json')) || {};
  const items = Array.isArray(diff.items) ? diff.items : (Array.isArray(view?.diff?.items) ? view.diff.items : []);

  const diffRows = buildDiffRows(items).map(makeRow);
  const baseRows = buildBaseRows(items).map(makeRow);
  const headRows = buildHeadRows(items).map(makeRow);

  const headers = ['Severity','Vulnerability','Package','State'];

  const sec3_1 = `
<section class="page" id="results">
  <h2>3. Vulnerability tables</h2>
  <h3>3.1 Vulnerability Diff Table</h3>
  ${tableHtml(headers, diffRows)}
</section>
`.trim();

  const sec3_2 = `
<section class="page" id="results-base">
  <h3>3.2 Vulnerability Base Table</h3>
  ${tableHtml(headers, baseRows)}
</section>
`.trim();

  const sec3_3 = `
<section class="page" id="results-head">
  <h3>3.3 Vulnerability Head Table</h3>
  ${tableHtml(headers, headRows)}
</section>
`.trim();

  return `${sec3_1}\n${sec3_2}\n${sec3_3}`;
}

module.exports = { resultsHtml };
