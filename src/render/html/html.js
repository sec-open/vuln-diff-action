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

    const styleCss = `/* Minimal layout for header(top), menu(left), content(center) */
:root {
  --bg: #0b0f16;
  --panel: #121826;
  --card: #0f1726;
  --text: #e5e7eb;
  --muted: #9aa4b2;
  --accent: #8b5cf6;
  --border: #1f2937;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
a { color: #93c5fd; text-decoration: none; }
a:hover { text-decoration: underline; }

#app-header { padding: 12px 16px; background: var(--panel); border-bottom: 1px solid var(--border); }
#app-main { display: grid; grid-template-columns: 260px 1fr; min-height: calc(100vh - 60px); }

#app-menu { background: var(--panel); border-right: 1px solid var(--border); padding: 8px; }
#app-menu .item { display: block; padding: 10px 12px; border-radius: 8px; color: var(--text); margin: 4px 0; }
#app-menu .item:hover { background: #162033; }
#app-menu .item.active { background: #1b2740; border: 1px solid #223154; }

#app-content { padding: 16px; }

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
}

.small { color: var(--muted); font-size: 13px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.tag { display:inline-block; padding: 2px 8px; border-radius: 999px; background: #1f2937; color: #cbd5e1; font-size: 12px; }
h1, h2, h3 { margin: 0 0 10px 0; }
h1 { font-size: 20px; }
h2 { font-size: 18px; }
h3 { font-size: 16px; }
code { background: #0b1220; padding: 2px 6px; border-radius: 6px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); }
.error { color: #fca5a5; }`;
    await writeText(path.join(assetsCss, 'style.css'), styleCss);

    core.info('[render/html] bundle written to ' + outDir);
  } catch (e) {
    core.setFailed('[render/html] buildHtmlBundle failed: ' + (e?.message || e));
    throw e;
  } finally {
    core.endGroup();
  }
}

module.exports = { buildHtmlBundle };
