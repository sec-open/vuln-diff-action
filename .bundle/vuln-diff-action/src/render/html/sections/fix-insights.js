// src/render/html/sections/fix-insights.js
// Fix insights: charts + actionable tables. No JSON reads here.

function renderFixInsights(/* { view } */) {
  return `
<div class="card">
  <h2 id="section-title">Fix Insights</h2>
  <p class="small">Head-focused view of fix availability. Data is derived in Phase 3 precompute (no Phase 2 changes).</p>
</div>

<div class="grid-3">
  <div class="card chart-card">
    <h3>Fix Availability (HEAD)</h3>
    <div class="chart-wrap"><canvas id="chart-fix-by-severity" aria-label="Fix availability by severity"></canvas></div>
  </div>
  <div class="card chart-card">
    <h3>Fix Coverage (HEAD)</h3>
    <div class="chart-wrap"><canvas id="chart-fix-coverage" aria-label="Fix coverage donut"></canvas></div>
  </div>
  <div class="card">
    <h3>Notes</h3>
    <p class="small">“With fix” means at least one fixed version is known for the affected component. Sources may vary by scanner.</p>
  </div>
</div>

<div class="grid-2" style="margin-top:12px;">
  <div class="card">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <h3 style="margin:0">NEW with Fix (HEAD)</h3>
      <input type="search" class="tbl-filter" data-target="#tbl-new-with-fix" placeholder="Filter…" />
    </div>
    <div class="tbl-wrap" style="overflow:auto; margin-top:8px;">
      <table id="tbl-new-with-fix" class="tbl sortable filterable">
        <thead>
          <tr>
            <th data-sort="severity">Severity</th>
            <th data-sort="id">Vulnerability</th>
            <th data-sort="package">Package</th>
            <th data-sort="fix">Fixed in</th>
          </tr>
        </thead>
        <tbody id="rows-new-with-fix"><tr><td colspan="4" class="small">Loading…</td></tr></tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <h3 style="margin:0">UNCHANGED with Fix (HEAD)</h3>
      <input type="search" class="tbl-filter" data-target="#tbl-unchanged-with-fix" placeholder="Filter…" />
    </div>
    <div class="tbl-wrap" style="overflow:auto; margin-top:8px;">
      <table id="tbl-unchanged-with-fix" class="tbl sortable filterable">
        <thead>
          <tr>
            <th data-sort="severity">Severity</th>
            <th data-sort="id">Vulnerability</th>
            <th data-sort="package">Package</th>
            <th data-sort="fix">Fixed in</th>
          </tr>
        </thead>
        <tbody id="rows-unchanged-with-fix"><tr><td colspan="4" class="small">Loading…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>
`;
}

module.exports = { renderFixInsights };
