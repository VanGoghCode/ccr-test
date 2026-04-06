import { describe, expect, it } from "vitest";
import {
  buildReviewRequest,
  createEmptyFileDraft,
  createImportedFileDrafts,
  createInitialSandboxState,
  sandboxReducer,
} from "../sandbox/src/state";

describe("app state", () => {
  it("adds and removes file sets without forcing a fallback row", () => {
    let state = createInitialSandboxState();
    expect(state.fileDrafts).toHaveLength(0);

    state = sandboxReducer(state, { type: "add-file" });
    expect(state.fileDrafts).toHaveLength(1);

    const firstFileId = state.fileDrafts[0].id;

    state = sandboxReducer(state, { type: "remove-file", fileId: firstFileId });
    expect(state.fileDrafts).toHaveLength(0);
  });

  it("builds a review request from the form", () => {
    const state = {
      ...createInitialSandboxState(),
      selectedArchitectureId: "parallel",
      metadata: "demo metadata",
      fileDrafts: [
        {
          ...createEmptyFileDraft(1),
          fileName: "app.ts",
          filePath: "src/app.ts",
          sampleCode: "export const value = 42;",
        },
      ],
    };

    const request = buildReviewRequest(state);

    expect(request.architectureId).toBe("parallel");
    expect(request.files[0].path).toBe("src/app.ts");
    expect(request.context?.metadata).toBe("demo metadata");
  });

  it("stores prompt edits per architecture and includes them in the request", async () => {
    const { loadAvailableArchitectures } = await import("../src/core/manifest");
    const architectures = await loadAvailableArchitectures("prompts");

    let state = sandboxReducer(createInitialSandboxState(), {
      type: "set-architectures",
      architectures,
    });

    state = sandboxReducer(state, {
      type: "select-architecture",
      architectureId: "parallel",
    });
    state = sandboxReducer(state, {
      type: "update-prompt",
      architectureId: "parallel",
      promptId: "stage-1",
      value: "one",
    });
    state = sandboxReducer(state, {
      type: "merge-prompt-drafts",
      architectureId: "parallel",
      promptDrafts: {
        "stage-2": "two",
        combine: "merge",
      },
    });

    const request = buildReviewRequest(state);

    expect(request.promptOverrides?.["stage-1"]).toBe("one");
    expect(request.promptOverrides?.["stage-2"]).toBe("two");
    expect(request.promptOverrides?.combine).toBe("merge");
  });

  it("imports uploaded code files into file drafts", async () => {
    const drafts = await createImportedFileDrafts([
      new File(["export const value = 42;\n"], "app.ts", {
        type: "text/typescript",
      }),
    ]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].fileName).toBe("app.ts");
    expect(drafts[0].filePath).toBe("app.ts");
    expect(drafts[0].sampleCode).toContain("export const value = 42;");
  });

  it("accepts blank file fields when building a review request", () => {
    const state = {
      ...createInitialSandboxState(),
      selectedArchitectureId: "single-pass",
      fileDrafts: [
        {
          ...createEmptyFileDraft(1),
          fileName: "",
          filePath: "",
          sampleCode: "",
        },
      ],
    };

    const request = buildReviewRequest(state);

    expect(request.files[0]).toEqual({
      path: "",
      name: "",
      content: "",
    });
  });

  it("replaces file drafts with imported drafts", () => {
    const importedDrafts = [
      {
        ...createEmptyFileDraft(1),
        fileName: "app.ts",
        filePath: "src/app.ts",
        sampleCode: "export const value = 42;",
      },
      {
        ...createEmptyFileDraft(2),
        fileName: "util.ts",
        filePath: "src/util.ts",
        sampleCode: "export const util = true;",
      },
    ];

    const state = sandboxReducer(createInitialSandboxState(), {
      type: "replace-file-drafts",
      fileDrafts: importedDrafts,
    });

    expect(state.fileDrafts).toHaveLength(2);
    expect(state.fileDrafts[0].fileName).toBe("app.ts");
    expect(state.fileDrafts[1].filePath).toBe("src/util.ts");
  });
});
