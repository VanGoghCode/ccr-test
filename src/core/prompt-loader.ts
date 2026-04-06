import { readFile } from "node:fs/promises";
import path from "node:path";

export function resolvePromptRoot(promptRoot = "prompts"): string {
  if (path.isAbsolute(promptRoot)) {
    return promptRoot;
  }

  const baseDir = process.env.GITHUB_ACTION_PATH || process.cwd();
  return path.resolve(baseDir, promptRoot);
}

export async function readPromptText(
  promptRoot: string,
  promptPath: string,
): Promise<string> {
  const absolutePath = path.resolve(promptRoot, promptPath);
  return readFile(absolutePath, "utf8");
}
