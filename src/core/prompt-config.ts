import type { LoadedPromptArchitecture } from "./types.js";

export type PromptDraftMap = Record<string, string>;

export interface PromptSlot {
  id: string;
  label: string;
  purpose: string;
  required: boolean;
}

function normalizePromptKey(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function registerPromptAlias(
  lookup: Map<string, string>,
  alias: string,
  stageId: string,
): void {
  lookup.set(normalizePromptKey(alias), stageId);
}

function buildPromptAliasLookup(
  architecture: LoadedPromptArchitecture,
): Map<string, string> {
  const lookup = new Map<string, string>();

  architecture.stages.forEach((stage, index) => {
    registerPromptAlias(lookup, stage.id, stage.id);
    registerPromptAlias(lookup, `stage${index + 1}`, stage.id);
    registerPromptAlias(lookup, `stage-${index + 1}`, stage.id);
    registerPromptAlias(lookup, `stage_${index + 1}`, stage.id);
    registerPromptAlias(lookup, `prompt${index + 1}`, stage.id);

    if (architecture.mode === "single" && index === 0) {
      registerPromptAlias(lookup, "review", stage.id);
      registerPromptAlias(lookup, "prompt", stage.id);
      registerPromptAlias(lookup, "single", stage.id);
    }
  });

  if (architecture.combineStage) {
    registerPromptAlias(
      lookup,
      architecture.combineStage.id,
      architecture.combineStage.id,
    );
    registerPromptAlias(lookup, "combine", architecture.combineStage.id);
    registerPromptAlias(lookup, "combine-stage", architecture.combineStage.id);
    registerPromptAlias(lookup, "final", architecture.combineStage.id);
  }

  return lookup;
}

export function createPromptDraftMap(
  architecture: LoadedPromptArchitecture,
): PromptDraftMap {
  const promptDrafts: PromptDraftMap = {};

  for (const stage of architecture.stages) {
    promptDrafts[stage.id] = stage.promptText;
  }

  if (architecture.combineStage) {
    promptDrafts[architecture.combineStage.id] =
      architecture.combineStage.promptText;
  }

  return promptDrafts;
}

export function mergePromptDraftMaps(
  base: PromptDraftMap,
  overrides: PromptDraftMap,
): PromptDraftMap {
  return {
    ...base,
    ...overrides,
  };
}

export function normalizePromptImport(
  architecture: LoadedPromptArchitecture,
  raw: unknown,
): PromptDraftMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Prompt JSON must be an object with string values.");
  }

  const lookup = buildPromptAliasLookup(architecture);
  const normalized: PromptDraftMap = {};

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      continue;
    }

    const target = lookup.get(normalizePromptKey(key));
    if (!target) {
      continue;
    }

    normalized[target] = value;
  }

  return normalized;
}

export function getPromptSlots(
  architecture: LoadedPromptArchitecture,
): PromptSlot[] {
  const slots: PromptSlot[] = architecture.stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    purpose: stage.purpose,
    required: true,
  }));

  if (architecture.combineStage) {
    slots.push({
      id: architecture.combineStage.id,
      label: architecture.combineStage.label,
      purpose: architecture.combineStage.purpose,
      required: true,
    });
  }

  return slots;
}

export function getMissingPromptLabels(
  architecture: LoadedPromptArchitecture,
  promptDrafts: PromptDraftMap,
): string[] {
  return getPromptSlots(architecture)
    .filter((slot) => (promptDrafts[slot.id] ?? "").trim().length === 0)
    .map((slot) => slot.label);
}

export function isPromptDraftMapComplete(
  architecture: LoadedPromptArchitecture,
  promptDrafts: PromptDraftMap,
): boolean {
  return getMissingPromptLabels(architecture, promptDrafts).length === 0;
}
