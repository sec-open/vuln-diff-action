// src/render/html/assets/js/dashboard.js
// Browser-side chart rendering for Dashboard (Chart.js v4).
// Loaded globally from index.html (not injected per section).

(function () {
  const SECT_URL = './sections/dashboard.html';
  const DATA_URL = './sections/dashboard-data.json';

  function hasChartJs() { return !!window.Chart; }

  async function fetchData() {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
    return res.json();
  }


    function mkPie(ctx, data) {
      return new Chart(ctx, {
        type: 'pie',
        data: { labels: data.labels, datasets: [{ data: data.values }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,    // ← importante
          plugins: { legend: { position: 'bottom' }, title: { display: false } }
        }
      });
    }

    function mkBarSideBySide(ctx, labels, newVals, removedVals) {
      return new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'NEW', data: newVals }, { label: 'REMOVED', data: removedVals }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,    // ← importante
          plugins: { legend: { position: 'top' }, title: { display: false } },
          scales: { x: { stacked: false }, y: { beginAtZero: true, stacked: false, ticks: { precision: 0 } } }
        }
      });
    }

    function mkBarStacked(ctx, labels, a, b, c) {
      return new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'NEW', data: a }, { label: 'REMOVED', data: b }, { label: 'UNCHANGED', data: c }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,    // ← importante
          plugins: { legend: { position: 'top' }, title: { display: false } },
          scales: { x: { stacked: true }, y: { beginAtZero: true, stacked: true, ticks: { precision: 0 } } }
        }
      });
    }


  async function render() {
    if (!hasChartJs()) {
      console.error('[dashboard] Chart.js not found (assets/js/vendor/chart.umd.js)');
      return;
    }
    const content = document.getElementById('app-content');
    if (!content) return;
    const loaded = content.getAttribute('data-loaded') || '';
    if (!loaded.endsWith('/dashboard.html')) return;

    let data;
    try { data = await fetchData(); }
    catch (e) { console.error('[dashboard] data fetch error:', e); return; }

    const pieEl = document.getElementById('chart-state-pie');
    const nrEl = document.getElementById('chart-new-removed');
    const stkEl = document.getElementById('chart-severity-stacked');

    if (pieEl) mkPie(pieEl, data.stateTotals);
    if (nrEl) mkBarSideBySide(nrEl, data.newVsRemovedBySeverity.labels, data.newVsRemovedBySeverity.NEW, data.newVsRemovedBySeverity.REMOVED);
    if (stkEl) mkBarStacked(stkEl, data.severityStacked.labels, data.severityStacked.NEW, data.severityStacked.REMOVED, data.severityStacked.UNCHANGED);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('app-content');
    if (!content) return;
    const obs = new MutationObserver(() => render());
    obs.observe(content, { attributes: true });
  });
})();
