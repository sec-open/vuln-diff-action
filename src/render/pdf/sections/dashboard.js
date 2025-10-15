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

function tablesBlock(agg){
  const totals = tableFromArray(['NEW','REMOVED','UNCHANGED'], [[
    agg.totalsByState.NEW, agg.totalsByState.REMOVED, agg.totalsByState.UNCHANGED
  ]]);
  const sevRows = SEV_ORDER.map(sev => {
    const r = agg.matrixSevState[sev] || { NEW:0, REMOVED:0, UNCHANGED:0 };
    return [sev, r.NEW, r.REMOVED, r.UNCHANGED];
  });
  const sevTbl = tableFromArray(['Severity','NEW','REMOVED','UNCHANGED'], sevRows);
  return `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0;">
  <div><h4>Totals by State</h4>${totals}</div>
  <div><h4>Severity × State</h4>${sevTbl}</div>
</div>`.trim();
}

function chartsBlock(idPrefix){
  return `
<div style="display:grid;grid-template-columns:1fr;gap:14px;">
  <div><h4>Distribution by State</h4><canvas id="${idPrefix}-state" style="width:100%;height:280px;"></canvas></div>
  <div><h4>NEW vs REMOVED by Severity</h4><canvas id="${idPrefix}-new-removed" style="width:100%;height:280px;"></canvas></div>
  <div><h4>By Severity &amp; State (stacked)</h4><canvas id="${idPrefix}-sev-state" style="width:100%;height:280px;"></canvas></div>
</div>`.trim();
}

function dashboardHtml(view){
  const items = Array.isArray(view?.diff?.items) ? view.diff.items : (Array.isArray(view?.items) ? view.items : []);
  const agg = aggregate(items);
  const modules = Object.keys(agg.modules).sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));

  // 4 + 4.1 Overview — UNA página
  const sec4_overview = `
<section class="page" id="dashboard">
  <h2>4. Dashboard</h2>
  <h3>4.1 Overview</h3>
  ${chartsBlock('chart-overview')}
  ${tablesBlock(agg.overview)}
</section>`.trim();

  // 4.2 Modules — página nueva con 4.2.1 en la misma
  const firstMod = modules[0];
  const firstSlug = slugify(firstMod || 'module0');
  const sec4_2_header_and_first = `
<section class="page" id="dashboard-modules">
  <h3>4.2 Modules</h3>
  <h4>4.2.1 ${firstMod || '—'}</h4>
  ${chartsBlock('chart-' + firstSlug)}
  ${firstMod ? tablesBlock(agg.modules[firstMod]) : ''}
</section>`.trim();

  // 4.2.2… — cada módulo en su propia página
  const rest = modules.slice(1);
  const perModule = rest.map((m,i)=>{
    const s = slugify(m);
    return (
      '<section class="page" id="dashboard-mod-' + s + '">' +
      '<h4>4.2.' + (i+2) + ' ' + m + '</h4>' +
      chartsBlock('chart-' + s) +
      tablesBlock(agg.modules[m]) +
      '</section>'
    ).trim();
  }).join('\n');

  // Script de Chart.js (no toca exporter; sólo emite señales compatibles)
  const payload = {
    SEV_ORDER, STATE_ORDER,
    overview: agg.overview,
    modules: modules.map((m, idx)=>({ name:m, slug:slugify(m||('module'+idx)), data: agg.modules[m] }))
  };

  const script = `
  <script>(function(){
    if (typeof window==='undefined' || typeof document==='undefined') return;
    if (!window.Chart) { window.__chartsReady = true; return; }  // <-- señal para waitForVisuals si no hay Chart
    if (window.Chart.defaults && window.Chart.defaults.animation!=null) window.Chart.defaults.animation = false;
    if (!window.__requireReady) window.__requireReady = function(){};
    if (!window.__markSectionReady) window.__markSectionReady = function(){};
    try { window.__requireReady('dashboard'); } catch(e){}

    var data = ${JSON.stringify(payload)};

    function draw(id, cfg){ var el = document.getElementById(id); if (!el) return; try { new Chart(el.getContext('2d'), cfg); } catch(e){} }

    function drawOverview(){
      var o = data.overview;
      draw('chart-overview-state', {
        type:'bar',
        data:{ labels:data.STATE_ORDER, datasets:[{label:'Count', data:data.STATE_ORDER.map(function(s){return o.totalsByState[s]||0;})}] },
        options:{ responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}}, scales:{x:{stacked:false},y:{stacked:false,beginAtZero:true}} }
      });
      draw('chart-overview-new-removed', {
        type:'bar',
        data:{ labels:data.SEV_ORDER, datasets:[
          {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=o.newVsRemovedBySeverity[s]||{};return r.NEW||0;})},
          {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=o.newVsRemovedBySeverity[s]||{};return r.REMOVED||0;})}
        ]},
        options:{ responsive:true, maintainAspectRatio:false, animation:false, scales:{x:{stacked:false},y:{stacked:false,beginAtZero:true}} }
      });
      draw('chart-overview-sev-state', {
        type:'bar',
        data:{ labels:data.SEV_ORDER, datasets:[
          {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=o.matrixSevState[s]||{};return r.NEW||0;}), stack:'s1'},
          {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=o.matrixSevState[s]||{};return r.REMOVED||0;}), stack:'s1'},
          {label:'UNCHANGED', data:data.SEV_ORDER.map(function(s){var r=o.matrixSevState[s]||{};return r.UNCHANGED||0;}), stack:'s1'}
        ]},
        options:{ responsive:true, maintainAspectRatio:false, animation:false, scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}} }
      });
    }

    function drawModule(mod){
      var base = 'chart-' + mod.slug;
      var m = mod.data || { totalsByState:{}, newVsRemovedBySeverity:{}, matrixSevState:{} };
      draw(base + '-state', {
        type:'bar',
        data:{ labels:data.STATE_ORDER, datasets:[{label:'Count', data:data.STATE_ORDER.map(function(s){return (m.totalsByState||{})[s]||0;})}] },
        options:{ responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}}, scales:{x:{stacked:false},y:{stacked:false,beginAtZero:true}} }
      });
      draw(base + '-new-removed', {
        type:'bar',
        data:{ labels:data.SEV_ORDER, datasets:[
          {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=(m.newVsRemovedBySeverity||{})[s]||{};return r.NEW||0;})},
          {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=(m.newVsRemovedBySeverity||{})[s]||{};return r.REMOVED||0;})}
        ]},
        options:{ responsive:true, maintainAspectRatio:false, animation:false, scales:{x:{stacked:false},y:{stacked:false,beginAtZero:true}} }
      });
      draw(base + '-sev-state', {
        type:'bar',
        data:{ labels:data.SEV_ORDER, datasets:[
          {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=(m.matrixSevState||{})[s]||{};return r.NEW||0;}), stack:'s1'},
          {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=(m.matrixSevState||{})[s]||{};return r.REMOVED||0;}), stack:'s1'},
          {label:'UNCHANGED', data:data.SEV_ORDER.map(function(s){var r=(m.matrixSevState||{})[s]||{};return r.UNCHANGED||0;}), stack:'s1'}
        ]},
        options:{ responsive:true, maintainAspectRatio:false, animation:false, scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}} }
      });
    }

    try {
      drawOverview();
      (data.modules||[]).forEach(drawModule);
    } finally {
      try { window.__markSectionReady('dashboard'); } catch(e){}
      // Señales que espera tu waitForVisuals
      window.__chartsReady = true;          // <-- clave para waitForVisuals
      window.__ALL_SECTIONS_READY = true;   // (opcional, ya lo usabas)
      window.PDF_READY = true;              // (opcional, compat)
    }
  })();</script>`.trim();


  return [sec4_overview, sec4_2_header_and_first, perModule, script].join('\n');
}

module.exports = { dashboardHtml };
