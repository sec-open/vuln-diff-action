# Vulnerability Diff Action

[![CI](https://github.com/sec-open/vuln-diff-action/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sec-open/vuln-diff-action/actions/workflows/ci.yml)

GitHub Action to **compare vulnerabilities between two refs (branches, tags, commits)** using [Syft](https://github.com/anchore/syft) and [Grype](https://github.com/anchore/grype).  

Generates an **SBOM (CycloneDX JSON)** for each ref, scans it with Grype, and produces a **diff of vulnerabilities**:
- Markdown table (sorted by severity)  
- JSON payload with detailed results  
- Counts of new, removed, and unchanged vulnerabilities  

---

## ✨ Features
- Detect new vulnerabilities introduced by a branch/PR  
- Optional build step before scanning (e.g., `mvn package`)  
- Filter vulnerabilities by minimum severity (`LOW|MEDIUM|HIGH|CRITICAL`)  
- Output as GitHub summary, workflow outputs, and downloadable artifact  
- Designed for multi-repo and monorepo setups (`path` input)  
- Future: GitHub PR comments, Checks API, and Slack notifications  

---

## 🚀 Usage

### Compare two refs manually

    name: Manual Vulnerability Diff

    on:
      workflow_dispatch:
        inputs:
          base:
            description: "Base ref (e.g. main)"
            required: true
            default: "develop"
          head:
            description: "Head ref (e.g. feature/x)"
            required: true
            default: "TASK-1234"

    jobs:
      vuln-diff:
        runs-on: ubuntu-24.04
        steps:
          - uses: actions/checkout@v4
            with: { fetch-depth: 0 }

          - name: Vulnerability Diff
            id: diff
            uses: sec-open/vuln-diff-action@v1
            with:
              base_ref: ${{ inputs.base }}
              head_ref: ${{ inputs.head }}
              build_command: ""   # usually leave empty
              min_severity: "LOW"
              write_summary: "true"

          - name: Outputs
            run: |
              echo "NEW=${{ steps.diff.outputs.new_count }}"
              echo "REMOVED=${{ steps.diff.outputs.removed_count }}"
              echo "UNCHANGED=${{ steps.diff.outputs.unchanged_count }}"

### Run automatically on pull requests

    on:
      pull_request:

    jobs:
      vuln-check:
        runs-on: ubuntu-24.04
        steps:
          - uses: actions/checkout@v4
            with:
              ref: ${{ github.head_ref }}
              fetch-depth: 0
              fetch-tags: true

          - name: Fetch base branch
            run: |
              git fetch origin ${{ github.base_ref }}:refs/remotes/origin/${{ github.base_ref }}

          - name: Vulnerability Diff
            id: diff
            uses: sec-open/vuln-diff-action@v1
            with:
              base_ref: ${{ github.base_ref }}
              head_ref: ${{ github.head_ref }}
              build_command: ""   # usually leave empty
              min_severity: "LOW"
              write_summary: "true"

---

## ⚙️ Inputs

| Name            | Required | Default | Description |
|-----------------|----------|---------|-------------|
| `base_ref`      | ✅       | –       | Base branch or commit SHA to compare against. |
| `head_ref`      | ✅       | –       | Head branch or commit SHA to compare. |
| `path`          | ❌       | `.`     | Directory to scan for SBOM. |
| `build_command` | ❌       | `""`    | Optional build command executed before SBOM generation (see note below). |
| `min_severity`  | ❌       | `LOW`   | Minimum severity to report (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`). |
| `write_summary` | ❌       | `true`  | Whether to write a job summary with the vulnerability diff. |

### Note on `build_command`

Normally you can leave `build_command` **empty**. The action already runs the CycloneDX Maven plugin to produce an accurate dependency SBOM without compiling.  
You may want to use `build_command` only in special cases, for example:

- To activate Maven profiles (`mvn -Pprod ...`) required for dependency resolution.  
- To build non-Maven modules so that Syft can analyze generated artifacts (e.g., JARs in `target/`).  
- To produce shaded/uber JARs that you specifically want to scan with Syft.  

For most projects, **no build step is needed**.

---

## 📤 Outputs

- `diff_markdown_table` – Vulnerability diff in Markdown format.  
- `diff_json` – JSON diff object.  
- `new_count`, `removed_count`, `unchanged_count`.  
- `base_sha`, `head_sha` – Resolved commit SHAs.  
- `base_input`, `head_input` – Raw inputs provided.  

---

## 📄 License

[Apache-2.0](LICENSE)
