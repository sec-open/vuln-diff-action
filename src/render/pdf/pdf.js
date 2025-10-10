// src/render/pdf/pdf.js
// Phase 3.3 (PDF) — minimal skeleton: Cover + Table of Contents + Introduction.
// No scanning, no Phase-2 changes. Outputs under ./dist/pdf.
// This file does NOT export to PDF yet (HTML only). Puppeteer/export can be added later.

const core = require('@actions/core');
const fs = require('fs/promises');
const path = require('path');
const { buildView } = require('../common/view');

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeText(file, text) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, text, 'utf8');
}

function sanitizeLogoUrl(u) {
  if (!u) return '';
  try {
    // Allow absolute URLs or relative file names (copied into ./dist/html/assets/img or similar).
    return String(u);
  } catch {
    return '';
  }
}

function makeCss() {
  // Minimal print-friendly CSS (can be replaced by your shared CSS later)
  return `
@page { size: A4; margin: 18mm 14mm; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0b0f16; }
main { padding: 0; }
h1, h2, h3 { margin: 0 0 12px 0; }
p { margin: 0 0 10px 0; }
.small { color: #6b7280; font-size: 12px; }

.section { page-break-inside: avoid; margin-bottom: 18mm; }
.cover { page-break-after: always; display:flex; flex-direction:column; gap:16px; }
.cover .header { display:flex; align-items:center; justify-content:space-between; }
.cover .brand { display:flex; align-items:center; gap:12px; }
.cover .brand img { max-height: 40px; }
.cover h1 { font-size: 28px; margin: 18px 0 6px; }
.kv { display:grid; grid-template-columns: 140px 1fr; gap: 4px 12px; margin: 4px 0; }
.card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }

.columns-2 { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.kpis { display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0; }
.kpi { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; }
.kpi-label { color: #6b7280; font-size: 12px; }
.kpi-value { font-size: 22px; font-weight: 700; }

.toc ol { margin: 0 0 0 18px; padding: 0; }
.toc li { margin: 6px 0; }

hr.sep { border: 0; border-top: 1px solid #e5e7eb; margin: 12px 0; }
  `.trim();
}

function makeIntroductionHtml({ repo, base, head }) {
  // Same copy as HTML Overview (adjusted for print, with inline variables)
  return `
<h2 id="introduction">Introduction</h2>
<p class="small">What you’re looking at</p>
<p>
  This report compares the security posture of <strong>${repo}</strong> between
  <strong>HEAD</strong> (<code>${head.ref}</code>, ${head.shaShort}) and
  <strong>BASE</strong> (<code>${base.ref}</code>, ${base.shaShort}).
  It highlights how known vulnerabilities differ across these two references so reviewers can quickly
  assess newly introduced risks, confirm improvements, and verify areas that remain unchanged.
</p>

<p class="small">How it was produced</p>
<ol>
  <li><strong>SBOM generation</strong> — via CycloneDX Maven (when a Maven reactor is detected) or Syft fallback.</li>
  <li><strong>Vulnerability scanning</strong> — SBOM analyzed with Grype to produce machine-readable findings (IDs, severities, CVSS, affected packages, locations, and fix data).</li>
  <li><strong>Normalization &amp; diff</strong> — findings normalized into a unified schema and compared using <code>vulnerability_id::groupId:artifactId:version</code>. Final states are: <em>NEW</em> (head only), <em>REMOVED</em> (base only), <em>UNCHANGED</em> (in both).</li>
  <li><strong>Rendering</strong> — interactive HTML dashboard plus a printable PDF and Markdown summary for CI/PR reviews.</li>
</ol>

<p class="small">Why this matters</p>
<p>
  The goal is to provide a transparent, reproducible view of changes in known vulnerabilities as the code evolves—supporting risk assessment,
  remediation prioritization, and merge decisions.
</p>
`.trim();
}

function makePrintHtml({ repo, base, head, generatedAt, logoUrl }) {
  const intro = makeIntroductionHtml({ repo, base, head });
  const srcLogo = sanitizeLogoUrl(logoUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Vulnerability Diff Report — ${repo}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="./assets/print.css" />
</head>
<body>
<main>

<!-- COVER -->
<section class="section cover">
  <div class="header">
    <div class="brand">
      ${srcLogo ? `<img src="${srcLogo}" alt="Logo" />` : ``}
      <div>
        <div class="small">Vulnerability Diff Report</div>
        <h1>${repo}</h1>
      </div>
    </div>
    <div class="small">Generated at<br/><strong>${generatedAt}</strong></div>
  </div>

  <div class="columns-2">
    <div class="card">
      <h3>Base</h3>
      <div class="kv"><div>Ref</div><div><code>${base.ref}</code></div></div>
      <div class="kv"><div>Commit</div><div><code>${base.shaShort}</code> (${base.sha})</div></div>
      <div class="kv"><div>Author</div><div>${base.author}</div></div>
      <div class="kv"><div>Authored at</div><div>${base.authoredAt}</div></div>
      <div class="kv"><div>Subject</div><div>${base.commitSubject}</div></div>
    </div>

    <div class="card">
      <h3>Head</h3>
      <div class="kv"><div>Ref</div><div><code>${head.ref}</code></div></div>
      <div class="kv"><div>Commit</div><div><code>${head.shaShort}</code> (${head.sha})</div></div>
      <div class="kv"><div>Author</div><div>${head.author}</div></div>
      <div class="kv"><div>Authored at</div><div>${head.authoredAt}</div></div>
      <div class="kv"><div>Subject</div><div>${head.commitSubject}</div></div>
    </div>
  </div>
</section>

<!-- TABLE OF CONTENTS -->
<section class="section toc">
  <h2 id="table-of-contents">Table of Contents</h2>
  <ol>
    <li><a href="#cover">Cover</a></li>
    <li><a href="#table-of-contents">Table of Contents</a></li>
    <li><a href="#introduction">Introduction</a></li>
  </ol>
  <hr class="sep"/>
</section>

<!-- INTRODUCTION -->
<section class="section">
  ${intro}
</section>

</main>
</body>
</html>`;
}

async function pdf_init({ distDir = './dist' } = {}) {
  core.startGroup('[render] PDF (skeleton)');
  try {
    const view = buildView(distDir);
    const outDir = path.join(path.resolve(distDir), 'pdf');
    const assetsDir = path.join(outDir, 'assets');

    await ensureDir(outDir);
    await ensureDir(assetsDir);

    // CSS
    await writeText(path.join(assetsDir, 'print.css'), makeCss());

    // Use same logo as HTML (input html_logo_url)
    const logo = core.getInput('html_logo_url') || '';

    // HTML (skeleton only)
    const html = makePrintHtml({
      repo: view.repo,
      generatedAt: view.generatedAt,
      base: view.base,
      head: view.head,
      logoUrl: logo,
    });
    await writeText(path.join(outDir, 'print.html'), html);

    core.info(`[render/pdf] skeleton written to ${path.join(outDir, 'print.html')}`);
  } catch (e) {
    core.setFailed(`[render] PDF skeleton failed: ${e?.message || e}`);
    throw e;
  } finally {
    core.endGroup();
  }
}

module.exports = { pdf_init };
