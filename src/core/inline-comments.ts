import { parseUnifiedDiffPatch, resolveChangedLine } from "./patch-map.js";
import type {
  ReviewFileInput,
  ReviewFinding,
  ReviewSeverity,
} from "./types.js";

const MAX_INLINE_TITLE_CHARS = 90;
const MAX_INLINE_DETAIL_CHARS = 220;
const MAX_INLINE_SUGGESTION_CHARS = 180;

const SEVERITY_PRIORITY: Record<ReviewSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const SKIP_REASON_KEYS = [
  "missing-file",
  "unmatched-file",
  "no-changed-lines",
  "unresolved-line",
  "duplicate",
] as const;

export type InlineCommentSkipReason = (typeof SKIP_REASON_KEYS)[number];

export interface InlineReviewComment {
  path: string;
  line: number;
  body: string;
  severity: ReviewSeverity;
  title: string;
}

export interface InlineCommentBuildOptions {
  findings: ReviewFinding[];
  files: ReviewFileInput[];
  maxComments: number;
  allowFallbackToFirstChangedLine?: boolean;
}

export interface InlineCommentBuildResult {
  comments: InlineReviewComment[];
  skippedCount: number;
  skippedByReason: Record<InlineCommentSkipReason, number>;
}

function createSkipCounter(): Record<InlineCommentSkipReason, number> {
  return {
    "missing-file": 0,
    "unmatched-file": 0,
    "no-changed-lines": 0,
    "unresolved-line": 0,
    duplicate: 0,
  };
}

function normalizePath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").trim().toLowerCase();
}

function clampText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function formatInlineCommentBody(finding: ReviewFinding): string {
  const lines = [
    `[${finding.severity.toUpperCase()}] ${clampText(finding.title.trim(), MAX_INLINE_TITLE_CHARS)}`,
    clampText(finding.detail.trim(), MAX_INLINE_DETAIL_CHARS),
  ];

  const recommendation = finding.recommendation ?? finding.suggestion;
  if (recommendation && recommendation.trim().length > 0) {
    lines.push(
      `Suggestion: ${clampText(recommendation.trim(), MAX_INLINE_SUGGESTION_CHARS)}`,
    );
  }

  return lines.join("\n");
}

function sortBySeverity(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((left, right) => {
    const priorityDelta =
      SEVERITY_PRIORITY[right.severity] - SEVERITY_PRIORITY[left.severity];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

function resolveFileRecord(
  findingFile: string,
  files: ReviewFileInput[],
): ReviewFileInput | undefined {
  const normalizedTarget = normalizePath(findingFile);

  const exact = files.find(
    (file) => normalizePath(file.path) === normalizedTarget,
  );
  if (exact) {
    return exact;
  }

  const suffixMatches = files.filter((file) => {
    const normalizedFilePath = normalizePath(file.path);
    return (
      normalizedFilePath.endsWith(`/${normalizedTarget}`) ||
      normalizedFilePath.endsWith(normalizedTarget)
    );
  });

  if (suffixMatches.length === 0) {
    return undefined;
  }

  return suffixMatches.sort(
    (left, right) => left.path.length - right.path.length,
  )[0];
}

export function buildInlineReviewComments(
  options: InlineCommentBuildOptions,
): InlineCommentBuildResult {
  const maxComments = Math.max(0, Math.floor(options.maxComments));
  const skippedByReason = createSkipCounter();

  if (maxComments === 0 || options.findings.length === 0) {
    return {
      comments: [],
      skippedCount: 0,
      skippedByReason,
    };
  }

  const patchCache = new Map<
    string,
    ReturnType<typeof parseUnifiedDiffPatch>
  >();
  const commentKeys = new Set<string>();
  const comments: InlineReviewComment[] = [];

  for (const finding of sortBySeverity(options.findings)) {
    if (comments.length >= maxComments) {
      break;
    }

    if (!finding.file || finding.file.trim().length === 0) {
      skippedByReason["missing-file"] += 1;
      continue;
    }

    const fileRecord = resolveFileRecord(finding.file, options.files);
    if (!fileRecord) {
      skippedByReason["unmatched-file"] += 1;
      continue;
    }

    const patchCacheKey = fileRecord.path;
    const patchMap =
      patchCache.get(patchCacheKey) ??
      parseUnifiedDiffPatch(fileRecord.patch ?? "");
    patchCache.set(patchCacheKey, patchMap);

    if (patchMap.changedLines.length === 0) {
      skippedByReason["no-changed-lines"] += 1;
      continue;
    }

    const resolvedLine = resolveChangedLine({
      patchMap,
      requestedLine: finding.line,
      searchText: `${finding.title}\n${finding.detail}`,
      allowFallbackToFirstChangedLine:
        options.allowFallbackToFirstChangedLine ?? true,
    });

    if (typeof resolvedLine !== "number") {
      skippedByReason["unresolved-line"] += 1;
      continue;
    }

    const dedupeKey = `${fileRecord.path}:${resolvedLine}:${finding.title.trim().toLowerCase()}`;
    if (commentKeys.has(dedupeKey)) {
      skippedByReason.duplicate += 1;
      continue;
    }

    commentKeys.add(dedupeKey);
    comments.push({
      path: fileRecord.path,
      line: resolvedLine,
      body: formatInlineCommentBody(finding),
      severity: finding.severity,
      title: finding.title,
    });
  }

  const skippedCount = Object.values(skippedByReason).reduce(
    (total, count) => total + count,
    0,
  );

  return {
    comments,
    skippedCount,
    skippedByReason,
  };
}
