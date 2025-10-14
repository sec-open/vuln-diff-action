// src/render/html/assets/js/tables.js
// Minimal sort + filter for tables with class "sortable filterable".
// - Click a <th data-sort="key"> to sort asc/desc.
// - Typing in <input.tbl-filter data-target="#tableId"> filters rows by text.
// Supports numeric sort if the target <td> has data-num="123".

(function () {
  function cellValue(td) {
    if (td && td.dataset && td.dataset.num !== undefined) {
      const n = Number(td.dataset.num);
      return Number.isNaN(n) ? 0 : n;
    }
    return (td.textContent || '').trim().toLowerCase();
  }

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

  function bindSorting(root) {
    root.querySelectorAll('table.sortable thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
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
