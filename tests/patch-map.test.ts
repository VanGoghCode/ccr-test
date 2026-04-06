import { describe, expect, it } from "vitest";
import {
  parseUnifiedDiffPatch,
  resolveChangedLine,
} from "../src/core/patch-map";

const samplePatch = [
  "@@ -1,4 +1,5 @@",
  " export function sum(a, b) {",
  "-  return a - b;",
  "+  const total = a + b;",
  "+  return total;",
  " }",
].join("\n");

describe("patch map", () => {
  it("parses changed lines from unified diff hunks", () => {
    const patchMap = parseUnifiedDiffPatch(samplePatch);

    expect(patchMap.hunks).toHaveLength(1);
    expect(patchMap.changedLines).toEqual([2, 3]);
    expect(patchMap.changedLineContentByLine.get(2)).toBe(
      "  const total = a + b;",
    );
    expect(patchMap.changedLineContentByLine.get(3)).toBe("  return total;");
  });

  it("resolves explicit line anchors and nearest changed fallback", () => {
    const patchMap = parseUnifiedDiffPatch(samplePatch);

    expect(
      resolveChangedLine({
        patchMap,
        requestedLine: 3,
      }),
    ).toBe(3);

    expect(
      resolveChangedLine({
        patchMap,
        requestedLine: 10,
      }),
    ).toBe(3);
  });

  it("resolves line anchors from search text", () => {
    const patchMap = parseUnifiedDiffPatch(samplePatch);

    expect(
      resolveChangedLine({
        patchMap,
        searchText: "Use const total = a + b before return",
        allowFallbackToFirstChangedLine: false,
      }),
    ).toBe(2);
  });

  it("returns undefined when no changed lines are available", () => {
    const patchMap = parseUnifiedDiffPatch("");

    expect(
      resolveChangedLine({
        patchMap,
        searchText: "anything",
      }),
    ).toBeUndefined();
  });
});
