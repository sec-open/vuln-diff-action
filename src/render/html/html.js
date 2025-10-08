// src/render/html/html.js
// Phase 3.2 (HTML) — bundle with Header + Menu + Summary, using a single strict view.
// Reads ONLY ./dist/ (Phase-2 outputs). No external requests or schema fallbacks.
// Writes ./dist/html/{index.html, header.html, menu.html, sections/summary.html, assets/...}

const core = require('@actions/core');
const fs = require('fs/promises');
const path = require('path');
const { buildView } = require('./lib/view');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}
async function writeText(p, content) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, content, 'utf8');
}

async function buildHtmlBundle({ distDir = './dist', logoUrl = '' } = {}) {
  core.startGroup('[render/html] buildHtmlBundle');
  try {
    const absDist = path.resolve(distDir);

    // Build strict view once; pass it down to sections.
    const view = buildView(absDist);
    core.info(`[render/html] repo=${view.repo} base=${view.base.ref}@${view.base.shaShort} head=${view.head.ref}@${view.head.shaShort}`);

    const outDir = path.join(absDist, 'html');
    const assetsJs = path.join(outDir, 'assets', 'js');
    const assetsCss = path.join(outDir, 'assets', 'css');

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
    // NOTE: we pass "view" (strict) so sections don't read JSON again.
    const { renderHeader } = require('./sections/header');
    const headerHtml = renderHeader({ view, logoUrl });
    await writeText(path.join(outDir, 'header.html'), headerHtml);

    const makeMenu = require('./ui/menu'); // existing simple menu (no need to change)
    const menuHtml = makeMenu();
    await writeText(path.join(outDir, 'menu.html'), menuHtml);

    // --- summary section HTML (delegated) ---
    const { renderSummary } = require('./sections/summary');
    const summaryHtml = renderSummary({ view });
    await writeText(path.join(outDir, 'sections', 'summary.html'), summaryHtml);

    // --- minimal runtime (kept inline and small on purpose) ---
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

    // CSS is external/static — do NOT overwrite here.
    // Ensure the folder exists; user provides style.css in repo under src/render/html/assets/css/style.css
    await ensureDir(assetsCss);

    core.info('[render/html] bundle written to ' + outDir);
  } catch (e) {
    core.setFailed('[render/html] buildHtmlBundle failed: ' + (e?.message || e));
    throw e;
  } finally {
    core.endGroup();
  }
}

module.exports = { buildHtmlBundle };
