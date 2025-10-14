// src/render/pdf/sections/toc.js
function tocHtml() {
  // Título sin sufijos, numeración fija, sin duplicados
  const items = [
    '1. Introduction',
    '2. Summary',
    '3. Results tables',
    '4. Dashboard',
    '5. Dependency Graph — Base',
    '6. Dependency Graph — Head',
    '7. Dependency Paths — Base',
    '8. Dependency Paths — Head',
    '9. Fix Insights'
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
