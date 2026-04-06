# CCR Review Action Setup

## 1. Local Development
Install dependencies and build the action:
```powershell
npm ci
npm test
npm run build
```

## 2. Customize Prompts
Edit the files in the `prompts/` directory to configure your architectures:
- `single-pass` (1 stage)
- `iterative` (6 sequential stages)
- `parallel` (6 parallel stages + 1 combine stage)

## 3. Sandbox Testing
Test your action locally using the built-in Sandbox UI:
```powershell
npm run dev
```
Open http://127.0.0.1:5173.

To test with a real LLM instead of the mock provider, set these environment variables first:
```powershell
$env:ASU_PROVIDER = "openai"
$env:ASU_API_KEY = "your-key"
$env:ASU_MODEL = "gpt5_2"
$env:ASU_BASE_URL = "https://api-main.aiml.asu.edu/queryV2"
```

## 4. GitHub Actions Integration
After building (`npm run build`) and releasing the code to a specific tag (e.g., `v1`), you can use it in other repositories:

```yaml
name: Review PR
on: pull_request
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

*Note: Ensure the `CREATEAI_API_KEY` secret is added to the repository's GitHub Actions settings.*