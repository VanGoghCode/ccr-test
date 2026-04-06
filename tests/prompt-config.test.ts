import { describe, expect, it } from "vitest";
import {
  createPromptDraftMap,
  getMissingPromptLabels,
  normalizePromptImport,
} from "../src/core/prompt-config";
import type { LoadedPromptArchitecture } from "../src/core/types";

function createSequentialArchitecture(): LoadedPromptArchitecture {
  return {
    id: "iterative",
    label: "Iterative",
    description: "Sequential architecture",
    mode: "sequential",
    stages: Array.from({ length: 6 }, (_, index) => ({
      id: `stage-${index + 1}`,
      label: `Stage ${index + 1}`,
      purpose: `Purpose ${index + 1}`,
      promptPath: `shared/stages/stage-${index + 1}.md`,
      promptText: "",
    })),
  };
}

function createParallelArchitecture(): LoadedPromptArchitecture {
  return {
    id: "parallel",
    label: "Parallel",
    description: "Parallel architecture",
    mode: "parallel",
    stages: Array.from({ length: 6 }, (_, index) => ({
      id: `stage-${index + 1}`,
      label: `Stage ${index + 1}`,
      purpose: `Purpose ${index + 1}`,
      promptPath: `shared/stages/stage-${index + 1}.md`,
      promptText: "",
    })),
    combineStage: {
      id: "combine",
      label: "Combine",
      purpose: "Merge the stage outputs.",
      promptPath: "architectures/parallel/combine.md",
      promptText: "",
    },
  };
}

function createSingleArchitecture(): LoadedPromptArchitecture {
  return {
    id: "single-pass",
    label: "Single",
    description: "Single prompt architecture",
    mode: "single",
    stages: [
      {
        id: "review",
        label: "Review",
        purpose: "Review the full change set.",
        promptPath: "architectures/single-pass/prompt.md",
        promptText: "",
      },
    ],
  };
}

describe("prompt config", () => {
  it("maps shorthand stage keys to the sequential architecture", () => {
    const architecture = createSequentialArchitecture();

    const imported = normalizePromptImport(architecture, {
      stage1: "one",
      stage2: "two",
      stage3: "three",
      stage4: "four",
      stage5: "five",
      stage6: "six",
    });

    expect(imported).toEqual({
      "stage-1": "one",
      "stage-2": "two",
      "stage-3": "three",
      "stage-4": "four",
      "stage-5": "five",
      "stage-6": "six",
    });
  });

  it("maps the combine prompt for the parallel architecture", () => {
    const architecture = createParallelArchitecture();

    const imported = normalizePromptImport(architecture, {
      stage1: "one",
      stage2: "two",
      stage3: "three",
      stage4: "four",
      stage5: "five",
      stage6: "six",
      combine: "merge",
    });

    expect(imported).toEqual({
      "stage-1": "one",
      "stage-2": "two",
      "stage-3": "three",
      "stage-4": "four",
      "stage-5": "five",
      "stage-6": "six",
      combine: "merge",
    });
  });

  it("accepts the review alias for the single architecture", () => {
    const architecture = createSingleArchitecture();

    const imported = normalizePromptImport(architecture, {
      review: "single prompt text",
    });

    expect(imported).toEqual({
      review: "single prompt text",
    });
  });

  it("reports missing prompts when the draft map is empty", () => {
    const architecture = createParallelArchitecture();

    expect(
      getMissingPromptLabels(architecture, createPromptDraftMap(architecture)),
    ).toEqual([
      "Stage 1",
      "Stage 2",
      "Stage 3",
      "Stage 4",
      "Stage 5",
      "Stage 6",
      "Combine",
    ]);
  });
});
