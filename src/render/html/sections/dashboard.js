// src/render/html/sections/dashboard.js
// Dashboard section — renders three canvases. No scripts here.
// Data is provided via sections/dashboard-data.json and rendered by assets/js/dashboard.js.

function renderDashboard(/* { view } */) {
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
`;
}

module.exports = { renderDashboard };
