// src/render/html/ui/menu.js
// Builds the left menu. "Overview" is the first item and the default view.

module.exports = function makeMenu() {
  return `
<div class="card" role="navigation" aria-label="Report Menu">
  <a href="#" class="item active" data-section="overview">Overview</a>
  <a href="#" class="item" data-section="summary">Summary</a>
  <a href="#" class="item" data-section="vuln-table">Vulnerability Diff Table</a>
  <a href="#" class="item" data-section="dashboard">Dashboard</a>

  <div class="item" style="margin-top:8px; font-weight:600;">Dependency Graph</div>
  <div class="submenu">
    <a href="#" class="item" data-section="dep-graph-base">Base</a>
    <a href="#" class="item" data-section="dep-graph-head">Head</a>
  </div>

  <div class="item" style="margin-top:8px; font-weight:600;">Dependency Paths</div>
  <div class="submenu">
    <a href="#" class="item" data-section="dep-paths-base">Base</a>
    <a href="#" class="item" data-section="dep-paths-head">Head</a>
  </div>
</div>`;
};
