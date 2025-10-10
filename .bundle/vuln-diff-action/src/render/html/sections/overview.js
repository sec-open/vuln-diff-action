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
  This report compares the security posture of <code>${repo}</code> between the <em>head</em> reference — the changes under review (<code>${headRef}</code>, <code>${headShaShort}</code>) — and the <em>base</em> reference — the comparison baseline (<code>${baseRef}</code>, <code>${baseShaShort}</code>). It shows how known vulnerabilities differ between these two points in history so reviewers can quickly spot newly introduced risks, confirm improvements, and verify areas that remain unchanged.</p>

  <p><strong>How it was produced</strong></p>
  <ol>
    <li><strong>SBOM generation</strong> — via CycloneDX Maven (when a Maven reactor is detected) or Syft as a fallback.</li>
    <li><strong>Vulnerability scanning</strong> — the SBOM is analyzed with Grype to produce machine-readable findings (IDs, severities, CVSS, affected packages, locations, and fix data).</li>
    <li><strong>Normalization &amp; diff</strong> — findings are normalized into a unified schema and compared using <code>id::package.name::package.version</code>. Final states are: <strong>NEW</strong> (present only in head), <strong>REMOVED</strong> (present only in base), <strong>UNCHANGED</strong> (present in both).</li>
    <li><strong>Rendering</strong> — an interactive HTML dashboard, plus a printable PDF and a Markdown summary for CI/PR reviews.</li>
  </ol>

  <p><strong>Why this matters</strong><br/>
  The goal is to provide a transparent, reproducible view of how known vulnerabilities change as the code evolves—supporting risk assessment, remediation prioritization, and merge decisions.</p>
</div>`;
}

module.exports = { renderOverview };
