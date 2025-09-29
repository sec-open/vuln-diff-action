// src/render/pdf.js
// Phase 3 — PDF-only components (cover / main / landscape). Independent from HTML.

const { PDFDocument } = require("pdf-lib");
const path = require("path");
const fs = require("fs");
const os = require("os");
const exec = require("@actions/exec");

async function sh(cmd, opts = {}) {
  return exec.exec("bash", ["-lc", cmd], opts);
}

// We use Puppeteer but ensure Chrome at runtime (no extra steps in consumer workflows)
async function ensureChrome() {
  const cache = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), ".cache/puppeteer");
  await sh(`PUPPETEER_CACHE_DIR="${cache}" npx --yes puppeteer@24.10.2 browsers install chrome`);
}

async function htmlToPdf(html, outPath, options) {
  const puppeteer = require("puppeteer");
  await ensureChrome();

  const browser = await puppeteer.launch({
    channel: "chrome",
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
      landscape: !!options?.landscape,
      printBackground: true,
      displayHeaderFooter: !!options?.displayHeaderFooter,
      headerTemplate: options?.headerTemplate || "<div></div>",
      footerTemplate: options?.footerTemplate || "<div></div>",
      margin: options?.margin || { top: "16mm", right: "10mm", bottom: "16mm", left: "10mm" }
    });
  } finally {
    try { await browser.close(); } catch {}
  }
}

async function mergePdfs(paths, outPath) {
  const docs = [];
  for (const p of paths) docs.push(await PDFDocument.load(fs.readFileSync(p)));
  const out = await PDFDocument.create();
  for (const doc of docs) {
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const pg of pages) out.addPage(pg);
  }
  fs.writeFileSync(outPath, await out.save());
}

function buildCoverHtml({ repository, baseLabel, headLabel, titleLogoUrl, generatedAt }) {
  return [
    "<!doctype html><html><head><meta charset='utf-8'/>",
    "<style>",
    "body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Ubuntu,Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b1220;color:#f8fafc}",
    ".wrap{text-align:center;padding:40px}",
    ".logo{height:56px;margin-bottom:16px}",
    "h1{margin:8px 0 0 0;font-size:28px}",
    "h2{margin:6px 0 18px 0;font-weight:500;color:#cbd5e1}",
    ".muted{color:#94a3b8}",
    "</style></head><body>",
    "<div class='wrap'>",
    (titleLogoUrl ? `<img class='logo' src='${titleLogoUrl}'/>` : ""),
    "<h1>Security Report</h1>",
    `<div class='muted'>${repository}</div>`,
    `<h2>Comparison of branches ${baseLabel} vs ${headLabel}</h2>`,
    `<div class='muted'>Generated: ${generatedAt}</div>`,
    "</div></body></html>"
  ].join("");
}

function buildMainHtml({ repository, base, head, counts, minSeverity, diffTableHtml, logo }) {
  const brandBg = "#111827";
  const brandFg = "#F9FAFB";
  const header = [
    `<div style="width:100%;font-size:9px;color:${brandFg};background:${brandBg};padding:6px 10mm;">`,
    `<span style="float:left;">Security Report — ${repository} — ${base.label} vs ${head.label}</span>`,
    `<span style="float:right;">Main</span></div>`
  ].join("");
  const footer = [
    `<div style="width:100%;font-size:9px;color:${brandFg};background:${brandBg};padding:6px 10mm;">`,
    (logo ? `<img src="${logo}" style="height:14px;vertical-align:middle;margin-right:8px"/>` : ""),
    `</div>`
  ].join("");

  const body = [
    "<!doctype html><html><head><meta charset='utf-8'/>",
    "<style>",
    "body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Ubuntu,Arial;margin:0}",
    "h2{margin:0 0 8px 0}",
    ".panel{border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;margin:12px}",
    ".tbl{width:100%;border-collapse:collapse;font-size:13px}",
    ".tbl th,.tbl td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top}",
    ".tbl thead th{background:#f9fafb}",
    "code{background:#f1f5f9;padding:2px 6px;border-radius:6px}",
    "</style></head><body>",
    `<div class="panel"><h2>Summary</h2>
     <div><b>Base:</b> ${base.label} — <code>${base.sha.slice(0,12)}</code></div>
     <div><b>Head:</b> ${head.label} — <code>${head.sha.slice(0,12)}</code></div>
     <div><b>Min severity:</b> ${minSeverity} · <b>Counts:</b> NEW=${counts.new} · REMOVED=${counts.removed} · UNCHANGED=${counts.unchanged}</div>
    </div>`,
    `<div class="panel"><h2>Vulnerability diff</h2>${diffTableHtml}</div>`,
    "</body></html>"
  ].join("");

  return { body, header, footer };
}

function buildLandscapeHtml({ baseLabel, headLabel, pathsBaseHtml, pathsHeadHtml, mermaidBase, mermaidHead }) {
  const brandBg = "#111827";
  const brandFg = "#F9FAFB";
  const header = `<div style="width:100%;font-size:9px;color:${brandFg};background:${brandBg};padding:6px 10mm;">
    <span style="float:left;">Dependency graphs & paths — ${baseLabel} vs ${headLabel}</span>
    <span style="float:right;">Appendix</span></div>`;

  const body = [
    "<!doctype html><html><head><meta charset='utf-8'/>",
    "<style>",
    "body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Ubuntu,Arial;margin:0}",
    "h2{margin:0 0 8px 0}",
    ".panel{border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;margin:12px}",
    "</style></head><body>",
    `<div class="panel"><h2>Dependency graph — BASE: ${baseLabel}</h2><div data-mermaid="${mermaidBase.replace(/"/g,"&quot;")}"></div></div>`,
    `<div class="panel"><h2>Dependency graph — HEAD: ${headLabel}</h2><div data-mermaid="${mermaidHead.replace(/"/g,"&quot;")}"></div></div>`,
    `<div class="panel"><h2>Dependency path base</h2>${pathsBaseHtml}</div>`,
    `<div class="panel"><h2>Dependency path head</h2>${pathsHeadHtml}</div>`,
    "</body></html>"
  ].join("");

  return { body, header };
}

module.exports = {
  buildCoverHtml,
  buildMainHtml,
  buildLandscapeHtml,
  htmlToPdf,
  mergePdfs
};
