// src/render/html/assets/js/dashboard.js
// Browser-side chart rendering for Dashboard (Chart.js v4).
// Expects vendor scripts to be loaded: chart.umd.js (and optionally chartjs-plugin-datalabels).

(function () {
  function ensureChartJs() {
    if (!window.Chart) {
      console.error('[dashboard] Chart.js not found. Did you include assets/js/vendor/chart.umd.js in index.html?');
      return false;
    }
    return true;
  }

  function mkPie(ctx, data) {
    return new Chart(ctx, {
      type: 'pie',
      data: {
        labels: data.labels,
        datasets: [{
          data: data.values,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
          title: { display: false }
        }
      }
    });
  }

  function mkBarSideBySide(ctx, labels, newVals, removedVals) {
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'NEW', data: newVals },
          { label: 'REMOVED', data: removedVals },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          title: { display: false },
        },
        scales: {
          x: { stacked: false },
          y: { beginAtZero: true, stacked: false, ticks: { precision: 0 } }
        }
      }
    });
  }

  function mkBarStacked(ctx, labels, newVals, removedVals, unchangedVals) {
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'NEW', data: newVals },
          { label: 'REMOVED', data: removedVals },
          { label: 'UNCHANGED', data: unchangedVals },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          title: { display: false },
        },
        scales: {
          x: { stacked: true },
          y: { beginAtZero: true, stacked: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  function render() {
    if (!ensureChartJs()) return;
    const blob = window.__DASH_DATA__;
    if (!blob) {
      console.error('[dashboard] No data blob found (window.__DASH_DATA__)');
      return;
    }

    const pieEl = document.getElementById('chart-state-pie');
    const nrEl = document.getElementById('chart-new-removed');
    const stkEl = document.getElementById('chart-severity-stacked');

    if (pieEl) mkPie(pieEl, blob.stateTotals);
    if (nrEl) mkBarSideBySide(nrEl, blob.newVsRemovedBySeverity.labels, blob.newVsRemovedBySeverity.NEW, blob.newVsRemovedBySeverity.REMOVED);
    if (stkEl) mkBarStacked(stkEl, blob.severityStacked.labels, blob.severityStacked.NEW, blob.severityStacked.REMOVED, blob.severityStacked.UNCHANGED);
  }

  // Render when the section is loaded
  document.addEventListener('DOMContentLoaded', function () {
    // When the content of #app-content changes (navigation), re-run
    const content = document.getElementById('app-content');
    if (!content) { render(); return; }
    const obs = new MutationObserver(() => {
      if (content.getAttribute('data-loaded')?.endsWith('/dashboard.html')) {
        render();
      }
    });
    obs.observe(content, { attributes: true });
  });
})();
