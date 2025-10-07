// src/render/html/sections/summary.js
// Builds sections/summary.html with user narrative, plus:
// - Tools (from diff.meta.tools)
// - Inputs (from diff.meta.inputs)
// - Branch details (from diff.meta.git.base/head or base/head docs)
// - Totals by state
// - Totals by severity and state
// Reads ONLY data passed by caller (diff/base/head objects). No new computations.

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

function safe(obj, path, fallback) {
  return path.split('.').reduce((o,k)=> (o && o[k] !== undefined) ? o[k] : undefined, obj) ?? fallback;
}
function shortSha(sha) {
  return typeof sha === 'string' && sha.length >= 7 ? sha.slice(0,7) : (sha || '-');
}
function kvTable(obj) {
  const rows = Object.entries(obj || {}).map(([k,v]) => {
    const val = (v === undefined || v === null || v === '') ? '<span class="small">n/a</span>' : String(v);
    return `<tr><th style="width:160px;">${k}</th><td>${val}</td></tr>`;
  });
  return `<table>${rows.join('')}</table>`;
}
function toolsList(metaTools) {
  const tools = metaTools || {};
  const rows = Object.entries(tools).map(([k,v]) => `<tr><th style="width:160px;">${k}</th><td>${typeof v === 'string' ? v : JSON.stringify(v)}</td></tr>`);
  if (!rows.length) return `<table><tr><th>Tools</th><td><span class="small">n/a</span></td></tr></table>`;
  return `<table>${rows.join('')}</table>`;
}
function totalsTable(totals) {
  const t = totals || {};
  return `<table>
    <tr><th style="width:160px;">NEW</th><td>${t.NEW ?? 0}</td></tr>
    <tr><th>REMOVED</th><td>${t.REMOVED ?? 0}</td></tr>
    <tr><th>UNCHANGED</th><td>${t.UNCHANGED ?? 0}</td></tr>
  </table>`;
}
function bySeverityAndStateTable(by) {
  const header = `<tr><th>Severity</th><th>NEW</th><th>REMOVED</th><th>UNCHANGED</th></tr>`;
  const rows = SEVERITY_ORDER.map(sev => {
    const r = by?.[sev] || {};
    return `<tr><td>${sev}</td><td>${r.NEW ?? 0}</td><td>${r.REMOVED ?? 0}</td><td>${r.UNCHANGED ?? 0}</td></tr>`;
  });
  return `<table>${header}${rows.join('')}</table>`;
}

module.exports = function makeSummary({ diff = {}, base = {}, head = {} } = {}) {
  // Repo & refs from diff
  const owner = safe(diff, 'meta.repo.owner', 'owner');
  const repo  = safe(diff, 'meta.repo.name', 'repo');
  const repoFull = safe(diff, 'meta.repo.full', `${owner}/${repo}`);

  const baseRef = safe(diff, 'meta.inputs.base_ref', '') || safe(base, 'git.ref', '') || 'base';
  const headRef = safe(diff, 'meta.inputs.head_ref', '') || safe(head, 'git.ref', '') || 'head';
  const baseShaShort = shortSha(safe(base, 'git.sha', '') || safe(diff, 'meta.git.base.sha', '') || '');
  const headShaShort = shortSha(safe(head, 'git.sha', '') || safe(diff, 'meta.git.head.sha', '') || '');
  const generatedAt = safe(diff, 'generated_at', '') || safe(diff, 'meta.generated_at', '') || new Date().toISOString();

  // Branch commit details (best-effort from diff.meta.git or base/head docs)
  const baseGit = {
    ref: baseRef,
    sha: baseShaShort,
    title: safe(diff, 'meta.git.base.title', safe(base, 'git.title', '')),
    author: safe(diff, 'meta.git.base.author_name', safe(base, 'git.author_name', '')),
    committer: safe(diff, 'meta.git.base.committer_name', safe(base, 'git.committer_name', '')),
    time: safe(diff, 'meta.git.base.committed_at', safe(base, 'git.committed_at', '')),
  };
  const headGit = {
    ref: headRef,
    sha: headShaShort,
    title: safe(diff, 'meta.git.head.title', safe(head, 'git.title', '')),
    author: safe(diff, 'meta.git.head.author_name', safe(head, 'git.author_name', '')),
    committer: safe(diff, 'meta.git.head.committer_name', safe(head, 'git.committer_name', '')),
    time: safe(diff, 'meta.git.head.committed_at', safe(head, 'git.committed_at', '')),
  };

  // Inputs & Tools
  const inputs = safe(diff, 'meta.inputs', {});
  const tools  = safe(diff, 'meta.tools', {});

  // Summary data tables
  const totals = safe(diff, 'summary.totals', {});
  const bySev  = safe(diff, 'summary.by_severity_and_state', {});

  const narrative = `
<h2 id="section-title">Summary</h2>
<div class="card" style="margin-bottom:12px;">
  <p><strong>What you’re looking at</strong><br/>
  This report compares the security posture of <code>${repoFull}</code> between <code>${headRef}</code> (<code>${headShaShort}</code>) and <code>${baseRef}</code> (<code>${baseShaShort}</code>). It shows how known
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

  const totalsBlock = `
<div class="card" style="margin-bottom:12px;">
  <h3>Totals by State</h3>
  ${totalsTable(totals)}
</div>`;

  const bySevBlock = `
<div class="card" style="margin-bottom:12px;">
  <h3>Totals by Severity & State</h3>
  ${bySeverityAndStateTable(bySev)}
</div>`;

  const toolsEnv = `
<div class="card" style="margin-bottom:12px;">
  <h3>Tools & Environment</h3>
  <div class="grid-2">
    <div>
      <div><strong>Tools</strong></div>
      ${toolsList(tools)}
    </div>
    <div>
      <div><strong>Branches</strong></div>
      ${kvTable({
        'Base Ref': baseGit.ref,
        'Base SHA': baseGit.sha,
        'Base Title': baseGit.title,
        'Base Author': baseGit.author,
        'Base Committer': baseGit.committer,
        'Base Committed At': baseGit.time,
        'Head Ref': headGit.ref,
        'Head SHA': headGit.sha,
        'Head Title': headGit.title,
        'Head Author': headGit.author,
        'Head Committer': headGit.committer,
        'Head Committed At': headGit.time,
        'Generated at': generatedAt,
      })}
    </div>
  </div>
</div>`;

  const inputsBlock = `
<div class="card" style="margin-bottom:12px;">
  <h3>Inputs</h3>
  ${kvTable(inputs)}
</div>`;

  return `${narrative}
${totalsBlock}
${bySevBlock}
${toolsEnv}
${inputsBlock}`;
};
