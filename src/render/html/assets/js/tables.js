// Table enhancement module: adds client-side sorting and text filtering
// for tables with class "sortable" and inputs with class "tbl-filter".
// Sorting supports numeric comparison when target cell includes data-num attribute.

(function () {
  // Extracts sortable value from a cell: numeric if data-num present, else lowercased text.
  function cellValue(td) {
    if (td && td.dataset && td.dataset.num !== undefined) {
      const n = Number(td.dataset.num);
      return Number.isNaN(n) ? 0 : n;
    }
    return (td.textContent || '').trim().toLowerCase();
  }

  // Sorts table rows (single <tbody>) by key taken from matching <th data-sort="key">.
  function sortTable(table, key, asc) {
    const tbody = table.tBodies[0];
    const rows = Array.from(tbody.rows);
    const ths = Array.from(table.tHead.rows[0].cells);
    const idx = ths.findIndex(th => th.dataset.sort === key);
    if (idx < 0) return;

    rows.sort((a, b) => {
      const av = cellValue(a.cells[idx]);
      const bv = cellValue(b.cells[idx]);
      if (typeof av === 'number' || typeof bv === 'number') {
        return asc ? (av - bv) : (bv - av);
      }
      if (av === bv) return 0;
      return asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

    rows.forEach(r => tbody.appendChild(r));
    ths.forEach(th => th.removeAttribute('aria-sort'));
    ths[idx].setAttribute('aria-sort', asc ? 'ascending' : 'descending');
  }

  // Binds click listeners on sortable headers to toggle ascending/descending order.
  function bindSorting(root) {
    root.querySelectorAll('table.sortable thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const table = th.closest('table');
        const key = th.dataset.sort;
        const current = th.getAttribute('aria-sort');
        const asc = current !== 'ascending'; // Toggle sort direction.
        sortTable(table, key, asc);
      });
    });
  }

  // Binds input listeners on filter fields to hide rows not matching query text.
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
        }, 120); // Debounce to reduce excessive DOM work.
      });
    });
  }

  // Initializes observers to apply enhancements when new section HTML is loaded.
  document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('app-content');
    if (!content) return;

    const enhance = () => {
      const loaded = content.getAttribute('data-loaded') || '';
      if (loaded.endsWith('.html')) {
        bindSorting(content);
        bindFiltering(content);
      }
    };

    const obs = new MutationObserver(enhance);
    obs.observe(content, { attributes: true });
    enhance();
  });
})();
