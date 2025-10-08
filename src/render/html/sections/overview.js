// src/render/html/sections/overview.js
// Renders sections/overview.html using the strict Phase-2 view (no JSON reads here).

function renderOverview({ view } = {}) {
  if (!view) throw new Error('[render/html/overview] Missing view');

  const repo = view.repo;
  const baseRef = view.base.ref;
  const headRef = view.head.ref;
  const baseShaShort = view.base.shaShort || 'n/a';
  const headShaShort = view.head.shaShort || 'n/a';

  return `
<div class="card">
  <h2 id="section-title">Overview</h2>

  <p><strong>What you’re looking at</strong><br/>
  This report compares the security posture of <code>${repo}</code> between <code>${headRef}</code> (<code>${headShaShort}</code>) and <code>${baseRef}</code> (<code>${baseShaShort}</code>). It shows how known
  vulnerabilities differ across these two references so reviewers can quickly assess newly introduced risks, confirm improvements, and verify areas that
  remain unchanged.</p>

  <p><strong>How it was produced</strong></p>
  <ol>
    <li>SBOM generation — via CycloneDX Maven (when a Maven reactor is detected) or Syft fallback.</li>
    <li>Vulnerability scanning — SBOM analyzed with Grype to produce machine-readable findings (IDs, severities, CVSS, affected packages, locations, and
    fix data).</li>
    <li>Normalization &amp; diff — findings normalized into a unified schema and compared using <code>id::package.name::package.version</code>. Final states are:
    <em>NEW</em> (head only), <em>REMOVED</em> (base only), <em>UNCHANGED</em> (in both).</li>
    <li>Rendering — interactive HTML dashboard plus a printable PDF and Markdown summary for CI/PR reviews.</li>
  </ol>

  <p><strong>Why this matters</strong><br/>
  The goal is to provide a transparent, reproducible view of changes in known vulnerabilities as the code evolves—supporting risk assessment,
  remediation prioritization, and merge decisions.</p>
</div>`;
}

module.exports = { renderOverview };
