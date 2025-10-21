// src/render/html/assets/js/dep-graph.js
// Mermaid bootstrapping for dependency graph sections.

(function () {
  // Verifies Mermaid presence; logs helpful error if missing.
  function ensureMermaid() {
    if (!window.mermaid) {
      console.error('[dep-graph] mermaid not found. Did you include assets/js/vendor/mermaid.min.js in index.html?');
      return false;
    }
    return true;
  }

  // Initializes Mermaid (without auto-start) and renders all diagrams with class .mermaid.
  function runMermaid() {
    if (!ensureMermaid()) return;
    window.mermaid.initialize({ startOnLoad: false });
    const nodes = document.querySelectorAll('.mermaid');
    if (nodes.length === 0) return;
    window.mermaid.run({ querySelector: '.mermaid' });
  }

  // Observes section content changes; runs Mermaid only for target dependency graph pages.
  document.addEventListener('DOMContentLoaded', function () {
    const content = document.getElementById('app-content');
    if (!content) { runMermaid(); return; }
    const obs = new MutationObserver(() => {
      const loaded = content.getAttribute('data-loaded') || '';
      if (loaded.endsWith('/dep-graph-base.html') || loaded.endsWith('/dep-graph-head.html')) {
        runMermaid();
      }
    });
    obs.observe(content, { attributes: true });
  });
})();
