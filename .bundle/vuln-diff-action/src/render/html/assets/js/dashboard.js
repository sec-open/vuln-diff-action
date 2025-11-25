// src/render/html/assets/js/dashboard.js
// Browser-side dashboard renderer: fetches JSON data, builds charts (Chart.js),
// populates KPI metrics, and binds a weighted risk tooltip.

(function () {
  // Endpoint for dashboard data (JSON artifact produced server-side)
  const DATA_URL = './sections/dashboard-data.json';

  // Returns true if Chart.js is present in global window scope.
  function hasChartJs() { return !!window.Chart; }

  // Fetches JSON data with no-store caching (fresh each navigation).
  async function fetchData() {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
    return res.json();
  }

  // Maps severity value to CSS class used for color coding dots/bars.
  function sevKeyToClass(sev) {
    const s = String(sev || '').toUpperCase();
    if (s === 'CRITICAL') return 'sev-critical';
    if (s === 'HIGH') return 'sev-high';
    if (s === 'MEDIUM') return 'sev-medium';
    if (s === 'LOW') return 'sev-low';
    return 'sev-unknown';
  }

  // Builds table rows HTML listing severity weights (risk scoring factors).
  function renderWeightsTable(weights) {
    const order = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
    return order.map(sev => {
      const w = weights?.[sev] ?? 0;
      const dot = `<span class="dot ${sevKeyToClass(sev)}"></span>`;
      return `<tr><td>${dot}${sev}</td><td>${w}</td></tr>`;
    }).join('');
  }

  // Builds horizontal segmented bar representing relative severity weights.
  function renderWeightsBar(weights) {
    const order = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
    const total = order.reduce((acc, sev) => acc + (weights?.[sev] ?? 0), 0) || 1;
    return order.map(sev => {
      const w = weights?.[sev] ?? 0;
      // Minimum width ensures visibility for very small values.
      const pct = Math.max(6, Math.round((w / total) * 100));
      return `<span class="seg ${sevKeyToClass(sev)}" style="width:${pct}%;" title="${sev}: ${w}"></span>`;
    }).join('');
  }

  // Attaches click handlers for weighted risk tooltip (open/close + outside click dismissal).
  function bindRiskTooltip() {
    const btn = document.getElementById('risk-help');
    const tip = document.getElementById('risk-tooltip');
    const close = document.getElementById('risk-tooltip-close');
    if (!btn || !tip) return;

    // Opens tooltip near trigger badge, positioning inside card boundaries.
    function open(e) {
      e.preventDefault();
      const rect = btn.getBoundingClientRect();
      const parentRect = btn.closest('.card').getBoundingClientRect();
      const top = rect.bottom - parentRect.top + 8;
      const left = Math.max(8, rect.left - parentRect.left - 220);
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
      tip.classList.add('show');
    }
    // Hides tooltip.
    function closeTip() { tip.classList.remove('show'); }

    btn.addEventListener('click', open);
    if (close) close.addEventListener('click', closeTip);
    document.addEventListener('click', (ev) => {
      if (!tip.classList.contains('show')) return;
      if (ev.target === btn || tip.contains(ev.target)) return;
      tip.classList.remove('show');
    });
  }

  // Creates pie chart for state distribution.
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

  // Creates side-by-side bar chart for two datasets (e.g., NEW vs REMOVED or HEAD vs BASE).
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

  // Creates stacked bar chart for state breakdown per severity.
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

  // Horizontal bar chart listing components ranked by vulnerability count (HEAD side).
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

  // Bar chart comparing fix availability for NEW vulnerabilities by severity.
  function mkBarFixNew(ctx, labels, withFix, withoutFix) {
    return new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'with fix', data: withFix }, { label: 'without fix', data: withoutFix }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, title: { display: false } },
        scales: { x: { stacked: false }, y: { beginAtZero: true, stacked: false, ticks: { precision: 0 } } }
      }
    });
  }

  // Sets KPI value and applies conditional coloring (net risk indicator).
  function setKpi(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(value);
    if (id === 'kpi-net-risk') {
      const v = Number(value);
      el.style.color = Number.isFinite(v) && v > 0 ? '#f87171' : '#34d399';
    }
  }

  // Main render flow: ensures section is active, fetches data, draws charts, populates KPIs, binds tooltip.
  async function render() {
    const content = document.getElementById('app-content');
    if (!content) return;
    const loaded = content.getAttribute('data-loaded') || '';
    if (!loaded.endsWith('/dashboard.html')) return;

    let data;
    try { data = await fetchData(); }
    catch (e) { console.error('[dashboard] data fetch error:', e); return; }

    if (!hasChartJs()) {
      console.error('[dashboard] Chart.js not found (assets/js/vendor/chart.umd.js)');
      return;
    }

    // Chart element references (conditionally rendered if present).
    const pieEl = document.getElementById('chart-state-pie');
    const nrEl = document.getElementById('chart-new-removed');
    const stkEl = document.getElementById('chart-severity-stacked');
    const hvbEl = document.getElementById('chart-head-vs-base');
    const topEl = document.getElementById('chart-top-components');

    // Pie chart (state totals).
    if (pieEl && data.stateTotals) mkPie(pieEl, data.stateTotals);

    // Side-by-side NEW vs REMOVED per severity.
    if (nrEl && data.newVsRemovedBySeverity) {
      mkBarSideBySide(nrEl, data.newVsRemovedBySeverity.labels, data.newVsRemovedBySeverity.NEW, data.newVsRemovedBySeverity.REMOVED);
    }

    // Stacked severity (NEW / REMOVED / UNCHANGED).
    if (stkEl && data.severityStacked) {
      mkBarStacked(stkEl, data.severityStacked.labels, data.severityStacked.NEW, data.severityStacked.REMOVED, data.severityStacked.UNCHANGED);
    }

    // HEAD vs BASE comparison by severity.
    if (hvbEl && data.headVsBaseBySeverity) {
      const labels = Object.keys(data.headVsBaseBySeverity);
      const head = labels.map(k => data.headVsBaseBySeverity[k].head);
      const base = labels.map(k => data.headVsBaseBySeverity[k].base);
      mkBarSideBySide(hvbEl, labels, head, base, 'HEAD', 'BASE');
    }

    // Top vulnerable components (HEAD).
    if (topEl && Array.isArray(data.topComponentsHead)) {
      const labels = data.topComponentsHead.map(x => x.gav);
      const counts = data.topComponentsHead.map(x => x.count);
      mkBarTopComponents(topEl, labels, counts);
    }

    // KPI metrics and tooltip content population.
    if (data.riskKpis?.kpis) {
      setKpi('kpi-net-risk', data.riskKpis.kpis.netRisk ?? '—');
      setKpi('kpi-base-stock', data.riskKpis.kpis.baseStockRisk ?? '—');
      setKpi('kpi-head-stock', data.riskKpis.kpis.headStockRisk ?? '—');

      const weights = data.riskKpis.weights || null;
      const rowsEl = document.getElementById('risk-weights-rows');
      const barEl = document.getElementById('risk-weight-bar');
      if (weights && rowsEl) rowsEl.innerHTML = renderWeightsTable(weights);
      if (weights && barEl)  barEl.innerHTML  = renderWeightsBar(weights);

      bindRiskTooltip();
    }

    // Fixability chart: NEW vulnerabilities with/without fix grouped by severity.
    if (data.fixesNew?.by_severity) {
      const sev = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
      const withFix = sev.map(s => data.fixesNew.by_severity[s]?.with_fix ?? 0);
      const withoutFix = sev.map(s => data.fixesNew.by_severity[s]?.without_fix ?? 0);
      const fxEl = document.getElementById('chart-fix-new');
      if (fxEl) mkBarFixNew(fxEl, sev, withFix, withoutFix);
    }
  }

  // Bootstraps a mutation observer to re-render when section content changes.
  document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('app-content');
    if (!content) return;
    const obs = new MutationObserver(() => render());
    obs.observe(content, { attributes: true });
  });
})();
