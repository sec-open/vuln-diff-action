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
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' }, title: { display: false } }
      }
    });
  }
  function mkBarSideBySide(ctx, labels, a, b, labelA = 'NEW', labelB = 'REMOVED') {
    return new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: labelA, data: a }, { label: labelB, data: b }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, title: { display: false } },
        scales: { x: { stacked: true }, y: { beginAtZero: true, stacked: true, ticks: { precision: 0 } } }
      }
    });
  }
  function mkBarTopComponents(ctx, labels, counts) {
    return new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'count', data: counts }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, title: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  function fillText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = (v ?? 'n/a');
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
    const hvbEl = document.getElementById('chart-head-vs-base');
    const topEl = document.getElementById('chart-top-components');

    if (pieEl && data.stateTotals) mkPie(pieEl, data.stateTotals);
    if (nrEl && data.newVsRemovedBySeverity) {
      mkBarSideBySide(nrEl, data.newVsRemovedBySeverity.labels, data.newVsRemovedBySeverity.NEW, data.newVsRemovedBySeverity.REMOVED);
    }
    if (stkEl && data.severityStacked) {
      mkBarStacked(stkEl, data.severityStacked.labels, data.severityStacked.NEW, data.severityStacked.REMOVED, data.severityStacked.UNCHANGED);
    }
    if (hvbEl && data.headVsBaseBySeverity) {
      const labels = Object.keys(data.headVsBaseBySeverity);
      const head = labels.map(k => data.headVsBaseBySeverity[k].head);
      const base = labels.map(k => data.headVsBaseBySeverity[k].base);
      mkBarSideBySide(hvbEl, labels, head, base, 'HEAD', 'BASE');
    }
    if (topEl && Array.isArray(data.topComponentsHead)) {
      const labels = data.topComponentsHead.map(x => x.gav);
      const counts = data.topComponentsHead.map(x => x.count);
      mkBarTopComponents(topEl, labels, counts);
    }

    // Path depth cards
    if (data.pathDepthHead) {
      fillText('pd-head-min', data.pathDepthHead.min);
      fillText('pd-head-max', data.pathDepthHead.max);
      fillText('pd-head-avg', data.pathDepthHead.avg);
      fillText('pd-head-p95', data.pathDepthHead.p95);
    }
    if (data.pathDepthBase) {
      fillText('pd-base-min', data.pathDepthBase.min);
      fillText('pd-base-max', data.pathDepthBase.max);
      fillText('pd-base-avg', data.pathDepthBase.avg);
      fillText('pd-base-p95', data.pathDepthBase.p95);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('app-content');
    if (!content) return;
    const obs = new MutationObserver(() => render());
    obs.observe(content, { attributes: true });
  });
})();
