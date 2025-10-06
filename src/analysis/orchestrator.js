// Phase 1 end-to-end orchestration (no Phase 2/3 logic)
const path = require('path');
const os = require('os');
const core = require('@actions/core');
const github = require('@actions/github');
const { layout } = require('./paths');
const { ensureDir, writeJson, writeFile } = require('./fsx');
const { detectTools } = require('./tools');
const { gitFetchAll, resolveRefToSha, shortSha, commitInfo, prepareIsolatedCheckout, cleanupWorktree } = require('./git');
const { generateSbom } = require('./sbom');
const { scanSbomWithGrype } = require('./grype');
const { makeMeta, writeMeta } = require('./meta');
const { uploadPhase1Artifact } = require('./artifact');

async function phase1() {
  if (os.platform() !== 'linux') {
    core.setFailed('This action requires a Linux runner (Ubuntu recommended).');
    return;
  }
  // 1) Inputs
  const base_ref = core.getInput('base_ref', { required: true });
  const head_ref = core.getInput('head_ref', { required: true });
  const subPath = core.getInput('path') || '.';

  const repoRoot = process.cwd();
  const l = layout();
  await ensureDir(l.root);

  // 2) Tools
  const tools = await detectTools();

  // 3) Resolve refs & worktrees
  await gitFetchAll(repoRoot);
  const baseSha = await resolveRefToSha(base_ref, repoRoot);
  const headSha = await resolveRefToSha(head_ref, repoRoot);
  const base7 = shortSha(baseSha);
  const head7 = shortSha(headSha);

  const baseInfo = await commitInfo(baseSha, repoRoot);
  const headInfo = await commitInfo(headSha, repoRoot);

  await ensureDir(path.dirname(l.git.base));
  await writeJson(l.git.base, { ...baseInfo, ref: base_ref });
  await writeJson(l.git.head, { ...headInfo, ref: head_ref });

  const baseCheckout = await prepareIsolatedCheckout(baseSha, path.join(l.root, 'refs', base7), repoRoot);
  const headCheckout = await prepareIsolatedCheckout(headSha, path.join(l.root, 'refs', head7), repoRoot);

  // Target working subfolders (path input)
  const baseWorkdir = path.resolve(baseCheckout, subPath);
  const headWorkdir = path.resolve(headCheckout, subPath);

  // 4) SBOMs
  await ensureDir(path.dirname(l.sbom.base));
  await ensureDir(path.dirname(l.sbom.head));

  const baseSbomPathLocal = await generateSbom({ checkoutDir: baseWorkdir, tools });
  const headSbomPathLocal = await generateSbom({ checkoutDir: headWorkdir, tools });

  // copy (read/write) into dist canonical paths
  const fs = require('fs/promises');
  await fs.copyFile(baseSbomPathLocal, l.sbom.base);
  await fs.copyFile(headSbomPathLocal, l.sbom.head);

  // 5) Grype scans
  await ensureDir(path.dirname(l.grype.base));
  await ensureDir(path.dirname(l.grype.head));

  const baseGrypeJson = await scanSbomWithGrype(tools.paths.grype, l.sbom.base, baseWorkdir);
  const headGrypeJson = await scanSbomWithGrype(tools.paths.grype, l.sbom.head, headWorkdir);

  await writeFile(l.grype.base, Buffer.from(baseGrypeJson, 'utf8'));
  await writeFile(l.grype.head, Buffer.from(headGrypeJson, 'utf8'));

  // 6) Meta
  const repoFull = `${github.context.repo.owner}/${github.context.repo.repo}`;
  const meta = makeMeta({
    inputs: { base_ref, head_ref, path: subPath },
    repo: repoFull,
    tools,
    paths: l,
  });
  await writeMeta(l.meta, meta);

  // 7) Upload artifact (ONLY Phase-1 outputs)
  const result = await uploadPhase1Artifact({ baseRef: base_ref, headRef: head_ref });

  // 8) Cleanup worktrees (best-effort)
  await Promise.all([
    cleanupWorktree(baseCheckout, repoRoot),
    cleanupWorktree(headCheckout, repoRoot),
  ]);

  core.setOutput('base_sha', baseSha);
  core.setOutput('head_sha', headSha);
  core.info(`Phase 1 complete. Artifact: ${result.artifactName}`);
}

module.exports = { phase1 };
