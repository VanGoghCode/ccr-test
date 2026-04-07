import { beforeEach, describe, expect, it, vi } from "vitest";

const { createReview, getOctokit, listReviewComments } = vi.hoisted(() => {
  const createReviewMock = vi.fn();
  const listReviewCommentsMock = vi.fn();
  const getOctokitMock = vi.fn(() => ({
    rest: {
      pulls: {
        createReview: createReviewMock,
        listReviewComments: listReviewCommentsMock,
      },
    },
  }));

  return {
    createReview: createReviewMock,
    getOctokit: getOctokitMock,
    listReviewComments: listReviewCommentsMock,
  };
});

vi.mock("@actions/github", () => ({
  getOctokit,
}));

import { publishInlineReview } from "../src/core/github-review";

describe("github review publisher", () => {
  beforeEach(() => {
    createReview.mockReset();
    listReviewComments.mockReset();
    listReviewComments.mockResolvedValue({ data: [] });
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
          startLine: 10,
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
        comments: [
          {
            path: "src/math.ts",
            line: 12,
            side: "RIGHT",
            start_line: 10,
            start_side: "RIGHT",
            body: "[HIGH] Guard overflow handling",
          },
        ],
      }),
    );
    expect(result).toEqual({
      postedCount: 1,
      reviewId: 42,
    });
  });

  it("skips posting when all inline comments already exist", async () => {
    listReviewComments.mockResolvedValue({
      data: [
        {
          path: "src/math.ts",
          line: 12,
          start_line: 10,
          body: "[HIGH] Guard overflow handling",
        },
      ],
    });

    const result = await publishInlineReview({
      githubToken: "token",
      owner: "octo",
      repo: "repo",
      pullNumber: 10,
      reviewBody: "CCR inline review comments",
      comments: [
        {
          path: "src/math.ts",
          line: 12,
          startLine: 10,
          body: "[HIGH] Guard overflow handling",
          severity: "high",
          title: "Guard overflow handling",
        },
      ],
    });

    expect(createReview).not.toHaveBeenCalled();
    expect(result).toEqual({ postedCount: 0 });
  });
});
