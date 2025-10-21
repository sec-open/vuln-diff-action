// Provides the HTML snippet for the dashboard section (charts + KPIs). Consumed by client-side runtime.
// Does not perform data reads; the browser JS populates chart canvases and KPI placeholders.
  return `
/**
 * Returns the HTML for the dashboard section (chart placeholders and KPI containers).
 * @returns {string} HTML markup for the dashboard view.
 */
/**
 * Builds hyperlink markup for known vulnerability IDs.
 * @param {string} id
 * @returns {string}
 */
<div class="card">
</div>

<!-- Row 1: three charts -->
<div class="grid-3">

/**
 * Formats package coordinates as group:artifact:version.
 * @param {Object} v
 * @returns {string}
 */
  <div class="card chart-card">
    <h3>Distribution by State</h3>
    <div class="chart-wrap"><canvas id="chart-state-pie" aria-label="State distribution pie"></canvas></div>
  </div>
    <div class="chart-wrap"><canvas id="chart-new-removed" aria-label="NEW vs REMOVED bar"></canvas></div>

/**
 * Formats a single dependency path chain into HTML.
 * @param {Array<string>} chain
 * @returns {string}
 */
  </div>
  <div class="card chart-card">
    <h3>By Severity &amp; State (stacked)</h3>
    <div class="chart-wrap"><canvas id="chart-severity-stacked" aria-label="Severity stacked bar"></canvas></div>
  </div>
/**
 * Converts vulnerability items into table row HTML strings.
 */
</div>

<!-- Row 2: head vs base + top components + KPIs -->
<div class="grid-3" style="margin-top:12px;">
  <div class="card chart-card">
    <h3>Head vs Base — Severity</h3>
    <div class="chart-wrap"><canvas id="chart-head-vs-base" aria-label="Head vs Base by severity"></canvas></div>
  </div>
  <div class="card chart-card">
    <h3>Top Components in Head</h3>
    <div class="chart-wrap"><canvas id="chart-top-components" aria-label="Top components in head"></canvas></div>
  </div>
  <div class="card" style="position:relative;">
    <h3>
      Risk &amp; Fixability
      <span id="risk-help" class="info-badge" title="How is risk calculated?">i</span>
    </h3>

    <!-- Tooltip (hidden by default) -->
    <div id="risk-tooltip" class="tooltip">
/**
 * Wraps a table with filter control inside a card.
 * @param {string} title
 * @param {string} id
 * @param {Array<Object>} items
 * @returns {string}
      <button class="close" id="risk-tooltip-close" aria-label="Close">&times;</button>
      <h4>Weighted Risk — How it is computed</h4>
      <div class="tooltip-grid">
        <div>
          <div class="small" style="margin-bottom:6px;">Formula</div>
          <code>Net Risk = Σ(weight × NEW) − Σ(weight × REMOVED)</code>
          <div class="small" style="margin-top:6px;">
            Head Stock Risk = Σ(weight × (NEW + UNCHANGED))<br/>
            Base Stock Risk = Σ(weight × (REMOVED + UNCHANGED))
          </div>
          <div style="margin-top:8px;">
            <div class="small">Weights by severity (visual)</div>
            <div id="risk-weight-bar" class="weight-bar" style="margin-top:6px;"></div>
          </div>
        </div>
        <div>
          <div class="small" style="margin-bottom:6px;">Weights table</div>
          <table>
            <thead><tr><th>Severity</th><th>Weight</th></tr></thead>
            <tbody id="risk-weights-rows">
              <!-- rows injected by dashboard.js -->
            </tbody>
          </table>
        </div>
/**
 * Renders Base dependency paths (REMOVED + UNCHANGED).
 * @param {{view:Object}} param0
 * @returns {string}
 */
    </div>

    <div class="grid-2" style="margin-top:10px;">
      <div>
        <div class="kpi">
          <div class="kpi-label">Net Risk</div>
          <div id="kpi-net-risk" class="kpi-value">—</div>
          <div class="small">Weighted NEW − REMOVED</div>
        </div>
/**
 * Renders Head dependency paths (NEW + UNCHANGED).
 * @param {{view:Object}} param0
 * @returns {string}
 */
          <div class="kpi-label">Base Stock Risk</div>
          <div id="kpi-base-stock" class="kpi-value">—</div>
          <div class="small">Weighted (REMOVED + UNCHANGED)</div>
        </div>
        <div class="kpi" style="margin-top:8px;">
          <div class="kpi-label">Head Stock Risk</div>
          <div id="kpi-head-stock" class="kpi-value">—</div>
          <div class="small">Weighted (NEW + UNCHANGED)</div>
        </div>
      </div>
      <div class="chart-card" style="min-height:200px;">
        <h3 class="small" style="margin-bottom:6px;">NEW Fixability</h3>
        <div class="chart-wrap" style="height:200px;"><canvas id="chart-fix-new" aria-label="NEW fixability by severity"></canvas></div>
      </div>
    </div>
  </div>
</div>
`;
}

module.exports = { renderDashboard };
