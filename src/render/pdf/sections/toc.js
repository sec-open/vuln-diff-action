// Table of contents generator for PDF (static ordered list of sections).

// src/render/pdf/sections/toc.js

/** Returns HTML for the table of contents page. */
function tocHtml() {
  // Título sin sufijos, numeración fija, sin duplicados
  const items = [
    'Introduction',
    'Summary',
    'Vulnerability tables',
    'Dashboard',
    'Dependency Graph — Base',
    'Dependency Graph — Head',
    'Dependency Paths — Base',
    'Dependency Paths — Head',
    'Fix Insights'
  ];
  const list = items.map(li => `<li>${li}</li>`).join('');
  return `
<section class="page toc">
  <h2>Table of Contents</h2>
  <ol>
    ${list}
  </ol>
</section>
  `.trim();
}

module.exports = { tocHtml };
