// src/render/pdf/utils/exporter.js
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const puppeteer = require('puppeteer-core');
const { install, computeExecutablePath } = require('@puppeteer/browsers');
const { PDFDocument } = require('pdf-lib');

/**
 * Descarga (si hace falta) y devuelve el ejecutable de **Chrome for Testing (stable)**
 * en una caché LOCAL del repo, independiente del runner.
 */
async function ensureChromeForPuppeteer() {
  const cacheDir = path.join(process.cwd(), '.chrome-for-testing');

  // Si el runner te da un binario, úsalo
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    const p = process.env.PUPPETEER_EXECUTABLE_PATH;
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* seguimos */ }
  }

  const browser = 'chrome';   // Chrome for Testing
  const buildId = 'stable';   // canal estable (no snapshots)

  // Idempotente: si ya está cacheado, NO descarga de nuevo
  await install({
    cacheDir,
    browser,
    buildId,
    downloadProgressCallback: () => {}, // silencio en CI
  });

  const execPath = computeExecutablePath({ cacheDir, browser, buildId });
  if (!execPath || !fs.existsSync(execPath)) {
    throw new Error(`[pdf] Chrome executable not found in ${cacheDir}`);
  }
  return execPath;
}

async function waitForVisuals(page, { timeout = 60000 } = {}) {
  try {
    await page.waitForFunction(
      () => (window.__chartsReady === true) && (window.__mermaidReady === true),
      { timeout }
    );
    await page.waitForTimeout(250);
  } catch {
    // continuar aunque no estén listos
  }
}

/**
 * Renderiza print.html en dos pasadas y une:
 *  1) Portada (pág.1) sin header/footer
 *  2) Resto (pág.2..n) con header/footer
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
  const executablePath = await ensureChromeForPuppeteer();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`file://${printHtmlPath}`, { waitUntil: 'load', timeout: gotoTimeoutMs });

    // Esperar charts/mermaid
    await waitForVisuals(page, { timeout: visualsTimeoutMs });

    // 1) Portada sin header/footer
    const coverTmp = path.join(pdfDir, 'cover.tmp.pdf');
    await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      pageRanges: '1',
      path: coverTmp,
      margin: { top: marginTop, bottom: marginBottom, left: marginLeft, right: marginRight },
    });

    // 2) Resto con header/footer
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

    // 3) Unir PDFs con pdf-lib
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
