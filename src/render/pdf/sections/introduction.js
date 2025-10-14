// src/render/pdf/sections/introduction.js
function introHtml(view) {
  const repo = view?.repo || '';
  const baseRef = view?.inputs?.baseRef || view?.base?.ref || '';
  const headRef = view?.inputs?.headRef || view?.head?.ref || '';
  const baseShaShort = view?.base?.shaShort || '';
  const headShaShort = view?.head?.shaShort || '';

  const tools = view?.tools || {};
  const action = view?.action || {};

  // Texto proporcionado por ti, adaptado a la estructura de view.js
  const html = `
<section class="page">
  <h2 class="section-title">1. Introduction</h2>
  <p><strong>What you’re looking at</strong><br>
  This report compares the security posture of <strong>${repo}</strong> between two Git references:
  <code>${headRef}</code> (<code>${headShaShort}</code>) and <code>${baseRef}</code> (<code>${baseShaShort}</code>).
  It focuses on how known vulnerabilities differ between these two points in time, making it easier to spot regressions (new issues),
  improvements (removed issues), and areas that remain unchanged.</p>

  <p><strong>How it was produced</strong><br>
  <em>SBOM generation</em> – The software bill of materials was generated using CycloneDX Maven (if a Maven reactor was detected) or Syft as a fallback over the repository at the specified path.<br>
  <em>Vulnerability scanning</em> – The SBOM was analyzed with Grype, producing machine-readable findings (IDs, severities, CVSS, affected packages, locations, and fix data).<br>
  <em>Normalization & diff</em> – Findings were normalized to a unified schema and then compared between <code>${baseRef}</code> and <code>${headRef}</code> using a stable key (<code>id::package.name::package.version</code>). Final states are: <strong>NEW</strong> (present in head only), <strong>REMOVED</strong> (present in base only), <strong>UNCHANGED</strong> (present in both).<br>
  <em>Rendering</em> – Results are presented as an interactive HTML dashboard and a printable PDF, plus a Markdown summary for CI logs/PRs.</p>

  <p><strong>Why this matters</strong><br>
  The goal is to provide a transparent, reproducible view of changes in known vulnerabilities as code evolves—helping reviewers quickly assess risk introduced by a branch or commit, prioritize remediation, and verify improvements before merging.</p>

  <p><strong>Tooling and environment</strong><br>
  Syft: <code>${tools.syft || '-'}</code><br>
  Grype: <code>${tools.grype || '-'}</code><br>
  CycloneDX Maven: <code>${tools.cyclonedx_maven || '-'}</code><br>
  Node.js: <code>${tools.node || '-'}</code><br>
  Action: <code>sec-open/vuln-diff-action ${action.version || '-'}</code> (<code>${action.commit || '-'}</code>)</p>

  <p><strong>Ficha resumen</strong><br>
  - Diff totals: número de vulnerabilidades por estado (NEW, REMOVED, UNCHANGED).<br>
  - Ramas: dos tarjetas, una por cada rama, con ref, SHA corto, y tabla de severidades (CRITICAL, HIGH, MEDIUM, LOW, UNKNOWN).<br>
  - Parámetros de entrada: tabla clave/valor con los parámetros del Action usados en la ejecución.
  </p>
</section>
  `.trim();

  return html;
}

module.exports = { introHtml };
