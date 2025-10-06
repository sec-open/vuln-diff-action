const os = require('os');
const path = require('path');
const { writeJson } = require('./fsx');

function makeMeta({ inputs, repo, tools, paths }) {
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    inputs: {
      base_ref: inputs.base_ref,
      head_ref: inputs.head_ref,
      path: inputs.path || '.',
    },
    repo,
    tools: {
      cyclonedx_maven: tools.versions.cyclonedx_maven || null,
      syft: tools.versions.syft || null,
      grype: tools.versions.grype || null,
      node: tools.versions.node || null,
    },
    environment: {
      runner_os: os.platform(),
      arch: os.arch(),
    },
    paths: {
      sbom: {
        base: paths.sbom.base,
        head: paths.sbom.head,
      },
      grype: {
        base: paths.grype.base,
        head: paths.grype.head,
      },
    },
  };
}

async function writeMeta(metaPath, metaObj) {
  await writeJson(metaPath, metaObj);
}

module.exports = { makeMeta, writeMeta };
