/* [render/html] runtime router (no frameworks) */
// Client-side lightweight router: loads HTML section fragments into page placeholders,
// updates document title, and manages active menu state (no framework used).

(function () {
  // Fetches a fragment and injects its HTML into target selector, setting data-loaded for observers.
  async function loadInto(selector, url) {
    const el = document.querySelector(selector);
    if (!el) return;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      el.innerHTML = await res.text();
      el.setAttribute('data-loaded', url);
      document.title =
        document.querySelector('#section-title')?.textContent ||
        'Vulnerability Diff Report';
    } catch (e) {
      el.innerHTML = '<p class="error">Failed to load: ' + url + '</p>';
      console.error('[render/html] loadInto error', e);
    }
  }

  // Wires menu click events to load corresponding section fragments into main content area.
  function wireMenu() {
    const menu = document.getElementById('app-menu');
    if (!menu) return;

    menu.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-section]');
      if (!a) return;
      ev.preventDefault();

      const name = a.getAttribute('data-section');

      // Section routing (explicit mapping).
      if (name === 'overview') {
        loadInto('#app-content', './sections/overview.html');
      } else if (name === 'summary') {
        loadInto('#app-content', './sections/summary.html');
      } else if (name === 'dashboard') {
        loadInto('#app-content', './sections/dashboard.html');
      } else if (name === 'vuln-table') {
        loadInto('#app-content', './sections/vuln-table.html');
      } else if (name === 'fix-insights') {
        loadInto('#app-content', './sections/fix-insights.html');
      } else if (name === 'dep-graph-base') {
        loadInto('#app-content', './sections/dep-graph-base.html');
      } else if (name === 'dep-graph-head') {
        loadInto('#app-content', './sections/dep-graph-head.html');
      } else if (name === 'dep-paths-base') {
        loadInto('#app-content', './sections/dep-paths-base.html');
      } else if (name === 'dep-paths-head') {
        loadInto('#app-content', './sections/dep-paths-head.html');
      } else {
        // Fallback for unimplemented sections: placeholder message.
        const el = document.querySelector('#app-content');
        if (el) {
          el.innerHTML =
            '<h2 id="section-title">' +
            a.textContent.trim() +
            '</h2><p class="small">Section under construction.</p>';
        }
      }

      // Active menu item state toggle (remove previous, set current).
      menu
        .querySelectorAll('[data-section].active')
        .forEach((n) => n.classList.remove('active'));
      a.classList.add('active');
    });
  }

  // Boot sequence: loads header/menu, wires events, and triggers default section (overview).
  async function boot() {
    await loadInto('#app-header', './header.html');
    await loadInto('#app-menu', './menu.html');
    wireMenu();

    const def = document.querySelector('#app-menu [data-section="overview"]');
    if (def) def.click();
  }

  // Start once DOM is ready.
  document.addEventListener('DOMContentLoaded', boot);
})();
