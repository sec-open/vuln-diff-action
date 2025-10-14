// src/render/pdf/utils/exporter.js
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const os = require('os');
const fsp = fs.promises;
const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');


async function ensureChromePath() {
  // Intenta localizar el ejecutable que Puppeteer haya instalado
  try {
    const p = await puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (_) { /* seguimos */ }

  // Si no existe, instalamos en runtime Chrome for Testing estable, en una cache que controlamos
  const cacheDir = path.join(process.cwd(), '.puppeteer-cache');
  const env = { ...process.env, PUPPETEER_CACHE_DIR: cacheDir };

  try {
    // Instalación silenciosa y reproducible
    cp.execSync('npx puppeteer browsers install chrome@stable --cache-dir "' + cacheDir + '"', {
      stdio: 'inherit',
      env,
    });
  } catch (e) {
    throw new Error(`[pdf] Failed to install Chrome for Puppeteer: ${e?.message || e}`);
  }

  // Resuelve de nuevo el ejecutable
  const p = await puppeteer.executablePath();
  if (!p || !fs.existsSync(p)) {
    throw new Error('[pdf] Chrome executable not found after install.');
  }
  return p;
}

async function waitForVisuals(page, { timeout = 60000 } = {}) {
  try {
    await page.waitForFunction(
      () => (window.__chartsReady === true) && (window.__mermaidReady === true),
      { timeout }
    );
    await page.waitForTimeout(250); // settle a little
  } catch {
    // Continuar aunque no estén listos (no rompemos el render)
  }
}

/**
 * Renderiza el print.html en dos pasadas:
 *  - Página 1 (portada) sin header/footer
 *  - Resto con header/footer y márgenes adecuados
 * Une ambos en dist/pdf/report.pdf
 */
async function renderPdf({
  printHtmlPath,       // ruta al HTML de impresión (file path)
  pdfDir,              // carpeta ./dist/pdf
  headerHtml,          // string HTML para header
  footerHtml,          // string HTML para footer
  marginTop = '60px',
  marginBottom = '60px',
  marginLeft = '14mm',
  marginRight = '14mm',
  gotoTimeoutMs = 120000,  // timeout de carga
  visualsTimeoutMs = 60000 // timeout de charts/mermaid
}) {


    const executablePath = await ensureChromePath();
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
    });


  try {
    const page = await browser.newPage();
    await page.goto(`file://${printHtmlPath}`, { waitUntil: 'load', timeout: gotoTimeoutMs });

    // Esperas de gráficas/mermaid
    await waitForVisuals(page, { timeout: visualsTimeoutMs });

    // 1) Portada sin header/footer
    const coverTmp = path.join(pdfDir, 'cover.tmp.pdf');
    await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      pageRanges: '1',
      path: coverTmp,
    });

    // 2) Resto con header/footer
    const restTmp = path.join(pdfDir, 'rest.tmp.pdf');
    await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      margin: { top: marginTop, bottom: marginBottom, left: marginLeft, right: marginRight },
      pageRanges: '2-',
      path: restTmp,
    });

    // 3) Unir PDFs
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

    // Limpiar temporales
    await Promise.allSettled([
      fsp.unlink(coverTmp),
      fsp.unlink(restTmp),
    ]);

    console.log(`[pdf] written: ${outPath}`);
    return outPath;
  } finally {
    await browser.close();
  }
}

module.exports = {
  renderPdf,
  waitForVisuals,
};
