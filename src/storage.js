// src/storage.js
// Phase 2 — Storage: write base.json, head.json, diff.json

const fs = require("fs");
const path = require("path");

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function persistAll(workdir, baseObj, headObj, diffObj) {
  const basePath = path.join(workdir, "base.json");
  const headPath = path.join(workdir, "head.json");
  const diffPath = path.join(workdir, "diff.json");

  writeJson(basePath, { items: baseObj.items, grype: baseObj.grypeRaw, sbom: baseObj.sbomPath });
  writeJson(headPath, { items: headObj.items, grype: headObj.grypeRaw, sbom: headObj.sbomPath });
  writeJson(diffPath, diffObj);

  return { basePath, headPath, diffPath };
}

module.exports = { persistAll };
