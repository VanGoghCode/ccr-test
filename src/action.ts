import path from "node:path";
import * as core from "@actions/core";
import { context } from "@actions/github";
import { createOpenAiCompatibleProviderConfig } from "./core/api.js";
import { runReviewArchitecture } from "./core/engine.js";
import {
  collectReviewContext,
  collectReviewFiles,
  resolveGitRange,
} from "./core/git.js";
import { publishInlineReview } from "./core/github-review.js";
import { buildInlineReviewComments } from "./core/inline-comments.js";
import { createOpenAiCompatibleProvider } from "./core/llm.js";
import { createLogger } from "./core/logging.js";
import { loadArchitectureById } from "./core/manifest.js";

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

function readBooleanInput(name: string, fallback: boolean): boolean {
  const raw = core.getInput(name);
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Input ${name} must be a boolean value.`);
}

function readOptionalInput(name: string): string | undefined {
  const value = core.getInput(name);
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

function getPullRequestNumber(): number | undefined {
  const pullRequest = context.payload.pull_request;
  if (!pullRequest || typeof pullRequest.number !== "number") {
    return undefined;
  }

  return pullRequest.number;
}

function getPullRequestHeadSha(): string | undefined {
  const pullRequest = context.payload.pull_request;
  if (
    !pullRequest ||
    !pullRequest.head ||
    typeof pullRequest.head.sha !== "string"
  ) {
    return undefined;
  }

  return pullRequest.head.sha;
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
    const postInlineComments = readBooleanInput("post-inline-comments", false);
    const inlineCommentLimit = readIntegerInput("inline-comment-limit", 10);
    const githubToken =
      readOptionalInput("github-token") ?? process.env.GITHUB_TOKEN;
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

    let inlineCommentsPosted = 0;
    let inlineCommentsSkipped = 0;

    if (postInlineComments) {
      const pullRequestNumber = getPullRequestNumber();
      if (!pullRequestNumber) {
        logger.warn(
          "Inline comment posting skipped because pull_request context is unavailable.",
        );
      } else if (!githubToken) {
        logger.warn(
          "Inline comment posting skipped because github-token input is not configured.",
        );
      } else {
        const inlineCommentResult = buildInlineReviewComments({
          findings: result.report.findings,
          files,
          maxComments: inlineCommentLimit,
        });
        inlineCommentsSkipped = inlineCommentResult.skippedCount;

        if (inlineCommentResult.comments.length === 0) {
          logger.warn(
            "Inline comment posting skipped because findings could not be mapped to changed lines.",
            {
              skippedByReason: inlineCommentResult.skippedByReason,
            },
          );
        } else {
          const owner = context.repo.owner;
          const repo = context.repo.repo;

          if (!owner || !repo) {
            logger.warn(
              "Inline comment posting skipped because repository metadata is unavailable.",
            );
          } else {
            const publishResult = await publishInlineReview({
              githubToken,
              owner,
              repo,
              pullNumber: pullRequestNumber,
              commitId: getPullRequestHeadSha(),
              comments: inlineCommentResult.comments,
              reviewBody: [
                "CCR inline review comments",
                "",
                `Architecture: ${result.report.architectureLabel}`,
                `Risk: ${result.report.riskLevel}`,
                `Summary: ${result.report.summary}`,
              ].join("\n"),
            });

            inlineCommentsPosted = publishResult.postedCount;
            logger.info("Inline review comments posted.", {
              postedCount: inlineCommentsPosted,
              skippedCount: inlineCommentsSkipped,
              reviewId: publishResult.reviewId,
            });
          }
        }
      }
    }

    core.setOutput("report-path", absoluteOutputPath);
    core.setOutput("summary", result.report.summary);
    core.setOutput("risk-level", result.report.riskLevel);
    core.setOutput("finding-count", String(result.report.findings.length));
    core.setOutput("architecture", result.report.architectureId);
    core.setOutput("inline-comments-posted", String(inlineCommentsPosted));
    core.setOutput("inline-comments-skipped", String(inlineCommentsSkipped));

    core.info(`CCR.md written to ${absoluteOutputPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}

await main();
