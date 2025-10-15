/* Dashboard section renderer: 4. Dashboard
 * Renders:
 *  4.1 Overview (same page as section title)
 *  4.2 Modules (each module in a new page, numbered 4.2.x)
 * Charts:
 *  - Distribution by State
 *  - NEW vs REMOVED by Severity
 *  - By Severity & State (stacked)
 */

(function () {
  const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  const STATE_ORDER = ['NEW', 'REMOVED', 'UNCHANGED'];

  function normSev(s) { return String(s || 'UNKNOWN').toUpperCase(); }
  function normState(s) { return String(s || '').toUpperCase(); }

  function deriveModuleNamesFromItem(it) {
    const mp = it && it.module_paths ? it.module_paths : {};
    const keys = Object.keys(mp || {});
    if (keys.length) return keys;
    if (it && it.module) return [String(it.module)];
    return ['—'];
  }

  function aggregate(items) {
    const agg = {
      totalsByState: { NEW: 0, REMOVED: 0, UNCHANGED: 0 },
      newVsRemovedBySeverity: {},      // sev -> { NEW, REMOVED }
      matrixSevState: {},              // sev -> { NEW, REMOVED, UNCHANGED }
      byModule: {}                     // mod -> { totalsByState, newVsRemovedBySeverity, matrixSevState }
    };
    for (const sev of SEV_ORDER) {
      agg.newVsRemovedBySeverity[sev] = { NEW: 0, REMOVED: 0 };
      agg.matrixSevState[sev] = { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
    }

    for (const it of items || []) {
      const sev = normSev(it.severity);
      const st = normState(it.state);
      if (!STATE_ORDER.includes(st)) continue;

      agg.totalsByState[st] += 1;
      if (!agg.matrixSevState[sev]) agg.matrixSevState[sev] = { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
      agg.matrixSevState[sev][st] += 1;
      if (st === 'NEW' || st === 'REMOVED') {
        if (!agg.newVsRemovedBySeverity[sev]) agg.newVsRemovedBySeverity[sev] = { NEW: 0, REMOVED: 0 };
        agg.newVsRemovedBySeverity[sev][st] += 1;
      }

      const modules = deriveModuleNamesFromItem(it);
      for (const mod of modules) {
        if (!agg.byModule[mod]) {
          agg.byModule[mod] = {
            totalsByState: { NEW: 0, REMOVED: 0, UNCHANGED: 0 },
            newVsRemovedBySeverity: {},
            matrixSevState: {}
          };
          for (const s of SEV_ORDER) {
            agg.byModule[mod].newVsRemovedBySeverity[s] = { NEW: 0, REMOVED: 0 };
            agg.byModule[mod].matrixSevState[s] = { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
          }
        }
        agg.byModule[mod].totalsByState[st] += 1;
        agg.byModule[mod].matrixSevState[sev][st] += 1;
        if (st === 'NEW' || st === 'REMOVED') {
          agg.byModule[mod].newVsRemovedBySeverity[sev][st] += 1;
        }
      }
    }
    return agg;
  }

  function h(tag, attrs = {}, html = '') {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'id') el.id = v;
      else el.setAttribute(k, v);
    }
    if (html) el.innerHTML = html;
    return el;
  }

  function ensureChartJs() {
    if (!window.Chart) {
      throw new Error('Chart.js not found on window.Chart');
    }
    if (window.Chart.defaults && window.Chart.defaults.animation != null) {
      window.Chart.defaults.animation = false;
    }
  }

  function createCanvas(idSuffix) {
    const c = h('canvas', { id: idSuffix });
    c.style.width = '100%';
    c.style.height = '280px';
    return c;
  }

  function renderOverviewSection(root, agg) {
    const sec = h('section', { class: 'page', id: 'dashboard' });
    const h2 = h('h2', {}, '4. Dashboard');
    sec.appendChild(h2);

    const h3 = h('h3', {}, '4.1 Overview');
    sec.appendChild(h3);

    const grid = h('div', { style: 'display:grid;grid-template-columns:1fr;gap:14px;' });

    const cv1 = createCanvas('chart-overview-state');
    const cv2 = createCanvas('chart-overview-new-removed');
    const cv3 = createCanvas('chart-overview-sev-state');

    const b1 = h('div', {}, `<h4>Distribution by State</h4>`);
    b1.appendChild(cv1);
    const b2 = h('div', {}, `<h4>NEW vs REMOVED by Severity</h4>`);
    b2.appendChild(cv2);
    const b3 = h('div', {}, `<h4>By Severity &amp; State (stacked)</h4>`);
    b3.appendChild(cv3);

    grid.appendChild(b1);
    grid.appendChild(b2);
    grid.appendChild(b3);
    sec.appendChild(grid);

    root.appendChild(sec);

    ensureChartJs();

    const ctx1 = cv1.getContext('2d');
    new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: STATE_ORDER,
        datasets: [{
          label: 'Count',
          data: STATE_ORDER.map(s => agg.totalsByState[s] || 0)
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: { x: { stacked: false }, y: { stacked: false, beginAtZero: true } }
      }
    });

    const ctx2 = cv2.getContext('2d');
    new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: SEV_ORDER,
        datasets: [
          { label: 'NEW', data: SEV_ORDER.map(s => (agg.newVsRemovedBySeverity[s] || {}).NEW || 0) },
          { label: 'REMOVED', data: SEV_ORDER.map(s => (agg.newVsRemovedBySeverity[s] || {}).REMOVED || 0) }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: { x: { stacked: false }, y: { stacked: false, beginAtZero: true } }
      }
    });

    const ctx3 = cv3.getContext('2d');
    new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: SEV_ORDER,
        datasets: [
          { label: 'NEW', data: SEV_ORDER.map(s => (agg.matrixSevState[s] || {}).NEW || 0), stack: 'stack1' },
          { label: 'REMOVED', data: SEV_ORDER.map(s => (agg.matrixSevState[s] || {}).REMOVED || 0), stack: 'stack1' },
          { label: 'UNCHANGED', data: SEV_ORDER.map(s => (agg.matrixSevState[s] || {}).UNCHANGED || 0), stack: 'stack1' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
      }
    });
  }

  function sanitizeId(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'module';
  }

  function renderModuleSection(root, modName, modAgg, idx) {
    const sec = h('section', { class: 'page', id: `dashboard-mod-${sanitizeId(modName)}` });

    const h3 = h('h3', {}, `4.2.${idx} ${modName}`);
    sec.appendChild(h3);

    const grid = h('div', { style: 'display:grid;grid-template-columns:1fr;gap:14px;' });

    const cv1 = createCanvas(`chart-${sanitizeId(modName)}-state`);
    const cv2 = createCanvas(`chart-${sanitizeId(modName)}-new-removed`);
    const cv3 = createCanvas(`chart-${sanitizeId(modName)}-sev-state`);

    const b1 = h('div', {}, `<h4>Distribution by State</h4>`);
    b1.appendChild(cv1);
    const b2 = h('div', {}, `<h4>NEW vs REMOVED by Severity</h4>`);
    b2.appendChild(cv2);
    const b3 = h('div', {}, `<h4>By Severity &amp; State (stacked)</h4>`);
    b3.appendChild(cv3);

    grid.appendChild(b1);
    grid.appendChild(b2);
    grid.appendChild(b3);
    sec.appendChild(grid);

    root.appendChild(sec);

    ensureChartJs();

    const ctx1 = cv1.getContext('2d');
    new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: STATE_ORDER,
        datasets: [{
          label: 'Count',
          data: STATE_ORDER.map(s => modAgg.totalsByState[s] || 0)
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: { x: { stacked: false }, y: { stacked: false, beginAtZero: true } }
      }
    });

    const ctx2 = cv2.getContext('2d');
    new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: SEV_ORDER,
        datasets: [
          { label: 'NEW', data: SEV_ORDER.map(s => (modAgg.newVsRemovedBySeverity[s] || {}).NEW || 0) },
          { label: 'REMOVED', data: SEV_ORDER.map(s => (modAgg.newVsRemovedBySeverity[s] || {}).REMOVED || 0) }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: { x: { stacked: false }, y: { stacked: false, beginAtZero: true } }
      }
    });

    const ctx3 = cv3.getContext('2d');
    new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: SEV_ORDER,
        datasets: [
          { label: 'NEW', data: SEV_ORDER.map(s => (modAgg.matrixSevState[s] || {}).NEW || 0), stack: 'stack1' },
          { label: 'REMOVED', data: SEV_ORDER.map(s => (modAgg.matrixSevState[s] || {}).REMOVED || 0), stack: 'stack1' },
          { label: 'UNCHANGED', data: SEV_ORDER.map(s => (modAgg.matrixSevState[s] || {}).UNCHANGED || 0), stack: 'stack1' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
      }
    });
  }

  function renderVulnDashboard(rootElOrId, data) {
    const root = typeof rootElOrId === 'string' ? document.getElementById(rootElOrId) : rootElOrId;
    if (!root) return;
    const items = (data && Array.isArray(data.items)) ? data.items : (Array.isArray(window.__DIFF__?.items) ? window.__DIFF__.items : []);
    const agg = aggregate(items);

    root.innerHTML = '';
    renderOverviewSection(root, agg);

    const modules = Object.keys(agg.byModule).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    let idx = 1;
    for (const mod of modules) {
      renderModuleSection(root, mod, agg.byModule[mod], idx++);
    }
  }

  window.renderVulnDashboard = renderVulnDashboard;

  document.addEventListener('DOMContentLoaded', function () {
    const mount = document.getElementById('dashboard-root');
    if (mount) {
      try { renderVulnDashboard(mount, { items: Array.isArray(window.__DIFF__?.items) ? window.__DIFF__.items : [] }); } catch {/* no-op */}
    }
  });
})();
