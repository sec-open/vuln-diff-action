// src/render/html/sections/header.js
// Renders header.html from a strict "view" built once by html.js (no JSON reads here).

function renderHeader({ view, logoUrl = '' } = {}) {
  if (!view) throw new Error('[render/html/header] Missing view');

  const repo = view.repo;
  const base = `${view.base.ref} <span class="small">→ ${view.base.shaShort}</span>`;
  const head = `${view.head.ref} <span class="small">→ ${view.head.shaShort}</span>`;
  const stamped = view.generatedAt;

  return `
<div class="grid-2">
  <div style="display:flex;align-items:center;gap:12px;">
    ${logoUrl ? `<img src="${logoUrl}" alt="logo" style="height:22px">` : ''}
    <h1>Vulnerability Diff Report</h1>
    <span class="tag">${repo}</span>
  </div>
  <div style="text-align:right;">
    <div><b>Base:</b> ${base}</div>
    <div><b>Head:</b> ${head}</div>
    <div class="small">Generated at ${stamped}</div>
  </div>
</div>`;
}

module.exports = { renderHeader };
