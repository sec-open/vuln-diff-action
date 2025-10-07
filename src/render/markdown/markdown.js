// --- inside src/render/markdown/markdown.js ---

const fs = require('fs');
const path = require('path');
const core = require('@actions/core');

function readJsonStrict(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`[markdown] Missing file: ${abs}`);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));

  // Validate the exact paths we expect from Phase 2 schema
  const required = [
    'schema_version',
    'generated_at',
    'repo',
    'inputs.base_ref',
    'inputs.head_ref',
    'inputs.path',
    'tools',
    'base.ref',
    'base.sha_short',
    'base.sha',
    'base.author',
    'base.authored_at',
    'base.commit_subject',
    'head.ref',
    'head.sha_short',
    'head.sha',
    'head.author',
    'head.authored_at',
    'head.commit_subject',
    'summary.totals.NEW',
    'summary.totals.REMOVED',
    'summary.totals.UNCHANGED',
    'summary.by_severity_and_state',
  ];
  for (const p of required) {
    const ok = p.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), data);
    if (ok === undefined) throw new Error(`[markdown] diff.json missing path: ${p}`);
  }
  return data;
}

function kValue(label, value) {
  return `- **${label}:** ${value}\n`;
}

function branchCard(title, b) {
  return [
    `### ${title}`,
    kValue('Ref', `\`${b.ref}\``),
    kValue('SHA', `\`${b.sha_short}\`  \`${b.sha}\``),
    kValue('Author', b.author || 'n/a'),
    kValue('Authored at', b.authored_at || 'n/a'),
    kValue('Commit', b.commit_subject || 'n/a'),
  ].join('');
}

function toolsCard(tools) {
  const entries = Object.entries(tools || {});
  const list = entries.length
    ? entries.map(([name, ver]) => `- \`${name}\`: ${ver}`).join('\n')
    : '_n/a_';
  return `### Tools\n${list}\n`;
}

function inputsCard(inputs) {
  return [
    '### Inputs',
    kValue('base_ref', `\`${inputs.base_ref}\``),
    kValue('head_ref', `\`${inputs.head_ref}\``),
    kValue('path', `\`${inputs.path}\``),
  ].join('');
}

function totalsBlock(summary) {
  const t = summary.totals;
  return `**Totals** — **NEW:** ${t.NEW} · **REMOVED:** ${t.REMOVED} · **UNCHANGED:** ${t.UNCHANGED}`;
}

function bySeverityAndStateTable(by) {
  const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  const header = '| Severity | NEW | REMOVED | UNCHANGED |\n|---|---:|---:|---:|\n';
  const rows = severities.map(s => {
    const v = by[s] || { NEW: 0, REMOVED: 0, UNCHANGED: 0 };
    return `| ${s} | ${v.NEW} | ${v.REMOVED} | ${v.UNCHANGED} |`;
  }).join('\n');
  return header + rows;
}

async function renderSummaryMarkdown(ctx) {
  const distDir = ctx.distDir || './dist';
  const diffPath = path.join(distDir, 'diff.json');

  const diff = readJsonStrict(diffPath);

  const header = `# Vulnerability Diff — Summary

_Generated at ${diff.generated_at}_

**Repo:** \`${diff.repo}\`

`;

  const intro = `## Comparison

${totalsBlock(diff.summary)}

`;

  // Cards: Branches (two cards), Tools, Inputs
  const cards = [
    '## Tools & Environment',
    toolsCard(diff.tools),
    '## Branches',
    branchCard('Base', diff.base),
    branchCard('Head', diff.head),
    `**Generated at:** ${diff.generated_at}`,
    '## Inputs',
    inputsCard(diff.inputs),
    '## Totals by Severity and State',
    bySeverityAndStateTable(diff.summary.by_severity_and_state),
  ].join('\n\n');

  const md = [header, intro, cards].join('\n');

  const outDir = path.join(distDir, 'markdown');
  await fs.promises.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'summary.md');
  await fs.promises.writeFile(outFile, md, 'utf8');

  // Append to GitHub Step Summary as agreed
  try {
    await fs.promises.appendFile(process.env.GITHUB_STEP_SUMMARY, md + '\n', 'utf8');
  } catch (e) {
    core.warning(`[markdown] Could not append to GITHUB_STEP_SUMMARY: ${e.message || e}`);
  }

  core.info(`[render/markdown] summary.md written → ${outFile}`);
}

module.exports = {
  renderSummaryMarkdown,
  // keep your other exports (renderPrCommentMarkdown, renderSlackMarkdown, etc.)
};
