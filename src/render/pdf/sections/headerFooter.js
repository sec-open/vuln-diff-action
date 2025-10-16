// src/render/pdf/sections/headerFooter.js
function headerFooterHtml({ logoDataUri, title = '' } = {}) {
  const logo = logoDataUri
    ? `<img src="${logoDataUri}" alt="logo" class="hf-logo" />`
    : '';

  const style = `
  <style>
    .hf-wrap{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
              font-size:10px; color:#fff; width:100%; box-sizing:border-box; }
    .hf-header, .hf-footer{ display:flex; align-items:center; justify-content:space-between;
                            padding:6px 14px; background:#0e0f12; }
    .hf-header .hf-title{ margin-left:10px; font-weight:600; color:#cfd3da; }
    .hf-left{ display:flex; align-items:center; gap:10px; }
    .hf-right{ opacity:.85; }
    .hf-logo{ height:14px; width:auto; display:block; object-fit:contain;
              background:transparent !important; mix-blend-mode:normal;
              -webkit-print-color-adjust: exact; }
    /* evita cajas blancas alrededor del logo */
    .hf-logo, .hf-left, .hf-header, .hf-footer{ box-shadow:none !important; }
    /* footer text */
    .hf-footer .hf-left, .hf-footer .hf-right{ color:#cfd3da; }
  </style>`.trim();

  const header = `
  <div class="hf-wrap hf-header">
    <div class="hf-left">
      ${logo}
      <div class="hf-title">${title || ''}</div>
    </div>
    <div class="hf-right"></div>
  </div>`.trim();

  const footer = `
  <div class="hf-wrap hf-footer">
    <div class="hf-left">
      ${logo}
      <span class="hf-title"></span>
    </div>
    <div class="hf-right">
      <span class="pageNumber"></span>/<span class="totalPages"></span>
    </div>
  </div>`.trim();

  return { header: style + header, footer: style + footer };
}

module.exports = { headerFooterHtml };
