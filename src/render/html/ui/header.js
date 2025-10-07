// src/render/html/ui/header.js
// Builds header.html: logo (optional), repo, base->sha, head->sha, generated date.
// Values come from Phase-2 docs passed by caller (diff/base/head).

function safe(obj, path, fallback) {
  return path.split('.').reduce((o,k)=> (o && o[k] !== undefined) ? o[k] : undefined, obj) ?? fallback;
}
function shortSha(sha) {
  return typeof sha === 'string' && sha.length >= 7 ? sha.slice(0,7) : (sha || '-');
}

function repoDisplay(diff, base) {
  // Prefer structured meta.repo: { owner, name } or { full }
  const full = safe(diff, 'meta.repo.full', '') || safe(base, 'meta.repo.full', '');
  if (full) return full;
  const owner = safe(diff, 'meta.repo.owner', '') || safe(base, 'meta.repo.owner', 'owner');
  const name  = safe(diff, 'meta.repo.name', '')  || safe(base, 'meta.repo.name', 'repo');
  return `${owner}/${name}`;
}

module.exports = function makeHeader({ logoUrl = '', diff = {}, base = {}, head = {} } = {}) {
  const repoFull = repoDisplay(diff, base);

  const baseRef = safe(diff, 'meta.inputs.base_ref', '') || safe(base, 'git.ref', '') || 'base';
  const headRef = safe(diff, 'meta.inputs.head_ref', '') || safe(head, 'git.ref', '') || 'head';
  const baseSha = shortSha(safe(base, 'git.sha', '') || safe(diff, 'meta.git.base.sha', '') || '');
  const headSha = shortSha(safe(head, 'git.sha', '') || safe(diff, 'meta.git.head.sha', '') || '');
  const generatedAt = safe(diff, 'generated_at', '') || safe(diff, 'meta.generated_at', '') || new Date().toISOString();

  const logoImg = logoUrl
    ? `<img alt="logo" src="${logoUrl}" style="height:28px;vertical-align:middle;margin-right:10px;"/>`
    : `<span class="tag" title="logo">LOGO</span>`;

  return `
<div class="card" role="banner" aria-label="Report Header">
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
    ${logoImg}
    <div>
      <h1>Vulnerability Diff Report</h1>
      <div class="small">${repoFull}</div>
    </div>
  </div>
  <div class="grid-2" style="margin-top:10px;">
    <div>
      <div><strong>Base</strong>: <code>${baseRef}</code> → <code>${baseSha}</code></div>
      <div><strong>Head</strong>: <code>${headRef}</code> → <code>${headSha}</code></div>
    </div>
    <div style="text-align:right;">
      <div class="small">Generated at</div>
      <div><code>${generatedAt}</code></div>
    </div>
  </div>
</div>`;
};
