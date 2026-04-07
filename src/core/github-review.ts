import * as github from "@actions/github";
import type { InlineReviewComment } from "./inline-comments.js";

function normalizePath(pathValue: string): string {
  return pathValue.trim().replaceAll("\\", "/").toLowerCase();
}

function normalizeCommentBody(body: string): string {
  return body.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function toCommentDedupeKey(comment: {
  path: string;
  line: number;
  startLine?: number;
  body: string;
}): string {
  const normalizedLine = Math.round(comment.line);
  const normalizedStartLine =
    typeof comment.startLine === "number" && comment.startLine < normalizedLine
      ? Math.round(comment.startLine)
      : normalizedLine;

  return [
    normalizePath(comment.path),
    String(normalizedStartLine),
    String(normalizedLine),
    normalizeCommentBody(comment.body),
  ].join(":");
}

export interface PublishInlineReviewParams {
  githubToken: string;
  owner: string;
  repo: string;
  pullNumber: number;
  comments: InlineReviewComment[];
  reviewBody: string;
  commitId?: string;
}

export interface PublishInlineReviewResult {
  postedCount: number;
  reviewId?: number;
}

export async function publishInlineReview(
  params: PublishInlineReviewParams,
): Promise<PublishInlineReviewResult> {
  if (params.comments.length === 0) {
    return {
      postedCount: 0,
    };
  }

  const octokit = github.getOctokit(params.githubToken);
  const existingCommentsResponse = await octokit.rest.pulls.listReviewComments({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    per_page: 100,
  });
  const existingCommentKeys = new Set<string>();
  for (const comment of existingCommentsResponse.data) {
    if (
      typeof comment.path !== "string" ||
      typeof comment.line !== "number" ||
      typeof comment.body !== "string"
    ) {
      continue;
    }

    existingCommentKeys.add(
      toCommentDedupeKey({
        path: comment.path,
        line: comment.line,
        startLine:
          typeof comment.start_line === "number"
            ? comment.start_line
            : undefined,
        body: comment.body,
      }),
    );
  }

  const commentsToPost = params.comments.filter(
    (comment) => !existingCommentKeys.has(toCommentDedupeKey(comment)),
  );

  if (commentsToPost.length === 0) {
    return {
      postedCount: 0,
    };
  }

  const response = await octokit.rest.pulls.createReview({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    event: "COMMENT",
    body: params.reviewBody,
    comments: commentsToPost.map((comment) => {
      const hasRange =
        typeof comment.startLine === "number" &&
        comment.startLine < comment.line;

      return {
        path: comment.path,
        line: comment.line,
        side: "RIGHT" as const,
        ...(hasRange
          ? {
              start_line: comment.startLine,
              start_side: "RIGHT" as const,
            }
          : {}),
        body: comment.body,
      };
    }),
    commit_id: params.commitId,
  });

  return {
    postedCount: commentsToPost.length,
    reviewId: response.data.id,
  };
}
