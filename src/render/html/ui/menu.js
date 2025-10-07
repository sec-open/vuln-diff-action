// src/render/html/ui/menu.js
// Builds menu.html with working buttons. Each item has data-section.
// In this first cut, only "summary" loads real content. Others show the title.

module.exports = function makeMenu() {
  return `
<div class="card" role="navigation" aria-label="Report Menu">
  <a href="#" class="item active" data-section="summary">Summary</a>
  <a href="#" class="item" data-section="vuln-table">Vulnerability Diff Table</a>
  <a href="#" class="item" data-section="dep-graph">Dependency Graph</a>
  <a href="#" class="item" data-section="dep-paths">Dependency Paths</a>
</div>`;
};
