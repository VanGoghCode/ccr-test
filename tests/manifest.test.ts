import { describe, expect, it } from "vitest";
import {
  applyPromptOverrides,
  loadAvailableArchitectures,
  validatePromptCoverage,
} from "../src/core/manifest";

describe("architecture manifests", () => {
  it("loads all three prompt architectures", async () => {
    const architectures = await loadAvailableArchitectures("prompts");

    expect(architectures.map((architecture) => architecture.id).sort()).toEqual(
      ["iterative", "parallel", "single-pass"],
    );

    const singlePass = architectures.find(
      (architecture) => architecture.id === "single-pass",
    );
    const iterative = architectures.find(
      (architecture) => architecture.id === "iterative",
    );
    const parallel = architectures.find(
      (architecture) => architecture.id === "parallel",
    );

    expect(singlePass?.stages).toHaveLength(1);
    expect(iterative?.stages).toHaveLength(6);
    expect(parallel?.stages).toHaveLength(6);
    expect(parallel?.combineStage?.id).toBe("combine");
    expect(singlePass?.stages[0].promptText).toBe("");
  });

  it("applies shorthand overrides to the loaded sequential architecture", async () => {
    const architectures = await loadAvailableArchitectures("prompts");
    const iterative = architectures.find(
      (architecture) => architecture.id === "iterative",
    );

    expect(iterative).toBeDefined();
    if (!iterative) {
      throw new Error("Expected the iterative architecture to load.");
    }

    const applied = applyPromptOverrides(iterative, {
      stage1: "one",
      stage2: "two",
      stage3: "three",
      stage4: "four",
      stage5: "five",
      stage6: "six",
    });

    expect(applied.stages.map((stage) => stage.promptText)).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
    ]);
    expect(() => validatePromptCoverage(applied)).not.toThrow();
  });

  it("rejects incomplete prompt coverage for the loaded architectures", async () => {
    const architectures = await loadAvailableArchitectures("prompts");
    const singlePass = architectures.find(
      (architecture) => architecture.id === "single-pass",
    );

    expect(singlePass).toBeDefined();
    if (!singlePass) {
      throw new Error("Expected the single-pass architecture to load.");
    }

    expect(() => validatePromptCoverage(singlePass)).toThrow(
      /Prompt text is required/,
    );
  });
});
