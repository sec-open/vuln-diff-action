// Phase 1 orchestration: generates SBOMs, vulnerability scan outputs, and metadata for later phases.
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

// Main driver: validates platform, resolves refs, prepares isolated checkouts,
// builds SBOMs, runs Grype, writes meta, cleans up, and sets action outputs.
async function analysis() {
  // Helper: returns a closure reporting elapsed milliseconds.
  const time = () => {
    const start = Date.now();
    return () => `${(Date.now() - start)}ms`;
  };

  // Precondition: Linux runner required (SBOM tooling expectation).
  if (os.platform() !== 'linux') {
    core.setFailed('This action requires a Linux runner (Ubuntu recommended).');
    return;
  }

  core.startGroup('[analysis] Inputs');
  try {
    // Read required action inputs (base/head refs and optional subdirectory).
    const base_ref = core.getInput('base_ref', { required: true });
    const head_ref = core.getInput('head_ref', { required: true });
    const subPath = core.getInput('path') || '.';

    core.info(`base_ref: ${base_ref}`);
    core.info(`head_ref: ${head_ref}`);
    core.info(`path: ${subPath}`);

    // Prepare dist layout directories.
    const repoRoot = process.cwd();
    const l = layout();
    await ensureDir(l.root);
    core.debug(`dist root: ${l.root}`);

    // Tool detection: discover or install syft/grype/maven.
    core.endGroup();
    core.startGroup('[analysis] Tools detection');
    let stop = time();
    const tools = await detectTools();
    core.info(`tools detected in ${stop()}`);
    core.debug(`tools: ${JSON.stringify(tools, null, 2)}`);

    // Resolve refs to SHAs and prepare temporary worktrees.
    core.endGroup();
    core.startGroup('[analysis] Resolve refs & prepare worktrees');
    stop = time();
    await gitFetchAll(repoRoot);
    const baseSha = await resolveRefToSha(base_ref, repoRoot);
    const headSha = await resolveRefToSha(head_ref, repoRoot);
    const base7 = shortSha(baseSha);
    const head7 = shortSha(headSha);

    core.info(`resolved base_sha: ${baseSha} (${base7})`);
    core.info(`resolved head_sha: ${headSha} (${head7})`);

    // Collect commit metadata (author, subject, timestamps).
    const baseInfo = await commitInfo(baseSha, repoRoot);
    const headInfo = await commitInfo(headSha, repoRoot);

    await ensureDir(path.dirname(l.git.base));
    await writeJson(l.git.base, { ...baseInfo, ref: base_ref });
    await ensureDir(path.dirname(l.git.head));
    await writeJson(l.git.head, { ...headInfo, ref: head_ref });

    // Create detached worktrees for base and head revisions.
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

    // Resolve working subdirectories according to input path.
    const baseWorkdir = path.resolve(baseCheckout, subPath);
    const headWorkdir = path.resolve(headCheckout, subPath);

    core.info(`base workdir: ${baseWorkdir}`);
    core.info(`head workdir: ${headWorkdir}`);
    core.info(`refs & worktrees ready in ${stop()}`);

    // SBOM generation for each side (Maven aggregate or Syft fallback).
    core.endGroup();
    core.startGroup('[analysis] SBOM generation');
    stop = time();
    await ensureDir(path.dirname(l.sbom.base));
    await ensureDir(path.dirname(l.sbom.head));

    const baseSbomPathLocal = await generateSbom({ checkoutDir: baseWorkdir, tools });
    const headSbomPathLocal = await generateSbom({ checkoutDir: headWorkdir, tools });

    // Copy generated SBOMs into canonical dist locations.
    const fs = require('fs/promises');
    await fs.copyFile(baseSbomPathLocal, l.sbom.base);
    await fs.copyFile(headSbomPathLocal, l.sbom.head);

    core.info(`wrote SBOMs -> ${l.sbom.base} / ${l.sbom.head}`);
    core.info(`SBOM generation done in ${stop()}`);

    // Vulnerability scanning using Grype against CycloneDX SBOMs.
    core.endGroup();
    core.startGroup('[analysis] Vulnerability scanning (Grype)');
    stop = time();
    await ensureDir(path.dirname(l.grype.base));
    await ensureDir(path.dirname(l.grype.head));

    const baseGrypeJson = await scanSbomWithGrype(tools.paths.grype, l.sbom.base, baseWorkdir);
    const headGrypeJson = await scanSbomWithGrype(tools.paths.grype, l.sbom.head, headWorkdir);

    // Persist raw scan output.
    await writeFile(l.grype.base, Buffer.from(baseGrypeJson, 'utf8'));
    await writeFile(l.grype.head, Buffer.from(headGrypeJson, 'utf8'));

    core.info(`wrote Grype outputs -> ${l.grype.base} / ${l.grype.head}`);
    core.info(`Grype scans done in ${stop()}`);

    // Metadata document describing inputs, environment, tool versions, and artifact paths.
    core.endGroup();
    core.startGroup('[analysis] Metadata');
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

    // Cleanup worktrees (non-fatal if fails).
    core.endGroup();
    core.startGroup('[analysis] Cleanup worktrees');
    stop = time();
    await Promise.all([
      cleanupWorktree(baseCheckout, repoRoot),
      cleanupWorktree(headCheckout, repoRoot),
    ]);
    core.info(`cleanup done in ${stop()}`);

    // Action outputs: expose resolved SHAs.
    core.endGroup();
    core.startGroup('[analysis] Outputs');
    core.setOutput('base_sha', baseSha);
    core.setOutput('head_sha', headSha);
    core.info(`outputs: base_sha=${baseSha}, head_sha=${headSha}`);
  } catch (err) {
    // Failure path marks action failed and ends grouping.
    core.setFailed(`[analysis] failed: ${err?.message || err}`);
  } finally {
    core.endGroup();
  }
}

module.exports = { analysis };
