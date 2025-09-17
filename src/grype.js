const core = require("@actions/core");
const exec = require("@actions/exec");

async function ensureGrype() {
  await exec.exec("bash", ["-lc", "command -v grype >/dev/null 2>&1 || curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin"]);
}

async function scanSbom(sbomPath) {
  await ensureGrype();
  let out = "";
  const opts = {
    listeners: {
      stdout: (data) => (out += data.toString())
    }
  };
  await exec.exec("bash", ["-lc", `grype sbom:${sbomPath} -o json || true`], opts);
  try {
    return JSON.parse(out);
  } catch (e) {
    core.warning("Failed to parse grype JSON. Returning empty.");
    return { matches: [] };
  }
}

module.exports = { scanSbom };
