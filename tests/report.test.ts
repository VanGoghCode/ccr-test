import { describe, expect, it } from "vitest";
import { loadArchitectureById } from "../src/core/manifest";
import {
  parseReviewModelOutput,
  renderReviewMarkdown,
} from "../src/core/report";

describe("report rendering", () => {
  it("parses a valid JSON model response", () => {
    const output = parseReviewModelOutput(
      JSON.stringify({
        summary: "Looks good.",
        riskLevel: "low",
        findings: [],
        todos: ["Ship it"],
      }),
    );

    expect(output.summary).toBe("Looks good.");
    expect(output.riskLevel).toBe("low");
    expect(output.todos).toEqual(["Ship it"]);
  });

  it("falls back to a safe report when JSON is invalid", () => {
    const output = parseReviewModelOutput("plain text that is not json");

    expect(output.riskLevel).toBe("medium");
    expect(output.notes?.[0]).toContain("plain text");
  });

  it("renders markdown with the architecture metadata", async () => {
    const architecture = await loadArchitectureById("prompts", "single-pass");
    const report = renderReviewMarkdown({
      architecture,
      request: {
        architectureId: architecture.id,
        files: [
          {
            path: "src/index.ts",
            name: "index.ts",
            content: "export const value = 1;",
          },
        ],
        context: {
          repositoryName: "demo/repo",
          metadata: "sandbox",
        },
      },
      modelOutput: {
        summary: "One file reviewed.",
        riskLevel: "low",
        findings: [],
        todos: ["No follow-up needed"],
        notes: ["mock output"],
      },
      stageOutputs: [
        {
          stageId: "review",
          label: "Review",
          output: "{}",
          prompt: "test prompt",
        },
      ],
      rawOutput: "{}",
      prompt: "test prompt",
    });

    expect(report.markdown).toContain("CCR.md");
    expect(report.markdown).toContain("demo/repo");
    expect(report.markdown).toContain("single-pass");
    expect(report.markdown).toContain("One file reviewed.");
  });
});
