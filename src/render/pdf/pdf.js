// src/render/pdf/pdf.js
// PDF renderer that reuses the HTML bundle but prints with a dedicated layout:
// - Clean light theme for pages (dark only on cover)
// - PDF-only dashboard (fixed grid, no overlap) with deterministic Chart.js render
// - Fix Insights section (always built from diff.json)
// - Cover without header/footer (merge cover + rest with pdf-lib)
// - Portable Chrome install via @puppeteer/browsers (no sudo)

const core = require('@actions/core');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const https = require('https');
const { PDFDocument } = require('pdf-lib');
const { buildView } = require('../common/view');

function exists(p){ try { fs.accessSync(p); return true; } catch { return false; } }
async function ensureDir(p){ await fsp.mkdir(p, { recursive: true }); }
async function readTextSafe(p){ try { return await fsp.readFile(p,'utf8'); } catch { return ''; } }
async function writeText(p, t){ await ensureDir(path.dirname(p)); await fsp.writeFile(p, t, 'utf8'); }

async function waitForCharts(page, { timeout = 60000 } = {}) {
  try {
    await page.waitForFunction(
      () => (window.__chartsReady === true) && (window.__mermaidReady === true),
      { timeout }
    );
    await page.waitForTimeout(250);
  } catch (_) {
    // no bloquear la exportación si llega a timeout
  }
}


// --- helpers ---
function fetchHttps(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function logoToDataUri(logoInput, distDir) {
  if (!logoInput) return '';

  const u = String(logoInput).trim();

  // If it's an absolute HTTP(S) URL, try to fetch and embed as data URI so it works in header/footer.
  if (/^https?:\/\//i.test(u)) {
    try {
      const buf = await fetchHttps(u);
      // Try to infer mime by extension
      const ext = path.extname(new URL(u).pathname).toLowerCase();
      const mime = ext === '.png' ? 'image/png'
        : (ext === '.webp' ? 'image/webp'
        : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
        : (ext === '.svg') ? 'image/svg+xml'
        : 'application/octet-stream');
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      // Fallback: return the original URL (may still work on cover, but header/footer prefers data URIs)
      return u;
    }
  }

  // Local/relative path → resolve and embed
  let abs = u.startsWith('/') ? u : path.resolve(distDir, u.replace(/^\.\//,''));
  if (!exists(abs)) {
    const maybe = path.resolve(distDir, 'html', u.replace(/^\.\//,'').replace(/^html\//,''));
    if (exists(maybe)) abs = maybe;
  }
  try {
    const buf = await fsp.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
      : ext === '.svg' ? 'image/svg+xml'
      : 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

// ---------- CSS (print) ----------
function makePrintCss() {
  return `
@page { size: A4; margin: 18mm 14mm 18mm 14mm; }
* { box-sizing: border-box !important; }
html, body {
  margin:0 !important; padding:0 !important;
  background:#ffffff !important; color:#0b0f16 !important;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
}
/* Neutralize dark UI from web bundle */
body, .card, .panel, .box, .bg, .bg-slate-900, .bg-slate-800, .bg-slate-700, .chart-card {
  background:#ffffff !important; color:#0b0f16 !important;
}
/* COVER (dark) */
.cover-page {
  page-break-after: always !important;
  background:#0b0f16 !important; color:#e5e7eb !important;
  min-height:100vh; padding:24mm 18mm !important; position: relative;
}
.cover-top{ display:flex; justify-content:space-between; align-items:flex-start; }
.cover-brand img{ max-height:52px; }
.cover-meta{ text-align:right; color:#9ca3af; font-size:12px; }
.cover-meta-ts{ font-weight:600; }
.cover-title{ margin-top:40mm; }
.cover-title .line1{ font-size:22px; font-weight:700; margin:0 0 6px 0; }
.cover-title .line2{ font-size:18px; color:#cbd5e1; }
.cover-cards{
  position:absolute; left:18mm; right:18mm; bottom:18mm;
  display:grid; grid-template-columns:1fr 1fr; gap:12px;
}
.card-dark{ border:1px solid #1f2937; border-radius:10px; padding:10px; background:#111827; }
.card-dark .card-title{ font-weight:700; margin-bottom:6px; color:#e5e7eb; }
.card-dark .kv{ display:grid; grid-template-columns:110px 1fr; gap:4px 10px; font-size:13px; line-height:1.35; }

/* PAGES */
.page { page-break-before: always !important; background:#fff !important; }
.section-wrap{ padding:6mm 0 !important; }
.section-title{ font-size:20px !important; margin:0 0 8px 0 !important; }

/* Subsections (Summary) */
.subsection-title{
  font-weight:700; margin:12px 0 4px 0; padding-bottom:4px; border-bottom:2px solid #0b0f16;
}

/* Tables */
table{ width:100% !important; border-collapse: collapse !important; }
th,td{ text-align:left !important; padding:6px 8px !important; border-bottom:1px solid #e5e7eb !important; }
thead th{ background:#f3f4f6 !important; font-weight:600 !important; }

/* Print Dashboard — PDF-only grid */
.print-dash-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.print-dash-card{ border:1px solid #e5e7eb; border-radius:10px; padding:8px; }
.print-dash-card h4{ margin:0 0 6px 0; font-size:14px; }
.print-dash-card canvas{ width:100% !important; height:200px !important; }
.print-dash-span2{ grid-column:1 / span 2; }

/* Hide interactive elements */
#app-menu, #app-header, nav, .controls, .filters, .btn, button{ display:none !important; }

/* Links / code */
a{ color:#1d4ed8 !important; text-decoration:none !important; }
a:hover{ text-decoration:underline !important; }
code{ background:#eef2ff !important; padding:2px 6px !important; border-radius:6px !important; }
`.trim();
}

// ---------- Sections plan ----------
function sectionPlan() {
  return [
    { num: 1, id: 'introduction',   title: 'Introduction',                 file: 'overview.html' },
    { num: 2, id: 'summary',        title: 'Summary',                      file: 'summary.html' },
    { num: 3, id: 'vuln-diff-table',title: 'Vulnerability Diff Table',     file: 'vuln-diff-table.html' },
    { num: 4, id: 'dashboard',      title: 'Dashboard',                    file: null /* PDF-only dashboard */ },
    { num: 5, id: 'dep-graph-base', title: 'Dependency Graph — Base',      file: 'dep-graph-base.html' },
    { num: 6, id: 'dep-graph-head', title: 'Dependency Graph — Head',      file: 'dep-graph-head.html' },
    { num: 7, id: 'dep-paths-base', title: 'Dependency Paths — Base',      file: 'dep-paths-base.html' },
    { num: 8, id: 'dep-paths-head', title: 'Dependency Paths — Head',      file: 'dep-paths-head.html' },
    { num: 9, id: 'fix-insights',   title: 'Fix Insights',                 file: null /* always built */ },
  ];
}

// ---------- HTML helpers ----------
function coverHtml({ repo, base, head, generatedAt, logoDataUri }) {
  return `
<div class="cover-page">
  <div class="cover-top">
    <div class="cover-brand">
      ${logoDataUri ? `<img src="${logoDataUri}" alt="logo" />` : ''}
    </div>
    <div class="cover-meta">
      <div>Generated at</div>
      <div class="cover-meta-ts">${generatedAt}</div>
    </div>
  </div>

  <div class="cover-title">
    <div class="line1">Vulnerability Diff Report</div>
    <div class="line2">${repo}</div>
  </div>

  <div class="cover-cards">
    <div class="card-dark">
      <div class="card-title">Base</div>
      <div class="kv"><div>Ref</div><div>${base.ref}</div></div>
      <div class="kv"><div>Commit</div><div>${base.shaShort} (${base.sha})</div></div>
      <div class="kv"><div>Author</div><div>${base.author}</div></div>
      <div class="kv"><div>Authored at</div><div>${base.authoredAt}</div></div>
      <div class="kv"><div>Subject</div><div>${base.commitSubject}</div></div>
    </div>
    <div class="card-dark">
      <div class="card-title">Head</div>
      <div class="kv"><div>Ref</div><div>${head.ref}</div></div>
      <div class="kv"><div>Commit</div><div>${head.shaShort} (${head.sha})</div></div>
      <div class="kv"><div>Author</div><div>${head.author}</div></div>
      <div class="kv"><div>Authored at</div><div>${head.authoredAt}</div></div>
      <div class="kv"><div>Subject</div><div>${head.commitSubject}</div></div>
    </div>
  </div>
</div>
`.trim();
}

function tocHtml(repo) {
  const items = sectionPlan().map(s => `<li>${s.title}</li>`).join('');
  return `
<div class="page">
  <div class="section-wrap">
    <h2 class="section-title">Table of Contents — ${repo}</h2>
    <ol>${items}</ol>
  </div>
</div>
`.trim();
}

function sectionWrapper({ id, title, num, innerHtml }) {
  return `
<div class="page" id="${id}">
  <div class="section-wrap">
    <h2 class="section-title">${num}. ${title}</h2>
    ${innerHtml || '<p>[empty]</p>'}
  </div>
</div>
`.trim();
}

// ---------- Load diff.json ----------
async function loadDiff(distDir) {
  const p = path.join(distDir, 'diff.json');
  try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return null; }
}
const pkgStr = (p) => p ? `${p.groupId ? p.groupId + ':' : ''}${p.artifactId || ''}${p.version ? ':' + p.version : ''}` : '—';

// ---------- Fallback: Vulnerability Diff Table ----------
async function buildVulnTableFromJson(distDir) {
  const diffPath = path.join(distDir, 'diff.json');
  let diff;
  try {
    diff = JSON.parse(await fsp.readFile(diffPath, 'utf8'));
  } catch {
    return '<p>[diff.json not found or invalid]</p>';
  }

  const items = Array.isArray(diff.items) ? diff.items : [];
  if (!items.length) return '<p>No vulnerabilities to display.</p>';

  // Orden deseado por severidad (desc) y luego por Package (asc)
  const sevRank = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 1 };
  const normSev = (s) => (s || 'UNKNOWN').toUpperCase();
  const pkgStr = (pkg) => {
    if (!pkg) return '';
    const g = pkg.groupId || '';
    const a = pkg.artifactId || pkg.name || '';
    const v = pkg.version || '';
    if (a && v && g) return `${g}:${a}:${v}`;
    if (a && v) return `${a}:${v}`;
    return a || v || '';
  };

  // Normalizamos campos que usaremos y ordenamos
  const rowsData = items.map(it => {
    const severity = normSev(it.severity);
    const pkg = pkgStr(it.package);
    const url = (Array.isArray(it.urls) && it.urls[0]) ? it.urls[0] : (it.url || '');
    const vulnId = it.id || it.vulnerabilityId || '';
    const status = it.state || it.status || '';
    return {
      severity,
      pkg,
      vulnHtml: url ? `<a href="${url}">${vulnId}</a>` : (vulnId || '—'),
      status: status || '—'
    };
  }).sort((a, b) => {
    const rA = sevRank[a.severity] || 0;
    const rB = sevRank[b.severity] || 0;
    if (rA !== rB) return rB - rA; // desc por severidad
    return (a.pkg || '').localeCompare(b.pkg || '', 'en', { sensitivity: 'base' });
  });

  const rowsHtml = rowsData.map(r => `
    <tr>
      <td>${r.severity}</td>
      <td>${r.vulnHtml}</td>
      <td>${r.pkg || '—'}</td>
      <td>${r.status}</td>
    </tr>
  `).join('');

  return `
<table>
  <thead>
    <tr>
      <th>Severity</th>
      <th>Vulnerability</th>
      <th>Package</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHtml}
  </tbody>
</table>
`.trim();
}


// ---------- PDF-only Dashboard ----------
function computeDashData(items) {
  const states = ['NEW','REMOVED','UNCHANGED'];
  const severities = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];

  const stateTotals = states.map(s => items.filter(x => x.state === s).length);
  const newVsRemoved = severities.map(sev => ({
    sev,
    NEW: items.filter(x => x.state==='NEW'      && (x.severity||'UNKNOWN')===sev).length,
    REMOVED: items.filter(x => x.state==='REMOVED'  && (x.severity||'UNKNOWN')===sev).length
  }));
  const stacked = severities.map(sev => ({
    sev,
    NEW: items.filter(x => x.state==='NEW'      && (x.severity||'UNKNOWN')===sev).length,
    REMOVED: items.filter(x => x.state==='REMOVED'  && (x.severity||'UNKNOWN')===sev).length,
    UNCHANGED: items.filter(x => x.state==='UNCHANGED' && (x.severity||'UNKNOWN')===sev).length
  }));
  return { states, severities, stateTotals, newVsRemoved, stacked };
}
function buildPdfDashboardHtml(dash) {
  // PDF-only dashboard: canvases + inline render con Chart.js y bandera __chartsReady,
  // e incluye tablas numéricas con los mismos datos justo debajo de cada gráfico.
  const dataJson = JSON.stringify(dash);

  // --- Tablas numéricas (renderizadas estáticamente en el HTML) ---
  // 1) Totales por estado
  const states = ['NEW','REMOVED','UNCHANGED'];
  const stateTotalsRows = states.map((s, i) => {
    const v = (dash.stateTotals && dash.stateTotals[i]) || 0;
    return `<tr><td>${s}</td><td>${v}</td></tr>`;
  }).join('');
  const stateTotalsSum = (dash.stateTotals || []).reduce((a,b)=>a+(b||0),0);
  const stateTotalsTable = `
    <table>
      <thead><tr><th>State</th><th>Count</th></tr></thead>
      <tbody>${stateTotalsRows}<tr><td><strong>Total</strong></td><td><strong>${stateTotalsSum}</strong></td></tr></tbody>
    </table>
  `.trim();

  // 2) NEW vs REMOVED por severidad
  const nvrHeader = `<thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th><th>Total</th></tr></thead>`;
  const nvrRows = (dash.newVsRemoved || []).map(row => {
    const newV = row.NEW || 0;
    const remV = row.REMOVED || 0;
    return `<tr><td>${row.sev}</td><td>${newV}</td><td>${remV}</td><td>${newV + remV}</td></tr>`;
  }).join('');
  const nvrTable = `<table>${nvrHeader}<tbody>${nvrRows}</tbody></table>`;

  // 3) Stacked por severidad y estado
  const stkHeader = `<thead><tr><th>Severity</th><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th><th>Total</th></tr></thead>`;
  const stkRows = (dash.stacked || []).map(row => {
    const n = row.NEW || 0, r = row.REMOVED || 0, u = row.UNCHANGED || 0;
    return `<tr><td>${row.sev}</td><td>${n}</td><td>${r}</td><td>${u}</td><td>${n + r + u}</td></tr>`;
  }).join('');
  const stkTable = `<table>${stkHeader}<tbody>${stkRows}</tbody></table>`;

  return `
<div class="print-dash-grid">
  <div class="print-dash-card">
    <h4>Distribution by State</h4>
    <canvas id="chart-state-totals" width="800" height="200"></canvas>
    <div class="dash-table">
      <h5 style="margin:8px 0 4px 0;">Data</h5>
      ${stateTotalsTable}
    </div>
  </div>

  <div class="print-dash-card">
    <h4>NEW vs REMOVED by Severity</h4>
    <canvas id="chart-new-removed" width="800" height="200"></canvas>
    <div class="dash-table">
      <h5 style="margin:8px 0 4px 0;">Data</h5>
      ${nvrTable}
    </div>
  </div>

  <div class="print-dash-card print-dash-span2">
    <h4>By Severity & State (stacked)</h4>
    <canvas id="chart-stacked" width="800" height="220"></canvas>
    <div class="dash-table">
      <h5 style="margin:8px 0 4px 0;">Data</h5>
      ${stkTable}
    </div>
  </div>
</div>

<script>
  (function(){
    var DASH = ${dataJson};

    function ready(){
      try{
        if (typeof Chart === 'undefined') { window.__chartsReady = true; return; }

        // Chart 1: state totals
        var ctx1 = document.getElementById('chart-state-totals').getContext('2d');
        new Chart(ctx1, {
          type: 'bar',
          data: { labels: ['NEW','REMOVED','UNCHANGED'], datasets: [{ label: 'Count', data: DASH.stateTotals }] },
          options: { responsive:false, animation:false }
        });

        // Chart 2: NEW vs REMOVED por severidad
        var labels2 = (DASH.newVsRemoved || []).map(function(x){ return x.sev; });
        var dataNew = (DASH.newVsRemoved || []).map(function(x){ return x.NEW || 0; });
        var dataRemoved = (DASH.newVsRemoved || []).map(function(x){ return x.REMOVED || 0; });
        var ctx2 = document.getElementById('chart-new-removed').getContext('2d');
        new Chart(ctx2, {
          type: 'bar',
          data: { labels: labels2, datasets: [{ label: 'NEW', data: dataNew }, { label: 'REMOVED', data: dataRemoved }] },
          options: { responsive:false, animation:false }
        });

        // Chart 3: stacked por severidad & estado
        var labels3 = (DASH.stacked || []).map(function(x){ return x.sev; });
        var dNew = (DASH.stacked || []).map(function(x){ return x.NEW || 0; });
        var dRem = (DASH.stacked || []).map(function(x){ return x.REMOVED || 0; });
        var dUnc = (DASH.stacked || []).map(function(x){ return x.UNCHANGED || 0; });
        var ctx3 = document.getElementById('chart-stacked').getContext('2d');
        new Chart(ctx3, {
          type: 'bar',
          data: { labels: labels3, datasets: [{ label:'NEW', data:dNew }, { label:'REMOVED', data:dRem }, { label:'UNCHANGED', data:dUnc }] },
          options: {
            responsive:false, animation:false,
            plugins:{ legend:{ position:'top' } },
            scales:{ x:{ stacked:true }, y:{ stacked:true } }
          }
        });

        setTimeout(function(){ window.__chartsReady = true; }, 50);
      } catch(e){ window.__chartsReady = true; }
    }

    function waitForChartAndRender(){
      var tries = 0, max = 100; // ~5s
      var t = setInterval(function(){
        if (typeof Chart !== 'undefined') { clearInterval(t); ready(); }
        else if (++tries >= max) { clearInterval(t); window.__chartsReady = true; }
      }, 50);
    }

    if (typeof Chart !== 'undefined') { ready(); } else { waitForChartAndRender(); }
  })();
</script>
`.trim();
}


// ---------- Fix Insights (always built) ----------
async function buildFixInsightsFromJson(distDir) {
  const diff = await loadDiff(distDir);
  if (!diff || !Array.isArray(diff.items)) return '<p>[diff.json not found or empty]</p>';

  // "fix available" (sin cálculos pesados adicionales)
  const withFixAll = diff.items.filter(x => x.fix && x.fix.state === 'fixed');

  const groupByState = (arr) => {
    const g = { NEW:[], REMOVED:[], UNCHANGED:[] };
    for (const o of arr) (g[o.state] || (g[o.state]=[])).push(o);
    return g;
  };
  const G = groupByState(withFixAll);

  const mkRows = (arr) => arr.map(o=>{
    const url = o.urls && o.urls[0] ? o.urls[0] : '';
    const id = url ? `<a href="${url}">${o.id}</a>` : o.id;
    const tgt = o.fix && o.fix.versions && o.fix.versions[0] ? o.fix.versions[0] : '—';
    return `<tr>
      <td>${o.severity||'UNKNOWN'}</td>
      <td>${id}</td>
      <td>${pkgStr(o.package)}</td>
      <td>${o.state}</td>
      <td>${tgt}</td>
    </tr>`;
  }).join('');

  const section = (title, arr) => `
  <h4 class="subsection-title">${title}</h4>
  <table>
    <thead>
      <tr><th>Severity</th><th>Vulnerability</th><th>Package</th><th>State</th><th>Target Version</th></tr>
    </thead>
    <tbody>${mkRows(arr)}</tbody>
  </table>`.trim();

  return `
<div class="fix-insights">
  <div class="kpi-row" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:8px 0 12px 0">
    <div class="kpi"><div class="kpi-label">Total with Fix</div><div class="kpi-value">${withFixAll.length}</div></div>
    <div class="kpi"><div class="kpi-label">NEW</div><div class="kpi-value">${G.NEW.length}</div></div>
    <div class="kpi"><div class="kpi-label">REMOVED</div><div class="kpi-value">${G.REMOVED.length}</div></div>
    <div class="kpi"><div class="kpi-label">UNCHANGED</div><div class="kpi-value">${G.UNCHANGED.length}</div></div>
  </div>
  ${section('All with fix', withFixAll)}
  ${section('NEW with fix', G.NEW)}
  ${section('REMOVED with fix', G.REMOVED)}
  ${section('UNCHANGED with fix', G.UNCHANGED)}
</div>
`.trim();
}
// ---------- Dependency Paths (PDF-only) ----------
// side: 'base' | 'head'
function buildDependencyPathsSection(items, side) {
  const SEV_ORDER = { CRITICAL:5, HIGH:4, MEDIUM:3, LOW:2, UNKNOWN:1 };

  // Filtrado por lado
  const keep = (it) => {
    const st = String(it.state || '').toUpperCase();
    if (side === 'base') return st === 'REMOVED' || st === 'UNCHANGED';
    if (side === 'head') return st === 'NEW' || st === 'UNCHANGED';
    return true;
  };

  // Expandimos a pares (sev, module, tail) a partir de item.module_paths
  // tail es un string ya "hop1 -> hop2 -> ..."
  const triples = [];
  for (const it of (items || [])) {
    if (!keep(it)) continue;
    const sev = String(it.severity || 'UNKNOWN').toUpperCase();
    const mp = it.module_paths || {};
    for (const mod of Object.keys(mp)) {
      const tails = Array.isArray(mp[mod]) ? mp[mod] : [];
      if (!tails.length) {
        // Si por alguna razón no hay tail, igualmente mostramos el módulo sin tail.
        triples.push({ sev, module: mod, tail: '' });
      } else {
        for (const t of tails) {
          triples.push({ sev, module: mod, tail: t || '' });
        }
      }
    }
  }

  // Deduplicar: misma (sev, module, tail) solo una vez
  const uniq = new Map(); // key -> row
  for (const r of triples) {
    const key = `${r.sev}||${r.module}||${r.tail}`;
    if (!uniq.has(key)) uniq.set(key, r);
  }
  const rows = Array.from(uniq.values());

  if (!rows.length) {
    return `<p>No dependency paths to display for ${side === 'base' ? 'Base' : 'Head'}.</p>`;
  }

  // Orden: Severity desc, Module asc, Tail asc
  rows.sort((a, b) => {
    const ra = SEV_ORDER[a.sev] || 0, rb = SEV_ORDER[b.sev] || 0;
    if (ra !== rb) return rb - ra;
    const ma = a.module || '', mb = b.module || '';
    if (ma !== mb) return ma.localeCompare(mb, 'en', { sensitivity: 'base' });
    return (a.tail || '').localeCompare(b.tail || '', 'en', { sensitivity: 'base' });
  });

  // Agrupar por severidad
  const groups = rows.reduce((acc, r) => {
    (acc[r.sev] ||= []).push(r);
    return acc;
  }, {});

  // Render por bloques (severidad)
  const sevOrderArr = Object.keys(SEV_ORDER).sort((s1, s2) => (SEV_ORDER[s2] - SEV_ORDER[s1]));
  const sections = sevOrderArr
    .filter(sev => Array.isArray(groups[sev]) && groups[sev].length)
    .map(sev => {
      const trs = groups[sev].map(r => {
        const rhs = r.tail ? ` -> ${r.tail}` : '';
        return `<tr><td>${r.module}${rhs}</td></tr>`;
      }).join('');
      return `
        <h4 class="subsection-title">${sev}</h4>
        <table class="dep-paths-table">
          <thead><tr><th>Module → Path tail</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      `;
    }).join('\n');

  return `
<div class="dep-paths">
  ${sections}
</div>
`.trim();
}



// ---------- Assemble print.html ----------
async function buildPrintHtml({ distDir, view, logoDataUri }) {
  const htmlRoot = path.join(distDir, 'html');
  const sectionsDir = path.join(htmlRoot, 'sections');

  // Vendors (si existen)
  const vendorChartPath   = path.join(htmlRoot, 'assets', 'js', 'vendor', 'chart.umd.js');
  const vendorMermaidPath = path.join(htmlRoot, 'assets', 'js', 'vendor', 'mermaid.min.js');

  // Cargar vendors con rutas absolutas file://
  const chartTag   = exists(vendorChartPath)   ? `<script src="file://${vendorChartPath}"></script>`   : '';
  const mermaidTag = exists(vendorMermaidPath) ? `<script src="file://${vendorMermaidPath}"></script>` : '';

  // Cover + ToC
  let bodyInner = coverHtml({ repo:view.repo, base:view.base, head:view.head, generatedAt:view.generatedAt, logoDataUri });
  bodyInner += '\n' + tocHtml(view.repo);

  // diff.json para dashboard
  const diff = await loadDiff(distDir);
  const items = diff?.items || [];

  for (const s of sectionPlan()) {
    let inner = '';
    if (s.id === 'dashboard') {
      const dash = computeDashData(items);
      inner = buildPdfDashboardHtml(dash);
    } else if (s.id === 'vuln-diff-table') {
      const file = path.join(sectionsDir, 'vuln-diff-table.html');
      const raw = await readTextSafe(file);
      const hasRows = /<tbody[^>]*>\s*<tr[\s\S]*<\/tr>\s*<\/tbody>/i.test(raw);
      inner = (raw && hasRows) ? raw : await buildVulnTableFromJson(distDir);
    } else if (s.id === 'fix-insights') {
      inner = await buildFixInsightsFromJson(distDir);
    } else if (s.id === 'dep-paths-base') {
      // PDF-only: construir desde view.items (sin columna "Paths", sin filtros)
      inner = buildDependencyPathsSection(items, 'base');
    } else if (s.id === 'dep-paths-head') {
      // PDF-only: construir desde view.items (sin columna "Paths", sin filtros)
      inner = buildDependencyPathsSection(items, 'head');
    } else {
      const file = s.file ? path.join(sectionsDir, s.file) : null;
      inner = file ? await readTextSafe(file) : '';
      if (s.id === 'summary') {
        inner = inner
          .replace(/<h3[^>]*>\s*Tools\s*<\/h3>/i, '<h3 class="subsection-title">Tools</h3>')
          .replace(/<h3[^>]*>\s*Inputs\s*<\/h3>/i, '<h3 class="subsection-title">Inputs</h3>')
          .replace(/<h3[^>]*>\s*Base\s*<\/h3>/i, '<h3 class="subsection-title">Base</h3>')
          .replace(/<h3[^>]*>\s*Head\s*<\/h3>/i, '<h3 class="subsection-title">Head</h3>');
      }
    }
    bodyInner += '\n' + sectionWrapper({ id:s.id, title:s.title, num:s.num, innerHtml: inner });
  }

  // CSS de impresión (vivirá en dist/pdf/assets/print.css, ruta relativa desde print.html)
  const printCssHref = './assets/print.css';

  // Script inline para activar Mermaid y marcar __mermaidReady
  const mermaidInit = `
<script>
  (function(){
    function bootstrapMermaid() {
      try {
        if (!window.mermaid) { window.__mermaidReady = true; return; }
        // Seguridad laxa para permitir enlaces/estilos del bundle
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

        // Soportar bloques que vengan como <div class="mermaid">, o <pre><code class="language-mermaid">
        var blocks = Array.from(document.querySelectorAll('.mermaid, pre code.language-mermaid'));
        // Si algún bloque viene como texto suelto "graph LR", lo subimos a un <div class="mermaid">
        if (blocks.length === 0) {
          var candidates = Array.from(document.querySelectorAll('section, div, article'));
          candidates.forEach(function(ct){
            if (ct.textContent && /\\bgraph\\s+(LR|TD)\\b/.test(ct.textContent) && !ct.querySelector('.mermaid')) {
              var code = ct.textContent.trim();
              // Evita duplicar si ya hay algo renderizado
              if (code.length < 20000) { // protección básica
                var host = document.createElement('div');
                host.className = 'mermaid';
                host.textContent = code;
                ct.innerHTML = '';
                ct.appendChild(host);
              }
            }
          });
          blocks = Array.from(document.querySelectorAll('.mermaid, pre code.language-mermaid'));
        }

        // Normaliza <pre><code> a <div class="mermaid">
        blocks.forEach(function(el){
          if (el.tagName.toLowerCase() === 'code' && el.parentElement && el.parentElement.tagName.toLowerCase() === 'pre') {
            var code = el.textContent;
            var host = document.createElement('div');
            host.className = 'mermaid';
            host.textContent = code;
            el.parentElement.replaceWith(host);
          }
        });

        // Render
        window.mermaid.run().then(function(){ window.__mermaidReady = true; }).catch(function(){ window.__mermaidReady = true; });
      } catch(e) { window.__mermaidReady = true; }
    }

    // Espera breve por si el script mermaid aún no cargó
    if (window.mermaid) { bootstrapMermaid(); }
    else {
      var tries = 0, max = 100, t = setInterval(function(){
        if (window.mermaid) { clearInterval(t); bootstrapMermaid(); }
        else if (++tries >= max) { clearInterval(t); window.__mermaidReady = true; }
      }, 50);
    }
  })();
</script>`.trim();

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <link rel="stylesheet" href="${printCssHref}">
  ${chartTag}
  ${mermaidTag}
  <title>Vulnerability Diff Report — ${view.repo}</title>
</head>
<body>
${bodyInner}
${mermaidInit}
</body>
</html>
`.trim();
}


// ---------- Portable Chrome ----------
async function ensurePortableChrome(cacheDir) {
  const { install, computeExecutablePath } = require('@puppeteer/browsers');
  const platformMap = { linux:'linux', darwin:(os.arch()==='arm64'?'mac-arm':'mac'), win32:'win64' };
  const platform = platformMap[os.platform()];
  if (!platform) throw new Error(`Unsupported platform: ${os.platform()}`);
  const buildId = 'stable';
  await install({ browser:'chrome', buildId, cacheDir, platform });
  return computeExecutablePath({ browser:'chrome', cacheDir, platform, buildId });
}

function knownBrowserCandidates() {
  return [
    process.env.CHROMIUM_PATH || '',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
}
async function resolveBrowserExecutable(outDir){
  for (const p of knownBrowserCandidates()) if (exists(p)) return p;
  const cacheDir = path.join(outDir,'.browsers');
  await ensureDir(cacheDir);
  core.info('[render/pdf] no system browser found; downloading Chrome (stable) locally…');
  return await ensurePortableChrome(cacheDir);
}

// ---------- Header/Footer (with band + border) ----------
function headerTemplate({ logoDataUri, repo, generatedAt }) {
  const band = '#0b0f16'; // mismo color que la portada
  const img = logoDataUri
    ? `<img src="${logoDataUri}" style="height:12px;vertical-align:middle;margin-right:6px"/>`
    : '';
  return `
<style>
  /* Forzar impresión de fondos en el template */
  html, body { margin:0; padding:0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 6px 12px; }
  .bg { background-color: ${band}; color: #ffffff; }
  .txt { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:10px; }
  .left { display: inline-flex; align-items: center; gap: 6px; }
  .right { opacity: 0.9; float: right; }
</style>
<table class="txt bg">
  <tr>
    <td>
      <span class="left">${img}<span>Vulnerability Diff Report — ${repo}</span></span>
      <span class="right">${generatedAt}</span>
    </td>
  </tr>
</table>
`.trim();
}

function footerTemplate({ logoDataUri, baseRef, headRef, generatedAt }) {
  const band = '#0b0f16'; // mismo color que la portada
  const img = logoDataUri
    ? `<img src="${logoDataUri}" style="height:10px;vertical-align:middle;margin-right:6px"/>`
    : '';
  return `
<style>
  html, body { margin:0; padding:0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 6px 12px; }
  .bg { background-color: ${band}; color: #ffffff; }
  .txt { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size:10px; }
  .left { display: inline-flex; align-items: center; gap: 6px; }
  .right { opacity: 0.9; float: right; }
</style>
<table class="txt bg">
  <tr>
    <td>
      <span class="left">${img}BASE: ${baseRef} → HEAD: ${headRef}</span>
      <span class="right">${generatedAt} — <span class="pageNumber"></span>/<span class="totalPages"></span></span>
    </td>
  </tr>
</table>
`.trim();
}




// ---------- Entry ----------
async function pdf_init({ distDir = './dist' } = {}) {
  core.startGroup('[render] PDF');
  try {
    const view = buildView(distDir);

    const outDir = path.join(path.resolve(distDir), 'pdf');
    const assetsDir = path.join(outDir, 'assets');
    await ensureDir(outDir);
    await ensureDir(assetsDir);

    // CSS
    await writeText(path.join(assetsDir,'print.css'), makePrintCss());

    // Logo (force data URI even if html_logo_url is remote)
    const logoInput = core.getInput('html_logo_url') || '';
    const logoDataUri = await logoToDataUri(logoInput, path.resolve(distDir));

    // Assemble HTML (includes PDF-only dashboard & Fix Insights)
    const html = await buildPrintHtml({ distDir: path.resolve(distDir), view, logoDataUri });
    const htmlPath = path.join(outDir, 'print.html');
    await writeText(htmlPath, html);

    // Browser
    let pptr;
    try { pptr = require('puppeteer-core'); }
    catch { throw new Error('puppeteer-core is not installed.\nPlease add "puppeteer-core" to your dependencies.'); }

    const executablePath = await resolveBrowserExecutable(outDir);
    const browser = await pptr.launch({ headless: 'new', executablePath, args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    // IMPORTANT: load via file://
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });

    // Export cover only (no header/footer)
    const coverPdf = path.join(outDir, 'cover.pdf');
    await waitForCharts(page); // (cover doesn't need charts, but keep a small wait symmetry)
    await page.pdf({
      path: coverPdf,
      printBackground: true,
      displayHeaderFooter: false,
      margin:{top:'0mm',right:'0mm',bottom:'0mm',left:'0mm'},
      format:'A4',
      pageRanges:'1'
    });

    // Export rest with header/footer (band + border; logo as data-uri)
    const restPdf = path.join(outDir, 'rest.pdf');
    await page.pdf({
      path: restPdf,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplate({ logoDataUri, repo: view.repo, generatedAt: view.generatedAt }),
      footerTemplate: footerTemplate({ logoDataUri, baseRef: view.base.ref, headRef: view.head.ref, generatedAt: view.generatedAt }),
      margin: { top:'20mm', right:'14mm', bottom:'16mm', left:'14mm' },
      format: 'A4',
      pageRanges: '2-'
    });

    await browser.close();

    // Merge cover + rest
    const finalPdf = path.join(outDir, 'report.pdf');
    const coverDoc = await PDFDocument.load(await fsp.readFile(coverPdf));
    const restDoc = await PDFDocument.load(await fsp.readFile(restPdf));
    const dest = await PDFDocument.create();
    const [c] = await dest.copyPages(coverDoc,[0]);
    dest.addPage(c);
    const rp = await dest.copyPages(restDoc, restDoc.getPageIndices());
    rp.forEach(p=>dest.addPage(p));
    await fsp.writeFile(finalPdf, await dest.save());
    core.info(`[render/pdf] exported: ${finalPdf}`);
  } catch (e) {
    core.setFailed(`[render] PDF failed: ${e?.message || e}`);
    throw e;
  } finally {
    core.endGroup();
  }
}

module.exports = { pdf_init };
