// Minimal SPA shell for the HTML bundle (pure client-side).
// Comments in English.

(() => {
  const SEV_ORDER = ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"];
  const STATE_ORDER = ["NEW","REMOVED","UNCHANGED"];

  const state = {
    base: null,
    head: null,
    diff: null,
    filters: {
      severities: [...SEV_ORDER],
      states: [...STATE_ORDER],
      query: ""
    },
    route: "#summary"
  };

  // --- Boot ---
  window.addEventListener("DOMContentLoaded", init);

  async function init() {
    setMetaTimestamp();
    await loadData();
    mountFilters();
    mountRouter();
    mountSections();
    navigate(location.hash || "#summary");
  }

  function setMetaTimestamp() {
    const m = document.querySelector('meta[name="report-generated-at"]');
    if (m) m.setAttribute("content", new Date().toISOString());
  }

  async function loadData() {
    // Load JSON files generated at runtime
    const [base, head, diff] = await Promise.all([
      fetch("./data/base.json").then(r => r.json()),
      fetch("./data/head.json").then(r => r.json()),
      fetch("./data/diff.json").then(r => r.json())
    ]);
    state.base = base;
    state.head = head;
    state.diff = diff;
  }

  // --- Router ---
  function mountRouter() {
    window.addEventListener("hashchange", () => navigate(location.hash));
  }

  function navigate(hash) {
    if (!hash) hash = "#summary";
    state.route = hash;
    document.querySelectorAll(".route").forEach(el => el.classList.remove("active"));
    const target = document.querySelector(hash);
    if (target) target.classList.add("active");
    // Lazy renders
    switch (hash) {
      case "#summary": renderSummary(); break;
      case "#overview": renderOverview(); break;
      case "#diff-table": renderDiffTable(); break;
      case "#dep-graph-base": renderDepGraphBase(); break;
      case "#dep-graph-head": renderDepGraphHead(); break;
      case "#dep-path-base": renderDepPathBase(); break;
      case "#dep-path-head": renderDepPathHead(); break;
      default: break;
    }
  }

  // --- Filters panel (global) ---
  function mountFilters() {
    const el = document.getElementById("filters");
    if (!el) return;
    el.innerHTML = `
      <div class="row">
        <strong>Filters:</strong>
        ${SEV_ORDER.map(s => `
          <label><input type="checkbox" data-sev value="${s}" checked /> ${s}</label>
        `).join("")}
        ${STATE_ORDER.map(s => `
          <label><input type="checkbox" data-state value="${s}" checked /> ${s}</label>
        `).join("")}
        <input type="search" id="q" placeholder="Search id / package / version" />
        <button id="reset">Reset</button>
      </div>
    `;
    el.addEventListener("change", onFilterChange);
    el.querySelector("#q").addEventListener("input", onFilterChange);
    el.querySelector("#reset").addEventListener("click", resetFilters);
  }

  function onFilterChange(e) {
    const sev = Array.from(document.querySelectorAll('input[data-sev]:checked')).map(i => i.value);
    const st = Array.from(document.querySelectorAll('input[data-state]:checked')).map(i => i.value);
    const q = /** @type {HTMLInputElement} */(document.getElementById("q")).value.trim();
    state.filters.severities = sev;
    state.filters.states = st;
    state.filters.query = q;
    // re-render current route if applicable
    if (state.route === "#overview") renderOverview();
    if (state.route === "#diff-table") renderDiffTable();
    if (state.route === "#dep-path-base") renderDepPathBase();
    if (state.route === "#dep-path-head") renderDepPathHead();
  }

  function resetFilters() {
    state.filters.severities = [...SEV_ORDER];
    state.filters.states = [...STATE_ORDER];
    state.filters.query = "";
    mountFilters(); // re-mount
    if (state.route === "#overview") renderOverview();
    if (state.route === "#diff-table") renderDiffTable();
    if (state.route === "#dep-path-base") renderDepPathBase();
    if (state.route === "#dep-path-head") renderDepPathHead();
  }

  // --- Utilities ---
  function formatPackage(name, version) {
    const n = name || "unknown";
    const v = (version && String(version).trim()) ? String(version).trim() : "-";
    return `${n}:${v}`;
  }

  // --- Renderers (stubs: wire to your real builders) ---
  function renderSummary() {
    const el = document.getElementById("summary");
    if (!el || !state.diff || !state.base || !state.head) return;
    const { diff, base, head } = state;

    el.innerHTML = `
      <div class="card">
        <h2>What you're looking at</h2>
        <p>This report compares the security posture of <strong>${diff?.repo || "repository"}</strong> between
           <strong>${diff?.head?.ref}</strong> (${(diff?.head?.sha_short)||""}) and
           <strong>${diff?.base?.ref}</strong> (${(diff?.base?.sha_short)||""}).</p>
      </div>
      <div class="row">
        <div class="card">
          <h3>Totals by state</h3>
          <ul>
            <li>NEW: ${diff?.summary?.totals?.NEW ?? 0}</li>
            <li>REMOVED: ${diff?.summary?.totals?.REMOVED ?? 0}</li>
            <li>UNCHANGED: ${diff?.summary?.totals?.UNCHANGED ?? 0}</li>
          </ul>
        </div>
        <div class="card">
          <h3>Base branch</h3>
          <p><strong>${base?.summary?.branch || diff?.base?.ref}</strong> (${base?.summary?.commit_short || diff?.base?.sha_short})</p>
        </div>
        <div class="card">
          <h3>Head branch</h3>
          <p><strong>${head?.summary?.branch || diff?.head?.ref}</strong> (${head?.summary?.commit_short || diff?.head?.sha_short})</p>
        </div>
      </div>
    `;
  }

  function renderOverview() {
    // Wire Chart.js datasets here when vendor assets are present.
    // Keep this stub rendering containers ready.
  }

  function renderDiffTable() {
    const mount = document.getElementById("diff-table-container");
    if (!mount || !state.diff) return;
    const rows = [
      ...(state.diff?.changes?.new ?? []).map(v => ({...v, __status:"NEW"})),
      ...(state.diff?.changes?.removed ?? []).map(v => ({...v, __status:"REMOVED"})),
      ...(state.diff?.changes?.unchanged ?? []).map(v => ({...v, __status:"UNCHANGED"})),
    ];
    const q = state.filters.query.toLowerCase();
    const filtered = rows.filter(r => {
      const sevOk = state.filters.severities.includes(r.severity);
      const stOk = state.filters.states.includes(r.__status);
      const txt = `${r.id||""} ${r.package?.name||""} ${r.package?.version||""}`.toLowerCase();
      const qOk = q ? txt.includes(q) : true;
      return sevOk && stOk && qOk;
    });

    mount.innerHTML = `
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Vulnerability</th>
              <th>Package</th>
              <th>Branches</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(r => `
              <tr>
                <td><span class="badge ${String(r.severity||"unknown").toLowerCase()}">${r.severity||"UNKNOWN"}</span></td>
                <td><a target="_blank" href="${advisoryHref(r)}">${r.id||""}</a></td>
                <td><code>${formatPackage(r.package?.name, r.package?.version)}</code></td>
                <td>${r.branches || r.__status === "UNCHANGED" ? "BOTH" : (r.__status === "NEW" ? "HEAD" : "BASE")}</td>
                <td>${r.__status}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function advisoryHref(v) {
    if (v?.ids?.ghsa) return `https://github.com/advisories/${v.ids.ghsa}`;
    if (v?.ids?.cve) return `https://nvd.nist.gov/vuln/detail/${v.ids.cve}`;
    return "#";
  }

  function renderDepGraphBase(){ /* stub for Mermaid init + base graph text */ }
  function renderDepGraphHead(){ /* stub for Mermaid init + head graph text */ }
  function renderDepPathBase(){ /* stub: build table with Depth0..DepthN */ }
  function renderDepPathHead(){ /* stub: build table with Depth0..DepthN */ }
})();
