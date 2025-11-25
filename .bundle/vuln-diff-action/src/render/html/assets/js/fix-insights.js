// Fix insights renderer: loads JSON data, builds fix coverage charts, and populates tables
// listing vulnerabilities with available fixes (NEW + UNCHANGED).

(function () {
  // HTML section and data artifact URLs.
  const SECT_URL = './sections/fix-insights.html';
  const DATA_URL = './sections/fix-insights-data.json';

  // Checks Chart.js availability.
  function hasChartJs() { return !!window.Chart; }

  // Loads JSON data from artifact endpoint.
  async function fetchData() {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
    return res.json();
  }

  // Builds bar chart grouping vulnerability counts by severity (with/without fix).
  function mkBarFixBySeverity(ctx, labels, withFix, withoutFix) {
    return new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'with fix', data: withFix }, { label: 'without fix', data: withoutFix }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, title: { display: false } },
        scales: { x: { stacked: false }, y: { beginAtZero: true, stacked: false, ticks: { precision: 0 } } }
      }
    });
  }

  // Builds donut chart summarizing overall fix coverage.
  function mkDonutFixCoverage(ctx, withFix, withoutFix) {
    return new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['with fix', 'without fix'], datasets: [{ data: [withFix, withoutFix] }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' }, title: { display: false } }
      }
    });
  }

  // Generates hyperlink for recognized vulnerability identifiers (CVE / GHSA).
  function hyperlinkId(id) {
    if (!id) return 'UNKNOWN';
    const up = String(id).toUpperCase();
    if (up.startsWith('CVE-')) return `<a href="https://nvd.nist.gov/vuln/detail/${up}" target="_blank" rel="noopener">${id}</a>`;
    if (up.startsWith('GHSA-')) return `<a href="https://github.com/advisories/${up}" target="_blank" rel="noopener">${id}</a>`;
    return id;
  }

  // Formats package coordinates into group:artifact:version string.
  function toGav(pkg) {
    const g = pkg?.groupId ?? 'unknown';
    const a = pkg?.artifactId ?? 'unknown';
    const v = pkg?.version ?? 'unknown';
    return `${g}:${a}:${v}`;
  }

  // Populates a table body with fix insight rows or fallback row if empty.
  function buildRows(items, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!Array.isArray(items) || items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="small">No entries.</td></tr>`;
      return;
    }
    const rows = items.map(it => {
      const sev = String(it.severity || 'UNKNOWN').toUpperCase();
      const id = it.id || it.ids?.ghsa || it.ids?.cve || 'UNKNOWN';
      const pkg = toGav(it.package);
      const fixed = Array.isArray(it.fixed_versions) ? it.fixed_versions.join(', ') :
                    Array.isArray(it.fix_versions) ? it.fix_versions.join(', ') :
                    Array.isArray(it.fix?.versions) ? it.fix.versions.join(', ') : '—';
      return `<tr>
        <td data-key="severity">${sev}</td>
        <td data-key="id">${hyperlinkId(id)}</td>
        <td data-key="package"><code>${pkg}</code></td>
        <td data-key="fix">${fixed}</td>
      </tr>`;
    }).join('');
    tbody.innerHTML = rows;
  }

  // Main render routine for fix insights section: validates active page, fetches data, renders charts and tables.
  async function render() {
    const content = document.getElementById('app-content');
    if (!content) return;
    const loaded = content.getAttribute('data-loaded') || '';
    if (!loaded.endsWith('/fix-insights.html')) return;

    let data;
    try { data = await fetchData(); }
    catch (e) { console.error('[fix-insights] data fetch error:', e); return; }

    // Charts (severity distribution + donut coverage).
    if (hasChartJs() && data.fixesHead) {
      const sev = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
      const withFix = sev.map(s => data.fixesHead.bySeverity[s]?.with_fix ?? 0);
      const withoutFix = sev.map(s => data.fixesHead.bySeverity[s]?.without_fix ?? 0);

      const barEl = document.getElementById('chart-fix-by-severity');
      if (barEl) mkBarFixBySeverity(barEl, sev, withFix, withoutFix);

      const donutEl = document.getElementById('chart-fix-coverage');
      if (donutEl) mkDonutFixCoverage(donutEl, data.fixesHead.totals.with_fix || 0, data.fixesHead.totals.without_fix || 0);
    }

    // Tables (NEW with fix, UNCHANGED with fix).
    buildRows(data.newWithFix || [], 'rows-new-with-fix');
    buildRows(data.unchangedWithFix || [], 'rows-unchanged-with-fix');
  }

  // Observes content changes to trigger render when section is loaded.
  document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('app-content');
    if (!content) return;
    const obs = new MutationObserver(() => render());
    obs.observe(content, { attributes: true });
  });
})();
