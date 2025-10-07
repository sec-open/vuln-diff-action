// src/render/html/sections/summary.js
// Builds sections/summary.html using the provided narrative and a Tools & Environment card.
// Reads ONLY data passed by caller (diff/base/head objects).

function safe(obj, path, fallback) {
  return path.split('.').reduce((o,k)=> (o && o[k] !== undefined) ? o[k] : undefined, obj) ?? fallback;
}
function shortSha(sha) {
  return typeof sha === 'string' && sha.length >= 7 ? sha.slice(0,7) : (sha || '-');
}
function toolsList(meta) {
  const tools = (meta && meta.tools) || {};
  const pairs = Object.entries(tools).map(([k,v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return pairs.length ? pairs.join(' · ') : 'n/a';
}

module.exports = function makeSummary({ diff = {}, base = {}, head = {} } = {}) {
  const owner = safe(diff, 'meta.repo.owner', 'owner') || 'owner';
  const repo = safe(diff, 'meta.repo.name', 'repo') || 'repo';

  const baseRef = safe(diff, 'meta.inputs.base_ref', '') || safe(base, 'git.ref', '') || 'base';
  const headRef = safe(diff, 'meta.inputs.head_ref', '') || safe(head, 'git.ref', '') || 'head';
  const baseShaShort = shortSha(safe(base, 'git.sha', '') || safe(diff, 'meta.git.base.sha', '') || '');
  const headShaShort = shortSha(safe(head, 'git.sha', '') || safe(diff, 'meta.git.head.sha', '') || '');

  const narrative = `
<h2 id="section-title">Summary</h2>
<div class="card" style="margin-bottom:12px;">
  <p><strong>What you’re looking at</strong><br/>
  This report compares the security posture of <code>${owner}/${repo}</code> between <code>${headRef}</code> (<code>${headShaShort}</code>) and <code>${baseRef}</code> (<code>${baseShaShort}</code>). It shows how known
  vulnerabilities differ across these two references so reviewers can quickly assess newly introduced risks, confirm improvements, and verify areas that
  remain unchanged.</p>

  <p><strong>How it was produced</strong></p>
  <ol>
    <li>SBOM generation — via CycloneDX Maven (when a Maven reactor is detected) or Syft fallback.</li>
    <li>Vulnerability scanning — SBOM analyzed with Grype to produce machine-readable findings (IDs, severities, CVSS, affected packages, locations, and
    fix data).</li>
    <li>Normalization & diff — findings normalized into a unified schema and compared using id::package.name::package.version. Final states are:
    NEW (head only), REMOVED (base only), UNCHANGED (in both).</li>
    <li>Rendering — interactive HTML dashboard plus a printable PDF and Markdown summary for CI/PR reviews.</li>
  </ol>

  <p><strong>Why this matters</strong><br/>
  The goal is to provide a transparent, reproducible view of changes in known vulnerabilities as the code evolves—supporting risk assessment,
  remediation prioritization, and merge decisions.</p>
</div>`;

  const toolsMeta = diff.meta || {};
  const tools = toolsList(diff.meta);
  const generatedAt = safe(diff, 'generated_at', '') || safe(diff, 'meta.generated_at', '') || new Date().toISOString();

  const env = `
<div class="card">
  <h3>Tools & Environment</h3>
  <div class="grid-2">
    <div>
      <div><strong>Tools</strong></div>
      <div class="small">${tools}</div>
    </div>
    <div>
      <div><strong>Branches</strong></div>
      <div class="small">Base: <code>${baseRef}</code> (<code>${baseShaShort}</code>)</div>
      <div class="small">Head: <code>${headRef}</code> (<code>${headShaShort}</code>)</div>
      <div class="small">Generated at: <code>${generatedAt}</code></div>
    </div>
  </div>
</div>`;

  return `${narrative}\n${env}`;
};
