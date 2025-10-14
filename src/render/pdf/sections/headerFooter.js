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

function guessMimeByExt(p) {
  const ext = (p || '').toLowerCase();
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg';
  if (ext.endsWith('.webp')) return 'image/webp';
  if (ext.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

/** URL → data URI (SVG en utf8 para header/footer) */
async function getLogoDataUri(logoInput, distDir) {
  if (!logoInput) return '';
  const u = String(logoInput).trim();

  // Remota
  if (/^https?:\/\//i.test(u)) {
    try {
      const buf = await fetchHttps(u);
      const mime = guessMimeByExt(new URL(u).pathname);
      if (mime === 'image/svg+xml') {
        const svgTxt = buf.toString('utf8')
          .replace(/\s+/g, ' ')
          .replace(/#/g, '%23')
          .replace(/"/g, '\'')
          .trim();
        return `data:image/svg+xml;utf8,${svgTxt}`;
      }
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return '';
    }
  }

  // Local (relativo a dist o dist/html)
  let abs = u.startsWith('/') ? u : path.resolve(distDir, u.replace(/^\.\//,''));
  if (!fs.existsSync(abs)) {
    const maybe = path.resolve(distDir, 'html', u.replace(/^\.\//,'').replace(/^html\//,''));
    if (fs.existsSync(maybe)) abs = maybe;
  }
  try {
    const buf = await fsp.readFile(abs);
    const mime = guessMimeByExt(abs);
    if (mime === 'image/svg+xml') {
      const svgTxt = buf.toString('utf8')
        .replace(/\s+/g, ' ')
        .replace(/#/g, '%23')
        .replace(/"/g, '\'')
        .trim();
      return `data:image/svg+xml;utf8,${svgTxt}`;
    }
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

/** Header con banda oscura (SVG) + logo como background-image */
function headerTemplate({ logoDataUri, repo, generatedAt }) {
  const band = '#0b0f16';
  const logoBlock = logoDataUri
    ? `<div style="width:120px;height:18px;background-image:url('${logoDataUri}');
                    background-size:contain;background-repeat:no-repeat;background-position:left center;margin-right:8px;"></div>`
    : '';

  // SVG como banda de fondo: fiable en Puppeteer
  const bandSvg = `<svg width="100%" height="36" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="36" fill="${band}"/></svg>`;

  return `
  <div style="font-size:10px; color:#e5e7eb; width:100%;">
    <div style="position:absolute; left:0; right:0; top:0; height:36px; z-index:0;">${bandSvg}</div>
    <div style="position:relative; z-index:1; padding:8px 12px; display:flex; align-items:center; justify-content:space-between;">
      <div style="display:flex; align-items:center;">${logoBlock}<span>Vulnerability Diff Report — ${repo || ''}</span></div>
      <div>${generatedAt || ''}</div>
    </div>
  </div>
  `.trim();
}

/** Footer con banda oscura (SVG) + logo + page x/total */
function footerTemplate({ logoDataUri, baseRef, headRef, generatedAt }) {
  const band = '#0b0f16';
  const logoBlock = logoDataUri
    ? `<div style="width:100px;height:14px;background-image:url('${logoDataUri}');
                    background-size:contain;background-repeat:no-repeat;background-position:left center;margin-right:8px;"></div>`
    : '';

  const bandSvg = `<svg width="100%" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="32" fill="${band}"/></svg>`;

  return `
  <div style="font-size:10px; color:#e5e7eb; width:100%;">
    <div style="position:absolute; left:0; right:0; bottom:0; height:32px; z-index:0;">${bandSvg}</div>
    <div style="position:relative; z-index:1; padding:6px 12px; display:flex; align-items:center; justify-content:space-between;">
      <div style="display:flex; align-items:center;">
        ${logoBlock}
        <span>BASE: ${baseRef || ''} → HEAD: ${headRef || ''}</span>
      </div>
      <div>
        ${generatedAt || ''} &nbsp;—&nbsp;
        <span class="pageNumber"></span>/<span class="totalPages"></span>
      </div>
    </div>
  </div>
  `.trim();
}

module.exports = { headerTemplate, footerTemplate, getLogoDataUri };
