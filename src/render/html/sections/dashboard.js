// src/render/html/sections/dashboard.js
// Dashboard section — charts only (no tables). No JSON reads here.

function renderDashboard(/* { view } */) {
  return `
<div class="card">
  <h2 id="section-title">Dashboard</h2>
  <p class="small">High-level visual summary of the diff (no extra calculations; all data comes from Phase 2 + Phase 3 precompute).</p>
</div>

<!-- Row 1: three charts -->
<div class="grid-3">
  <div class="card chart-card">
    <h3>Distribution by State</h3>
    <div class="chart-wrap"><canvas id="chart-state-pie" aria-label="State distribution pie"></canvas></div>
  </div>
  <div class="card chart-card">
    <h3>NEW vs REMOVED by Severity</h3>
    <div class="chart-wrap"><canvas id="chart-new-removed" aria-label="NEW vs REMOVED bar"></canvas></div>
  </div>
  <div class="card chart-card">
    <h3>By Severity &amp; State (stacked)</h3>
    <div class="chart-wrap"><canvas id="chart-severity-stacked" aria-label="Severity stacked bar"></canvas></div>
  </div>
</div>

<!-- Row 2: head vs base + top components + depth cards -->
<div class="grid-3" style="margin-top:12px;">
  <div class="card chart-card">
    <h3>Head vs Base — Severity</h3>
    <div class="chart-wrap"><canvas id="chart-head-vs-base" aria-label="Head vs Base by severity"></canvas></div>
  </div>
  <div class="card chart-card">
    <h3>Top Components in Head</h3>
    <div class="chart-wrap"><canvas id="chart-top-components" aria-label="Top components in head"></canvas></div>
  </div>
  <div class="card">
    <h3>Path Depth Summary</h3>
    <div class="grid-2">
      <div>
        <div class="small">HEAD</div>
        <ul class="small">
          <li>min: <span id="pd-head-min">n/a</span></li>
          <li>max: <span id="pd-head-max">n/a</span></li>
          <li>avg: <span id="pd-head-avg">n/a</span></li>
          <li>p95: <span id="pd-head-p95">n/a</span></li>
        </ul>
      </div>
      <div>
        <div class="small">BASE</div>
        <ul class="small">
          <li>min: <span id="pd-base-min">n/a</span></li>
          <li>max: <span id="pd-base-max">n/a</span></li>
          <li>avg: <span id="pd-base-avg">n/a</span></li>
          <li>p95: <span id="pd-base-p95">n/a</span></li>
        </ul>
      </div>
    </div>
  </div>
</div>
`;
}

module.exports = { renderDashboard };
