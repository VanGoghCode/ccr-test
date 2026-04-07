import { parseReviewModelOutput, renderReviewMarkdown } from "./report.js";
import type {
  LoadedPromptArchitecture,
  ReviewLogger,
  ReviewProvider,
  ReviewProviderMessage,
  ReviewProviderResult,
  ReviewRequest,
  ReviewRunResult,
  ReviewTokenUsage,
  StageExecutionResult,
} from "./types.js";

const PARALLEL_STAGE_LAUNCH_GAP_MS = 1000;
const DEFAULT_INPUT_COST_PER_1M_USD = Number(
  process.env.CCR_EST_INPUT_COST_PER_1M_USD ?? "5",
);
const DEFAULT_OUTPUT_COST_PER_1M_USD = Number(
  process.env.CCR_EST_OUTPUT_COST_PER_1M_USD ?? "15",
);

function waitForDelay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n... [truncated ${value.length - limit} characters]`;
}

function tryParseJson(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function buildRequestEnvelope(
  request: ReviewRequest,
  previousOutputs: string[],
  stageIndex: number,
  stageCount: number,
  maxContextChars: number,
): string {
  const fileBudget = Math.max(
    500,
    Math.floor(maxContextChars / Math.max(request.files.length * 2, 1)),
  );
  const previousOutputBudget = Math.max(500, Math.floor(maxContextChars / 4));
  const commitMessageBudget = Math.max(120, Math.floor(maxContextChars / 10));
  const reviewContext = request.context
    ? {
        ...request.context,
        metadata: request.context.metadata
          ? truncateText(request.context.metadata, previousOutputBudget)
          : undefined,
        commitMessages: request.context.commitMessages?.map((message) =>
          truncateText(message, commitMessageBudget),
        ),
      }
    : undefined;

  return JSON.stringify(
    {
      reviewContext,
      stageIndex,
      stageCount,
      architectureId: request.architectureId,
      files: request.files.map((file) => ({
        path: file.path,
        previousPath: file.previousPath,
        name: file.name,
        status: file.status,
        language: file.language,
        content: truncateText(file.content, fileBudget),
        patch: file.patch ? truncateText(file.patch, fileBudget) : undefined,
      })),
      previousOutputs: previousOutputs.map((output) =>
        truncateText(output, previousOutputBudget),
      ),
      previousOutputsParsed: previousOutputs.map((output) =>
        tryParseJson(output),
      ),
    },
    null,
    2,
  );
}

function buildSystemMessage(
  architecture: LoadedPromptArchitecture,
  stageLabel: string,
  stagePurpose: string,
  mode: string,
): string {
  return [
    "You are CCR, a code review engine that must return valid JSON only.",
    `Architecture: ${architecture.label} (${architecture.id}).`,
    `Mode: ${mode}.`,
    `Current stage: ${stageLabel}.`,
    `Stage purpose: ${stagePurpose}.`,
    "Return a JSON object with the following keys: summary, riskLevel, findings, todos, notes.",
    "Risk level must be one of low, medium, or high.",
    "Findings should be an array of objects with severity, title, detail, optional file, optional line, optional endLine, and optional recommendation or suggestion fields.",
    "When a finding maps to a changed file, set file and line to an exact changed-line anchor in the head revision.",
    "When a finding spans a changed block, set line to the first changed line and endLine to the last changed line in that block.",
    "Use reviewContext.commitMessages to understand intent and flag mismatches between commit intent and code changes.",
    "Keep detail and recommendation concise so each finding can be posted as a short inline review comment.",
    "If previousOutputsParsed is present, use it as the authoritative previous-stage context to avoid escaped JSON artifacts.",
    "Do not wrap the JSON in Markdown fences.",
  ].join("\n");
}

function createMessages(params: {
  architecture: LoadedPromptArchitecture;
  stageIndex: number;
  stageCount: number;
  stageLabel: string;
  stagePurpose: string;
  promptText: string;
  request: ReviewRequest;
  previousOutputs: string[];
  mode: string;
  maxContextChars: number;
}): ReviewProviderMessage[] {
  const messages: ReviewProviderMessage[] = [
    {
      role: "system",
      content: buildSystemMessage(
        params.architecture,
        params.stageLabel,
        params.stagePurpose,
        params.mode,
      ),
    },
  ];

  if (params.promptText.trim().length > 0) {
    messages.push({
      role: "system",
      content: params.promptText.trim(),
    });
  }

  messages.push({
    role: "user",
    content: buildRequestEnvelope(
      params.request,
      params.previousOutputs,
      params.stageIndex,
      params.stageCount,
      params.maxContextChars,
    ),
  });

  return messages;
}

function estimateTokensFromText(value: string): number {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

function normalizeUsage(
  usage: Partial<ReviewTokenUsage> | undefined,
  messages: ReviewProviderMessage[],
  output: string,
): ReviewTokenUsage {
  const fallbackPromptTokens = estimateTokensFromText(
    messages.map((message) => message.content).join("\n\n"),
  );
  const fallbackCompletionTokens = estimateTokensFromText(output);

  const promptTokens =
    typeof usage?.promptTokens === "number" &&
    Number.isFinite(usage.promptTokens)
      ? Math.max(0, Math.round(usage.promptTokens))
      : fallbackPromptTokens;
  const completionTokens =
    typeof usage?.completionTokens === "number" &&
    Number.isFinite(usage.completionTokens)
      ? Math.max(0, Math.round(usage.completionTokens))
      : fallbackCompletionTokens;
  const totalTokens =
    typeof usage?.totalTokens === "number" && Number.isFinite(usage.totalTokens)
      ? Math.max(0, Math.round(usage.totalTokens))
      : promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function estimateCostUsd(usage: ReviewTokenUsage): number {
  const inputCost =
    (usage.promptTokens / 1_000_000) * DEFAULT_INPUT_COST_PER_1M_USD;
  const outputCost =
    (usage.completionTokens / 1_000_000) * DEFAULT_OUTPUT_COST_PER_1M_USD;
  return Number((inputCost + outputCost).toFixed(6));
}

function normalizeProviderResult(
  rawResult: string | ReviewProviderResult,
  messages: ReviewProviderMessage[],
): {
  output: string;
  usage: ReviewTokenUsage;
  estimatedCostUsd: number;
} {
  if (typeof rawResult === "string") {
    const usage = normalizeUsage(undefined, messages, rawResult);
    return {
      output: rawResult,
      usage,
      estimatedCostUsd: estimateCostUsd(usage),
    };
  }

  const output = rawResult.output;
  const usage = normalizeUsage(rawResult.usage, messages, output);
  return {
    output,
    usage,
    estimatedCostUsd:
      typeof rawResult.estimatedCostUsd === "number" &&
      Number.isFinite(rawResult.estimatedCostUsd)
        ? Number(rawResult.estimatedCostUsd.toFixed(6))
        : estimateCostUsd(usage),
  };
}

function aggregateRunMetrics(
  startedAtMs: number,
  stageOutputs: StageExecutionResult[],
) {
  const usage = stageOutputs.reduce<ReviewTokenUsage>(
    (current, stage) => ({
      promptTokens: current.promptTokens + stage.usage.promptTokens,
      completionTokens: current.completionTokens + stage.usage.completionTokens,
      totalTokens: current.totalTokens + stage.usage.totalTokens,
    }),
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  );

  const estimatedCostUsd = Number(
    stageOutputs
      .reduce((current, stage) => current + stage.estimatedCostUsd, 0)
      .toFixed(6),
  );

  return {
    durationMs: Math.max(0, Date.now() - startedAtMs),
    usage,
    estimatedCostUsd,
  };
}

async function executeStage(params: {
  architecture: LoadedPromptArchitecture;
  stageIndex: number;
  stageCount: number;
  stage: LoadedPromptArchitecture["stages"][number];
  request: ReviewRequest;
  previousOutputs: string[];
  provider: ReviewProvider;
  logger: ReviewLogger;
  mode: string;
  maxContextChars: number;
}): Promise<StageExecutionResult> {
  const messages = createMessages({
    architecture: params.architecture,
    stageIndex: params.stageIndex,
    stageCount: params.stageCount,
    stageLabel: params.stage.label,
    stagePurpose: params.stage.purpose,
    promptText: params.stage.promptText,
    request: params.request,
    previousOutputs: params.previousOutputs,
    mode: params.mode,
    maxContextChars: params.maxContextChars,
  });

  params.logger.info("Executing review stage", {
    stageId: params.stage.id,
    stageLabel: params.stage.label,
    stageIndex: params.stageIndex,
    stageNumber: params.stageIndex + 1,
    stageCount: params.stageCount,
    stageStatus: "started",
    mode: params.mode,
    promptMessages: messages, // Log exact prompt sent to LLM
  });

  const stageStartedAtMs = Date.now();
  const rawResult = await params.provider.review({
    architecture: params.architecture,
    stage: params.stage,
    stageIndex: params.stageIndex,
    messages,
    request: params.request,
    previousOutputs: params.previousOutputs,
  });

  const normalized = normalizeProviderResult(rawResult, messages);
  const durationMs = Math.max(0, Date.now() - stageStartedAtMs);

  return {
    stageId: params.stage.id,
    label: params.stage.label,
    output: normalized.output,
    prompt: JSON.stringify(messages, null, 2),
    durationMs,
    usage: normalized.usage,
    estimatedCostUsd: normalized.estimatedCostUsd,
  };
}

export async function runReviewArchitecture(params: {
  architecture: LoadedPromptArchitecture;
  request: ReviewRequest;
  provider: ReviewProvider;
  logger: ReviewLogger;
  maxContextChars?: number;
}): Promise<ReviewRunResult> {
  const { architecture, request, provider, logger } = params;
  const runStartedAtMs = Date.now();
  const maxContextChars = params.maxContextChars ?? 12000;
  logger.info("Starting review run", {
    architectureId: architecture.id,
    mode: architecture.mode,
    fileCount: request.files.length,
  });

  const stageOutputs: StageExecutionResult[] = [];
  const stageCount =
    architecture.stages.length + (architecture.combineStage ? 1 : 0);

  if (architecture.mode === "single") {
    const finalStage = architecture.stages[0];
    const stageResult = await executeStage({
      architecture,
      stageIndex: 0,
      stageCount,
      stage: finalStage,
      request,
      previousOutputs: [],
      provider,
      logger,
      mode: architecture.mode,
      maxContextChars,
    });
    stageOutputs.push(stageResult);

    const modelOutput = parseReviewModelOutput(stageResult.output);
    const report = renderReviewMarkdown({
      architecture,
      request,
      modelOutput,
      stageOutputs,
      rawOutput: stageResult.output,
      prompt: stageResult.prompt,
    });

    logger.info("Review run completed", {
      architectureId: architecture.id,
      findingCount: report.findings.length,
      riskLevel: report.riskLevel,
    });

    return {
      report,
      stageOutputs,
      metrics: aggregateRunMetrics(runStartedAtMs, stageOutputs),
    } satisfies ReviewRunResult;
  }

  if (architecture.mode === "sequential") {
    let previousStageOutput: string | undefined;
    for (const [index, stage] of architecture.stages.entries()) {
      const result = await executeStage({
        architecture,
        stageIndex: index,
        stageCount,
        stage,
        request,
        previousOutputs: previousStageOutput ? [previousStageOutput] : [],
        provider,
        logger,
        mode: architecture.mode,
        maxContextChars,
      });
      stageOutputs.push(result);
      previousStageOutput = result.output;
    }

    const finalStageResult = stageOutputs.at(-1);
    if (!finalStageResult) {
      throw new Error(
        `Sequential architecture ${architecture.id} did not produce any stage output.`,
      );
    }

    const modelOutput = parseReviewModelOutput(finalStageResult.output);
    const report = renderReviewMarkdown({
      architecture,
      request,
      modelOutput,
      stageOutputs,
      rawOutput: finalStageResult.output,
      prompt: finalStageResult.prompt,
    });

    logger.info("Review run completed", {
      architectureId: architecture.id,
      findingCount: report.findings.length,
      riskLevel: report.riskLevel,
    });

    return {
      report,
      stageOutputs,
      metrics: aggregateRunMetrics(runStartedAtMs, stageOutputs),
    } satisfies ReviewRunResult;
  }

  const parallelStageOutputs = await Promise.all(
    architecture.stages.map(async (stage, index) => {
      const launchDelayMs = index * PARALLEL_STAGE_LAUNCH_GAP_MS;

      if (launchDelayMs > 0) {
        logger.info("Waiting before launching parallel stage", {
          stageId: stage.id,
          stageLabel: stage.label,
          stageIndex: index,
          stageNumber: index + 1,
          launchDelayMs,
        });
        await waitForDelay(launchDelayMs);
      }

      return executeStage({
        architecture,
        stageIndex: index,
        stageCount,
        stage,
        request,
        previousOutputs: [],
        provider,
        logger,
        mode: architecture.mode,
        maxContextChars,
      });
    }),
  );
  stageOutputs.push(...parallelStageOutputs);

  const combineStage = architecture.combineStage;
  if (!combineStage) {
    throw new Error(
      `Parallel architecture ${architecture.id} is missing a combine stage.`,
    );
  }

  const combineResult = await executeStage({
    architecture,
    stageIndex: architecture.stages.length,
    stageCount,
    stage: combineStage,
    request,
    previousOutputs: parallelStageOutputs.map((entry) => entry.output),
    provider,
    logger,
    mode: architecture.mode,
    maxContextChars,
  });
  stageOutputs.push(combineResult);

  const modelOutput = parseReviewModelOutput(combineResult.output);
  const report = renderReviewMarkdown({
    architecture,
    request,
    modelOutput,
    stageOutputs,
    rawOutput: combineResult.output,
    prompt: combineResult.prompt,
  });

  logger.info("Review run completed", {
    architectureId: architecture.id,
    findingCount: report.findings.length,
    riskLevel: report.riskLevel,
  });

  return {
    report,
    stageOutputs,
    metrics: aggregateRunMetrics(runStartedAtMs, stageOutputs),
  } satisfies ReviewRunResult;
}
