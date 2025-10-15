// src/render/pdf/sections/dashboard.js
const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const STATE_ORDER = ['NEW', 'REMOVED', 'UNCHANGED'];

function sevKey(s) { return String(s || 'UNKNOWN').toUpperCase(); }
function stateKey(s) { return String(s || '').toUpperCase(); }

function deriveModuleNamesFromItem(it) {
  const mp = it && it.module_paths ? it.module_paths : {};
  const keys = Object.keys(mp || {});
  if (keys.length) return keys;
  if (it && it.module) return [String(it.module)];
  return ['—'];
}

function aggregate(items = []) {
  const agg = {
    overview: {
      totalsByState: { NEW: 0, REMOVED: 0, UNCHANGED: 0 },
      newVsRemovedBySeverity: {},
      matrixSevState: {}
    },
    modules: {}
  };
  for (const sev of SEV_ORDER) {
    agg.overview.newVsRemovedBySeverity[sev] = { NEW: 0, REMOVED: 0 };
    agg.overview.matrixSevState[sev] = { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
  }
  for (const it of items) {
    const sev = sevKey(it.severity);
    const st = stateKey(it.state);
    if (!STATE_ORDER.includes(st)) continue;
    agg.overview.totalsByState[st] += 1;
    if (!agg.overview.matrixSevState[sev]) agg.overview.matrixSevState[sev] = { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
    agg.overview.matrixSevState[sev][st] += 1;
    if (st === 'NEW' || st === 'REMOVED') {
      agg.overview.newVsRemovedBySeverity[sev][st] += 1;
    }
    const modules = deriveModuleNamesFromItem(it);
    for (const mod of modules) {
      if (!agg.modules[mod]) {
        agg.modules[mod] = {
          totalsByState: { NEW: 0, REMOVED: 0, UNCHANGED: 0 },
          newVsRemovedBySeverity: {},
          matrixSevState: {}
        };
        for (const s of SEV_ORDER) {
          agg.modules[mod].newVsRemovedBySeverity[s] = { NEW: 0, REMOVED: 0 };
          agg.modules[mod].matrixSevState[s] = { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
        }
      }
      agg.modules[mod].totalsByState[st] += 1;
      agg.modules[mod].matrixSevState[sev][st] += 1;
      if (st === 'NEW' || st === 'REMOVED') {
        agg.modules[mod].newVsRemovedBySeverity[sev][st] += 1;
      }
    }
  }
  return agg;
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'module';
}

function tableFromArray(headers, rows) {
  const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="compact">${thead}<tbody>${tbody}</tbody></table>`;
}

function tablesBlockOverview(ov) {
  const totals = tableFromArray(['NEW','REMOVED','UNCHANGED'], [[ov.totalsByState.NEW, ov.totalsByState.REMOVED, ov.totalsByState.UNCHANGED]]);
  const sevRows = SEV_ORDER.map(sev => {
    const r = ov.matrixSevState[sev] || { NEW:0, REMOVED:0, UNCHANGED:0 };
    return [sev, r.NEW, r.REMOVED, r.UNCHANGED];
  });
  const sevTbl = tableFromArray(['Severity','NEW','REMOVED','UNCHANGED'], sevRows);
  return `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:8px 0;">
  <div>
    <h4>Totals by State</h4>
    ${totals}
  </div>
  <div>
    <h4>Severity × State</h4>
    ${sevTbl}
  </div>
</div>
`.trim();
}

function tablesBlockModule(mAgg) {
  const totals = tableFromArray(['NEW','REMOVED','UNCHANGED'], [[mAgg.totalsByState.NEW, mAgg.totalsByState.REMOVED, mAgg.totalsByState.UNCHANGED]]);
  const sevRows = SEV_ORDER.map(sev => {
    const r = mAgg.matrixSevState[sev] || { NEW:0, REMOVED:0, UNCHANGED:0 };
    return [sev, r.NEW, r.REMOVED, r.UNCHANGED];
  });
  const sevTbl = tableFromArray(['Severity','NEW','REMOVED','UNCHANGED'], sevRows);
  return `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:8px 0;">
  <div>
    <h4>Totals by State</h4>
    ${totals}
  </div>
  <div>
    <h4>Severity × State</h4>
    ${sevTbl}
  </div>
</div>
`.trim();
}

function chartsBlock(idPrefix, titlePrefix) {
  return `
<div style="display:grid;grid-template-columns:1fr;gap:14px;">
  <div>
    <h4>${titlePrefix}Distribution by State</h4>
    <canvas id="${idPrefix}-state" style="width:100%;height:280px;"></canvas>
  </div>
  <div>
    <h4>${titlePrefix}NEW vs REMOVED by Severity</h4>
    <canvas id="${idPrefix}-new-removed" style="width:100%;height:280px;"></canvas>
  </div>
  <div>
    <h4>${titlePrefix}By Severity &amp; State (stacked)</h4>
    <canvas id="${idPrefix}-sev-state" style="width:100%;height:280px;"></canvas>
  </div>
</div>
`.trim();
}

function dashboardHtml(view) {
  const items = Array.isArray(view?.diff?.items) ? view.diff.items : (Array.isArray(view?.items) ? view.items : []);
  const agg = aggregate(items);
  const modules = Object.keys(agg.modules).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

  const overviewSection = `
<section class="page" id="dashboard">
  <h2>4. Dashboard</h2>
  <h3>4.1 Overview</h3>
  ${chartsBlock('chart-overview', '')}
  ${tablesBlockOverview(agg.overview)}
  <h3>4.2 Modules</h3>
  <h4>4.2.1 ${modules[0] || '—'}</h4>
  ${chartsBlock('chart-' + slugify(modules[0] || 'module0'), '')}
  ${modules[0] ? tablesBlockModule(agg.modules[modules[0]]) : ''}
</section>
`.trim();

  const rest = modules.slice(1);
  const moduleSections = rest.map((m, i) => {
    const s = slugify(m);
    return (
      '<section class="page" id="dashboard-mod-' + s + '">' +
      '<h4>4.2.' + (i + 2) + ' ' + m + '</h4>' +
      chartsBlock('chart-' + s, '') +
      tablesBlockModule(agg.modules[m]) +
      '</section>'
    ).trim();
  }).join('\n');

  const payload = {
    SEV_ORDER, STATE_ORDER,
    overview: agg.overview,
    modules: modules.map((m, idx) => ({
      name: m,
      slug: slugify(m || ('module' + idx)),
      data: agg.modules[m]
    }))
  };

  const inlineScript = `
<script>
(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!window.Chart) return;
  if (!window.__markSectionReady) window.__markSectionReady = function(){};
  if (window.Chart.defaults && window.Chart.defaults.animation != null) {
    window.Chart.defaults.animation = false;
  }
  var data = ${JSON.stringify(payload)};

  function drawBar(el, cfg) { try { return new Chart(el.getContext('2d'), cfg); } catch(e) {} }

  function drawOverview() {
    var o = data.overview;
    var el1 = document.getElementById('chart-overview-state');
    var el2 = document.getElementById('chart-overview-new-removed');
    var el3 = document.getElementById('chart-overview-sev-state');
    if (el1) drawBar(el1, {
      type:'bar',
      data:{ labels:data.STATE_ORDER, datasets:[{ label:'Count', data:data.STATE_ORDER.map(function(s){return o.totalsByState[s]||0;}) }] },
      options:{ responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}}, scales:{ x:{stacked:false}, y:{stacked:false, beginAtZero:true} } }
    });
    if (el2) drawBar(el2, {
      type:'bar',
      data:{ labels:data.SEV_ORDER, datasets:[
        {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=o.newVsRemovedBySeverity[s]||{};return r.NEW||0;})},
        {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=o.newVsRemovedBySeverity[s]||{};return r.REMOVED||0;})}
      ]},
      options:{ responsive:true, maintainAspectRatio:false, animation:false, scales:{ x:{stacked:false}, y:{stacked:false, beginAtZero:true} } }
    });
    if (el3) drawBar(el3, {
      type:'bar',
      data:{ labels:data.SEV_ORDER, datasets:[
        {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=o.matrixSevState[s]||{};return r.NEW||0;}), stack:'s1'},
        {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=o.matrixSevState[s]||{};return r.REMOVED||0;}), stack:'s1'},
        {label:'UNCHANGED', data:data.SEV_ORDER.map(function(s){var r=o.matrixSevState[s]||{};return r.UNCHANGED||0;}), stack:'s1'}
      ]},
      options:{ responsive:true, maintainAspectRatio:false, animation:false, scales:{ x:{stacked:true}, y:{stacked:true, beginAtZero:true} } }
    });
  }

  function drawModule(mod) {
    var base = 'chart-' + mod.slug;
    var el1 = document.getElementById(base + '-state');
    var el2 = document.getElementById(base + '-new-removed');
    var el3 = document.getElementById(base + '-sev-state');
    var m = mod.data || { totalsByState:{}, newVsRemovedBySeverity:{}, matrixSevState:{} };

    if (el1) drawBar(el1, {
      type:'bar',
      data:{ labels:data.STATE_ORDER, datasets:[{ label:'Count', data:data.STATE_ORDER.map(function(s){return (m.totalsByState||{})[s]||0;}) }] },
      options:{ responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}}, scales:{ x:{stacked:false}, y:{stacked:false, beginAtZero:true} } }
    });
    if (el2) drawBar(el2, {
      type:'bar',
      data:{ labels:data.SEV_ORDER, datasets:[
        {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=(m.newVsRemovedBySeverity||{})[s]||{};return r.NEW||0;})},
        {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=(m.newVsRemovedBySeverity||{})[s]||{};return r.REMOVED||0;})}
      ]},
      options:{ responsive:true, maintainAspectRatio:false, animation:false, scales:{ x:{stacked:false}, y:{stacked:false, beginAtZero:true} } }
    });
    if (el3) drawBar(el3, {
      type:'bar',
      data:{ labels:data.SEV_ORDER, datasets:[
        {label:'NEW', data:data.SEV_ORDER.map(function(s){var r=(m.matrixSevState||{})[s]||{};return r.NEW||0;}), stack:'s1'},
        {label:'REMOVED', data:data.SEV_ORDER.map(function(s){var r=(m.matrixSevState||{})[s]||{};return r.REMOVED||0;}), stack:'s1'},
        {label:'UNCHANGED', data:data.SEV_ORDER.map(function(s){var r=(m.matrixSevState||{})[s]||{};return r.UNCHANGED||0;}), stack:'s1'}
      ]},
      options:{ responsive:true, maintainAspectRatio:false, animation:false, scales:{ x:{stacked:true}, y:{stacked:true, beginAtZero:true} } }
    });
  }

  try {
    if (window.__requireReady) window.__requireReady('dashboard');
    drawOverview();
    data.modules.forEach(drawModule);
    window.__markSectionReady('dashboard');
  } catch(e){}
})();
</script>
`.trim();

  return [overviewSection, moduleSections, inlineScript].join('\n');
}

module.exports = { dashboardHtml };
