import { parseReviewModelOutput, renderReviewMarkdown } from "./report";
import type {
  LoadedPromptArchitecture,
  ReviewLogger,
  ReviewProvider,
  ReviewProviderMessage,
  ReviewRequest,
  ReviewRunResult,
  StageExecutionResult,
} from "./types";

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n... [truncated ${value.length - limit} characters]`;
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
  const reviewContext = request.context
    ? {
        ...request.context,
        metadata: request.context.metadata
          ? truncateText(request.context.metadata, previousOutputBudget)
          : undefined,
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
    "Findings should be an array of objects with severity, title, detail, and optional file and recommendation fields.",
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

  const rawResult = await params.provider.review({
    architecture: params.architecture,
    stage: params.stage,
    stageIndex: params.stageIndex,
    messages,
    request: params.request,
    previousOutputs: params.previousOutputs,
  });

  const output = rawResult;

  return {
    stageId: params.stage.id,
    label: params.stage.label,
    output,
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
    });

    logger.info("Review run completed", {
      architectureId: architecture.id,
      findingCount: report.findings.length,
      riskLevel: report.riskLevel,
    });

    return {
      report,
      stageOutputs,
    } satisfies ReviewRunResult;
  }

  if (architecture.mode === "sequential") {
    const previousOutputs: string[] = [];
    for (const [index, stage] of architecture.stages.entries()) {
      const result = await executeStage({
        architecture,
        stageIndex: index,
        stageCount,
        stage,
        request,
        previousOutputs: [...previousOutputs],
        provider,
        logger,
        mode: architecture.mode,
        maxContextChars,
      });
      stageOutputs.push(result);
      previousOutputs.push(result.output);
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
    });

    logger.info("Review run completed", {
      architectureId: architecture.id,
      findingCount: report.findings.length,
      riskLevel: report.riskLevel,
    });

    return {
      report,
      stageOutputs,
    } satisfies ReviewRunResult;
  }

  const parallelStageOutputs = await Promise.all(
    architecture.stages.map((stage, index) =>
      executeStage({
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
      }),
    ),
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
  });

  logger.info("Review run completed", {
    architectureId: architecture.id,
    findingCount: report.findings.length,
    riskLevel: report.riskLevel,
  });

  return {
    report,
    stageOutputs,
  } satisfies ReviewRunResult;
}
