export type ArchitectureMode = "single" | "sequential" | "parallel";

export type ReviewSeverity = "low" | "medium" | "high";

export interface ReviewFileInput {
  path: string;
  name: string;
  content: string;
  status?:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "copied"
    | "untracked";
  language?: string;
  patch?: string;
  previousPath?: string;
}

export interface ReviewContext {
  repositoryName?: string;
  metadata?: string;
  baseRef?: string;
  headRef?: string;
}

export interface ReviewRequest {
  architectureId: string;
  files: ReviewFileInput[];
  context?: ReviewContext;
  promptOverrides?: Record<string, string>;
}

export interface PromptStageManifest {
  id: string;
  label: string;
  purpose: string;
  promptPath: string;
}

export interface PromptArchitectureManifest {
  id: string;
  label: string;
  description: string;
  mode: ArchitectureMode;
  stages: PromptStageManifest[];
  combineStage?: PromptStageManifest;
}

export interface LoadedPromptStage extends PromptStageManifest {
  promptText: string;
}

export interface LoadedPromptArchitecture
  extends Omit<PromptArchitectureManifest, "stages" | "combineStage"> {
  stages: LoadedPromptStage[];
  combineStage?: LoadedPromptStage;
}

export interface ReviewFinding {
  severity: ReviewSeverity;
  title: string;
  detail: string;
  file?: string;
  line?: number;
  endLine?: number;
  recommendation?: string;
  suggestion?: string;
}

export interface ReviewModelOutput {
  summary: string;
  riskLevel: ReviewSeverity;
  findings: ReviewFinding[];
  todos: string[];
  notes?: string[];
}

export interface ReviewReport {
  title: string;
  summary: string;
  riskLevel: ReviewSeverity;
  findings: ReviewFinding[];
  todos: string[];
  notes: string[];
  architectureId: string;
  architectureLabel: string;
  repositoryName?: string;
  fileCount: number;
  markdown: string;
  rawModelOutput?: string;
}

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  details?: Record<string, unknown>;
}

export type LogSink = (entry: LogEntry) => void;

export interface ReviewLogger {
  log(entry: LogEntry): void;
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export interface ReviewProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ReviewProviderRequest {
  architecture: LoadedPromptArchitecture;
  stage: PromptStageManifest | LoadedPromptStage;
  stageIndex: number;
  messages: ReviewProviderMessage[];
  request: ReviewRequest;
  previousOutputs: string[];
}

export interface ReviewTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ReviewProviderResult {
  output: string;
  usage?: Partial<ReviewTokenUsage>;
  estimatedCostUsd?: number;
}

export interface ReviewProvider {
  review(input: ReviewProviderRequest): Promise<string | ReviewProviderResult>;
}

export interface StageExecutionResult {
  stageId: string;
  label: string;
  output: string;
  prompt: string;
  durationMs: number;
  usage: ReviewTokenUsage;
  estimatedCostUsd: number;
}

export interface ReviewRunMetrics {
  durationMs: number;
  usage: ReviewTokenUsage;
  estimatedCostUsd: number;
}

export interface ReviewRunResult {
  report: ReviewReport;
  stageOutputs: StageExecutionResult[];
  metrics: ReviewRunMetrics;
}
