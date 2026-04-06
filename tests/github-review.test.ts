import { beforeEach, describe, expect, it, vi } from "vitest";

const { createReview, getOctokit } = vi.hoisted(() => {
  const createReviewMock = vi.fn();
  const getOctokitMock = vi.fn(() => ({
    rest: {
      pulls: {
        createReview: createReviewMock,
      },
    },
  }));

  return {
    createReview: createReviewMock,
    getOctokit: getOctokitMock,
  };
});

vi.mock("@actions/github", () => ({
  getOctokit,
}));

import { publishInlineReview } from "../src/core/github-review";

describe("github review publisher", () => {
  beforeEach(() => {
    createReview.mockReset();
    getOctokit.mockClear();
  });

  it("returns zero when no comments are provided", async () => {
    const result = await publishInlineReview({
      githubToken: "token",
      owner: "octo",
      repo: "repo",
      pullNumber: 10,
      comments: [],
      reviewBody: "CCR inline review comments",
    });

    expect(result).toEqual({ postedCount: 0 });
    expect(getOctokit).not.toHaveBeenCalled();
  });

  it("posts a pull request review with inline comments", async () => {
    createReview.mockResolvedValue({
      data: {
        id: 42,
      },
    });

    const result = await publishInlineReview({
      githubToken: "token",
      owner: "octo",
      repo: "repo",
      pullNumber: 10,
      commitId: "abc123",
      reviewBody: "CCR inline review comments",
      comments: [
        {
          path: "src/math.ts",
          line: 12,
          body: "[HIGH] Guard overflow handling",
          severity: "high",
          title: "Guard overflow handling",
        },
      ],
    });

    expect(getOctokit).toHaveBeenCalledWith("token");
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "octo",
        repo: "repo",
        pull_number: 10,
        commit_id: "abc123",
        event: "COMMENT",
      }),
    );
    expect(result).toEqual({
      postedCount: 1,
      reviewId: 42,
    });
  });
});
