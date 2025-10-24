# Vulnerability Diff Action

[![CI](https://github.com/sec-open/vuln-diff-action/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sec-open/vuln-diff-action/actions/workflows/ci.yml)

GitHub Action to **compare vulnerabilities between two refs (branches, tags, commits)** using [Syft](https://github.com/anchore/syft) and [Grype](https://github.com/anchore/grype).

It generates an **SBOM (CycloneDX JSON)** for each ref, scans them with Grype, and produces a **vulnerability diff**:
- Markdown table (sorted by severity and labeled by branch)
- JSON payload with detailed results
- Counts of new, removed, and unchanged vulnerabilities
- Job summary with key metrics
- Optional artifact upload (SBOMs, scans, diff, reports)
- Optional PDF report with charts and graphs
- Optional reusable PR comment (auto-updated per run)
- Optional Slack notification when **new** vulnerabilities are introduced

---

## ✨ Features

- Detects new vulnerabilities introduced by a branch/PR
- Optional build step before scanning (e.g., `mvn package`)
- Minimum severity filter (`LOW | MEDIUM | HIGH | CRITICAL`)
- GitHub Summary + Outputs + downloadable artifacts
- Monorepo-ready via `path`
- Automatic SBOM: Maven CycloneDX (preferred) or Syft (fallback)
- Rich PDF report (cover, TOC, intro, summary, severity charts, diff table, dependency graphs, dependency paths)
- Reusable PR comment (single comment, updated on each run)
- Slack notification (Incoming Webhook) with severity-colored list

---

## 🚀 Usage Examples

### Compare two refs manually (workflow_dispatch)

    name: Manual Vulnerability Diff
    on:
      workflow_dispatch:
        inputs:
          base:
            description: "Base ref (e.g. develop)"
            required: true
          head:
            description: "Head ref (e.g. feature/x)"
            required: true

    jobs:
      vuln-diff:
        runs-on: ubuntu-24.04
        steps:
          - uses: actions/checkout@v4
            with:
              fetch-depth: 0

          - name: Vulnerability Diff
            uses: sec-open/vuln-diff-action@v1
            with:
              base_ref: ${{ inputs.base }}
              head_ref: ${{ inputs.head }}
              path: .
              build_command: ""              # usually not needed; see notes below
              min_severity: "LOW"
              write_summary: "true"
              upload_artifact: "true"
              report_pdf: "true"             # enable PDF report if you want it

### Pull request check (PR comment + Slack)

    name: Vulnerability Diff (PR)
    on:
      pull_request:
        types: [opened, synchronize, reopened]

    permissions:
      contents: read
      pull-requests: write   # needed for commenting on PRs

    jobs:
      vuln-diff-pr:
        runs-on: ubuntu-24.04
        steps:
          - name: Checkout PR head
            uses: actions/checkout@v4
            with:
              ref: ${{ github.event.pull_request.head.sha }}
              fetch-depth: 0
              fetch-tags: true

          - name: Ensure base branch is available
            run: |
              git fetch origin ${{ github.event.pull_request.base.ref }}:refs/remotes/origin/${{ github.event.pull_request.base.ref }} --tags --prune

          - name: Vulnerability Diff
            uses: sec-open/vuln-diff-action@v1
            with:
              base_ref: ${{ github.event.pull_request.base.ref }}
              head_ref: ${{ github.event.pull_request.head.sha }}   # exact commit of the PR
              path: .
              build_command: ""                                     # add if your reactor requires it
              min_severity: "LOW"
              write_summary: "true"
              upload_artifact: "true"
              report_pdf: "false"                                   # usually off for PR guard (faster)
              pr_comment: "true"
              github_token: ${{ secrets.GITHUB_TOKEN }}
              slack_webhook_url: ${{ secrets.SLACK_SECURITY_WEBHOOK_URL }}
              # slack_channel: "#security-alerts"                   # optional; only works if your webhook allows channel override

---

## ⚙️ Inputs

| Name                 | Required | Default                         | Description |
|----------------------|:--------:|---------------------------------|-------------|
| `base_ref`           | ✅       | –                               | Base ref (branch, tag, or commit SHA) to compare against. |
| `head_ref`           | ✅       | –                               | Head ref (branch, tag, or commit SHA) to compare. |
| `path`               | ❌       | `.`                             | Path to scan (relative to repo root). For Maven multimodule, point to the reactor root `pom.xml`. |
| `build_command`      | ❌       | `""`                            | Optional build command executed in each worktree **before** SBOM generation (e.g., `mvn -q -DskipTests package`). See notes below. |
| `min_severity`       | ❌       | `LOW`                           | Minimum severity to include (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`). |
| `write_summary`      | ❌       | `true`                          | Add a run summary with ref info, counts, and the diff table. |
| `upload_artifact`    | ❌       | `true`                          | Upload artifacts (SBOMs, scans, diff JSON, HTML/PDF reports). |
| `artifact_name`      | ❌       | `vuln-diff-artifacts`           | Custom artifact name. |
| `graph_max_nodes`    | ❌       | `150`                           | Max nodes for dependency graphs (to keep them readable). |
| `report_pdf`         | ❌       | `false`                         | Generate PDF report (cover, TOC, intro, summary, charts, graphs). |
| `setup_script`       | ❌       | `""`                            | Shell script run **inside each worktree** (BASE/HEAD) before build/SBOM (e.g., clone another repo and create symlinks). Env vars: `WORKTREE_ROLE`, `WORKTREE_DIR`, `REPOSITORY`, `BASE_LABEL`, `HEAD_LABEL`, `GITHUB_TOKEN`. |
| `pr_comment`         | ❌       | `false`                         | Create/update a single reusable PR comment with **NEW** vulnerabilities (or a “no new vulns” message). |
| `pr_comment_marker`  | ❌       | `<!-- vuln-diff-action:comment -->` | Hidden marker used to find/update the existing PR comment. |
| `github_token`       | ❌       | –                               | Token for PR comment (`secrets.GITHUB_TOKEN`). |
| `slack_webhook_url`  | ❌       | –                               | Slack Incoming Webhook URL (store it as a secret, e.g., `SLACK_SECURITY_WEBHOOK_URL`). |
| `slack_channel`      | ❌       | –                               | Optional channel override (e.g., `#security-alerts`). Many webhooks **ignore** overrides and always post to their configured channel. |

---

## 📤 Outputs

- `new_count` — number of **new** vulnerabilities introduced by `head_ref`.
- `removed_count` — number of vulnerabilities fixed (present in base, not in head).
- `unchanged_count` — number of vulnerabilities present in both refs (filtered by `min_severity`).
- `diff_markdown_table` — vulnerability diff table (Markdown).
- `diff_json` — JSON diff structure `{ news, removed, unchanged }`.
- `base_sha`, `head_sha` — resolved commit SHAs.
- `base_input`, `head_input` — raw user inputs for traceability.

---

## 🧩 How it works (high level)

1. Resolves `base_ref` and `head_ref` to SHAs.
2. Creates two **git worktrees** (BASE/HEAD) if needed.
3. Runs `setup_script` in each worktree (optional).
4. Runs `build_command` in each worktree (optional).
5. Generates SBOMs:
   - If a `pom.xml` is found at `path`, uses **CycloneDX Maven Plugin** (`makeAggregateBom`).
   - Otherwise, falls back to **Syft** directory scan.
6. Scans SBOMs with **Grype** and computes the diff (`new`, `removed`, `unchanged`).
7. Writes a job **summary** and (optionally) **artifacts**.
8. (Optional) Generates a **PDF report** (cover, TOC, intro, summary, dual pie charts, diff table, dependency graphs/paths).
9. (Optional) Upserts a **PR comment** (single comment, updated per run).
10. (Optional) Sends a **Slack notification** when there are **new** vulnerabilities (severity-colored list with links).

---

## 📄 Diff JSON Structure (v2.0.0)

El archivo `dist/diff.json` incluye ahora una sección adicional para dependencias declaradas explícitamente en `pom.xml`:

```jsonc
{
  // ...existing keys...
  "dependency_pom_diff": {
    "totals": { "NEW": 0, "REMOVED": 0, "UPDATED": 0, "UNCHANGED": 0 },
    "items": [
      { "groupId": "org.example", "artifactId": "lib", "baseVersion": "1.2.3", "headVersion": "1.3.0", "state": "UPDATED" },
      { "groupId": "org.foo", "artifactId": "bar", "headVersion": "2.0.0", "state": "NEW" },
      { "groupId": "org.old", "artifactId": "legacy", "baseVersion": "0.9.1", "state": "REMOVED" }
    ]
  }
}
```

Reglas de estado:
- `NEW`: aparece en head y no en base.
- `REMOVED`: existía en base y desaparece en head.
- `UPDATED`: mismo `groupId:artifactId` pero versión distinta.
- `UNCHANGED`: versión idéntica en ambos refs (no se muestra en tablas resumen HTML/PDF/Markdown).

La sección POM se deriva exclusivamente de dependencias directas declaradas (tras resolver `${property}`), sin inferir transitivas.

---

## 🧪 Notes & Tips

### On `build_command`
- In many Maven projects, you can leave it **empty** because the action already invokes the CycloneDX plugin to build an accurate dependency SBOM.
- Use it if:
  - You must activate profiles (e.g., `-Pprod`).
  - You need to resolve private repositories or custom settings.
  - You want Syft to analyze generated artifacts (e.g., shaded/uber JARs).

### On `setup_script`
- Useful when each worktree needs extra preparation (cloning another repo, creating symlinks, etc.).
- Runs **before** `build_command` and SBOM generation.

### On Slack
- Use a Slack **Incoming Webhook** and store the URL in a secret (e.g., `SLACK_SECURITY_WEBHOOK_URL`).
- The action posts **only when there are NEW vulnerabilities**.
- The message includes a severity-colored list with links (GHSA → GitHub Advisory, CVE → NVD).
- `slack_channel` override may be ignored depending on your webhook/workspace settings.

---

## 📄 License

Apache-2.0
