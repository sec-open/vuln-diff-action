/**
 * HTML bundle renderer
 * - Copies the static bundle (index.html, assets/*) to outputDir
 * - Writes data/*.json alongside it
 * - Does not rely on 'dist/html-bundle' (ncc does not include non-JS by default)
 */

const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

/**
 * Resolve the source directory where 'html-bundle' lives.
 * We try multiple candidates so the action works both from source and from a packaged dist:
 *  1) $GITHUB_ACTION_PATH/html-bundle
 *  2) <action-root>/html-bundle  (two levels up from dist: __dirname/../..)
 *  3) process.cwd()/html-bundle
 */
async function resolveBundleDir() {
  const candidates = [
    process.env.GITHUB_ACTION_PATH && path.join(process.env.GITHUB_ACTION_PATH, "html-bundle"),
    path.resolve(__dirname, "..", "..", "html-bundle"),
    path.resolve(process.cwd(), "html-bundle"),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      const stat = await fs.stat(dir);
      if (stat.isDirectory() && fssync.existsSync(path.join(dir, "index.html"))) {
        return dir;
      }
    } catch {
      // ignore and continue
    }
  }

  const tried = candidates.join(", ");
  throw new Error(
    `HTML bundle not found. Looked for: ${tried}. ` +
    `Ensure the 'html-bundle/' directory is included in your repository/tag next to action.yml.`
  );
}

/**
 * Recursively copy a directory (Node 16+: fs.cp; Node 20 is guaranteed on Actions).
 */
async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  // Node 20+ supports fs.cp; keep a fallback just in case.
  if (fs.cp) {
    await fs.cp(src, dst, { recursive: true, force: true, errorOnExist: false });
  } else {
    // simple fallback
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

/**
 * Write JSON helper (pretty-printed).
 */
async function writeJson(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2), "utf8");
}

/**
 * Render the deployable HTML bundle.
 * @param {Object} opts
 * @param {string} opts.outputDir           Destination directory for the bundle
 * @param {Object} opts.baseJson
 * @param {Object} opts.headJson
 * @param {Object} opts.diffJson
 * @param {Object} [opts.meta]              Extra metadata to embed as data/meta.json
 */
async function renderHtmlBundle(opts) {
  const {
    outputDir,
    baseJson,
    headJson,
    diffJson,
    meta = {},
  } = opts || {};

  if (!outputDir) throw new Error("renderHtmlBundle: 'outputDir' is required");

  // 1) Locate the source html-bundle directory
  const bundleSrc = await resolveBundleDir();

  // 2) Copy the entire bundle to outputDir
  await copyDir(bundleSrc, outputDir);

  // 3) Write data/*.json next to the copied index.html
  const dataDir = path.join(outputDir, "data");
  await writeJson(path.join(dataDir, "base.json"), baseJson || {});
  await writeJson(path.join(dataDir, "head.json"), headJson || {});
  await writeJson(path.join(dataDir, "diff.json"), diffJson || {});
  await writeJson(path.join(dataDir, "meta.json"), {
    generatedAt: new Date().toISOString(),
    ...meta,
  });

  // 4) Sanity log
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
