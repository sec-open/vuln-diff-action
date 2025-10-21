// PDF dashboard section: aggregates vulnerability data and embeds non-responsive Chart.js canvases.
// Provides overview (global) and per-module triplets (state distribution, NEW vs REMOVED, severity/state matrix).

const SEV_ORDER = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
const STATE_ORDER = ['NEW','REMOVED','UNCHANGED'];

function sevKey(s){ return String(s||'UNKNOWN').toUpperCase(); }
function stateKey(s){ return String(s||'').toUpperCase(); }

// Derives module names from an item (uses precomputed module_paths if available).
function deriveModuleNamesFromItem(it){
  const mp = it && it.module_paths ? it.module_paths : {};
  const keys = Object.keys(mp || {});
  if (keys.length) return keys;
  if (it && it.module) return [String(it.module)];
  return ['—'];
}

// Aggregates counts by severity/state at overview level and per module.
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

// Converts a string to a slug suitable for element IDs.
function slugify(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'module';
}

// Generic HTML table builder.
function tableFromArray(headers, rows){
  const thead = `<thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="compact">${thead}<tbody>${tbody}</tbody></table>`;
}

// Overview / module helper tables.
function tblTotalsByState(obj){
  return tableFromArray(['NEW','REMOVED','UNCHANGED'], [[
    obj.totalsByState.NEW, obj.totalsByState.REMOVED, obj.totalsByState.UNCHANGED
  ]]);
}
function tblNewRemovedBySeverity(obj){
  const rows = SEV_ORDER.map(sev=>{
    const r = obj.newVsRemovedBySeverity[sev] || { NEW:0, REMOVED:0 };
    return [sev, r.NEW, r.REMOVED];
  });
  return tableFromArray(['Severity','NEW','REMOVED'], rows);
}
function tblSevByState(obj){
  const rows = SEV_ORDER.map(sev=>{
    const r = obj.matrixSevState[sev] || { NEW:0, REMOVED:0, UNCHANGED:0 };
    return [sev, r.NEW, r.REMOVED, r.UNCHANGED];
  });
  return tableFromArray(['Severity','NEW','REMOVED','UNCHANGED'], rows);
}

// Renders a visualization pair (chart + data table) with a title.
function vizPair(prefix, title, tableHtml, canvasId){
  return `
<div class="viz-pair no-break">
  <div class="viz-title">${title}</div>
  <div class="viz-grid">
    <div class="viz-chart">
      <canvas class="chart-fixed" id="${prefix}-${canvasId}" width="520" height="180"></canvas>
    </div>
    <div class="viz-table">${tableHtml}</div>
  </div>
</div>`.trim();
}

// Renders the three stacked visualization pairs for a stats object.
function vizTriplet(prefix, statsObj){
  return [
    vizPair(prefix, 'Distribution by State', tblTotalsByState(statsObj), 'state'),
    vizPair(prefix, 'NEW vs REMOVED by Severity', tblNewRemovedBySeverity(statsObj), 'nr'),
    vizPair(prefix, 'By Severity & State (stacked)', tblSevByState(statsObj), 'sev')
  ].join('\n');
}

// Entry point: builds full dashboard HTML (overview + modules + chart script).
function dashboardHtml(view){
  const items = Array.isArray(view?.diff?.items) ? view.diff.items : (Array.isArray(view?.items) ? view.items : []);
  const agg = aggregate(items);
  const modules = Object.keys(agg.modules).sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));

  const style = `
<style>
  #dashboard, [id^="dashboard-mod"] { break-inside: avoid; page-break-inside: avoid; }
  .viz-pair { margin: 8px 0 10px; }
  .viz-title { font-size: 11px; font-weight: 600; margin: 2px 0 6px; }
  .viz-grid { display:grid; grid-template-columns: 2.1fr 1fr; gap: 10px; align-items:start; }
  .chart-fixed { width:520px; height:180px; display:block; }
  .viz-table table.compact { font-size: 10px; line-height: 1.25; }
  .viz-table th, .viz-table td { padding: 3px 6px; }
  .no-break, .no-break * { break-inside: avoid; page-break-inside: avoid; }
</style>`.trim();

  // Section 4.1 Overview (same page)
  const sec4_overview = `
<section class="page" id="dashboard">
  <h2>4. Dashboard</h2>
  <h3>4.1 Overview</h3>
  ${vizTriplet('chart-overview', agg.overview)}
</section>`.trim();

  // Section 4.2 Modules header + first module on same page
  const firstMod = modules[0];
  const firstSlug = slugify(firstMod || 'module0');
  const sec4_2_header_and_first = `
<section class="page" id="dashboard-modules">
  <h3>4.2 Modules</h3>
  <h4>4.2.1 ${firstMod || '—'}</h4>
  ${vizTriplet('chart-' + firstSlug, firstMod ? agg.modules[firstMod] : { totalsByState:{NEW:0,REMOVED:0,UNCHANGED:0}, newVsRemovedBySeverity:{}, matrixSevState:{} })}
</section>`.trim();

  // Remaining modules each on its own page (4.2.2+)
  const rest = modules.slice(1);
  const perModule = rest.map((m,i)=>{
    const s = slugify(m);
    return `
<section class="page" id="dashboard-mod-${s}">
  <h4>4.2.${i + 2} ${m}</h4>
  ${vizTriplet('chart-' + s, agg.modules[m])}
</section>`.trim();
  }).join('\n');

  // Data payload for Chart.js script
  const payload = {
    SEV_ORDER, STATE_ORDER,
    overview: agg.overview,
    modules: modules.map((m, idx)=>({ name:m, slug:slugify(m||('module'+idx)), data: agg.modules[m] }))
  };

  // Chart rendering script sets window.__chartsReady for PDF visual wait logic.
  const script = `
<script>(function(){
  if (typeof window==='undefined' || typeof document==='undefined') return;
  if (!window.Chart) { window.__chartsReady = true; return; }

  try {
    window.Chart.defaults.responsive = false;
    window.Chart.defaults.maintainAspectRatio = false;
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
  } catch(e){}

  var data = ${JSON.stringify(payload)};

  function lockCanvas(el){
    if (!el) return;
    el.style.width = '520px';
    el.style.height = '180px';
    if (el.width !== 520) el.width = 520;
    if (el.height !== 180) el.height = 180;
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
    draw('chart-overview-nr', {
      type:'bar',
      data:{ labels:data.SEV_ORDER, datasets:[
        {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=o.newVsRemovedBySeverity[s]||{};return r.NEW||0;})},
        {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=o.newVsRemovedBySeverity[s]||{};return r.REMOVED||0;})}
      ]},
      options:{ animation:false, scales:{x:{stacked:false},y:{stacked:false,beginAtZero:true}} }
    });
    draw('chart-overview-sev', {
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
    draw(base + '-nr', {
      type:'bar',
      data:{ labels:data.SEV_ORDER, datasets:[
        {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=(m.newVsRemovedBySeverity||{})[s]||{};return r.NEW||0;})},
        {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=(m.newVsRemovedBySeverity||{})[s]||{};return r.REMOVED||0;})}
      ]},
      options:{ animation:false, scales:{x:{stacked:false},y:{stacked:false,beginAtZero:true}} }
    });
    draw(base + '-sev', {
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
