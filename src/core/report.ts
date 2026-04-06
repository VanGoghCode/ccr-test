import { z } from "zod";
import type {
  LoadedPromptArchitecture,
  ReviewFinding,
  ReviewModelOutput,
  ReviewReport,
  ReviewRequest,
  StageExecutionResult,
} from "./types.js";

const findingSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  title: z.string().min(1),
  detail: z.string().min(1),
  file: z.string().optional(),
  recommendation: z.string().optional(),
});

const modelOutputSchema = z.object({
  summary: z.string().min(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  findings: z.array(findingSchema),
  todos: z.array(z.string().min(1)),
  notes: z.array(z.string().min(1)).optional(),
});

function markdownEscape(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function extractJsonCandidate(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}

export function parseReviewModelOutput(rawOutput: string): ReviewModelOutput {
  const candidate = extractJsonCandidate(rawOutput);
  try {
    return modelOutputSchema.parse(JSON.parse(candidate));
  } catch {
    return {
      summary:
        "The model response was not valid JSON, so the raw output is preserved in the report.",
      riskLevel: "medium",
      findings: [],
      todos: [
        "Review the raw model response and replace the prompt scaffolding with a stricter instruction set.",
      ],
      notes: [rawOutput.trim() || "The model response was empty."],
    } satisfies ReviewModelOutput;
  }
}

function formatFindings(findings: ReviewFinding[]): string {
  if (findings.length === 0) {
    return "No findings were returned by the review model.";
  }

  return findings
    .map((finding) => {
      const location = finding.file ? ` (${finding.file})` : "";
      const recommendation = finding.recommendation
        ? `\n  Recommendation: ${finding.recommendation}`
        : "";
      return `- [${finding.severity.toUpperCase()}] ${finding.title}${location}\n  ${finding.detail}${recommendation}`;
    })
    .join("\n");
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return "- None";
  }

  return values.map((value) => `- ${value}`).join("\n");
}

export function renderReviewMarkdown(params: {
  architecture: LoadedPromptArchitecture;
  request: ReviewRequest;
  modelOutput: ReviewModelOutput;
  stageOutputs: StageExecutionResult[];
  rawOutput: string;
  prompt: string;
}): ReviewReport {
  const {
    architecture,
    request,
    modelOutput,
    stageOutputs,
    rawOutput,
    prompt,
  } = params;
  const title = `CCR Review for ${architecture.label}`;
  const contextLines = [
    `- Architecture: ${architecture.label} (${architecture.id})`,
    `- Mode: ${architecture.mode}`,
    `- Files reviewed: ${request.files.length}`,
    request.context?.repositoryName
      ? `- Repository: ${request.context.repositoryName}`
      : undefined,
    request.context?.baseRef
      ? `- Base ref: ${request.context.baseRef}`
      : undefined,
    request.context?.headRef
      ? `- Head ref: ${request.context.headRef}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  const fileInventory = request.files
    .map((file) => {
      const label = file.status ? `${file.status} · ${file.path}` : file.path;
      return `- ${markdownEscape(label)}${file.previousPath ? ` (from ${markdownEscape(file.previousPath)})` : ""}`;
    })
    .join("\n");

  const stageTrail = stageOutputs
    .map(
      (stage) =>
        `- ${stage.label} (${stage.stageId}): ${stage.output.length} characters`,
    )
    .join("\n");

  const notes = modelOutput.notes ?? [];
  const markdown = [
    "# CCR.md",
    "",
    "### Prompt",
    prompt.trim() || "- No prompt recorded.",
    "",
    `## ${title}`,
    "",
    "### Summary",
    modelOutput.summary,
    "",
    "### Risk",
    modelOutput.riskLevel,
    "",
    "### Findings",
    formatFindings(modelOutput.findings),
    "",
    "### Follow-up TODOs",
    formatList(modelOutput.todos),
    "",
    "### Review Context",
    ...contextLines,
    "",
    "### Files in Scope",
    fileInventory || "- None",
    "",
    "### Stage Trail",
    stageTrail || "- No intermediate stage output recorded.",
    "",
    "### Notes",
    formatList(notes),
    "",
    "### Raw Output",
    "```json",
    rawOutput.trim(),
    "```",
  ].join("\n");

  return {
    title,
    summary: modelOutput.summary,
    riskLevel: modelOutput.riskLevel,
    findings: modelOutput.findings,
    todos: modelOutput.todos,
    notes,
    architectureId: architecture.id,
    architectureLabel: architecture.label,
    repositoryName: request.context?.repositoryName,
    fileCount: request.files.length,
    markdown,
    rawModelOutput: rawOutput,
  } satisfies ReviewReport;
}

export function toReviewModelOutput(report: ReviewReport): ReviewModelOutput {
  return {
    summary: report.summary,
    riskLevel: report.riskLevel,
    findings: report.findings,
    todos: report.todos,
    notes: report.notes.length > 0 ? report.notes : undefined,
  };
}
