const fsp = require('fs/promises');

/**
 * Merge vulnerabilities from multiple sources (Grype, npm audit, etc.)
 * into a single unified output.
 *
 * @param {string[]} inputPaths - Array of paths to vulnerability JSON files
 * @returns {Promise<Object>} - Merged vulnerabilities object
 */
async function mergeVulnerabilities(inputPaths) {
  const allVulnerabilities = [];
  const allMatches = [];

  for (const inputPath of inputPaths) {
    try {
      const content = await fsp.readFile(inputPath, 'utf8');
      const data = JSON.parse(content);
      if (data && data.vulnerabilities) {
        allVulnerabilities.push(...data.vulnerabilities);
      }
      if (data && data.matches) {
        allMatches.push(...data.matches);
      }
    } catch (err) {
      // Log but don't fail if one source is missing or empty
      console.warn(`Warning: Could not read vulnerabilities from ${inputPath}: ${err.message}`);
    }
  }

  // Return merged structure compatible with Grype format
  return {
    vulnerabilities: allVulnerabilities,
    matches: allMatches,
  };
}

module.exports = { mergeVulnerabilities };


