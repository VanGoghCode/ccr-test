import { describe, expect, it } from "vitest";
import { filterReviewPaths } from "../src/core/git";

describe("git path filtering", () => {
  it("honors include and exclude glob lists", () => {
    const filtered = filterReviewPaths(
      ["src/main.ts", "dist/index.js", ".git/config", "sandbox/src/App.tsx"],
      ["**/*"],
      ["dist/**", ".git/**"],
    );

    expect(filtered).toEqual(["src/main.ts", "sandbox/src/App.tsx"]);
  });
});
