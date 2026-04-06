import { describe, expect, it } from "vitest";
import { filterReviewPaths, parseCommitMessages } from "../src/core/git";

describe("git path filtering", () => {
  it("honors include and exclude glob lists", () => {
    const filtered = filterReviewPaths(
      ["src/main.ts", "dist/index.js", ".git/config", "sandbox/src/App.tsx"],
      ["**/*"],
      ["dist/**", ".git/**"],
    );

    expect(filtered).toEqual(["src/main.ts", "sandbox/src/App.tsx"]);
  });

  it("parses commit messages from git log output", () => {
    const logOutput = [
      "0123456789abcdef0123456789abcdef01234567\u001ffeat: add login flow\u001fAdd initial auth hooks and route guard.\u001e",
      "89abcdef0123456789abcdef0123456789abcdef\u001ffix: trim stale imports\u001f\u001e",
    ].join("");

    const messages = parseCommitMessages(logOutput);

    expect(messages).toEqual([
      "0123456789ab feat: add login flow\n\nAdd initial auth hooks and route guard.",
      "89abcdef0123 fix: trim stale imports",
    ]);
  });

  it("limits parsed commit messages to the configured max", () => {
    const logOutput = [
      "a111111111111111111111111111111111111111\u001ffirst\u001f\u001e",
      "b222222222222222222222222222222222222222\u001fsecond\u001f\u001e",
    ].join("");

    const messages = parseCommitMessages(logOutput, 1);

    expect(messages).toEqual(["a11111111111 first"]);
  });
});
