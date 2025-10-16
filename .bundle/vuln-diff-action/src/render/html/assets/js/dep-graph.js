// src/render/html/assets/js/dep-graph.js
// Mermaid bootstrapping for dependency graph sections.

(function () {
  function ensureMermaid() {
    if (!window.mermaid) {
      console.error('[dep-graph] mermaid not found. Did you include assets/js/vendor/mermaid.min.js in index.html?');
      return false;
    }
    return true;
  }

  function runMermaid() {
    if (!ensureMermaid()) return;
    // Do not auto-start on load; we drive rendering after content is injected.
    window.mermaid.initialize({ startOnLoad: false });
    // Re-render all diagrams present in the section
    const nodes = document.querySelectorAll('.mermaid');
    if (nodes.length === 0) return;
    window.mermaid.run({ querySelector: '.mermaid' });
  }

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
