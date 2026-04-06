import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import picomatch from "picomatch";
import type { ReviewContext, ReviewFileInput } from "./types.js";

const execFileAsync = promisify(execFile);

export interface GitRange {
  baseRef: string;
  headRef: string;
}

export interface CollectReviewFilesOptions {
  repositoryRoot: string;
  range: GitRange;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  maxFiles?: number;
  repositoryName?: string;
}

const COMMIT_FIELD_SEPARATOR = "\u001f";
const COMMIT_RECORD_SEPARATOR = "\u001e";
const DEFAULT_MAX_COMMIT_MESSAGES = 20;
const DEFAULT_MAX_COMMIT_MESSAGE_CHARS = 400;

function splitStatusLine(line: string): {
  status: string;
  path: string;
  previousPath?: string;
} {
  const parts = line.split("\t");
  const status = parts[0] ?? "M";
  if (status.startsWith("R") || status.startsWith("C")) {
    return {
      status,
      path: parts[2] ?? parts[1] ?? "",
      previousPath: parts[1],
    };
  }

  return {
    status,
    path: parts[1] ?? "",
  };
}

function normalizeStatus(status: string): ReviewFileInput["status"] {
  if (status.startsWith("A")) {
    return "added";
  }
  if (status.startsWith("D")) {
    return "deleted";
  }
  if (status.startsWith("R")) {
    return "renamed";
  }
  if (status.startsWith("C")) {
    return "copied";
  }
  return "modified";
}

function fileLanguage(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  const mapping: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".css": "css",
    ".html": "html",
    ".sh": "shell",
  };
  return mapping[extension];
}

async function runGit(repositoryRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.toString().trim();
}

function truncateCommitMessage(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}... [truncated ${value.length - maxChars} characters]`;
}

export function parseCommitMessages(
  logOutput: string,
  maxMessages = DEFAULT_MAX_COMMIT_MESSAGES,
): string[] {
  const records = logOutput
    .split(COMMIT_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean);

  const messages: string[] = [];
  for (const record of records) {
    const [hashRaw = "", subjectRaw = "", bodyRaw = ""] = record.split(
      COMMIT_FIELD_SEPARATOR,
    );
    const hash = hashRaw.trim();
    const subject = subjectRaw.trim();
    const body = bodyRaw.trim();
    const messageCore = [subject, body].filter(Boolean).join("\n\n").trim();

    if (!messageCore) {
      continue;
    }

    const shortHash = hash ? hash.slice(0, 12) : undefined;
    const normalizedMessage = messageCore.replace(/\n{3,}/g, "\n\n");
    const truncatedMessage = truncateCommitMessage(
      normalizedMessage,
      DEFAULT_MAX_COMMIT_MESSAGE_CHARS,
    );
    messages.push(
      shortHash ? `${shortHash} ${truncatedMessage}` : truncatedMessage,
    );

    if (messages.length >= maxMessages) {
      break;
    }
  }

  return messages;
}

export async function collectCommitMessages(
  repositoryRoot: string,
  range: GitRange,
  maxMessages = DEFAULT_MAX_COMMIT_MESSAGES,
): Promise<string[]> {
  const logOutput = await runGit(repositoryRoot, [
    "log",
    `--format=%H${COMMIT_FIELD_SEPARATOR}%s${COMMIT_FIELD_SEPARATOR}%b${COMMIT_RECORD_SEPARATOR}`,
    `${range.baseRef}..${range.headRef}`,
  ]);

  return parseCommitMessages(logOutput, maxMessages);
}

function buildMatcher(
  patterns: string[] | undefined,
): ((value: string) => boolean) | undefined {
  if (!patterns || patterns.length === 0) {
    return undefined;
  }

  const filteredPatterns = patterns.filter((pattern) => pattern.length > 0);
  if (filteredPatterns.length === 0) {
    return undefined;
  }

  const matcher = picomatch(filteredPatterns, { dot: true });
  return (value: string) => matcher(value);
}

export function filterReviewPaths(
  paths: string[],
  includeGlobs?: string[],
  excludeGlobs?: string[],
): string[] {
  const includeMatcher = buildMatcher(includeGlobs);
  const excludeMatcher = buildMatcher(excludeGlobs);

  return paths.filter((value) => {
    const included = includeMatcher ? includeMatcher(value) : true;
    const excluded = excludeMatcher ? excludeMatcher(value) : false;
    return included && !excluded;
  });
}

async function readFileAtRef(
  repositoryRoot: string,
  ref: string,
  filePath: string,
): Promise<string> {
  const relativePath = filePath.replaceAll(path.sep, "/");
  try {
    return await runGit(repositoryRoot, ["show", `${ref}:${relativePath}`]);
  } catch {
    const diskPath = path.resolve(repositoryRoot, filePath);
    return readFile(diskPath, "utf8");
  }
}

export async function resolveGitRange(
  repositoryRoot: string,
  context: ReviewContext,
  fallbackHead = "HEAD",
): Promise<GitRange> {
  if (context.baseRef && context.headRef) {
    return {
      baseRef: context.baseRef,
      headRef: context.headRef,
    };
  }

  try {
    const eventName = process.env.GITHUB_EVENT_NAME ?? "";
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (
      (eventName === "pull_request" || eventName === "pull_request_target") &&
      eventPath
    ) {
      const eventPayload = JSON.parse(await readFile(eventPath, "utf8")) as {
        pull_request?: {
          base?: { sha?: string };
          head?: { sha?: string };
        };
      };
      const baseSha = eventPayload.pull_request?.base?.sha;
      const headSha = eventPayload.pull_request?.head?.sha;
      if (baseSha && headSha) {
        return {
          baseRef: baseSha,
          headRef: headSha,
        };
      }
    }
  } catch {
    // Fall back to git state below.
  }

  const headRef = fallbackHead;
  const baseRef = `${headRef}~1`;
  return {
    baseRef,
    headRef,
  };
}

export async function collectReviewFiles(
  options: CollectReviewFilesOptions,
): Promise<ReviewFileInput[]> {
  const {
    repositoryRoot,
    range,
    includeGlobs,
    excludeGlobs,
    maxFiles = 25,
  } = options;

  const statusOutput = await runGit(repositoryRoot, [
    "diff",
    "--name-status",
    `${range.baseRef}...${range.headRef}`,
  ]);
  const statusLines = statusOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fileRecords = statusLines
    .map(splitStatusLine)
    .filter((entry) => entry.path.length > 0);
  const selectedPaths = filterReviewPaths(
    fileRecords.map((entry) => entry.path),
    includeGlobs,
    excludeGlobs,
  ).slice(0, maxFiles);

  const selectedRecords = fileRecords.filter((record) =>
    selectedPaths.includes(record.path),
  );
  const files: ReviewFileInput[] = [];

  for (const record of selectedRecords) {
    const absolutePath = path.resolve(repositoryRoot, record.path);
    const normalizedStatus = normalizeStatus(record.status);
    let content = "";

    if (normalizedStatus === "deleted") {
      content = await readFileAtRef(repositoryRoot, range.baseRef, record.path);
    } else {
      content = await readFile(absolutePath, "utf8");
    }

    const patch = await runGit(repositoryRoot, [
      "diff",
      "--unified=3",
      `${range.baseRef}...${range.headRef}`,
      "--",
      record.path,
    ]);

    files.push({
      path: record.path,
      previousPath: record.previousPath,
      name: path.basename(record.path),
      content,
      status: normalizedStatus,
      language: fileLanguage(record.path),
      patch: patch.trim(),
    });
  }

  return files;
}

export async function collectReviewContext(
  repositoryRoot: string,
  context: ReviewContext,
): Promise<ReviewContext> {
  const range = await resolveGitRange(repositoryRoot, context, "HEAD");
  let commitMessages: string[] = context.commitMessages ?? [];
  if (commitMessages.length === 0) {
    try {
      commitMessages = await collectCommitMessages(repositoryRoot, range);
    } catch {
      commitMessages = [];
    }
  }

  const repositoryName =
    context.repositoryName ??
    process.env.GITHUB_REPOSITORY ??
    path.basename(repositoryRoot);

  return {
    repositoryName,
    metadata: context.metadata,
    baseRef: range.baseRef,
    headRef: range.headRef,
    commitMessages,
  };
}
