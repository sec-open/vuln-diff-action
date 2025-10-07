// src/render/html/html.js
// Phase 3.2 (HTML) — minimal bundle with Header + Menu + Summary section.
// Reads ONLY ./dist/{diff.json, base.json, head.json}. No external requests.
// Writes ./dist/html/{index.html, header.html, menu.html, sections/summary.html, assets/...}

const core = require('@actions/core');
const fs = require('fs/promises');
const path = require('path');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}
async function readJSON(p) {
  const txt = await fs.readFile(p, 'utf8');
  return JSON.parse(txt);
}
async function writeText(p, content) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, content, 'utf8');
}
function shortSha(sha) {
  return typeof sha === 'string' && sha.length >= 7 ? sha.slice(0, 7) : (sha || '-');
}

async function buildHtmlBundle({ distDir = './dist', logoUrl = '' } = {}) {
  core.startGroup('[render/html] buildHtmlBundle');
  try {
    const absDist = path.resolve(distDir);
    const diff = await readJSON(path.join(absDist, 'diff.json')).catch(() => ({}));
    const base = await readJSON(path.join(absDist, 'base.json')).catch(() => ({}));
    const head = await readJSON(path.join(absDist, 'head.json')).catch(() => ({}));

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
    const makeHeader = require('./ui/header');
    const headerHtml = makeHeader({ logoUrl, diff, base, head });
    await writeText(path.join(outDir, 'header.html'), headerHtml);

    const makeMenu = require('./ui/menu');
    const menuHtml = makeMenu();
    await writeText(path.join(outDir, 'menu.html'), menuHtml);

    // --- summary section HTML (delegated) ---
    const makeSummary = require('./sections/summary');
    const summaryHtml = makeSummary({ diff, base, head });
    await writeText(path.join(outDir, 'sections', 'summary.html'), summaryHtml);

    // --- minimal runtime & css ---
    const runtimeJs = `/* [render/html] runtime router (no frameworks) */
(function(){
  async function loadInto(selector, url) {
    const el = document.querySelector(selector);
    if (!el) return;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      el.innerHTML = await res.text();
      // Announce change for accessibility
      el.setAttribute('data-loaded', url);
      document.title = (document.querySelector('#section-title')?.textContent || 'Vulnerability Diff Report');
    } catch(e) {
      el.innerHTML = '<p class="error">Failed to load: ' + url + '</p>';
      console.error('[render/html] loadInto error', e);
    }
  }

  // Wire menu clicks: any [data-section] points to ./sections/<name>.html
  function wireMenu() {
    const menu = document.getElementById('app-menu');
    menu.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-section]');
      if (!a) return;
      ev.preventDefault();
      const name = a.getAttribute('data-section');
      // For this first version, load summary for "summary", and for others just show title.
      if (name === 'summary') {
        loadInto('#app-content', './sections/summary.html');
      } else {
        // Swap center content with the section title only
        const el = document.querySelector('#app-content');
        if (el) el.innerHTML = '<h2 id="section-title">' + a.textContent.trim() + '</h2>';
      }
      // Mark active
      menu.querySelectorAll('[data-section].active').forEach(n => n.classList.remove('active'));
      a.classList.add('active');
    });
  }

  async function boot() {
    await loadInto('#app-header', './header.html');
    await loadInto('#app-menu', './menu.html');
    wireMenu();
    // Default section: summary
    const def = document.querySelector('#app-menu [data-section="summary"]');
    if (def) def.click();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();`;
    await writeText(path.join(assetsJs, 'runtime.js'), runtimeJs);


    core.info('[render/html] bundle written to ' + outDir);
  } catch (e) {
    core.setFailed('[render/html] buildHtmlBundle failed: ' + (e?.message || e));
    throw e;
  } finally {
    core.endGroup();
  }
}

module.exports = { buildHtmlBundle };
