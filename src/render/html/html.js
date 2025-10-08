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
    const { renderSummary } = require('./sections/summary');
    const { renderVulnTable } = require('./sections/vuln-table');
    const { renderDepPathsBase, renderDepPathsHead } = require('./sections/dep-paths');

    const overviewHtml = renderOverview({ view });
    await writeText(path.join(outDir, 'sections', 'overview.html'), overviewHtml);

    const summaryHtml = renderSummary({ view });
    await writeText(path.join(outDir, 'sections', 'summary.html'), summaryHtml);

    const vulnTableHtml = renderVulnTable({ view });
    await writeText(path.join(outDir, 'sections', 'vuln-table.html'), vulnTableHtml);

    const depBaseHtml = renderDepPathsBase({ view });
    await writeText(path.join(outDir, 'sections', 'dep-paths-base.html'), depBaseHtml);

    const depHeadHtml = renderDepPathsHead({ view });
    await writeText(path.join(outDir, 'sections', 'dep-paths-head.html'), depHeadHtml);

    // --- COPY STATIC ASSETS (CSS + JS + images, etc.) FROM REPO ---
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
