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
const { extractPomDependencies, comparePomDependencies } = require('./pom');
const { scanWithNpmAudit } = require('./npm');
const { mergeVulnerabilities } = require('./merge');
const { detectProjectType } = require('./detectProjectType');
const { scanJavaScriptVulnerabilities } = require('./scan/javascriptScanner');
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
    core.info('[debug] Analysis start');
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
    core.endGroup();
    core.startGroup('[analysis] Project type detection');
    const projectType = detectProjectType(headWorkdir);
    core.info(`[analysis] Detected project type: ${projectType}`);
    core.endGroup();
    //


    core.startGroup('[analysis] SBOM generation');
    stop = time();
    await ensureDir(path.dirname(l.sbom.base));
    await ensureDir(path.dirname(l.sbom.head));
    const baseSbomPathLocal = await generateSbom({ checkoutDir: baseWorkdir, tools, side: 'base' });
    const headSbomPathLocal = await generateSbom({ checkoutDir: headWorkdir, tools, side: 'head' });
    const fsProm = require('fs/promises');
    if (baseSbomPathLocal !== l.sbom.base) await fsProm.copyFile(baseSbomPathLocal, l.sbom.base);
    if (headSbomPathLocal !== l.sbom.head) await fsProm.copyFile(headSbomPathLocal, l.sbom.head);
    core.info(`wrote SBOMs -> ${l.sbom.base} / ${l.sbom.head}`);
    core.info(`SBOM generation done in ${stop()}`);

    // Vulnerability scanning using Grype and npm audit.
    core.endGroup();
    core.startGroup('[analysis] Vulnerability scanning (Grype + npm audit)');

    stop = time();

    // Escaneo con Grype contra SBOMs CycloneDX
    await ensureDir(path.dirname(l.grype.base));
    await ensureDir(path.dirname(l.grype.head));

    const baseGrypeJson = await scanSbomWithGrype(tools.paths.grype, l.sbom.base, baseWorkdir);
    const headGrypeJson = await scanSbomWithGrype(tools.paths.grype, l.sbom.head, headWorkdir);

    // Guarda las salidas raw de Grype
    await writeFile(l.grype.base, Buffer.from(baseGrypeJson, 'utf8'));
    await writeFile(l.grype.head, Buffer.from(headGrypeJson, 'utf8'));

    core.info(`wrote Grype outputs -> ${l.grype.base} / ${l.grype.head}`);
    core.info(`Grype scans done`);

    // Escaneo con npm audit (solo para proyectos JavaScript o Mixed)
    await ensureDir(path.dirname(l.npm.base));
    await ensureDir(path.dirname(l.npm.head));
    await ensureDir(path.dirname(l.merged.base));
    await ensureDir(path.dirname(l.merged.head));

    if (projectType === 'javascript' || projectType === 'mixed') {
      try {
        await scanWithNpmAudit(baseWorkdir, l.npm.base);
        await scanWithNpmAudit(headWorkdir, l.npm.head);
        core.info(`npm audit scanning completed`);
      } catch (err) {
        core.warning(`[analysis] npm audit scanning failed: ${err.message || err}`);
        // Continúa sin fallar, el escaneo de Grype ya está hecho
      }
    } else {
      core.info(`Skipping npm audit for non-JavaScript project type: ${projectType}`);
      // Crear archivos vacíos para mantener la estructura
      await writeFile(l.npm.base, JSON.stringify({ vulnerabilities: [] }, null, 2));
      await writeFile(l.npm.head, JSON.stringify({ vulnerabilities: [] }, null, 2));
    }

    if (projectType === 'javascript' || projectType === 'mixed') {
      core.startGroup('[analysis] Running enhanced JavaScript scanners');

      try {
        const baseJsResults = await scanJavaScriptVulnerabilities(baseWorkdir, l.sbom.base);
        const headJsResults = await scanJavaScriptVulnerabilities(headWorkdir, l.sbom.head);

        // Persist to Phase-1 structure (same style as npm)
        await writeJson(path.join(path.dirname(l.npm.base), 'javascript.json'), baseJsResults);
        await writeJson(path.join(path.dirname(l.npm.head), 'javascript.json'), headJsResults);

        core.info(`JavaScript scanning: BASE=${baseJsResults.length}, HEAD=${headJsResults.length}`);
      } catch (err) {
        core.warning(`[analysis] JavaScript scanning failed: ${err.message || err}`);
      }

      core.endGroup();
    }


    // Fusiona los resultados de Grype y npm audit
    const baseMerged = await mergeVulnerabilities([l.grype.base, l.npm.base]);
    const headMerged = await mergeVulnerabilities([l.grype.head, l.npm.head]);

    // Guarda los resultados fusionados
    await writeFile(l.merged.base, JSON.stringify(baseMerged, null, 2));
    await writeFile(l.merged.head, JSON.stringify(headMerged, null, 2));

    core.info(`wrote merged outputs -> ${l.merged.base} / ${l.merged.head}`);
    core.info(`Vulnerability scanning done in ${stop()}`);

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
      projectType, // nuevo campo
    });
    core.info('[debug] metaPath: ' + l.meta);
    core.info('[debug] metaObj: ' + JSON.stringify(meta, null, 2));
    await writeMeta(l.meta, meta);
    core.info(`wrote meta.json -> ${l.meta}`);
    core.debug(`meta: ${JSON.stringify(meta, null, 2)}`);
    core.info(`metadata written in ${stop()}`);

    // Extract POM dependencies from each workdir and persist as JSON.
    core.endGroup();
    core.startGroup('[analysis] POM dependencies extraction & comparison');
    stop = time();

    // Comparar pom.xml archivo a archivo entre las dos ramas
    const pomDifferences = await comparePomDependencies(baseWorkdir, headWorkdir);

    core.info(`[analysis] Found ${pomDifferences.length} pom.xml differences`);
    if (pomDifferences.length > 0) {
      pomDifferences.slice(0, 10).forEach(diff => {
        const msg = diff.type === 'PROPERTY_CHANGED'
          ? `[${diff.type}] ${diff.pomFile}: ${diff.propertyName} (${diff.baseValue} -> ${diff.headValue})`
          : `[${diff.type}] ${diff.pomFile}: ${diff.groupId}:${diff.artifactId}`;
        core.info(`  ${msg}`);
      });
    }

    // Para mantener compatibility con el pipeline de normalización, extraer dependencias simples
    const basePomDeps = await extractPomDependencies(baseWorkdir);
    const headPomDeps = await extractPomDependencies(headWorkdir);


    await ensureDir(path.dirname(l.pom.base));
    await ensureDir(path.dirname(l.pom.head));
    await writeJson(l.pom.base, { dependencies: basePomDeps });
    await writeJson(l.pom.head, { dependencies: headPomDeps });
    core.info(`wrote pom deps -> ${l.pom.base} / ${l.pom.head}`);
    core.info(`POM dependencies extraction done in ${stop()}`);

    // Cleanup worktrees (non-fatal if fails).
    core.endGroup();
    core.startGroup('[analysis] Cleanup worktrees');
    stop = time();
    await Promise.all([
      cleanupWorktree(baseCheckout, repoRoot),
      cleanupWorktree(headCheckout, repoRoot),
    ]);
    core.info('[debug] Worktrees cleanup');
    core.info(`cleanup done in ${stop()}`);

    // Action outputs: expose resolved SHAs.
    core.endGroup();
    core.startGroup('[analysis] Outputs');
    core.setOutput('base_sha', baseSha);
    core.setOutput('head_sha', headSha);
    core.info(`outputs: base_sha=${baseSha}, head_sha=${headSha}`);
    core.info('[debug] Analysis finished');
  } catch (err) {
    core.error('[debug] Error caught in analysis: ' + (err?.stack || err));
    core.setFailed(`[analysis] failed: ${err?.message || err}`);
  } finally {
    core.endGroup();
  }
}

module.exports = { analysis };
