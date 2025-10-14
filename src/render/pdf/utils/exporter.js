// src/render/pdf/utils/exporter.js
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { chromium } = require('playwright'); // ← Playwright
const { PDFDocument } = require('pdf-lib');

async function waitForVisuals(page, { timeout = 60000 } = {}) {
  try {
    await page.waitForFunction(
      () => (window.__chartsReady === true) && (window.__mermaidReady === true),
      { timeout }
    );
    await page.waitForTimeout(250); // pequeño settle
  } catch {
    // continuar aunque no estén listos
  }
}

/**
 * Renderiza print.html en dos pasadas:
 *   1) Portada (pág.1) sin header/footer
 *   2) Resto (pág.2..n) con header/footer
 * Une ambos en dist/pdf/report.pdf
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
  // Playwright trae su propio Chromium (descargado en la instalación de la lib)
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    const context = await browser.newContext({
      viewport: null,              // usa tamaño del contenido/CSS @page
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    await page.goto(`file://${printHtmlPath}`, { waitUntil: 'load', timeout: gotoTimeoutMs });

    // Esperar a charts/mermaid como en Puppeteer
    await waitForVisuals(page, { timeout: visualsTimeoutMs });

    // 1) Portada (sin header/footer)
    const coverTmp = path.join(pdfDir, 'cover.tmp.pdf');
    await page.pdf({
      path: coverTmp,
      printBackground: true,
      displayHeaderFooter: false,
      pageRanges: '1',
      preferCSSPageSize: true,
      margin: { top: marginTop, bottom: marginBottom, left: marginLeft, right: marginRight },
    });

    // 2) Resto (con header/footer)
    const restTmp = path.join(pdfDir, 'rest.tmp.pdf');
    await page.pdf({
      path: restTmp,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      pageRanges: '2-',
      preferCSSPageSize: true,
      margin: { top: marginTop, bottom: marginBottom, left: marginLeft, right: marginRight },
    });

    // 3) Unir PDFs con pdf-lib (igual que tenías)
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
