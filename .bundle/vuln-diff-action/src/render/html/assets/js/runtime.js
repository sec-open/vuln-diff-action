/* [render/html] runtime router (no frameworks) */
(function () {
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

  function wireMenu() {
    const menu = document.getElementById('app-menu');
    if (!menu) return;

    menu.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-section]');
      if (!a) return;
      ev.preventDefault();

      const name = a.getAttribute('data-section');

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
        // Placeholder for sections not implemented yet:
        const el = document.querySelector('#app-content');
        if (el) {
          el.innerHTML =
            '<h2 id="section-title">' +
            a.textContent.trim() +
            '</h2><p class="small">Section under construction.</p>';
        }
      }

      // Active state
      menu
        .querySelectorAll('[data-section].active')
        .forEach((n) => n.classList.remove('active'));
      a.classList.add('active');
    });
  }

  async function boot() {
    await loadInto('#app-header', './header.html');
    await loadInto('#app-menu', './menu.html');
    wireMenu();

    // Default view → Overview
    const def = document.querySelector('#app-menu [data-section="overview"]');
    if (def) def.click();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
