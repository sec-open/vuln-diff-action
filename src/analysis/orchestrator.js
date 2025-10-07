// Phase 1 end-to-end orchestration (no Phase 2/3 logic)
const path = require('path');
const os = require('os');
const core = require('@actions/core');
const github = require('@actions/github');
const { layout } = require('./paths');
const { ensureDir, writeJson, writeFile } = require('./fsx');
const { detectTools } = require('./tools');
const {
  gitFetchAll,
  resolveRefToSha,
  shortSha,
  commitInfo,
  prepareIsolatedCheckout,
  cleanupWorktree,
} = require('./git');
const { generateSbom } = require('./sbom');
const { scanSbomWithGrype } = require('./grype');
const { makeMeta, writeMeta } = require('./meta');

async function phase1() {
  // Small helper to time steps
  const time = () => {
    const start = Date.now();
    return () => `${(Date.now() - start)}ms`;
  };

  // 0) Preconditions
  if (os.platform() !== 'linux') {
    core.setFailed('This action requires a Linux runner (Ubuntu recommended).');
    return;
  }

  core.startGroup('[phase1] Inputs');
  try {
    const base_ref = core.getInput('base_ref', { required: true });
    const head_ref = core.getInput('head_ref', { required: true });
    const subPath = core.getInput('path') || '.';

    core.info(`base_ref: ${base_ref}`);
    core.info(`head_ref: ${head_ref}`);
    core.info(`path: ${subPath}`);

    const repoRoot = process.cwd();
    const l = layout();
    await ensureDir(l.root);
    core.debug(`dist root: ${l.root}`);

    // 1) Tools detection
    core.endGroup();
    core.startGroup('[phase1] Tools detection');
    let stop = time();
    const tools = await detectTools();
    core.info(`tools detected in ${stop()}`);
    core.debug(`tools: ${JSON.stringify(tools, null, 2)}`);

    // 2) Resolve refs & worktrees
    core.endGroup();
    core.startGroup('[phase1] Resolve refs & prepare worktrees');
    stop = time();
    await gitFetchAll(repoRoot);
    const baseSha = await resolveRefToSha(base_ref, repoRoot);
    const headSha = await resolveRefToSha(head_ref, repoRoot);
    const base7 = shortSha(baseSha);
    const head7 = shortSha(headSha);

    core.info(`resolved base_sha: ${baseSha} (${base7})`);
    core.info(`resolved head_sha: ${headSha} (${head7})`);

    const baseInfo = await commitInfo(baseSha, repoRoot);
    const headInfo = await commitInfo(headSha, repoRoot);

    await ensureDir(path.dirname(l.git.base));
    await writeJson(l.git.base, { ...baseInfo, ref: base_ref });
    await ensureDir(path.dirname(l.git.head));
    await writeJson(l.git.head, { ...headInfo, ref: head_ref });

    const baseCheckout = await prepareIsolatedCheckout(
      baseSha,
      path.join(l.root, 'refs', base7),
      repoRoot
    );
    const headCheckout = await prepareIsolatedCheckout(
      headSha,
      path.join(l.root, 'refs', head7),
      repoRoot
    );

    // Target working subfolders (path input)
    const baseWorkdir = path.resolve(baseCheckout, subPath);
    const headWorkdir = path.resolve(headCheckout, subPath);

    core.info(`base workdir: ${baseWorkdir}`);
    core.info(`head workdir: ${headWorkdir}`);
    core.info(`refs & worktrees ready in ${stop()}`);

    // 3) SBOM generation
    core.endGroup();
    core.startGroup('[phase1] SBOM generation');
    stop = time();
    await ensureDir(path.dirname(l.sbom.base));
    await ensureDir(path.dirname(l.sbom.head));

    const baseSbomPathLocal = await generateSbom({ checkoutDir: baseWorkdir, tools });
    const headSbomPathLocal = await generateSbom({ checkoutDir: headWorkdir, tools });

    // copy (read/write) into dist canonical paths
    const fs = require('fs/promises');
    await fs.copyFile(baseSbomPathLocal, l.sbom.base);
    await fs.copyFile(headSbomPathLocal, l.sbom.head);

    core.info(`wrote SBOMs -> ${l.sbom.base} / ${l.sbom.head}`);
    core.info(`SBOM generation done in ${stop()}`);

    // 4) Grype scans
    core.endGroup();
    core.startGroup('[phase1] Vulnerability scanning (Grype)');
    stop = time();
    await ensureDir(path.dirname(l.grype.base));
    await ensureDir(path.dirname(l.grype.head));

    const baseGrypeJson = await scanSbomWithGrype(tools.paths.grype, l.sbom.base, baseWorkdir);
    const headGrypeJson = await scanSbomWithGrype(tools.paths.grype, l.sbom.head, headWorkdir);

    await writeFile(l.grype.base, Buffer.from(baseGrypeJson, 'utf8'));
    await writeFile(l.grype.head, Buffer.from(headGrypeJson, 'utf8'));

    core.info(`wrote Grype outputs -> ${l.grype.base} / ${l.grype.head}`);
    core.info(`Grype scans done in ${stop()}`);

    // 5) Meta
    core.endGroup();
    core.startGroup('[phase1] Metadata');
    stop = time();
    const repoFull = `${github.context.repo.owner}/${github.context.repo.repo}`;
    const meta = makeMeta({
      inputs: { base_ref, head_ref, path: subPath },
      repo: repoFull,
      tools,
      paths: l,
    });
    await writeMeta(l.meta, meta);
    core.info(`wrote meta.json -> ${l.meta}`);
    core.debug(`meta: ${JSON.stringify(meta, null, 2)}`);
    core.info(`metadata written in ${stop()}`);

    // 6) Cleanup worktrees (best-effort)
    core.endGroup();
    core.startGroup('[phase1] Cleanup worktrees');
    stop = time();
    await Promise.all([
      cleanupWorktree(baseCheckout, repoRoot),
      cleanupWorktree(headCheckout, repoRoot),
    ]);
    core.info(`cleanup done in ${stop()}`);

    // 7) Outputs
    core.endGroup();
    core.startGroup('[phase1] Outputs');
    core.setOutput('base_sha', baseSha);
    core.setOutput('head_sha', headSha);
    core.info(`outputs: base_sha=${baseSha}, head_sha=${headSha}`);
  } catch (err) {
    core.setFailed(`[phase1] failed: ${err?.message || err}`);
  } finally {
    core.endGroup();
  }
}

module.exports = { phase1 };
