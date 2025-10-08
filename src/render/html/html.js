// src/render/html/html.js
// Phase 3.2 (HTML) — bundle with Header + Menu + Summary, using a single strict view.
// Reads ONLY ./dist/ (Phase-2 outputs). No schema fallbacks.
// Writes ./dist/html/{index.html, header.html, menu.html, sections/summary.html, assets/...}

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
    core.info(`[render/html] repo=${view.repo} base=${view.base.ref}@${view.base.shaShort} head=${view.head.ref}@${view.head.shaShort}`);

    const outDir = path.join(absDist, 'html');
    const assetsDir = path.join(outDir, 'assets');
    const assetsJs = path.join(assetsDir, 'js');
    const assetsCss = path.join(assetsDir, 'css');

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

    // --- summary section HTML (delegated) ---
    const { renderSummary } = require('./sections/summary');
    const summaryHtml = renderSummary({ view });
    await writeText(path.join(outDir, 'sections', 'summary.html'), summaryHtml);

    // --- runtime.js (inline small router; you can externalize and copy if preferred) ---
    const runtimeJs = `/* [render/html] runtime router (no frameworks) */
(function(){
  async function loadInto(selector, url) {
    const el = document.querySelector(selector);
    if (!el) return;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      el.innerHTML = await res.text();
      el.setAttribute('data-loaded', url);
      document.title = (document.querySelector('#section-title')?.textContent || 'Vulnerability Diff Report');
    } catch(e) {
      el.innerHTML = '<p class="error">Failed to load: ' + url + '</p>';
      console.error('[render/html] loadInto error', e);
    }
  }
  function wireMenu() {
    const menu = document.getElementById('app-menu');
    menu.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-section]');
      if (!a) return;
      ev.preventDefault();
      const name = a.getAttribute('data-section');
      if (name === 'summary') {
        loadInto('#app-content', './sections/summary.html');
      } else {
        const el = document.querySelector('#app-content');
        if (el) el.innerHTML = '<h2 id="section-title">' + a.textContent.trim() + '</h2>';
      }
      menu.querySelectorAll('[data-section].active').forEach(n => n.classList.remove('active'));
      a.classList.add('active');
    });
  }
  async function boot() {
    await loadInto('#app-header', './header.html');
    await loadInto('#app-menu', './menu.html');
    wireMenu();
    const def = document.querySelector('#app-menu [data-section="summary"]');
    if (def) def.click();
  }
  document.addEventListener('DOMContentLoaded', boot);
})();`;
    await writeText(path.join(assetsJs, 'runtime.js'), runtimeJs);

    // --- COPY STATIC ASSETS (CSS and everything under assets/) ---
    // Source: your repo under src/render/html/assets
    const srcAssets = path.resolve('src/render/html/assets');
    if (fs.existsSync(srcAssets)) {
      await copyTree(srcAssets, assetsDir);
      core.info(`[render/html] assets copied from ${srcAssets} -> ${assetsDir}`);
    } else {
      core.warning('[render/html] no static assets found at src/render/html/assets (skipping copy)');
      // Ensure at least CSS dir exists to avoid 404 in link tag
      await ensureDir(assetsCss);
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
