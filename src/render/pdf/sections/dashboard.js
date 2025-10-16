// src/render/pdf/sections/dashboard.js
const SEV_ORDER = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
const STATE_ORDER = ['NEW','REMOVED','UNCHANGED'];

function sevKey(s){ return String(s||'UNKNOWN').toUpperCase(); }
function stateKey(s){ return String(s||'').toUpperCase(); }

function deriveModuleNamesFromItem(it){
  const mp = it && it.module_paths ? it.module_paths : {};
  const keys = Object.keys(mp || {});
  if (keys.length) return keys;
  if (it && it.module) return [String(it.module)];
  return ['—'];
}

function aggregate(items = []){
  const agg = {
    overview: {
      totalsByState: { NEW:0, REMOVED:0, UNCHANGED:0 },
      newVsRemovedBySeverity: {},
      matrixSevState: {}
    },
    modules: {}
  };
  for (const s of SEV_ORDER){
    agg.overview.newVsRemovedBySeverity[s] = { NEW:0, REMOVED:0 };
    agg.overview.matrixSevState[s] = { NEW:0, REMOVED:0, UNCHANGED:0 };
  }
  for (const it of items){
    const sev = sevKey(it.severity);
    const st = stateKey(it.state);
    if (!STATE_ORDER.includes(st)) continue;

    agg.overview.totalsByState[st] += 1;
    agg.overview.matrixSevState[sev][st] += 1;
    if (st === 'NEW' || st === 'REMOVED') agg.overview.newVsRemovedBySeverity[sev][st] += 1;

    const mods = deriveModuleNamesFromItem(it);
    for (const m of mods){
      if (!agg.modules[m]){
        agg.modules[m] = {
          totalsByState: { NEW:0, REMOVED:0, UNCHANGED:0 },
          newVsRemovedBySeverity: {},
          matrixSevState: {}
        };
        for (const s of SEV_ORDER){
          agg.modules[m].newVsRemovedBySeverity[s] = { NEW:0, REMOVED:0 };
          agg.modules[m].matrixSevState[s] = { NEW:0, REMOVED:0, UNCHANGED:0 };
        }
      }
      agg.modules[m].totalsByState[st] += 1;
      agg.modules[m].matrixSevState[sev][st] += 1;
      if (st === 'NEW' || st === 'REMOVED') agg.modules[m].newVsRemovedBySeverity[sev][st] += 1;
    }
  }
  return agg;
}

function slugify(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'module';
}

function tableFromArray(headers, rows){
  const thead = `<thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="compact">${thead}<tbody>${tbody}</tbody></table>`;
}

function tablesBlock3(agg){
  const totals = tableFromArray(['NEW','REMOVED','UNCHANGED'], [[
    agg.totalsByState.NEW, agg.totalsByState.REMOVED, agg.totalsByState.UNCHANGED
  ]]);

  const nrRows = SEV_ORDER.map(sev => {
    const r = agg.newVsRemovedBySeverity[sev] || { NEW:0, REMOVED:0 };
    return [sev, r.NEW, r.REMOVED];
  });
  const newRemovedTbl = tableFromArray(['Severity','NEW','REMOVED'], nrRows);

  const sevRows = SEV_ORDER.map(sev => {
    const r = agg.matrixSevState[sev] || { NEW:0, REMOVED:0, UNCHANGED:0 };
    return [sev, r.NEW, r.REMOVED, r.UNCHANGED];
  });
  const sevTbl = tableFromArray(['Severity','NEW','REMOVED','UNCHANGED'], sevRows);

  return `
<div class="dash tables-3 no-break">
  <div><h4>Totals by State</h4>${totals}</div>
  <div><h4>NEW vs REMOVED by Severity</h4>${newRemovedTbl}</div>
  <div><h4>Severity × State</h4>${sevTbl}</div>
</div>`.trim();
}

function chartsBlock(idPrefix){
  return `
<div class="dash charts-3 no-break">
  <div class="chart-box"><h4>Distribution by State</h4><canvas class="chart-compact" id="${idPrefix}-state" width="220" height="90"></canvas></div>
  <div class="chart-box"><h4>NEW vs REMOVED by Severity</h4><canvas class="chart-compact" id="${idPrefix}-new-removed" width="220" height="90"></canvas></div>
  <div class="chart-box"><h4>By Severity &amp; State (stacked)</h4><canvas class="chart-compact" id="${idPrefix}-sev-state" width="220" height="90"></canvas></div>
</div>`.trim();
}

function dashboardHtml(view){
  const items = Array.isArray(view?.diff?.items) ? view.diff.items : (Array.isArray(view?.items) ? view.items : []);
  const agg = aggregate(items);
  const modules = Object.keys(agg.modules).sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));

  const style = `
<style>
  /* Todo este bloque cabe en una página A4 con márgenes estándar */
  #dashboard, [id^="dashboard-mod"] { break-inside: avoid; page-break-inside: avoid; }
  .dash h4 { margin: 3px 0 3px; font-size: 10px; line-height: 1.15; }
  .charts-3 { display:grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 2px 0 6px; }
  .tables-3 { display:grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 0; }
  .chart-box { display:flex; flex-direction:column; gap:3px; overflow:hidden; }
  .chart-compact { width: 220px; height: 90px; display:block; }
  #dashboard table.compact, [id^="dashboard-mod"] table.compact { font-size: 9px; line-height: 1.25; }
  #dashboard table.compact th, #dashboard table.compact td,
  [id^="dashboard-mod"] table.compact th, [id^="dashboard-mod"] table.compact td { padding: 3px 6px; }
  .no-break, .no-break * { break-inside: avoid; page-break-inside: avoid; }
</style>`.trim();

  // 4 + 4.1 Overview — una sola página
  const sec4_overview = `
<section class="page" id="dashboard">
  <h2>4. Dashboard</h2>
  <h3>4.1 Overview</h3>
  ${chartsBlock('chart-overview')}
  ${tablesBlock3(agg.overview)}
</section>`.trim();

  // 4.2 Modules — nueva página, con 4.2.1 en la misma
  const firstMod = modules[0];
  const firstSlug = slugify(firstMod || 'module0');
  const sec4_2_header_and_first = `
<section class="page" id="dashboard-modules">
  <h3>4.2 Modules</h3>
  <h4>4.2.1 ${firstMod || '—'}</h4>
  ${chartsBlock('chart-' + firstSlug)}
  ${firstMod ? tablesBlock3(agg.modules[firstMod]) : ''}
</section>`.trim();

  // 4.2.2… — cada módulo en su propia página
  const rest = modules.slice(1);
  const perModule = rest.map((m,i)=>{
    const s = slugify(m);
    return `
<section class="page" id="dashboard-mod-${s}">
  <h4>4.2.${i + 2} ${m}</h4>
  ${chartsBlock('chart-' + s)}
  ${tablesBlock3(agg.modules[m])}
</section>`.trim();
  }).join('\n');

  const payload = {
    SEV_ORDER, STATE_ORDER,
    overview: agg.overview,
    modules: modules.map((m, idx)=>({ name:m, slug:slugify(m||('module'+idx)), data: agg.modules[m] }))
  };

  const script = `
<script>(function(){
  if (typeof window==='undefined' || typeof document==='undefined') return;
  if (!window.Chart) { window.__chartsReady = true; return; }

  // Nada de responsive para que no crezca; bitmap fijo y DPI plano
  try {
    window.Chart.defaults.responsive = false;
    window.Chart.defaults.maintainAspectRatio = false;
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
  } catch(e){}

  var data = ${JSON.stringify(payload)};

  function lockCanvas(el){
    if (!el) return;
    el.style.width = '220px';
    el.style.height = '90px';
    if (el.width !== 220) el.width = 220;
    if (el.height !== 90) el.height = 90;
  }

  function draw(id, cfg){
    var el = document.getElementById(id);
    if (!el) return;
    lockCanvas(el);
    try { new Chart(el.getContext('2d'), cfg); } catch(e){}
  }

  function drawOverview(){
    var o = data.overview;
    draw('chart-overview-state', {
      type:'bar',
      data:{ labels:data.STATE_ORDER, datasets:[{label:'Count', data:data.STATE_ORDER.map(function(s){return o.totalsByState[s]||0;})}] },
      options:{ animation:false, plugins:{legend:{display:false}}, scales:{x:{stacked:false},y:{stacked:false,beginAtZero:true}} }
    });
    draw('chart-overview-new-removed', {
      type:'bar',
      data:{ labels:data.SEV_ORDER, datasets:[
        {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=o.newVsRemovedBySeverity[s]||{};return r.NEW||0;})},
        {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=o.newVsRemovedBySeverity[s]||{};return r.REMOVED||0;})}
      ]},
      options:{ animation:false, scales:{x:{stacked:false},y:{stacked:false,beginAtZero:true}} }
    });
    draw('chart-overview-sev-state', {
      type:'bar',
      data:{ labels:data.SEV_ORDER, datasets:[
        {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=o.matrixSevState[s]||{};return r.NEW||0;}), stack:'s1'},
        {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=o.matrixSevState[s]||{};return r.REMOVED||0;}), stack:'s1'},
        {label:'UNCHANGED', data:data.SEV_ORDER.map(function(s){var r=o.matrixSevState[s]||{};return r.UNCHANGED||0;}), stack:'s1'}
      ]},
      options:{ animation:false, scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}} }
    });
  }

  function drawModule(mod){
    var base = 'chart-' + mod.slug;
    var m = mod.data || { totalsByState:{}, newVsRemovedBySeverity:{}, matrixSevState:{} };
    draw(base + '-state', {
      type:'bar',
      data:{ labels:data.STATE_ORDER, datasets:[{label:'Count', data:data.STATE_ORDER.map(function(s){return (m.totalsByState||{})[s]||0;})}] },
      options:{ animation:false, plugins:{legend:{display:false}}, scales:{x:{stacked:false},y:{stacked:false,beginAtZero:true}} }
    });
    draw(base + '-new-removed', {
      type:'bar',
      data:{ labels:data.SEV_ORDER, datasets:[
        {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=(m.newVsRemovedBySeverity||{})[s]||{};return r.NEW||0;})},
        {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=(m.newVsRemovedBySeverity||{})[s]||{};return r.REMOVED||0;})}
      ]},
      options:{ animation:false, scales:{x:{stacked:false},y:{stacked:false,beginAtZero:true}} }
    });
    draw(base + '-sev-state', {
      type:'bar',
      data:{ labels:data.SEV_ORDER, datasets:[
        {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=(m.matrixSevState||{})[s]||{};return r.NEW||0;}), stack:'s1'},
        {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=(m.matrixSevState||{})[s]||{};return r.REMOVED||0;}), stack:'s1'},
        {label:'UNCHANGED', data:data.SEV_ORDER.map(function(s){var r=(m.matrixSevState||{})[s]||{};return r.UNCHANGED||0;}), stack:'s1'}
      ]},
      options:{ animation:false, scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}} }
    });
  }

  try {
    drawOverview();
    (data.modules||[]).forEach(drawModule);
  } finally {
    window.__chartsReady = true;
  }
})();</script>`.trim();

  return [style, sec4_overview, sec4_2_header_and_first, perModule, script].join('\n');
}

module.exports = { dashboardHtml };
