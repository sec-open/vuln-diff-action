const puppeteer = require('puppeteer');

async function rasterizeCharts(page) {
  await page.evaluate(async () => {
    try {
      if (window.Chart && window.Chart.defaults && window.Chart.defaults.animation != null) {
        window.Chart.defaults.animation = false;
      }
      const canvases = Array.from(document.querySelectorAll('canvas'));
      for (const c of canvases) {
        try {
          const url = c.toDataURL('image/png');
          const img = document.createElement('img');
          img.src = url;
          img.className = 'chart-img';
          img.setAttribute('alt', c.getAttribute('aria-label') || 'chart');
          c.replaceWith(img);
        } catch {}
      }
    } catch {}
  });
}

async function renderPdf({ html, outPath, header, footer }) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--font-render-hinting=medium'] });
  const page = await browser.newPage();
  await page.setBypassCSP(true);
  await page.setContent(html, { waitUntil: ['networkidle0'] });
  await page.emulateMediaType('print');

  // Espera al semáforo global (con timeout) antes de rasterizar y exportar
  try {
    await page.waitForFunction(
      'window && (window.__ALL_SECTIONS_READY === true)',
      { timeout: 30000 }
    );
  } catch {}

  await rasterizeCharts(page);

  const pdf = await page.pdf({
    path: outPath,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: header,
    footerTemplate: footer,
    preferCSSPageSize: true,
    margin: { top: '60px', bottom: '60px', left: '14mm', right: '14mm' }
  });
  await browser.close();
  return pdf;
}

module.exports = { renderPdf };
