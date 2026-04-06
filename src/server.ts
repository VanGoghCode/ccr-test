import "dotenv/config";
import { access } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { readAsuAimlProviderConfig } from "./core/api.js";
import { runReviewArchitecture } from "./core/engine.js";
import { createAsuAimlProvider } from "./core/llm.js";
import { createLogger } from "./core/logging.js";
import {
  applyPromptOverrides,
  loadArchitectureById,
  loadAvailableArchitectures,
  validatePromptCoverage,
} from "./core/manifest.js";
import type { LogEntry, ReviewProvider, ReviewRequest } from "./core/types.js";

const repositoryRoot = process.cwd();
const promptRoot = process.env.PROMPT_ROOT || "prompts";
const port = Number.parseInt(process.env.PORT || "3030", 10);

function createProvider(): ReviewProvider {
  const providerMode = process.env.CCR_PROVIDER?.trim().toLowerCase() || "asu";
  if (providerMode !== "asu") {
    throw new Error(
      "Only ASU provider mode is supported. Set CCR_PROVIDER=asu.",
    );
  }

  return createAsuAimlProvider(readAsuAimlProviderConfig());
}

function readPromptOverrides(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      typeof entry[0] === "string" && typeof entry[1] === "string",
  );

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

const app = express();
export default app;
const clientBuildDir = path.resolve(repositoryRoot, "sandbox", "dist");

const provider = createProvider();

app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/architectures", async (_request, response, next) => {
  try {
    const architectures = await loadAvailableArchitectures(promptRoot);
    response.json({ architectures });
  } catch (error) {
    next(error);
  }
});

app.post("/api/review", async (request, response, next) => {
  try {
    const architectureId = String(
      request.body?.architectureId ?? "single-pass",
    );
    const files = Array.isArray(request.body?.files) ? request.body.files : [];
    const context =
      request.body?.context && typeof request.body.context === "object"
        ? request.body.context
        : undefined;
    const promptOverrides =
      readPromptOverrides(request.body?.promptOverrides) ??
      readPromptOverrides(request.body?.instructions);

    const architecture = applyPromptOverrides(
      await loadArchitectureById(promptRoot, architectureId),
      promptOverrides,
    );
    validatePromptCoverage(architecture);

    const capturedLogs: LogEntry[] = [];
    const logger = createLogger((entry) => {
      capturedLogs.push(entry);
    });

    const reviewRequest: ReviewRequest = {
      architectureId,
      files,
      context,
      promptOverrides,
    };

    const result = await runReviewArchitecture({
      architecture,
      request: reviewRequest,
      provider,
      logger,
      maxContextChars: 12000,
    });

    const promptEntry = [...capturedLogs]
      .reverse()
      .find((entry) => entry.details?.promptText);
    const sentPrompt =
      typeof promptEntry?.details?.promptText === "string"
        ? (promptEntry.details.promptText as string)
        : "";

    const rawModelOutput = result.stageOutputs.at(-1)?.output ?? "";

    response.json({
      report: result.report,
      sentPrompt,
      rawModelOutput,
      metrics: result.metrics,
    });
  } catch (error) {
    next(error);
  }
});

const hasClientBuild = await (async () => {
  try {
    await access(path.join(clientBuildDir, "index.html"));
    return true;
  } catch {
    return false;
  }
})();

if (hasClientBuild) {
  app.use(express.static(clientBuildDir));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(clientBuildDir, "index.html"));
  });
}

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = error instanceof Error ? error.message : String(error);
    response.status(500).json({ error: message });
  },
);

if (!process.env.VERCEL) {
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.info(`CCR server listening on http://127.0.0.1:${port}`);
  });

  server.timeout = 300000;
}
