// src/render/html/sections/dashboard.js
// Dashboard section — renders three charts using only Phase-2 summary data.
// No JSON reads; receives a strict "view" from the HTML orchestrator.

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

function renderDashboard({ view } = {}) {
  if (!view) throw new Error('[render/html/dashboard] Missing view');

  // Data ready for charts (no extra calculations beyond picking fields)
  const totals = view.summary.totals; // { NEW, REMOVED, UNCHANGED }
  const bySevState = view.summary.bySeverityAndState || {}; // { sev: { NEW, REMOVED, UNCHANGED } }

  // Build arrays for charts from the strict summary
  const sevLabels = SEVERITY_ORDER.slice();
  const sevNew = sevLabels.map((s) => (bySevState[s]?.NEW ?? 0));
  const sevRemoved = sevLabels.map((s) => (bySevState[s]?.REMOVED ?? 0));
  const sevUnchanged = sevLabels.map((s) => (bySevState[s]?.UNCHANGED ?? 0));

  // Put data on the page so /assets/js/dashboard.js can pick it up at runtime
  const dataBlob = {
    stateTotals: {
      labels: ['NEW', 'REMOVED', 'UNCHANGED'],
      values: [totals.NEW, totals.REMOVED, totals.UNCHANGED],
    },
    severityStacked: {
      labels: sevLabels,
      NEW: sevNew,
      REMOVED: sevRemoved,
      UNCHANGED: sevUnchanged,
    },
    newVsRemovedBySeverity: {
      labels: sevLabels,
      NEW: sevNew,
      REMOVED: sevRemoved,
    },
  };

  return `
<div class="card">
  <h2 id="section-title">Dashboard</h2>
  <p class="small">High-level visual summary of the diff (no extra calculations; all data comes from Phase 2).</p>
</div>

<div class="grid-2">
  <div class="card">
    <h3>Distribution by State</h3>
    <canvas id="chart-state-pie" width="400" height="280" aria-label="State distribution pie"></canvas>
  </div>
  <div class="card">
    <h3>NEW vs REMOVED by Severity</h3>
    <canvas id="chart-new-removed" width="400" height="280" aria-label="NEW vs REMOVED bar"></canvas>
  </div>
</div>

<div class="card" style="margin-top:12px;">
  <h3>By Severity &amp; State (stacked)</h3>
  <canvas id="chart-severity-stacked" height="320" aria-label="Severity stacked bar"></canvas>
</div>

<!-- Inline data for charts; the rendering logic lives in assets/js/dashboard.js -->
<script>
  window.__DASH_DATA__ = ${JSON.stringify(dataBlob)};
</script>
<script src="./assets/js/dashboard.js"></script>
`;
}

module.exports = { renderDashboard };
