import { describe, expect, it } from "vitest";
import { buildInlineReviewComments } from "../src/core/inline-comments";
import type { ReviewFileInput, ReviewFinding } from "../src/core/types";

const files: ReviewFileInput[] = [
  {
    path: "src/math.ts",
    name: "math.ts",
    content:
      "export function sum(a, b) {\n  const total = a + b;\n  return total;\n}\n",
    patch: [
      "@@ -1,4 +1,5 @@",
      " export function sum(a, b) {",
      "-  return a - b;",
      "+  const total = a + b;",
      "+  return total;",
      " }",
    ].join("\n"),
  },
];

describe("inline comments", () => {
  it("maps findings to changed lines and formats short comments", () => {
    const findings: ReviewFinding[] = [
      {
        severity: "high",
        title: "Validate overflow handling",
        detail:
          "Ensure addition logic handles unexpected integer overflow boundaries.",
        file: "src/math.ts",
        line: 2,
        recommendation: "Add guard checks before arithmetic operation.",
      },
      {
        severity: "medium",
        title: "Return path clarity",
        detail:
          "The return total statement should include quick explanation for maintainers.",
        file: "math.ts",
      },
      {
        severity: "low",
        title: "Global finding",
        detail: "No file mapping present for this note.",
      },
      {
        severity: "high",
        title: "Validate overflow handling",
        detail: "Duplicate issue with same title and line.",
        file: "src/math.ts",
        line: 2,
      },
    ];

    const result = buildInlineReviewComments({
      findings,
      files,
      maxComments: 10,
    });

    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]).toMatchObject({
      path: "src/math.ts",
      line: 2,
      severity: "high",
    });
    expect(result.comments[1]).toMatchObject({
      path: "src/math.ts",
      line: 3,
      severity: "medium",
    });
    expect(result.comments[0]?.body).toContain("Suggestion:");

    expect(result.skippedByReason["missing-file"]).toBe(1);
    expect(result.skippedByReason.duplicate).toBe(1);
  });

  it("respects the configured max comment limit", () => {
    const findings: ReviewFinding[] = [
      {
        severity: "high",
        title: "First",
        detail: "First finding",
        file: "src/math.ts",
        line: 2,
      },
      {
        severity: "medium",
        title: "Second",
        detail: "Second finding",
        file: "src/math.ts",
        line: 3,
      },
    ];

    const result = buildInlineReviewComments({
      findings,
      files,
      maxComments: 1,
    });

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.title).toBe("First");
  });

  it("maps multiline findings to start_line and end line anchors", () => {
    const result = buildInlineReviewComments({
      findings: [
        {
          severity: "high",
          title: "Range should map to changed block",
          detail: "This finding covers multiple changed lines.",
          file: "src/math.ts",
          line: 2,
          endLine: 3,
        },
      ],
      files,
      maxComments: 5,
    });

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
      path: "src/math.ts",
      startLine: 2,
      line: 3,
    });
  });

  it("prioritizes one comment per file with file-coverage mode", () => {
    const result = buildInlineReviewComments({
      findings: [
        {
          severity: "high",
          title: "High risk in a",
          detail: "First issue in file a.",
          file: "src/a.ts",
          line: 2,
        },
        {
          severity: "medium",
          title: "Another issue in a",
          detail: "Second issue in file a.",
          file: "src/a.ts",
          line: 3,
        },
        {
          severity: "low",
          title: "Issue in b",
          detail: "Issue in file b.",
          file: "src/b.ts",
          line: 4,
        },
      ],
      files: [
        {
          path: "src/a.ts",
          name: "a.ts",
          content: "export const a = 1;\nexport const b = 2;\n",
          patch: [
            "@@ -1,2 +1,3 @@",
            " export const a = 1;",
            "+export const b = 2;",
            "+export const c = 3;",
          ].join("\n"),
        },
        {
          path: "src/b.ts",
          name: "b.ts",
          content: "export const value = true;\n",
          patch: [
            "@@ -1,1 +1,2 @@",
            " export const value = true;",
            "+export const status = 'ok';",
          ].join("\n"),
        },
      ],
      maxComments: 2,
      strategy: "file-coverage",
    });

    expect(result.comments).toHaveLength(2);
    expect(result.comments.map((comment) => comment.path).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("skips findings when file has no changed lines", () => {
    const result = buildInlineReviewComments({
      findings: [
        {
          severity: "high",
          title: "Deleted-only hunk",
          detail: "This should not map to a RIGHT-side line.",
          file: "src/deleted.ts",
        },
      ],
      files: [
        {
          path: "src/deleted.ts",
          name: "deleted.ts",
          content: "",
          patch: "@@ -1,2 +0,0 @@\n-old\n-old2",
        },
      ],
      maxComments: 5,
      allowFallbackToFirstChangedLine: false,
    });

    expect(result.comments).toHaveLength(0);
    expect(result.skippedByReason["no-changed-lines"]).toBe(1);
  });
});
