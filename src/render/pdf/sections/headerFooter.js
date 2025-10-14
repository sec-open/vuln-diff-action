// src/render/pdf/sections/headerFooter.js
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const https = require('https');

function fetchHttps(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/**
 * Convierte la URL de logo (absoluta o relativa al bundle) en data URI.
 * Esto es clave para que el logo se vea en header/footer de Puppeteer.
 */
async function getLogoDataUri(logoInput, distDir) {
  if (!logoInput) return '';
  const u = String(logoInput).trim();

  // HTTP(S) absoluto
  if (/^https?:\/\//i.test(u)) {
    try {
      const buf = await fetchHttps(u);
      const ext = path.extname(new URL(u).pathname).toLowerCase();
      const mime =
        ext === '.png'  ? 'image/png'  :
        ext === '.webp' ? 'image/webp' :
        (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' :
        ext === '.svg'  ? 'image/svg+xml' : 'application/octet-stream';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return ''; // mejor vacío que una ruta que no pinta en header/footer
    }
  }

  // Ruta local/relativa al dist/html
  let abs = u.startsWith('/') ? u : path.resolve(distDir, u.replace(/^\.\//,''));
  if (!fs.existsSync(abs)) {
    const maybe = path.resolve(distDir, 'html', u.replace(/^\.\//,'').replace(/^html\//,''));
    if (fs.existsSync(maybe)) abs = maybe;
  }
  try {
    const buf = await fsp.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime =
      ext === '.png'  ? 'image/png'  :
      ext === '.webp' ? 'image/webp' :
      (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' :
      ext === '.svg'  ? 'image/svg+xml' : 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

/** Header con banda oscura + logo en data URI + fecha a la derecha */
function headerTemplate({ logoDataUri, repo, generatedAt }) {
  const band = '#0b0f16';
  const img = logoDataUri ? `<img src="${logoDataUri}" style="height:18px; vertical-align:middle; margin-right:8px;" />` : '';
  return `
    <div style="font-size:10px; color:#e5e7eb; width:100%;">
      <div style="position:absolute; left:0; right:0; top:0; height:36px; background:${band}; z-index:0;"></div>
      <div style="position:relative; z-index:1; padding:8px 12px; display:flex; align-items:center; justify-content:space-between;">
        <div>${img}<span>Vulnerability Diff Report — ${repo}</span></div>
        <div>${generatedAt}</div>
      </div>
    </div>
  `.trim();
}

/** Footer con banda oscura + logo + numeración página/total */
function footerTemplate({ logoDataUri, baseRef, headRef, generatedAt }) {
  const band = '#0b0f16';
  const img = logoDataUri ? `<img src="${logoDataUri}" style="height:14px; vertical-align:middle; margin-right:8px;" />` : '';
  return `
    <div style="font-size:10px; color:#e5e7eb; width:100%;">
      <div style="position:absolute; left:0; right:0; bottom:0; height:32px; background:${band}; z-index:0;"></div>
      <div style="position:relative; z-index:1; padding:6px 12px; display:flex; align-items:center; justify-content:space-between;">
        <div>${img}<span>BASE: ${baseRef} → HEAD: ${headRef}</span></div>
        <div>
          ${generatedAt} &nbsp;—&nbsp;
          <span class="pageNumber"></span>/<span class="totalPages"></span>
        </div>
      </div>
    </div>
  `.trim();
}

module.exports = { headerTemplate, footerTemplate, getLogoDataUri };
