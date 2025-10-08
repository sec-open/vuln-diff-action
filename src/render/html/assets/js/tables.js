// src/render/html/assets/js/tables.js
// Minimal sort + filter for tables with class "sortable filterable".
// - Click a <th data-sort="key"> to sort asc/desc.
// - Typing in <input.tbl-filter data-target="#tableId"> filters rows by text.

(function () {
  function textContent(node) {
    return (node.textContent || '').trim().toLowerCase();
  }

  function sortTable(table, key, asc) {
    const tbody = table.tBodies[0];
    const rows = Array.from(tbody.rows);
    const idx = Array.from(table.tHead.rows[0].cells).findIndex(th => th.dataset.sort === key);
    if (idx < 0) return;

    rows.sort((a, b) => {
      const av = textContent(a.cells[idx]);
      const bv = textContent(b.cells[idx]);
      if (av === bv) return 0;
      return asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

    // Paint back
    rows.forEach(r => tbody.appendChild(r));
    // Set aria / state
    Array.from(table.tHead.rows[0].cells).forEach(th => th.removeAttribute('aria-sort'));
    table.tHead.rows[0].cells[idx].setAttribute('aria-sort', asc ? 'ascending' : 'descending');
  }

  function bindSorting(root) {
    root.querySelectorAll('table.sortable thead th[data-sort]').forEach(th => {
      th.addEventListener('click', (ev) => {
        const table = th.closest('table');
        const key = th.dataset.sort;
        const current = th.getAttribute('aria-sort');
        const asc = current !== 'ascending'; // toggle
        sortTable(table, key, asc);
      });
    });
  }

  function bindFiltering(root) {
    root.querySelectorAll('input.tbl-filter[data-target]').forEach(inp => {
      const sel = inp.dataset.target;
      const table = root.querySelector(sel);
      if (!table) return;

      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const q = inp.value.trim().toLowerCase();
          const rows = table.tBodies[0].rows;
          for (const r of rows) {
            const hit = q === '' || Array.from(r.cells).some(td => (td.textContent || '').toLowerCase().includes(q));
            r.style.display = hit ? '' : 'none';
          }
        }, 120);
      });
    });
  }

  // Re-bind whenever a section is loaded into #app-content
  document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('app-content');
    if (!content) return;

    const enhance = () => {
      const loaded = content.getAttribute('data-loaded') || '';
      // Improve any tables present in current section (dashboard or others)
      if (loaded.endsWith('.html')) {
        bindSorting(content);
        bindFiltering(content);
      }
    };

    const obs = new MutationObserver(enhance);
    obs.observe(content, { attributes: true });
    enhance(); // initial
  });
})();
