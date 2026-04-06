import * as github from "@actions/github";
import type { InlineReviewComment } from "./inline-comments.js";

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
  const response = await octokit.rest.pulls.createReview({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    event: "COMMENT",
    body: params.reviewBody,
    comments: params.comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: "RIGHT",
      body: comment.body,
    })),
    commit_id: params.commitId,
  });

  return {
    postedCount: params.comments.length,
    reviewId: response.data.id,
  };
}
