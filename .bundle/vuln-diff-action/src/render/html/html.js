// src/render/html/html.js
// Phase 3.2 (HTML) — bundle with Header + Menu + Overview + Summary, using a single strict view.
// Reads ONLY ./dist/ (Phase-2 outputs). No schema fallbacks.
// Writes ./dist/html/{index.html, header.html, menu.html, sections/*.html, assets/**}

const core = require('@actions/core');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const { buildView } = require('../common/view');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}
async function writeText(p, content) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, content, 'utf8');
}
async function copyTree(src, dst) {
  const stat = await fsp.stat(src);
  if (stat.isDirectory()) {
    await ensureDir(dst);
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const e of entries) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) {
        await copyTree(s, d);
      } else {
        await ensureDir(path.dirname(d));
        await fsp.copyFile(s, d);
      }
    }
  } else {
    await ensureDir(path.dirname(dst));
    await fsp.copyFile(src, dst);
  }
}

async function buildHtmlBundle({ distDir = './dist', logoUrl = '' } = {}) {
  core.startGroup('[render/html] buildHtmlBundle');
  try {
    const absDist = path.resolve(distDir);

    // Build strict view once; pass it down to sections.
    const view = buildView(absDist);
    core.info(
      `[render/html] repo=${view.repo} base=${view.base.ref}@${view.base.shaShort} head=${view.head.ref}@${view.head.shaShort}`
    );

    const outDir = path.join(absDist, 'html');
    const assetsDir = path.join(outDir, 'assets');

    // --- write index.html (shell with 3 zones) ---
    const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Vulnerability Diff Report</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link href="./assets/css/style.css" rel="stylesheet" />
</head>
<body>
  <header id="app-header"></header>
  <div id="app-main">
    <nav id="app-menu"></nav>
    <main id="app-content" aria-live="polite"></main>
  </div>
    <script src="./assets/js/vendor/chart.umd.js"></script>
    <script src="./assets/js/vendor/chartjs-plugin-datalabels.min.js"></script>

    <script src="./assets/js/vendor/mermaid.min.js"></script>
    <script src="./assets/js/dep-graph.js"></script>

    <script src="./assets/js/dashboard.js"></script>
    <script src="./assets/js/fix-insights.js"></script>
    <script src="./assets/js/tables.js"></script>

    <script src="./assets/js/runtime.js"></script>
</body>
</html>`;
    await writeText(path.join(outDir, 'index.html'), indexHtml);

    // --- header and menu HTML (delegated) ---
    const { renderHeader } = require('./ui/header');
    const headerHtml = renderHeader({ view, logoUrl });
    await writeText(path.join(outDir, 'header.html'), headerHtml);

    const makeMenu = require('./ui/menu');
    const menuHtml = makeMenu();
    await writeText(path.join(outDir, 'menu.html'), menuHtml);

    // --- sections: overview + summary (delegated) ---
    const { renderOverview } = require('./sections/overview');
    const { renderSummary } = require('./sections/summary');
    const { renderDepGraphBase, renderDepGraphHead } = require('./sections/dep-graph');
    const { renderDashboard } = require('./sections/dashboard');
    const { renderFixInsights } = require('./sections/fix-insights');
    const { renderVulnTable } = require('./sections/vuln-table');
    const { renderDepPathsBase, renderDepPathsHead } = require('./sections/dep-paths');

    const overviewHtml = renderOverview({ view });
    await writeText(path.join(outDir, 'sections', 'overview.html'), overviewHtml);

    const summaryHtml = renderSummary({ view });
    await writeText(path.join(outDir, 'sections', 'summary.html'), summaryHtml);

    const dashboardHtml = renderDashboard({ view });
    await writeText(path.join(outDir, 'sections', 'dashboard.html'), dashboardHtml);

    // ... after writing dashboard.html
    const SEVERITY_ORDER = ['CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN'];
    const totals = view.summary.totals;
    const by = view.summary.bySeverityAndState || {};
    const sevLabels = SEVERITY_ORDER.slice();
    const sevNew = sevLabels.map(s => (by[s]?.NEW ?? 0));
    const sevRemoved = sevLabels.map(s => (by[s]?.REMOVED ?? 0));
    const sevUnchanged = sevLabels.map(s => (by[s]?.UNCHANGED ?? 0));

    // NEW blocks from precompute
    const hvb = view.precomputed.aggregates.head_vs_base_by_severity || null;
    const topHead = view.precomputed.aggregates.top_components_head || [];
    const risk = view.precomputed.aggregates.risk || null;
    const fixesNew = view.precomputed.aggregates.fixes_new || null;

    const dashData = {
      stateTotals: { labels: ['NEW','REMOVED','UNCHANGED'], values: [totals.NEW, totals.REMOVED, totals.UNCHANGED] },
      severityStacked: { labels: sevLabels, NEW: sevNew, REMOVED: sevRemoved, UNCHANGED: sevUnchanged },
      newVsRemovedBySeverity: { labels: sevLabels, NEW: sevNew, REMOVED: sevRemoved },
      headVsBaseBySeverity: hvb,
      topComponentsHead: topHead,
      // KPIs (net risk)
      riskKpis: risk, // { weights, components:{newWeighted,removedWeighted}, kpis:{netRisk,headStockRisk} }
      // NEW-only fixability
      fixesNew: fixesNew, // { by_severity:{...}, totals:{with_fix,without_fix} }
    };

    await writeText(path.join(outDir, 'sections', 'dashboard-data.json'), JSON.stringify(dashData));


    // ---- Fix Insights section and data ----
    const fixHtml = renderFixInsights({ view });
    await writeText(path.join(outDir, 'sections', 'fix-insights.html'), fixHtml);

    // Tables sources (items) — we keep only items needed here to avoid large payloads if desired
    const newWithFix = view.items.filter(it => String(it.state).toUpperCase() === 'NEW' && (it.has_fix === true || Array.isArray(it.fixed_versions) || Array.isArray(it.fix_versions) || (it.fix && Array.isArray(it.fix.versions))));
    const unchangedWithFix = view.items.filter(it => String(it.state).toUpperCase() === 'UNCHANGED' && (it.has_fix === true || Array.isArray(it.fixed_versions) || Array.isArray(it.fix_versions) || (it.fix && Array.isArray(it.fix.versions))));

    const fixData = {
      fixesHead: {
        bySeverity: view.precomputed.aggregates.fixes_head.by_severity,
        totals: view.precomputed.aggregates.fixes_head.totals,
      },
      newWithFix: newWithFix,
      unchangedWithFix: unchangedWithFix,
    };
    await writeText(path.join(outDir, 'sections', 'fix-insights-data.json'), JSON.stringify(fixData));

    const depGraphBaseHtml = renderDepGraphBase({ view });
    await writeText(path.join(outDir, 'sections', 'dep-graph-base.html'), depGraphBaseHtml);

    const depGraphHeadHtml = renderDepGraphHead({ view });
    await writeText(path.join(outDir, 'sections', 'dep-graph-head.html'), depGraphHeadHtml);


    const vulnTableHtml = renderVulnTable({ view });
    await writeText(path.join(outDir, 'sections', 'vuln-table.html'), vulnTableHtml);

    const depBaseHtml = renderDepPathsBase({ view });
    await writeText(path.join(outDir, 'sections', 'dep-paths-base.html'), depBaseHtml);

    const depHeadHtml = renderDepPathsHead({ view });
    await writeText(path.join(outDir, 'sections', 'dep-paths-head.html'), depHeadHtml);

    // Source expected at src/render/html/assets/**
    const srcAssets = path.resolve('src/render/html/assets');
    if (fs.existsSync(srcAssets)) {
      await copyTree(srcAssets, assetsDir);
      core.info(
        `[render/html] assets copied from ${srcAssets} -> ${assetsDir}`
      );
    } else {
      core.warning(
        '[render/html] no static assets found at src/render/html/assets (skipping copy)'
      );
      // Ensure directories exist to avoid 404s
      await ensureDir(path.join(assetsDir, 'css'));
      await ensureDir(path.join(assetsDir, 'js'));
    }

    core.info('[render/html] bundle written to ' + outDir);
  } catch (e) {
    core.setFailed('[render/html] buildHtmlBundle failed: ' + (e?.message || e));
    throw e;
  } finally {
    core.endGroup();
  }
}

module.exports = { buildHtmlBundle };
