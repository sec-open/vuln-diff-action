// src/index.js
// Main action: generate SBOMs, scan with Grype, compute diff, write summary,
// build Markdown + HTML reports, and (optionally) export PDF with Puppeteer.

const core = require("@actions/core");
const exec = require("@actions/exec");
const artifact = require("@actions/artifact");
const fs = require("fs");
const path = require("path");
const { generateSbomAuto } = require("./sbom");
const { scanSbom } = require("./grype");
const { diff, renderMarkdownTable } = require("./diff");
const { buildMarkdownReport } = require("./report");
const { buildHtmlReport } = require("./report-html");

// ----------------------- shell + git helpers -----------------------
async function sh(cmd, opts = {}) { return exec.exec("bash", ["-lc", cmd], opts); }

async function tryRevParse(ref) {
  let out = "";
  try {
    await exec.exec("bash", ["-lc", `git rev-parse ${ref}`], {
      listeners: { stdout: d => (out += d.toString()) },
    });
    return out.trim();
  } catch { return null; }
}

function isSha(ref) { return /^[0-9a-f]{7,40}$/i.test(ref || ""); }

async function resolveRefToSha(ref) {
  if (isSha(ref)) {
    const sha = await tryRevParse(ref);
    if (sha) return sha;
    throw new Error(`Input '${ref}' looks like a SHA but does not exist locally.`);
  }
  let sha = await tryRevParse(ref);
  if (sha) return sha;
  sha = await tryRevParse(`refs/remotes/origin/${ref}`);
  if (sha) return sha;
  let remotes = "";
  await exec.exec("bash", ["-lc", "git remote"], { listeners: { stdout: d => (remotes += d.toString()) } });
  if (remotes.split(/\s+/).includes("upstream")) {
    sha = await tryRevParse(`refs/remotes/upstream/${ref}`);
    if (sha) return sha;
  }
  try {
    await sh(`git fetch origin ${ref}:${ref} --tags --prune`);
    sha = await tryRevParse(ref);
    if (sha) return sha;
  } catch {}
  throw new Error(`Cannot resolve ref '${ref}' to a commit SHA. Ensure the branch or SHA exists in this runner.`);
}

function shortSha(sha) { return (sha || "").substring(0, 12); }
function guessLabel(ref) { const m = (ref || "").match(/^(?:refs\/remotes\/\w+\/|origin\/)?(.+)$/); return m ? m[1] : (ref || ""); }
async function commitLine(sha) {
  let out = "";
  await exec.exec("bash", ["-lc", `git --no-pager log -1 --format="%H %s" ${sha}`], {
    listeners: { stdout: d => (out += d.toString()) },
  });
  return out.trim();
}

// ----------------------- Mermaid graph utils from report.js -----------------------
const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
function buildGraphFromBOM(bomJson) {
  const dependencies = bomJson?.dependencies || [];
  const components = bomJson?.components || [];
  const refToLabel = new Map();
  const nameVer = (c) => `${c?.name || "unknown"}:${c?.version || "unknown"}`;
  for (const c of components) {
    const label = nameVer(c);
    if (c["bom-ref"]) refToLabel.set(c["bom-ref"], label);
    if (c.purl) refToLabel.set(c.purl, label);
  }
  const adj = new Map();     // label -> Set(label)
  const parents = new Map(); // label -> Set(label)
  const ensure = (map, key) => { if (!map.has(key)) map.set(key, new Set()); return map.get(key); };
  for (const d of dependencies) {
    const parentLabel = refToLabel.get(d.ref) || d.ref || "unknown";
    ensure(adj, parentLabel); ensure(parents, parentLabel);
    for (const ch of (d.dependsOn || [])) {
      const childLabel = refToLabel.get(ch) || ch || "unknown";
      ensure(adj, childLabel); ensure(parents, childLabel);
      adj.get(parentLabel).add(childLabel);
      parents.get(childLabel).add(parentLabel);
    }
  }
  // Ensure nodes for orphans
  for (const [p, cs] of adj) { ensure(parents, p); for (const c of cs) ensure(adj, c); }
  // Roots = nodes with no parents
  const roots = [];
  for (const [node, ps] of parents.entries()) if (!ps || ps.size === 0) roots.push(node);
  return { adj, parents, roots };
}

function buildMermaidGraphFromBOMImproved(bomJson, grypeMatches, graphMax = 150) {
  const { adj, parents, roots } = buildGraphFromBOM(bomJson);
  const vulnerable = new Set((grypeMatches || []).map(m => `${m?.artifact?.name || "unknown"}:${m?.artifact?.version || "unknown"}`));
  const keep = new Set(); const queue = [];
  for (const v of vulnerable) { if (!keep.has(v)) { keep.add(v); queue.push(v); } }
  while (queue.length && keep.size < graphMax) {
    const cur = queue.shift();
    for (const p of (parents.get(cur) || [])) {
      if (!keep.has(p)) { keep.add(p); queue.push(p); if (keep.size >= graphMax) break; }
    }
  }
  let idx = 0; const idMap = new Map(); const idFor = (l)=>{ if(!idMap.has(l)) idMap.set(l,`n${idx++}`); return idMap.get(l); };
  // cluster by nearest root
  const rootOf = new Map();
  function nearestRoot(node) {
    const visited = new Set(); const q=[node];
    while (q.length) { const x=q.shift(); if (visited.has(x)) continue; visited.add(x);
      const ps = parents.get(x) || new Set(); if (ps.size===0) return x; for (const p of ps) q.push(p); }
    return node;
  }
  for (const node of keep) { const r = nearestRoot(node); if (!rootOf.has(r)) rootOf.set(r, new Set()); rootOf.get(r).add(node); }
  const lines = []; lines.push("graph LR");
  for (const [root, nodes] of rootOf.entries()) {
    lines.push(`subgraph "${root}"`);
    for (const n of nodes) { const nid = idFor(n); lines.push(`${nid}["${n}"]`); }
    for (const n of nodes) {
      const nid = idFor(n);
      for (const ch of (adj.get(n) || [])) { if (!nodes.has(ch)) continue; const cid = idFor(ch); lines.push(`${nid} --> ${cid}`); }
    }
    lines.push("end");
  }
  for (const v of vulnerable) { if (keep.has(v)) { const vid = idFor(v); lines.push(`style ${vid} fill:#ffe0e0,stroke:#d33,stroke-width:2px`); } }
  return lines.join("\n");
}

// ----------------------- PDF helper (Puppeteer) -----------------------
async function renderPdfFromHtml(html, outPath) {
  // Lazy import to avoid cost if not requested
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" }
    });
  } finally {
    await browser.close();
  }
}

// ----------------------- main -----------------------
async function run() {
  try {
    // Inputs
    const baseRefInput   = core.getInput("base_ref", { required: true });
    const headRefInput   = core.getInput("head_ref", { required: true });
    const scanPath       = core.getInput("path") || ".";
    const buildCommand   = core.getInput("build_command") || "";
    const minSeverity    = core.getInput("min_severity") || "LOW";
    const writeSummary   = (core.getInput("write_summary") || "true") === "true";
    const uploadArtifact = (core.getInput("upload_artifact") || "true") === "true";
    const artifactName   = core.getInput("artifact_name") || "vuln-diff-artifacts";
    const graphMaxNodes  = parseInt(core.getInput("graph_max_nodes") || "150", 10);
    const reportPdf      = (core.getInput("report_pdf") || "false") === "true"; // NEW

    const workdir = process.cwd();
    const baseDir = path.join(workdir, "__base__");
    const headDir = path.join(workdir, "__head__");
    fs.mkdirSync(baseDir, { recursive: true });

    // Ensure refs local
    await sh("git fetch --all --tags --prune --force");

    // Resolve SHAs
    const baseSha = await resolveRefToSha(baseRefInput);
    const headSha = await resolveRefToSha(headRefInput);
    if (baseSha === headSha) {
      core.setFailed(`Both refs resolve to the same commit (${baseSha}). base='${baseRefInput}', head='${headRefInput}'`);
      return;
    }

    // Current workspace SHA
    let currentSha = "";
    await exec.exec("bash", ["-lc", "git rev-parse HEAD"], {
      listeners: { stdout: d => (currentSha += d.toString()) },
    });
    currentSha = currentSha.trim();

    // Worktrees
    await sh(`git worktree add --detach ${baseDir} ${baseSha}`);
    let headScanRoot = workdir;
    let createdHeadWorktree = false;
    if (currentSha !== headSha) {
      fs.mkdirSync(headDir, { recursive: true });
      await sh(`git worktree add --detach ${headDir} ${headSha}`);
      headScanRoot = headDir;
      createdHeadWorktree = true;
    }

    // Optional build
    if (buildCommand) {
      await sh(buildCommand, { cwd: baseDir });
      await sh(buildCommand, { cwd: headScanRoot });
    }

    // SBOMs
    const baseSbom = path.join(workdir, "sbom-base.json");
    const headSbom = path.join(workdir, "sbom-head.json");
    await generateSbomAuto(path.join(baseDir, scanPath), baseSbom);
    await generateSbomAuto(path.join(headScanRoot, scanPath), headSbom);

    // Scans
    const baseScan = await scanSbom(baseSbom);
    const headScan = await scanSbom(headSbom);

    // Diff
    const d = diff(baseScan.matches || [], headScan.matches || [], minSeverity);
    const table = renderMarkdownTable(d.news, d.removed, d.unchanged);

    // Commit lines
    const baseCommit = await commitLine(baseSha);
    const headCommit = await commitLine(headSha);

    // Outputs
    core.setOutput("new_count", String(d.news.length));
    core.setOutput("removed_count", String(d.removed.length));
    core.setOutput("unchanged_count", String(d.unchanged.length));
    core.setOutput("diff_markdown_table", table);
    core.setOutput("diff_json", JSON.stringify(d));
    core.setOutput("base_sha", baseSha);
    core.setOutput("head_sha", headSha);
    core.setOutput("base_input", baseRefInput);
    core.setOutput("head_input", headRefInput);

    // Summary
    if (writeSummary) {
      const summary = [];
      summary.push("### Vulnerability Diff (Syft+Grype)\n");
      summary.push(`- **Base**: \`${guessLabel(baseRefInput)}\` (_input:_ \`${baseRefInput}\`) → \`${shortSha(baseSha)}\``);
      summary.push(`  - ${baseCommit}`);
      summary.push(`- **Head**: \`${guessLabel(headRefInput)}\` (_input:_ \`${headRefInput}\`) → \`${shortSha(headSha)}\``);
      summary.push(`  - ${headCommit}`);
      summary.push(`- **Min severity**: \`${minSeverity}\``);
      summary.push(`- **Counts**: NEW=${d.news.length} · REMOVED=${d.removed.length} · UNCHANGED=${d.unchanged.length}\n`);
      summary.push(table);
      await core.summary.addRaw(summary.join("\n")).write();
    }

    // Build Markdown report.md (with severity groups + paths + improved mermaid)
    const reportPath = path.join(workdir, "report.md");
    let headBomJson = {};
    try { headBomJson = JSON.parse(fs.readFileSync(headSbom, "utf8")); }
    catch (e) { core.warning(`Failed to parse ${headSbom}: ${e.message}`); }

    // Generate dependency paths table + improved Mermaid for HTML via buildMarkdownReport
    const mermaidGraph = buildMermaidGraphFromBOMImproved(headBomJson, headScan.matches || [], graphMaxNodes);
    const reportMd = buildMarkdownReport({
      baseLabel: guessLabel(baseRefInput), baseInput: baseRefInput, baseSha, baseCommitLine: baseCommit,
      headLabel: guessLabel(headRefInput), headInput: headRefInput, headSha, headCommitLine: headCommit,
      minSeverity,
      counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
      table,
      headGrype: headScan,
      headBOM: headBomJson,
      graphMaxNodes
    });
    fs.writeFileSync(reportPath, reportMd, "utf8");

    // Build HTML report (render diff table + dependency paths + mermaid + pie chart)
    const pathsSectionOnly = reportMd.split("#### Dependency paths")[1] || "";
    const pathsMd = pathsSectionOnly ? "#### Dependency paths\n" + pathsSectionOnly.split("#### Dependency graph")[0] : "";
    const reportHtml = buildHtmlReport({
      baseLabel: guessLabel(baseRefInput), baseInput: baseRefInput, baseSha, baseCommitLine: baseCommit,
      headLabel: guessLabel(headRefInput), headInput: headRefInput, headSha, headCommitLine: headCommit,
      minSeverity,
      counts: { new: d.news.length, removed: d.removed.length, unchanged: d.unchanged.length },
      diffTableMarkdown: table,
      headGrype: headScan,
      headBOM: headBomJson,
      mermaidGraph,
      pathsTableMarkdown: pathsMd
    });
    const reportHtmlPath = path.join(workdir, "report.html");
    fs.writeFileSync(reportHtmlPath, reportHtml, "utf8");

    // Optional: export to PDF with Puppeteer
    let reportPdfPath = "";
    if (reportPdf) {
      reportPdfPath = path.join(workdir, "report.pdf");
      await renderPdfFromHtml(reportHtml, reportPdfPath);
      core.info(`PDF report generated at ${reportPdfPath}`);
    }

    // Save raw scans/diff for artifact
    const grypeBasePath = path.join(workdir, "grype-base.json");
    const grypeHeadPath = path.join(workdir, "grype-head.json");
    fs.writeFileSync(grypeBasePath, JSON.stringify(baseScan, null, 2));
    fs.writeFileSync(grypeHeadPath, JSON.stringify(headScan, null, 2));
    const diffJsonPath = path.join(workdir, "diff.json");
    fs.writeFileSync(diffJsonPath, JSON.stringify({ news: d.news, removed: d.removed, unchanged: d.unchanged }, null, 2));

    // Upload artifact bundle
    if (uploadArtifact) {
      const client = new artifact.DefaultArtifactClient();
      const files = [reportPath, reportHtmlPath, baseSbom, headSbom, grypeBasePath, grypeHeadPath, diffJsonPath];
      if (reportPdf && reportPdfPath) files.push(reportPdfPath);
      await client.uploadArtifact(artifactName, files, workdir, { continueOnError: true, retentionDays: 90 });
    }

    // Cleanup worktrees
    await sh(`git worktree remove ${baseDir} --force || true`);
    if (createdHeadWorktree) await sh(`git worktree remove ${headDir} --force || true`);
  } catch (error) {
    core.setFailed(error.message || String(error));
  }
}

run();
