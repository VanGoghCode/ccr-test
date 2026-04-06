const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export interface ParsedPatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  changedLines: number[];
  changedLineContents: Array<{
    line: number;
    content: string;
  }>;
}

export interface ParsedPatchMap {
  hunks: ParsedPatchHunk[];
  changedLines: number[];
  changedLineContentByLine: Map<number, string>;
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function normalizeSearchText(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function extractSearchCandidates(value: string): string[] {
  const raw = value.trim();
  if (raw.length === 0) {
    return [];
  }

  const fromNewlines = raw
    .split(/\r?\n+/)
    .map((entry) => normalizeSearchText(entry))
    .filter((entry) => entry.length >= 8);
  if (fromNewlines.length > 0) {
    return fromNewlines.slice(0, 4);
  }

  const fromPunctuation = raw
    .split(/[.;:!?]+/)
    .map((entry) => normalizeSearchText(entry))
    .filter((entry) => entry.length >= 8);
  if (fromPunctuation.length > 0) {
    return fromPunctuation.slice(0, 4);
  }

  return [normalizeSearchText(raw)];
}

function tokenize(value: string): string[] {
  return normalizeSearchText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function tokenOverlapScore(
  candidate: string,
  line: string,
): {
  score: number;
  overlaps: number;
} {
  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) {
    return {
      score: 0,
      overlaps: 0,
    };
  }

  const lineTokens = new Set(tokenize(line));
  let overlaps = 0;
  for (const token of candidateTokens) {
    if (lineTokens.has(token)) {
      overlaps += 1;
    }
  }

  return {
    score: overlaps / candidateTokens.length,
    overlaps,
  };
}

function closestLine(target: number, lines: number[]): number | undefined {
  if (lines.length === 0) {
    return undefined;
  }

  let best = lines[0];
  let bestDistance = Math.abs(best - target);

  for (const line of lines.slice(1)) {
    const distance = Math.abs(line - target);
    if (distance < bestDistance) {
      best = line;
      bestDistance = distance;
    }
  }

  return best;
}

export function parseUnifiedDiffPatch(patch: string): ParsedPatchMap {
  if (patch.trim().length === 0) {
    return {
      hunks: [],
      changedLines: [],
      changedLineContentByLine: new Map<number, string>(),
    };
  }

  const lines = patch.split(/\r?\n/);
  const hunks: ParsedPatchHunk[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    const match = header.match(HUNK_HEADER_PATTERN);
    if (!match) {
      continue;
    }

    const hunk: ParsedPatchHunk = {
      oldStart: toPositiveInt(match[1], 0),
      oldCount: toPositiveInt(match[2], 1),
      newStart: toPositiveInt(match[3], 0),
      newCount: toPositiveInt(match[4], 1),
      changedLines: [],
      changedLineContents: [],
    };

    let currentLine = hunk.newStart;

    for (index += 1; index < lines.length; index += 1) {
      const rawLine = lines[index];
      if (rawLine.startsWith("@@ ")) {
        index -= 1;
        break;
      }

      if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
        const content = rawLine.slice(1);
        hunk.changedLines.push(currentLine);
        hunk.changedLineContents.push({
          line: currentLine,
          content,
        });
        currentLine += 1;
        continue;
      }

      if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
        continue;
      }

      if (rawLine.startsWith(" ")) {
        currentLine += 1;
      }
    }

    hunks.push(hunk);
  }

  const changedLineContentByLine = new Map<number, string>();
  for (const hunk of hunks) {
    for (const entry of hunk.changedLineContents) {
      changedLineContentByLine.set(entry.line, entry.content);
    }
  }

  return {
    hunks,
    changedLines: Array.from(changedLineContentByLine.keys()).sort(
      (left, right) => left - right,
    ),
    changedLineContentByLine,
  };
}

export function resolveChangedLine(params: {
  patchMap: ParsedPatchMap;
  requestedLine?: number;
  searchText?: string;
  allowFallbackToFirstChangedLine?: boolean;
}): number | undefined {
  const {
    patchMap,
    requestedLine,
    searchText,
    allowFallbackToFirstChangedLine = true,
  } = params;

  if (patchMap.changedLines.length === 0) {
    return undefined;
  }

  const changedLineSet = new Set<number>(patchMap.changedLines);

  if (typeof requestedLine === "number" && Number.isFinite(requestedLine)) {
    const rounded = Math.round(requestedLine);
    if (changedLineSet.has(rounded)) {
      return rounded;
    }

    return closestLine(rounded, patchMap.changedLines);
  }

  if (searchText && searchText.trim().length > 0) {
    const candidates = extractSearchCandidates(searchText);
    let bestLine: number | undefined;
    let bestScore = 0;
    let bestOverlap = 0;

    for (const candidate of candidates) {
      for (const [
        line,
        content,
      ] of patchMap.changedLineContentByLine.entries()) {
        const normalizedLine = normalizeSearchText(content);
        if (
          normalizedLine.includes(candidate) ||
          (candidate.length >= 12 && candidate.includes(normalizedLine))
        ) {
          return line;
        }

        const overlap = tokenOverlapScore(candidate, normalizedLine);
        if (
          overlap.overlaps > bestOverlap ||
          (overlap.overlaps === bestOverlap && overlap.score > bestScore)
        ) {
          bestLine = line;
          bestScore = overlap.score;
          bestOverlap = overlap.overlaps;
        }
      }
    }

    if (bestLine && bestOverlap >= 2 && bestScore >= 0.2) {
      return bestLine;
    }
  }

  if (!allowFallbackToFirstChangedLine) {
    return undefined;
  }

  return patchMap.changedLines[0];
}
