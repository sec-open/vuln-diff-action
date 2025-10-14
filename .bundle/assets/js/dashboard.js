// src/render/html/assets/js/dashboard.js
// Browser-side chart rendering for Dashboard (Chart.js v4).
// Loaded globally from index.html (not injected per section).

(function () {
  const DATA_URL = './sections/dashboard-data.json';

  function hasChartJs() { return !!window.Chart; }

  async function fetchData() {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
    return res.json();
  }
  function sevKeyToClass(sev) {
    const s = String(sev || '').toUpperCase();
    if (s === 'CRITICAL') return 'sev-critical';
    if (s === 'HIGH') return 'sev-high';
    if (s === 'MEDIUM') return 'sev-medium';
    if (s === 'LOW') return 'sev-low';
    return 'sev-unknown';
  }

  function renderWeightsTable(weights) {
    const order = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
    return order.map(sev => {
      const w = weights?.[sev] ?? 0;
      const dot = `<span class="dot ${sevKeyToClass(sev)}"></span>`;
      return `<tr><td>${dot}${sev}</td><td>${w}</td></tr>`;
    }).join('');
  }

  function renderWeightsBar(weights) {
    const order = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
    const total = order.reduce((acc, sev) => acc + (weights?.[sev] ?? 0), 0) || 1;
    return order.map(sev => {
      const w = weights?.[sev] ?? 0;
      const pct = Math.max(6, Math.round((w / total) * 100)); // mínimo 6% para visibilidad
      return `<span class="seg ${sevKeyToClass(sev)}" style="width:${pct}%;" title="${sev}: ${w}"></span>`;
    }).join('');
  }

  // Tooltip toggle logic
  function bindRiskTooltip() {
    const btn = document.getElementById('risk-help');
    const tip = document.getElementById('risk-tooltip');
    const close = document.getElementById('risk-tooltip-close');
    if (!btn || !tip) return;

    function open(e) {
      e.preventDefault();
      // place tooltip near the badge
      const rect = btn.getBoundingClientRect();
      const parentRect = btn.closest('.card').getBoundingClientRect();
      const top = rect.bottom - parentRect.top + 8;
      const left = Math.max(8, rect.left - parentRect.left - 220);
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
      tip.classList.add('show');
    }
    function closeTip() { tip.classList.remove('show'); }

    btn.addEventListener('click', open);
    if (close) close.addEventListener('click', closeTip);
    document.addEventListener('click', (ev) => {
      if (!tip.classList.contains('show')) return;
      if (ev.target === btn || tip.contains(ev.target)) return;
      tip.classList.remove('show');
    });
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

  function setKpi(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(value);
    // color hint: red if positive net risk (worse), green if <= 0
    if (id === 'kpi-net-risk') {
      const v = Number(value);
      el.style.color = Number.isFinite(v) && v > 0 ? '#f87171' : '#34d399';
    }
  }

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

    // ---- existing charts ----
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

    // ---- KPIs (net risk) ----
    if (data.riskKpis?.kpis) {
      setKpi('kpi-net-risk', data.riskKpis.kpis.netRisk ?? '—');
      setKpi('kpi-base-stock', data.riskKpis.kpis.baseStockRisk ?? '—'); // ← NEW
      setKpi('kpi-head-stock', data.riskKpis.kpis.headStockRisk ?? '—');

        // Fill tooltip content (weights table + bar)
        const weights = data.riskKpis.weights || null;
        const rowsEl = document.getElementById('risk-weights-rows');
        const barEl = document.getElementById('risk-weight-bar');
        if (weights && rowsEl) rowsEl.innerHTML = renderWeightsTable(weights);
        if (weights && barEl)  barEl.innerHTML  = renderWeightsBar(weights);

        // Bind tooltip events
        bindRiskTooltip();
    }


    // ---- NEW Fixability (bars by severity) ----
    if (data.fixesNew?.by_severity) {
      const sev = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
      const withFix = sev.map(s => data.fixesNew.by_severity[s]?.with_fix ?? 0);
      const withoutFix = sev.map(s => data.fixesNew.by_severity[s]?.without_fix ?? 0);
      const fxEl = document.getElementById('chart-fix-new');
      if (fxEl) mkBarFixNew(fxEl, sev, withFix, withoutFix);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('app-content');
    if (!content) return;
    const obs = new MutationObserver(() => render());
    obs.observe(content, { attributes: true });
  });
})();
