// src/render/pdf/utils/exporter.js
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const puppeteer = require('puppeteer-core');
const { install, computeExecutablePath } = require('@puppeteer/browsers');
const { PDFDocument } = require('pdf-lib');

/**
 * Returns true if a path exists and is executable.
 */
function isExecutable(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}

/**
 * Attempts to locate a system-installed Chrome/Chromium binary.
 */
function resolveSystemChrome() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH, // if the workflow defines it
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);

  for (const p of candidates) {
    if (isExecutable(p)) return p;
  }
  return null;
}

/**
 * Installs (if needed) Chrome for Testing (stable) locally and returns the executable path.
 * If it fails with 404, returns null (does not break).
 */
async function resolveChromeForTesting() {
  const cacheDir = path.join(process.cwd(), '.chrome-for-testing');
  const browser = 'chrome';
  const buildId = 'stable';

  try {
    await install({ cacheDir, browser, buildId, downloadProgressCallback: () => {} });
    const execPath = computeExecutablePath({ cacheDir, browser, buildId });
    if (execPath && fs.existsSync(execPath)) return execPath;
  } catch (e) {
    // Do not abort on 404 or network blocks; continue with other methods
    console.warn('[pdf] Chrome for Testing install failed or unavailable:', e?.message || e);
  }
  return null;
}

/**
 * Determines which browser executable to use (system first, fallback to Chrome for Testing).
 */
async function ensureBrowserPath() {
  // 1) System Chrome (more reliable in runners, avoids 404)
  const sys = resolveSystemChrome();
  if (sys) return sys;

  // 2) Chrome for Testing (stable) cached locally
  const cft = await resolveChromeForTesting();
  if (cft) return cft;

  // If we reached here, no usable browser
  throw new Error('[pdf] No Chrome/Chromium executable available (system not found, Chrome for Testing download failed).');
}

async function waitForVisuals(page, { timeout = 60000 } = {}) {
  const predicate = `
    (function () {
      var q = document.querySelector.bind(document);
      var qa = function(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); };

      // CHARTS readiness
      var hasCharts = qa('canvas[id^="chart-"]').length > 0;
      var chartsOk =
        (window.__chartsReady === true) ||
        !hasCharts ||
        qa('canvas[id^="chart-"]').every(function(c){ return (c.width || 0) > 0 && (c.height || 0) > 0; });

      // MERMAID readiness
      var mermaidBlocks = qa('pre code.language-mermaid, .language-mermaid, pre.mermaid, .mermaid');
      var hasMermaid = mermaidBlocks.length > 0;
      var mermaidOk =
        (window.__mermaidReady === true) ||
        !hasMermaid ||
        (qa('svg[id^="mmsvg-"]').length >= mermaidBlocks.length);

      // FIX INSIGHTS content loaded
      var fixEl = q('#fix-insights');
      var fixOk =
        (window.__fixInsightsReady === true) ||
        !fixEl ||
        !/Loading…|Loading\\.\\.\\.|Loading/i.test(fixEl.textContent || '');

      // DEP PATHS tables present
      var depBase = q('#dep-paths-base');
      var depHead = q('#dep-paths-head');
      var depOk =
        (window.__depPathsReady === true) ||
        (!depBase && !depHead) ||
        (q('#dep-paths-base table, #dep-paths-head table') !== null);

      // IMAGES (all <img> complete)
      var imagesOk = Array.prototype.every.call(document.images || [], function(img){ return img.complete; });

      return chartsOk && mermaidOk && fixOk && depOk && imagesOk;
    })()
  `;
  try {
    await page.waitForFunction(predicate, { timeout });
    await page.waitForTimeout(150); // small settle
  } catch {
    // Does not block: if it does not reach ready, we continue anyway (your current behavior)
  }
}


/**
 * Renders the report in two passes (cover without header/footer, rest with header/footer) and merges PDFs.
 */
async function renderPdf({
  printHtmlPath,
  pdfDir,
  headerHtml,
  footerHtml,
  marginTop = '60px',
  marginBottom = '60px',
  marginLeft = '14mm',
  marginRight = '14mm',
  gotoTimeoutMs = 120000,
  visualsTimeoutMs = 60000,
}) {
  const executablePath = await ensureBrowserPath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`file://${printHtmlPath}`, { waitUntil: 'load', timeout: gotoTimeoutMs });

    // Wait for charts/mermaid (if present)
    await waitForVisuals(page, { timeout: visualsTimeoutMs });

    // 1) Cover page (without header/footer)
    const coverTmp = path.join(pdfDir, 'cover.tmp.pdf');
    await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      pageRanges: '1',
      path: coverTmp,
      margin: { top: marginTop, bottom: marginBottom, left: marginLeft, right: marginRight },
    });

    // 2) Rest of the document (with header/footer)
    const restTmp = path.join(pdfDir, 'rest.tmp.pdf');
    await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      pageRanges: '2-',
      path: restTmp,
      margin: { top: marginTop, bottom: marginBottom, left: marginLeft, right: marginRight },
    });

    // 3) Merge PDFs with pdf-lib
    const coverDoc = await PDFDocument.load(await fsp.readFile(coverTmp));
    const restDoc  = await PDFDocument.load(await fsp.readFile(restTmp));
    const out = await PDFDocument.create();

    const [coverPage] = await out.copyPages(coverDoc, [0]);
    out.addPage(coverPage);

    const restPages = await out.copyPages(restDoc, restDoc.getPageIndices());
    restPages.forEach((p) => out.addPage(p));

    const bytes = await out.save();
    const outPath = path.join(pdfDir, 'report.pdf');
    await fsp.writeFile(outPath, bytes);

    await Promise.allSettled([ fsp.unlink(coverTmp), fsp.unlink(restTmp) ]);

    console.log(`[pdf] written: ${outPath}`);
    return outPath;
  } finally {
    await browser.close();
  }
}

module.exports = { renderPdf, waitForVisuals };
