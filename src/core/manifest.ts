import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  createPromptDraftMap,
  getMissingPromptLabels,
  normalizePromptImport,
} from "./prompt-config.js";
import { readPromptText, resolvePromptRoot } from "./prompt-loader.js";
import type {
  LoadedPromptArchitecture,
  LoadedPromptStage,
  PromptArchitectureManifest,
  PromptStageManifest,
} from "./types.js";

const stageSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  purpose: z.string().min(1),
  promptPath: z.string().min(1),
});

const manifestSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    mode: z.enum(["single", "sequential", "parallel"]),
    stages: z.array(stageSchema).min(1),
    combineStage: stageSchema.optional(),
  })
  .superRefine((manifest, context) => {
    if (manifest.mode !== "parallel" && manifest.combineStage) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "combineStage is only valid for the parallel architecture",
      });
    }
  });

function resolveManifestPath(
  promptRoot: string,
  architectureId: string,
): string {
  return path.resolve(
    promptRoot,
    "architectures",
    architectureId,
    "manifest.json",
  );
}

async function loadManifestFile(
  promptRoot: string,
  architectureId: string,
): Promise<PromptArchitectureManifest> {
  const manifestPath = resolveManifestPath(promptRoot, architectureId);
  const raw = await readFile(manifestPath, "utf8");
  const parsed = manifestSchema.parse(
    JSON.parse(raw),
  ) satisfies PromptArchitectureManifest;
  return parsed;
}

async function loadStage(
  promptRoot: string,
  stage: PromptStageManifest,
): Promise<LoadedPromptStage> {
  const promptText = await readPromptText(promptRoot, stage.promptPath);
  return {
    ...stage,
    promptText,
  };
}

export async function loadAvailableArchitectures(
  promptRootInput = "prompts",
): Promise<LoadedPromptArchitecture[]> {
  const promptRoot = resolvePromptRoot(promptRootInput);
  const architectureDir = path.resolve(promptRoot, "architectures");
  const entries = await readdir(architectureDir, { withFileTypes: true });
  const manifests = entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const manifest = await loadManifestFile(promptRoot, entry.name);
      const stages = await Promise.all(
        manifest.stages.map(async (stage) => loadStage(promptRoot, stage)),
      );
      const combineStage = manifest.combineStage
        ? await loadStage(promptRoot, manifest.combineStage)
        : undefined;
      return {
        ...manifest,
        stages,
        combineStage,
      } satisfies LoadedPromptArchitecture;
    });

  const loaded = await Promise.all(manifests);
  return loaded.sort((left, right) => left.label.localeCompare(right.label));
}

export async function loadArchitectureById(
  promptRootInput: string | undefined,
  architectureId: string,
): Promise<LoadedPromptArchitecture> {
  const architectures = await loadAvailableArchitectures(promptRootInput);
  const architecture = architectures.find(
    (entry) => entry.id === architectureId,
  );
  if (!architecture) {
    throw new Error(`Unknown architecture: ${architectureId}`);
  }
  return architecture;
}

export function applyPromptOverrides(
  architecture: LoadedPromptArchitecture,
  promptOverrides?: Record<string, string>,
): LoadedPromptArchitecture {
  const normalized = promptOverrides
    ? normalizePromptImport(architecture, promptOverrides)
    : {};

  return {
    ...architecture,
    stages: architecture.stages.map((stage) => ({
      ...stage,
      promptText: normalized[stage.id] ?? stage.promptText,
    })),
    combineStage: architecture.combineStage
      ? {
          ...architecture.combineStage,
          promptText:
            normalized[architecture.combineStage.id] ??
            architecture.combineStage.promptText,
        }
      : undefined,
  } satisfies LoadedPromptArchitecture;
}

export function validatePromptCoverage(
  architecture: LoadedPromptArchitecture,
): void {
  const missingPromptLabels = getMissingPromptLabels(
    architecture,
    createPromptDraftMap(architecture),
  );

  if (missingPromptLabels.length > 0) {
    throw new Error(
      `Prompt text is required for ${missingPromptLabels.join(", ")} in the ${architecture.label} architecture.`,
    );
  }
}
