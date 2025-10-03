// path: src/render/html.js
/**
 * HTML bundle renderer
 * - Copies the static bundle (index.html, assets/*) to outputDir
 * - Writes data/*.json alongside it
 * - Robustly resolves where 'html-bundle' lives at runtime.
 */

const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

/**
 * Find 'html-bundle' by checking multiple candidates and walking upwards
 * from __dirname (dist). We require the directory to exist and to contain index.html.
 */
async function resolveBundleDir() {
  const candidates = [];

  // 1) Candidates from environment (may or may not include the version subdir)
  if (process.env.GITHUB_ACTION_PATH) {
    candidates.push(path.join(process.env.GITHUB_ACTION_PATH, "html-bundle"));
  }

  // 2) Relative to current compiled file:
  //    .../dist        -> ../html-bundle
  //    .../dist        -> ./html-bundle (if someone copied it inside dist)
  //    .../dist        -> ../../html-bundle (defensive)
  candidates.push(
    path.resolve(__dirname, "..", "html-bundle"),
    path.resolve(__dirname, "html-bundle"),
    path.resolve(__dirname, "..", "..", "html-bundle")
  );

  // 3) Walk up from __dirname and look for a sibling 'html-bundle'
  let dir = path.resolve(__dirname);
  for (let i = 0; i < 5; i++) {
    const probe = path.join(dir, "html-bundle");
    candidates.push(probe);
    dir = path.dirname(dir);
  }

  // 4) Last-resort: cwd/html-bundle (useful in local runs)
  candidates.push(path.resolve(process.cwd(), "html-bundle"));

  // Deduplicate
  const seen = new Set();
  const unique = candidates.filter(p => {
    if (!p) return false;
    const k = path.resolve(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (const dirPath of unique) {
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) continue;
      const indexHtml = path.join(dirPath, "index.html");
      if (fssync.existsSync(indexHtml)) {
        return dirPath;
      }
    } catch {
      // ignore and continue
    }
  }

  throw new Error(
    `HTML bundle not found. Looked for: ${unique.join(", ")}. ` +
    `Ensure 'html-bundle/' is committed next to action.yml in the tag/release.`
  );
}

/**
 * Recursively copy a directory (Node 20: fs.cp available).
 */
async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  if (fs.cp) {
    await fs.cp(src, dst, { recursive: true, force: true, errorOnExist: false });
  } else {
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const e of entries) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) await copyDir(s, d);
      else if (e.isFile()) {
        await fs.mkdir(path.dirname(d), { recursive: true });
        await fs.copyFile(s, d);
      }
    }
  }
}

async function writeJson(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(obj ?? {}, null, 2), "utf8");
}

/**
 * Copy bundle and write data/*.json
 */
async function renderHtmlBundle(opts) {
  const { outputDir, baseJson, headJson, diffJson, meta = {} } = opts || {};
  if (!outputDir) throw new Error("renderHtmlBundle: 'outputDir' is required");

  const bundleSrc = await resolveBundleDir();
  await copyDir(bundleSrc, outputDir);

  const dataDir = path.join(outputDir, "data");
  await writeJson(path.join(dataDir, "base.json"), baseJson);
  await writeJson(path.join(dataDir, "head.json"), headJson);
  await writeJson(path.join(dataDir, "diff.json"), diffJson);
  await writeJson(path.join(dataDir, "meta.json"), {
    generatedAt: new Date().toISOString(),
    ...meta,
  });

  const indexPath = path.join(outputDir, "index.html");
  if (!fssync.existsSync(indexPath)) {
    throw new Error(`renderHtmlBundle: 'index.html' not found at ${indexPath}. Check your html-bundle source.`);
  }
  return { outputDir, indexPath };
}

module.exports = {
  renderHtmlBundle,
  _internal: { resolveBundleDir, copyDir, writeJson },
};
