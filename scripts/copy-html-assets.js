// Copies vendor UMD/min assets from node_modules to html-bundle/assets
// so the HTML report can run offline without CDNs.
//
// Files copied:
//
//  - node_modules/chart.js/dist/chart.umd.js                       -> html-bundle/assets/chart.umd.js
//  - node_modules/chartjs-plugin-annotation/dist/chartjs-plugin-annotation.min.js  -> html-bundle/assets/chartjs-plugin-annotation.min.js
//  - node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.min.js  -> html-bundle/assets/chartjs-plugin-datalabels.min.js
//  - node_modules/chartjs-chart-matrix/dist/chartjs-chart-matrix.min.js           -> html-bundle/assets/chartjs-chart-matrix.min.js
//  - node_modules/mermaid/dist/mermaid.min.js                      -> html-bundle/assets/mermaid.min.js
//
// Run:
//   npm run assets:bundle
//
// It is also wired in package.json "postinstall" (best-effort).

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const pairs = [
  ["chart.js/dist/chart.umd.js", "chart.umd.js"],
  ["chartjs-plugin-annotation/dist/chartjs-plugin-annotation.min.js", "chartjs-plugin-annotation.min.js"],
  ["chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.min.js", "chartjs-plugin-datalabels.min.js"],
  ["chartjs-chart-matrix/dist/chartjs-chart-matrix.min.js", "chartjs-chart-matrix.min.js"],
  ["mermaid/dist/mermaid.min.js", "mermaid.min.js"],
];

async function main() {
  const repoRoot = process.cwd();
  const assetsDst = path.join(repoRoot, "html-bundle", "assets");
  await fsp.mkdir(assetsDst, { recursive: true });

  for (const [srcRel, outName] of pairs) {
    const src = path.join(repoRoot, "node_modules", srcRel);
    const dst = path.join(assetsDst, outName);
    try {
      await fsp.copyFile(src, dst);
      console.log(`Copied: ${srcRel} -> html-bundle/assets/${outName}`);
    } catch (e) {
      console.error(`WARNING: Cannot copy ${srcRel}. Did you run "npm install"?`, e.message);
    }
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
