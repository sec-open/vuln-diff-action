// src/render/pdf/sections/fix.js
const fs = require('fs');
const path = require('path');

// Fix insights PDF section: totals and split tables for vulnerabilities with/without available fixes.

/** Reads JSON file safely returning null on failure. */
function readJsonSafe(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
/** Normalizes severity key. */
function sevKey(s){ return String(s||'UNKNOWN').toUpperCase(); }

/** Builds a compact HTML table. */
function table(headers, rows){
  const thead = `<thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="compact">${thead}<tbody>${tbody || '<tr><td colspan="'+headers.length+'">—</td></tr>'}</tbody></table>`;
}

/** Builds row cells for a vulnerability item. */
function rowFromItem(o){
  const vuln = o.id || o.vulnerabilityId || '';
  const pkg = (() => {
    const p = o.package || {};
    const g = p.groupId || p.group || p.namespace || '';
    const a = p.artifactId || p.artifact || p.name || p.package || '';
    const v = p.version || '';
    const ga = [g,a].filter(Boolean).join(':');
    return v ? (ga ? `${ga}:${v}` : v) : ga;
  })();
  const target = (o.fix && Array.isArray(o.fix.versions) && o.fix.versions[0]) ? o.fix.versions[0] : '—';
  return [sevKey(o.severity), vuln, pkg, String(o.state||'').toUpperCase(), target];
}

/**
 * Builds complete Fix Insights section HTML.
 * @param {string} distDir
 * @returns {Promise<string>}
 */
async function fixHtml(distDir){
  const diffPath = path.join(distDir, 'diff.json');
  const diff = readJsonSafe(diffPath) || {};
  const headItems = (diff.items || []).filter(x => {
    const st = String(x.state || '').toUpperCase();
    return st === 'NEW' || st === 'UNCHANGED';
  });
  const hasFix = o => Boolean(o && o.fix && (
    (Array.isArray(o.fix.versions) && o.fix.versions.length) ||
    o.fix.state === 'fixed'
  ));

  const withFix = headItems.filter(hasFix);
  const withoutFix = headItems.filter(x => !hasFix(x));

  const totalsHeaders = ['Vulnerabilities (HEAD)','With Fix','NEW (with fix)','UNCHANGED (with fix)'];
  const totalsRows = [[
    headItems.length,
    withFix.length,
    withFix.filter(x => String(x.state).toUpperCase()==='NEW').length,
    withFix.filter(x => String(x.state).toUpperCase()==='UNCHANGED').length
  ]];

  const headers = ['Severity','Vulnerability','Package','State','Target Version'];

  const html = `
<section class="page" id="fix-insights">
  <h2>9. Fix Insights</h2>

  <h3>9.1 Totals</h3>
  ${table(totalsHeaders, totalsRows)}

  <h3>9.2 With fix (NEW/UNCHANGED)</h3>
  ${table(headers, withFix.map(rowFromItem))}

  <h3>9.3 Without fix (NEW/UNCHANGED)</h3>
  ${table(headers, withoutFix.map(rowFromItem))}

  <script>(function(){ try { window.__fixInsightsReady = true; } catch(e){} })();</script>
</section>
  `.trim();

  return html;
}

module.exports = { fixHtml };
