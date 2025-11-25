// src/scan/javascriptScanner.js
const { execSync } = require('child_process');
const { parseScannerOutput } = require('../../utils/scannerUtils');

/**
 * Run a shell command and return stdout as string.
 * If the command fails, logs the error and returns null.
 */
function runCommandSafe(label, command, options = {}) {
  try {
    console.log(`[JS Scanner] Running ${label}: ${command}`);
    const output = execSync(command, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }).toString();
    return output;
  } catch (err) {
    console.error(`[JS Scanner] ${label} failed:`, err.message || err);
    return null;
  }
}

/**
 * Scan JavaScript/Node.js vulnerabilities using multiple scanners.
 *
 * @param {string} repoPath - Path to the cloned repository.
 * @param {string} sbomPath - Path to the CycloneDX JSON SBOM.
 * @returns {Promise<Array>} - Array of normalized vulnerability objects
 *                             as returned by parseScannerOutput().
 */
async function scanJavaScriptVulnerabilities(repoPath, sbomPath) {
  const vulnerabilities = [];

  // 1) Install dependencies (needed for npm audit / yarn)
  const installCmd = 'npm install';
  const installOutput = runCommandSafe('npm install', installCmd, { cwd: repoPath });
  if (installOutput === null) {
    console.error('[JS Scanner] Aborting JS scan because dependencies could not be installed.');
    return vulnerabilities;
  }

  // 2) Define scanners we want to run
  //    Easy to extend in the future (retire.js, semgrep, etc.)
  const scanners = [
    {
      name: 'npm-audit',
      enabled: true,
      buildCommand: () => 'npm audit --json',
      cwd: repoPath,
    },
    {
      name: 'grype',
      enabled: !!sbomPath,
      buildCommand: () => `grype sbom:"${sbomPath}" -o json`,
    },
    {
      name: 'osv',
      enabled: !!sbomPath,
      buildCommand: () => `osv-scanner --sbom="${sbomPath}" --format json`,
    },
    {
      name: 'trivy',
      enabled: !!sbomPath,
      buildCommand: () => `trivy sbom --input "${sbomPath}" --format json`,
    },
  ];

  // 3) Run each enabled scanner
  for (const scanner of scanners) {
    if (!scanner.enabled) {
      console.log(`[JS Scanner] Skipping ${scanner.name} (disabled or missing prerequisites).`);
      continue;
    }

    const cmd = scanner.buildCommand();
    const output = runCommandSafe(scanner.name, cmd, scanner.cwd ? { cwd: scanner.cwd } : {});
    if (!output) {
      continue;
    }

    try {
      const parsed = parseScannerOutput(scanner.name, output);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`[JS Scanner] ${scanner.name} returned ${parsed.length} vulnerabilities.`);
        vulnerabilities.push(...parsed);
      } else {
        console.log(`[JS Scanner] ${scanner.name} returned no vulnerabilities.`);
      }
    } catch (parseErr) {
      console.error(`[JS Scanner] Failed to parse output from ${scanner.name}:`, parseErr);
    }
  }

  console.log('[JS Scanner] Total vulnerabilities found:', vulnerabilities.length);
  return vulnerabilities;
}

module.exports = { scanJavaScriptVulnerabilities };
