// src/render/pdf.js
// Minimal PDF renderer focused ONLY on the COVER page.
// This module is SELF-CONTAINED and does not reuse HTML/Markdown renderers.
//
// Exports:
// - buildCoverHtml({ repository, baseLabel, headLabel, titleLogoUrl, generatedAt, coverBg, coverFg })
// - htmlToPdf(html, outPath, opts)
//
// Notes:
// - The cover is strictly one A4 page (no cut/crop). We enforce @page A4 + zero margins
//   and size the .cover container to exactly 210mm x 297mm.
// - The logo is constrained with object-fit: contain; max-width/max-height to avoid overflow/cut.
// - Robust Chrome/Chromium resolution is kept to avoid changing consumer workflows.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/* -------------------------- Puppeteer resolution -------------------------- */
/**
 * Try to require puppeteer first, then puppeteer-core as a fallback.
 */
function resolvePuppeteerModule() {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  try { return require("puppeteer"); } catch (_) { /* ignore */ }
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  try { return require("puppeteer-core"); } catch (_) { /* ignore */ }
  return null;
}

/**
 * Find an executable on PATH using `which`. Returns null if not found.
 */
function which(bin) {
  try {
    const out = execSync(`which ${bin}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a Chrome/Chromium executable path in GitHub runners or local envs.
 * Priority:
 *  1. PUPPETEER_EXECUTABLE_PATH env
 *  2. puppeteer.executablePath() (if available and non-empty)
 *  3. System Chrome/Chromium names on PATH
 *  4. Common hard-coded locations
 */
function resolveChromeExecutablePath(puppeteer) {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  try {
    if (puppeteer && typeof puppeteer.executablePath === "function") {
      const xp = puppeteer.executablePath();
      if (xp && fs.existsSync(xp)) return xp;
    }
  } catch { /* ignore */ }

  const candidates = [
    "google-chrome-stable",
    "google-chrome",
    "chromium-browser",
    "chromium",
  ];
  for (const name of candidates) {
    const found = which(name);
    if (found && fs.existsSync(found)) return found;
  }

  const hardcoded = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const p of hardcoded) if (fs.existsSync(p)) return p;

  return null;
}

/**
 * Attempt an on-the-fly browser install via `npx puppeteer browsers install`.
 * Keeps the consumer workflow unchanged.
 */
function tryInstallBrowser(product = "chrome") {
  const cmd = `npx --yes puppeteer browsers install ${product}`;
  try {
    execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------- Theme --------------------------------- */
// Default colors (can be overridden through buildCoverHtml parameters).
const COVER_BG = "#0b2239";
const COVER_FG = "#ffffff";

/* --------------------------------- Utils --------------------------------- */
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleLine(repository, baseLabel, headLabel) {
  return `Security Report — ${repository} — ${baseLabel} vs ${headLabel}`;
}

function nowUK() {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date()).replace(",", "");
  } catch {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(
      d.getHours()
    )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
}

/* ---------------------------------- CSS ---------------------------------- */
// IMPORTANT: We force a single page A4 cover.
// - @page size: A4 and margin: 0 so the content occupies the full page.
// - .cover exact size: 210mm x 297mm (A4 portrait), preventing extra pages.
// - All content is flex-centered; logo uses object-fit: contain to avoid clipping.
const COVER_CSS = `
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; }
.cover {
  width: 210mm;
  height: 297mm;
  background: VAR_BG;
  color: VAR_FG;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  box-sizing: border-box;
  padding: 18mm 12mm; /* gentle inner padding so text/logo won't touch edges */
}
.cover .repo {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  font-size: 18px;
  opacity: .9;
  margin-bottom: 4mm;
}
.cover h1 {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  font-size: 26px;
  line-height: 1.25;
  margin: 0 0 6mm 0;
}
.cover .date {
  font-size: 13px;
  opacity: .9;
}
.cover .logo-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 14mm;
  width: 100%;
}
.cover .logo-wrap img {
  display: block;
  max-width: 140mm;   /* keep generous width but below page width */
  max-height: 40mm;   /* critical: avoid vertical overflow/cut */
  width: auto;
  height: auto;
  object-fit: contain; /* never crop */
}
`;

/* --------------------------------- Cover --------------------------------- */
function buildCoverHtml({
  repository,
  baseLabel,
  headLabel,
  titleLogoUrl,
  generatedAt,
  coverBg = COVER_BG,
  coverFg = COVER_FG,
}) {
  const title = titleLine(repository, baseLabel, headLabel);
  const hasLogo = !!titleLogoUrl;

  const css = COVER_CSS
    .replace("VAR_BG", escHtml(coverBg))
    .replace("VAR_FG", escHtml(coverFg));

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
${css}
</style>
<title>${escHtml(title)}</title>
</head>
<body>
  <section class="cover">
    <div class="repo">${escHtml(repository)}</div>
    <h1>${escHtml(title)}</h1>
    <div class="date">${escHtml(generatedAt || nowUK())}</div>
    ${
      hasLogo
        ? `<div class="logo-wrap"><img src="${escHtml(titleLogoUrl)}" alt="logo"></div>`
        : ""
    }
  </section>
</body>
</html>
`.trim();
}

/* ------------------------------ Puppeteer I/O ------------------------------ */
/**
 * Render an HTML string to a PDF file using Puppeteer/Chromium.
 * - Forces zero PDF margins and preferCSSPageSize so the A4 cover fits exactly one page.
 * - Robustly resolves Chrome path; if missing, auto-installs via npx so the consumer workflow remains unchanged.
 *
 * @param {string} html - Full HTML document string
 * @param {string} outPath - Path to output PDF
 * @param {object} opts - { launchArgs }
 */
async function htmlToPdf(html, outPath, opts = {}) {
  const {
    launchArgs = ["--no-sandbox", "--disable-setuid-sandbox"],
  } = opts;

  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  // 1) Try to load puppeteer/puppeteer-core
  let puppeteer = resolvePuppeteerModule();
  if (!puppeteer) {
    // Attempt runtime install (keeps consumer unchanged)
    try {
      execSync("npm i -D puppeteer", { stdio: ["ignore", "pipe", "pipe"] });
      // eslint-disable-next-line global-require
      puppeteer = require("puppeteer");
    } catch {
      try {
        execSync("npm i -D puppeteer-core", { stdio: ["ignore", "pipe", "pipe"] });
        // eslint-disable-next-line global-require
        puppeteer = require("puppeteer-core");
      } catch {
        throw new Error(
          "Unable to load 'puppeteer' or 'puppeteer-core' and runtime install failed."
        );
      }
    }
  }

  // 2) Resolve Chrome/Chromium executable; if missing, try auto-install
  let executablePath = resolveChromeExecutablePath(puppeteer);
  if (!executablePath) {
    const okChrome = tryInstallBrowser("chrome");
    if (!okChrome) tryInstallBrowser("chromium");
    executablePath = resolveChromeExecutablePath(puppeteer);
  }

  // 3) Launch
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: executablePath || undefined, // allow puppeteer default if still null
      args: launchArgs,
    });
  } catch (e) {
    // One last attempt without executablePath; useful if the previous step downloaded a default
    browser = await puppeteer.launch({
      headless: "new",
      args: launchArgs,
    });
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Force exact one-page cover: A4, zero margins, printBackground, preferCSSPageSize
    await page.pdf({
      path: outPath,
      format: "A4",
      landscape: false,
      displayHeaderFooter: false,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      printBackground: true,
      preferCSSPageSize: true, // use our @page size/margins
    });
  } finally {
    await browser.close();
  }
}

/* --------------------------------- Exports -------------------------------- */
module.exports = {
  buildCoverHtml,
  htmlToPdf,
};
