// src/render/pdf/sections/headerFooter.js
function headerFooterHtml({ logoDataUri, title = '' } = {}) {
  const logoUrl = logoDataUri || '';
  const style = `
  <style>
    .hf-wrap{ font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; font-size:10px; color:#cfd3da; width:100%; box-sizing:border-box; }
    .hf-header,.hf-footer{ display:flex; align-items:center; justify-content:space-between; padding:6px 14px; background:#0e0f12; }
    .hf-left{ display:flex; align-items:center; gap:10px; }
    .hf-right{ opacity:.9; }
    .hf-title{ font-weight:600; }
    /* Logo como background para evitar cuadros blancos en header/footer PDF */
    .hf-logo{
      width:96px; height:16px; display:inline-block; background-repeat:no-repeat; background-position:left center; background-size:contain;
      background-color:transparent !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; image-rendering:auto;
    }
  </style>`.trim();

  const logo = logoUrl ? `<span class="hf-logo" style="background-image:url('${logoUrl}')"></span>` : '';

  const header = `
  <div class="hf-wrap hf-header">
    <div class="hf-left">
      ${logo}
      <span class="hf-title">${title || ''}</span>
    </div>
    <div class="hf-right"></div>
  </div>`.trim();

  const footer = `
  <div class="hf-wrap hf-footer">
    <div class="hf-left">${logo}</div>
    <div class="hf-right"><span class="pageNumber"></span>/<span class="totalPages"></span></div>
  </div>`.trim();

  return { header: style + header, footer: style + footer };
}

module.exports = { headerFooterHtml };
