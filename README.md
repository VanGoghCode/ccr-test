# CCR Review Action

CCR Review is a reusable GitHub Action that reviews a PR-style change set, runs one of three configurable prompt architectures, and writes the resulting report to `CCR.md` in the repository root.

The repository also includes a local sandbox UI so you can test the action logic in the same repo before wiring it into a real project. The sandbox is development-only; the published action surface is still the Node 20 action defined in `action.yml`.

## What It Does

- Collects changed files from a PR or explicit git range.
- Feeds the file content and optional metadata into a shared review engine.
- Runs one of three architectures:
  - `single-pass`: one review call over the entire change set.
  - `iterative`: six shared sequential stages that refine the previous stage output.
  - `parallel`: the same six shared stages in parallel followed by a combine stage.
- Writes the final markdown report to `CCR.md` or a path you choose.
- Exposes outputs for the report path, summary, risk level, finding count, and architecture ID.

The prompt files are intentionally empty for now. The infrastructure is in place, and you can fill in the prompt bodies later without changing the orchestration code.

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
| `api-key` | Yes | - | API key for the OpenAI-compatible review provider. |
| `base-url` | No | `https://api.openai.com/v1` | Base URL for the chat completions endpoint. |
| `model` | Yes | - | Model name to use for the review. |
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

## Permissions

The action only needs repository contents read access.

```yaml
permissions:
  contents: read
```

When the action runs on pull request events, use `actions/checkout@v4` with `fetch-depth: 0` so the diff range can be resolved reliably.

## Example Workflow

```yaml
name: Review PR

on:
  pull_request:

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run CCR review
        uses: your-org/your-repo@v1
        with:
          api-key: ${{ secrets.CREATEAI_API_KEY }}
          base-url: https://platform.aiml.asu.edu/api
          model: gpt5_2
          architecture: parallel
          output-path: CCR.md
```

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

The sandbox defaults to the mock provider. To exercise the official ASU CreateAI OpenAI-compatible endpoint, set:

```bash
set ASU_PROVIDER=openai
set ASU_API_KEY=...
set ASU_MODEL=...
set ASU_BASE_URL=https://api-main.aiml.asu.edu/queryV2
```

For the CreateAI API model, use `ASU_MODEL=gpt5_2`.

The sandbox UI is at http://127.0.0.1:5173 and the backend API is on http://127.0.0.1:3030.

If you want to test the published action in a workflow, add these inputs in the workflow file and store the API key as a repository secret:

- Go to Repository settings, then Secrets and variables, then Actions.
- Add a secret such as CREATEAI_API_KEY.
- In the workflow, pass api-key: ${{ secrets.CREATEAI_API_KEY }}, base-url: https://platform.aiml.asu.edu/api, and model: gpt5_2.

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

- The action writes `CCR.md` only; it does not commit or comment on pull requests.
- The prompt bodies are empty on purpose right now so you can fill in the architecture content after the repository scaffold is in place.
- The sandbox and the action share the same engine so local tests mirror the publishable behavior.