/**
 * HTML bundle renderer
 * - Copies the static bundle skeleton (no CDNs) to an output directory.
 * - Writes runtime data files: data/base.json, data/head.json, data/diff.json.
 * - Optionally injects small meta into index.html (non-destructive).
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

async function renderHtmlBundle(args) {
  const {
    bundleTemplateDir = path.resolve(__dirname, "../../html-bundle"),
    outputDir,
    baseJson,
    headJson,
    diffJson,
    meta = {},
  } = args || {};

  if (!outputDir) throw new Error("renderHtmlBundle: 'outputDir' is required");
  if (!baseJson || !headJson || !diffJson) throw new Error("renderHtmlBundle: baseJson, headJson, diffJson required");

  await fsp.mkdir(outputDir, { recursive: true });
  await copyDir(bundleTemplateDir, outputDir);

  const dataDir = path.join(outputDir, "data");
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, "base.json"), JSON.stringify(baseJson, null, 2));
  await fsp.writeFile(path.join(dataDir, "head.json"), JSON.stringify(headJson, null, 2));
  await fsp.writeFile(path.join(dataDir, "diff.json"), JSON.stringify(diffJson, null, 2));

  const indexPath = path.join(outputDir, "index.html");
  await injectIndexMeta(indexPath, meta);

  return { outDir: outputDir, dataDir };
}

async function copyDir(srcDir, dstDir) {
  if (typeof fs.cp === "function") {
    await fsp.cp(srcDir, dstDir, { recursive: true, force: true });
    return;
  }
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });
  await fsp.mkdir(dstDir, { recursive: true });
  for (const ent of entries) {
    const src = path.join(srcDir, ent.name);
    const dst = path.join(dstDir, ent.name);
    if (ent.isDirectory()) await copyDir(src, dst);
    else if (ent.isFile()) await fsp.copyFile(src, dst);
  }
}

async function injectIndexMeta(indexPath, meta) {
  try {
    let html = await fsp.readFile(indexPath, "utf8");
    if (meta.generatedAt) {
      const tag = /<meta\s+name=["']report-generated-at["']\s+content=["'][^"']*["']\s*\/?>/i;
      const replacement = `<meta name="report-generated-at" content="${escapeHtmlAttr(meta.generatedAt)}" />`;
      if (tag.test(html)) html = html.replace(tag, replacement);
      else html = html.replace(/<\/head>/i, `  ${replacement}\n</head>`);
    }
    const tiny = {};
    if (meta.repo) tiny.repo = String(meta.repo);
    if (meta.base?.ref) tiny.baseRef = String(meta.base.ref);
    if (meta.head?.ref) tiny.headRef = String(meta.head.ref);
    if (Object.keys(tiny).length > 0) {
      html = html.replace(/<\/head>/i, `<script>window.__REPORT_META=${JSON.stringify(tiny)}</script>\n</head>`);
    }
    await fsp.writeFile(indexPath, html, "utf8");
  } catch {
    // best-effort
  }
}

function escapeHtmlAttr(s) {
  return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

module.exports = { renderHtmlBundle };
