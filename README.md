Vulnerability Diff Action

GitHub Action to compare vulnerabilities between two refs (branches, tags, commits) using Syft
 and Grype
.

Generates an SBOM (CycloneDX JSON) for each ref, scans it with Grype, and produces a diff of vulnerabilities:

Markdown table (sorted by severity)

JSON payload with detailed results

Counts of new, removed, and unchanged vulnerabilities

✨ Features

Detect new vulnerabilities introduced by a branch/PR

Optional build step before scanning (e.g., mvn package)

Filter vulnerabilities by minimum severity (LOW|MEDIUM|HIGH|CRITICAL)

Output as GitHub summary, workflow outputs, and downloadable artifact

Designed for multi-repo and monorepo setups (path input)

Future: GitHub PR comments, Checks API, and Slack notifications

🚀 Usage
Compare two refs manually
name: Manual Vulnerability Diff

on:
  workflow_dispatch:
    inputs:
      base:
        description: "Base ref (e.g. main)"
        required: true
      head:
        description: "Head ref (e.g. feature/x)"
        required: true

jobs:
  vuln-diff:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - name: Vulnerability Diff
        id: diff
        uses: sec-open/vuln-diff-action@main
        with:
          base_ref: ${{ inputs.base }}
          head_ref: ${{ inputs.head }}
          build_command: "mvn -q -DskipTests package"
          min_severity: "LOW"
          write_summary: "true"

      - name: Outputs
        run: |
          echo "NEW=${{ steps.diff.outputs.new_count }}"
          echo "REMOVED=${{ steps.diff.outputs.removed_count }}"
          echo "UNCHANGED=${{ steps.diff.outputs.unchanged_count }}"

📥 Inputs
Name	Required	Default	Description
base_ref	✅	–	Base ref/branch/sha to compare against
head_ref	✅	–	Head ref/branch/sha to compare
path	❌	.	Subdirectory to scan (monorepo)
build_command	❌	""	Optional build command (e.g. mvn package)
min_severity	❌	LOW	Minimum severity to report (`LOW
write_summary	❌	true	Write Markdown table to GitHub Summary
📤 Outputs
Name	Description
new_count	Number of new vulnerabilities introduced
removed_count	Number of vulnerabilities removed
unchanged_count	Number of unchanged vulnerabilities
diff_markdown_table	Markdown table with Severity / VulnerabilityID / package:version / branches
diff_json	JSON diff payload
🛠️ Roadmap

 PR comments with new vulnerabilities

 GitHub Checks API integration

 Slack notifications (summary + snippet)

 Artifact upload with full vulnerability list

📄 License

Apache-2.0
 © 2025 sec-open
