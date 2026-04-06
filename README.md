# CCR Review Action

CCR Review is a reusable GitHub Action that reviews a PR-style change set, runs one of three configurable prompt architectures, and writes the resulting report to `CCR.md` in the repository root.

The repository also includes a local sandbox UI so you can test the action logic in the same repo before wiring it into a real project. The sandbox is development-only; the published action surface is still the Node 20 action defined in `action.yml`.

## What It Does

- Collects changed files from a PR or explicit git range.
- Feeds changed file content, git range context, and commit messages into a shared review engine.
- Runs one of three architectures:
  - `single-pass`: one review call over the entire change set.
  - `iterative`: six shared sequential stages that refine the previous stage output.
  - `parallel`: the same six shared stages in parallel followed by a combine stage.
- Writes the final markdown report to `CCR.md` or a path you choose.
- Optionally posts short inline pull request review comments on mapped changed lines.
- Exposes outputs for report path, summary, risk level, finding count, architecture ID, and inline comment counts.

Prompt files are part of this repository and are bundled with each action release tag.

## Where To Set Up Prompts

Edit these files to define the review behavior:

- [prompts/architectures/single-pass/manifest.json](prompts/architectures/single-pass/manifest.json) to control the single-pass architecture shape.
- [prompts/architectures/iterative/manifest.json](prompts/architectures/iterative/manifest.json) to control the six-stage iterative pipeline.
- [prompts/architectures/parallel/manifest.json](prompts/architectures/parallel/manifest.json) to control the six-stage parallel pipeline and its final combiner.
- [prompts/architectures/single-pass/prompt.md](prompts/architectures/single-pass/prompt.md) for the single-pass prompt body.
- [prompts/shared/stages/stage-1.md](prompts/shared/stages/stage-1.md) through [prompts/shared/stages/stage-6.md](prompts/shared/stages/stage-6.md) for the shared iterative and parallel stages.
- [prompts/architectures/parallel/combine.md](prompts/architectures/parallel/combine.md) for the final parallel merge prompt.

The action reads these prompts from the bundled action path in GitHub Actions, so consumers do not need to copy the prompts into their own repository.

## Why Use It

- You want a reusable review action with a publishable GitHub Action package.
- You want to compare multiple prompt architectures against the same sample change set.
- You want a local UI that lets you change file inputs, context, and architecture before the action is wired into a live repository.

## Inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `api-key` | Yes | - | API key for the ASU AIML review provider. |
| `base-url` | No | `https://api-main.aiml.asu.edu/queryV2` | Base URL for the ASU AIML query endpoint. |
| `model-provider` | No | - | Optional ASU model provider identifier included in query requests. |
| `model` | Yes | - | ASU model name to use for the review. |
| `github-token` | No | - | GitHub token used to publish inline PR comments when enabled. |
| `post-inline-comments` | No | `false` | Whether to publish short inline comments on changed lines in pull requests. |
| `inline-comment-limit` | No | `10` | Maximum number of inline comments posted per run. |
| `architecture` | No | `single-pass` | Which architecture manifest to run. |
| `prompt-root` | No | `prompts` | Directory containing the architecture manifests and prompt files. |
| `output-path` | No | `CCR.md` | Where the final markdown report should be written. |
| `base-ref` | No | inferred from the PR event or `HEAD~1` | Base git ref for the diff. |
| `head-ref` | No | inferred from the PR event or `HEAD` | Head git ref for the diff. |
| `include-globs` | No | `**/*` | Comma-separated list of included paths. |
| `exclude-globs` | No | `node_modules/**,dist/**,coverage/**,.git/**` | Comma-separated list of excluded paths. |
| `max-files` | No | `25` | Maximum number of changed files to include. |
| `max-context-chars` | No | `12000` | Total prompt payload budget used to truncate file context. |
| `temperature` | No | `0.2` | Sampling temperature for the model request. |
| `request-timeout-ms` | No | `120000` | Timeout for the model request. |

## Outputs

| Output | Meaning |
| --- | --- |
| `report-path` | Absolute or workspace-relative path to the generated `CCR.md` file. |
| `summary` | Concise summary extracted from the final review output. |
| `risk-level` | Final risk level returned by the review. |
| `finding-count` | Number of findings in the generated report. |
| `architecture` | Architecture ID that ran for the review. |
| `inline-comments-posted` | Number of inline comments posted on the pull request. |
| `inline-comments-skipped` | Number of findings skipped during inline comment mapping. |

## Permissions

Minimum permission for report generation:

```yaml
permissions:
  contents: read
```

If you enable inline PR comments, add pull request write permission:

```yaml
permissions:
  contents: read
  pull-requests: write
```

When the action runs on pull request events, use `actions/checkout@v4` with `fetch-depth: 0` so the diff range can be resolved reliably.

## Example Workflow

```yaml
name: CCR Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run CCR review
        uses: your-org/your-repo@v1
        with:
          api-key: ${{ secrets.ASU_API_KEY }}
          github-token: ${{ github.token }}
          base-url: https://api-main.aiml.asu.edu/queryV2
          model-provider: provider-id
          model: gpt5_2
          architecture: parallel
          post-inline-comments: "true"
          inline-comment-limit: "10"
          output-path: CCR.md

      - name: Upload CCR report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ccr-report-${{ github.run_id }}
          path: CCR.md
          if-no-files-found: ignore
```

## Quick Setup In Any Repository

1. Add the workflow shown above at `.github/workflows/ccr-review.yml`.
2. Set `uses` to the published action tag, for example `your-org/your-repo@v1`.
3. Add a repository secret named `ASU_API_KEY`.
4. Open a PR and verify `CCR.md` is generated in the workflow artifact.

## Common Customizations

Change these `with` inputs in the workflow:

- `architecture`: `single-pass` | `iterative` | `parallel`
- `model`: set your preferred model name
- `base-url`: set your ASU AIML endpoint
- `model-provider`: set your ASU provider identifier when required
- `post-inline-comments`: `true` to publish short line-level PR comments
- `inline-comment-limit`: cap inline comments per run
- `output-path`: change review report output file
- `include-globs` / `exclude-globs`: limit reviewed files
- `max-files` / `max-context-chars`: control payload size
- `temperature` / `request-timeout-ms`: tune model behavior and timeout

## Prompt Source Options

- Default: use prompts bundled inside this action release.
- Repository-specific prompts: keep the same prompt/manifest structure in the repository where the workflow runs and set an absolute prompt root.

```yaml
with:
  prompt-root: ${{ github.workspace }}/.github/ccr-prompts
```

Relative `prompt-root` resolves inside the action package path. Use absolute path for repository-local prompt folders.

## Sandbox UI

The sandbox lives in the same repo and gives you a local review harness before you publish or integrate the action.

- `F1`: add or remove PR-like file sets with file name, file path, and sample code.
- `F2`: add optional metadata or context.
- `F3`: switch the architecture for the whole run.
- `F4`: inspect the exact `CCR.md` markdown output.
- `F5`: follow backend logs as the review runs.

Run it locally with:

```bash
npm ci
npm run dev
```

The sandbox backend supports ASU provider mode. Set:

```bash
set CCR_PROVIDER=asu
set ASU_API_KEY=...
set ASU_MODEL=gpt5_2
set ASU_BASE_URL=https://api-main.aiml.asu.edu/queryV2
set ASU_MODEL_PROVIDER=provider-id
```

If your ASU tenant does not require an explicit model provider, omit `ASU_MODEL_PROVIDER`.

The sandbox UI is at http://127.0.0.1:5173 and the backend API is on http://127.0.0.1:3030.

If you move the prompt folder, set prompt-root in the action inputs to the new folder name or absolute path. The default prompt-root already points at the action’s bundled prompts.

## Build And Test

```bash
npm run build
npm test
npm run lint
npm run typecheck
```

## Release Guidance

1. Publish a versioned release tag, for example `v1.0.0`.
2. Move the major tag `v1` to the latest compatible `v1.x.y` release commit.
3. Ask consumers to pin either `@v1` for compatibility or a full commit SHA for maximum reproducibility.
4. Keep the committed `dist/index.js` in sync with the TypeScript source by rebuilding before each release.

## Notes

- The action always writes a markdown report (default `CCR.md`, configurable via `output-path`). Inline PR comments are optional and require `post-inline-comments: "true"` plus `pull-requests: write` permission.
- Update prompts in this repository and release a new tag when you want all repositories using this action to get new review behavior.
- The sandbox and the action share the same engine so local tests mirror the publishable behavior.