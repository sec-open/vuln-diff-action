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
    modules: {} // mod -> same shape as overview
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
      if (!agg.overview.newVsRemovedBySeverity[sev]) agg.overview.newVsRemovedBySeverity[sev] = { NEW: 0, REMOVED: 0 };
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
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'module';
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
</section>
`.trim();

  const moduleSections = modules.map((m, i) => `
<section class="page" id="dashboard-mod-${slugify(m)}">
  <h3>4.2.${i + 1} ${m}</h3>
  ${chartsBlock(\`chart-\${slugify(m)}\`, '')}
</section>
`.trim()).join('\n');

  const payload = {
    SEV_ORDER, STATE_ORDER,
    overview: {
      totalsByState: agg.overview.totalsByState,
      newVsRemovedBySeverity: agg.overview.newVsRemovedBySeverity,
      matrixSevState: agg.overview.matrixSevState
    },
    modules: modules.map(m => ({
      name: m,
      slug: slugify(m),
      totalsByState: agg.modules[m].totalsByState,
      newVsRemovedBySeverity: agg.modules[m].newVsRemovedBySeverity,
      matrixSevState: agg.modules[m].matrixSevState
    }))
  };

  const inlineScript = `
<script>
(function(){
  var data = ${JSON.stringify(payload)};
  if (!window || !document) return;
  if (!window.Chart) return;
  if (window.Chart.defaults && window.Chart.defaults.animation != null) {
    window.Chart.defaults.animation = false;
  }

  function drawOverview() {
    var o = data.overview;
    var el1 = document.getElementById('chart-overview-state');
    var el2 = document.getElementById('chart-overview-new-removed');
    var el3 = document.getElementById('chart-overview-sev-state');
    if (!el1 || !el2 || !el3) return;

    new Chart(el1.getContext('2d'), {
      type: 'bar',
      data: { labels: data.STATE_ORDER, datasets: [{ label: 'Count', data: data.STATE_ORDER.map(function(s){ return o.totalsByState[s] || 0; }) }] },
      options: { responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}}, scales:{ x:{stacked:false}, y:{stacked:false, beginAtZero:true} } }
    });

    new Chart(el2.getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.SEV_ORDER,
        datasets: [
          { label: 'NEW', data: data.SEV_ORDER.map(function(s){ var r=o.newVsRemovedBySeverity[s]||{}; return r.NEW||0; }) },
          { label: 'REMOVED', data: data.SEV_ORDER.map(function(s){ var r=o.newVsRemovedBySeverity[s]||{}; return r.REMOVED||0; }) }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false, animation:false, scales:{ x:{stacked:false}, y:{stacked:false, beginAtZero:true} } }
    });

    new Chart(el3.getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.SEV_ORDER,
        datasets: [
          { label: 'NEW', data: data.SEV_ORDER.map(function(s){ var r=o.matrixSevState[s]||{}; return r.NEW||0; }), stack:'stack1' },
          { label: 'REMOVED', data: data.SEV_ORDER.map(function(s){ var r=o.matrixSevState[s]||{}; return r.REMOVED||0; }), stack:'stack1' },
          { label: 'UNCHANGED', data: data.SEV_ORDER.map(function(s){ var r=o.matrixSevState[s]||{}; return r.UNCHANGED||0; }), stack:'stack1' }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false, animation:false, scales:{ x:{stacked:true}, y:{stacked:true, beginAtZero:true} } }
    });
  }

  function drawModule(mod) {
    var el1 = document.getElementById('chart-' + mod.slug + '-state');
    var el2 = document.getElementById('chart-' + mod.slug + '-new-removed');
    var el3 = document.getElementById('chart-' + mod.slug + '-sev-state');
    if (!el1 || !el2 || !el3) return;

    new Chart(el1.getContext('2d'), {
      type: 'bar',
      data: { labels: data.STATE_ORDER, datasets: [{ label: 'Count', data: data.STATE_ORDER.map(function(s){ return (mod.totalsByState||{})[s] || 0; }) }] },
      options: { responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}}, scales:{ x:{stacked:false}, y:{stacked:false, beginAtZero:true} } }
    });

    new Chart(el2.getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.SEV_ORDER,
        datasets: [
          { label: 'NEW', data: data.SEV_ORDER.map(function(s){ var r=(mod.newVsRemovedBySeverity||{})[s]||{}; return r.NEW||0; }) },
          { label: 'REMOVED', data: data.SEV_ORDER.map(function(s){ var r=(mod.newVsRemovedBySeverity||{})[s]||{}; return r.REMOVED||0; }) }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false, animation:false, scales:{ x:{stacked:false}, y:{stacked:false, beginAtZero:true} } }
    });

    new Chart(el3.getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.SEV_ORDER,
        datasets: [
          { label: 'NEW', data: data.SEV_ORDER.map(function(s){ var r=(mod.matrixSevState||{})[s]||{}; return r.NEW||0; }), stack:'stack1' },
          { label: 'REMOVED', data: data.SEV_ORDER.map(function(s){ var r=(mod.matrixSevState||{})[s]||{}; return r.REMOVED||0; }), stack:'stack1' },
          { label: 'UNCHANGED', data: data.SEV_ORDER.map(function(s){ var r=(mod.matrixSevState||{})[s]||{}; return r.UNCHANGED||0; }), stack:'stack1' }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false, animation:false, scales:{ x:{stacked:true}, y:{stacked:true, beginAtZero:true} } }
    });
  }

  try {
    drawOverview();
    (data.modules || []).forEach(drawModule);
  } catch (e) { /* no-op */ }
})();
</script>
`.trim();

  return [overviewSection, moduleSections, inlineScript].join('\n');
}

module.exports = { dashboardHtml };
