import path from "node:path";
import * as core from "@actions/core";
import { context } from "@actions/github";
import { createOpenAiCompatibleProviderConfig } from "./core/api";
import { runReviewArchitecture } from "./core/engine";
import {
  collectReviewContext,
  collectReviewFiles,
  resolveGitRange,
} from "./core/git";
import { createOpenAiCompatibleProvider } from "./core/llm";
import { createLogger } from "./core/logging";
import { loadArchitectureById } from "./core/manifest";

function readCsvInput(name: string, fallback: string): string[] {
  const raw = core.getInput(name) || fallback;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readIntegerInput(name: string, fallback: number): number {
  const raw = core.getInput(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(`Input ${name} must be a positive integer.`);
  }

  return parsed;
}

function readFloatInput(name: string, fallback: number): number {
  const raw = core.getInput(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Input ${name} must be a number.`);
  }

  return parsed;
}

function buildProvider() {
  const apiKey = core.getInput("api-key", { required: true });
  const baseUrl = core.getInput("base-url") || "https://api.openai.com/v1";
  const model = core.getInput("model", { required: true });
  const temperature = readFloatInput("temperature", 0.2);
  const timeoutMs = readIntegerInput("request-timeout-ms", 120000);

  return createOpenAiCompatibleProvider(
    createOpenAiCompatibleProviderConfig({
      apiKey,
      baseUrl,
      model,
      temperature,
      timeoutMs,
    }),
  );
}

async function main(): Promise<void> {
  try {
    const promptRoot = core.getInput("prompt-root") || "prompts";
    const architectureId = core.getInput("architecture") || "single-pass";
    const outputPath = core.getInput("output-path") || "CCR.md";
    const includeGlobs = readCsvInput("include-globs", "**/*");
    const excludeGlobs = readCsvInput(
      "exclude-globs",
      "node_modules/**,dist/**,coverage/**,.git/**",
    );
    const maxFiles = readIntegerInput("max-files", 25);
    const maxContextChars = readIntegerInput("max-context-chars", 12000);
    const repoRoot = process.cwd();

    const logger = createLogger((entry) => {
      const details = entry.details ? ` ${JSON.stringify(entry.details)}` : "";
      const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${details}`;
      if (entry.level === "error") {
        core.error(line);
      } else if (entry.level === "warn") {
        core.warning(line);
      } else if (entry.level === "debug") {
        core.debug(line);
      } else {
        core.info(line);
      }
    });

    const architecture = await loadArchitectureById(promptRoot, architectureId);
    const reviewContext = await collectReviewContext(repoRoot, {
      repositoryName:
        context.repo.owner && context.repo.repo
          ? `${context.repo.owner}/${context.repo.repo}`
          : undefined,
      metadata: core.getInput("metadata") || undefined,
      baseRef: core.getInput("base-ref") || undefined,
      headRef: core.getInput("head-ref") || undefined,
    });
    const gitRange = await resolveGitRange(repoRoot, reviewContext, "HEAD");
    const files = await collectReviewFiles({
      repositoryRoot: repoRoot,
      range: gitRange,
      includeGlobs,
      excludeGlobs,
      maxFiles,
      repositoryName: reviewContext.repositoryName,
    });

    if (files.length === 0) {
      logger.warn("No files matched the review filters.");
    }

    const provider = buildProvider();
    const result = await runReviewArchitecture({
      architecture,
      request: {
        architectureId: architecture.id,
        files,
        context: reviewContext,
      },
      provider,
      logger,
      maxContextChars,
    });

    const absoluteOutputPath = path.resolve(repoRoot, outputPath);
    await core.summary.addRaw(result.report.markdown).write();

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, result.report.markdown, "utf8");

    core.setOutput("report-path", absoluteOutputPath);
    core.setOutput("summary", result.report.summary);
    core.setOutput("risk-level", result.report.riskLevel);
    core.setOutput("finding-count", String(result.report.findings.length));
    core.setOutput("architecture", result.report.architectureId);

    core.info(`CCR.md written to ${absoluteOutputPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}

await main();
