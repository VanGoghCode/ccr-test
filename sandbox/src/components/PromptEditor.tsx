import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
  type PromptDraftMap,
  getMissingPromptLabels,
  getPromptSlots,
  normalizePromptImport,
} from "../../../src/core/prompt-config";
import type { LoadedPromptArchitecture } from "../../../src/core/types";

export interface PromptEditorProps {
  architecture?: LoadedPromptArchitecture;
  promptDrafts: PromptDraftMap;
  onChangePrompt: (promptId: string, value: string) => void;
  onMergePromptDrafts: (promptDrafts: PromptDraftMap) => void;
  onImportValidationChange: (errorMessage: string | null) => void;
}

type PromptCollapseMap = Record<string, boolean>;

function buildInitialPromptCollapseMap(
  architecture?: LoadedPromptArchitecture,
): PromptCollapseMap {
  if (!architecture || architecture.mode === "single") {
    return {};
  }

  return Object.fromEntries(
    getPromptSlots(architecture).map((slot) => [slot.id, true]),
  );
}

function buildImportPlaceholder(
  architecture: LoadedPromptArchitecture,
): string {
  if (architecture.mode === "single") {
    return '{"review":"Write the single review prompt here."}';
  }

  const placeholders = architecture.stages.map(
    (_, index) => `"stage${index + 1}": "prompt${index + 1}"`,
  );

  if (architecture.combineStage) {
    placeholders.push('"combine": "prompt-combine"');
  }

  return `{${placeholders.join(", ")}}`;
}

function buildSamplePromptJson(architecture: LoadedPromptArchitecture): string {
  if (architecture.mode === "single") {
    return JSON.stringify(
      {
        review: "Check changed files for correctness and summarize risk.",
      },
      null,
      2,
    );
  }

  const sample: Record<string, string> = Object.fromEntries(
    architecture.stages.map((_, index) => [
      `stage${index + 1}`,
      `Write instructions for stage ${index + 1}.`,
    ]),
  );

  if (architecture.combineStage) {
    sample.combine = "Merge findings into final CCR markdown.";
  }

  return JSON.stringify(sample, null, 2);
}

async function readJsonText(file: File): Promise<string> {
  return file.text();
}

function getJsonValidationError(
  architecture: LoadedPromptArchitecture | undefined,
  rawText: string,
): string | null {
  if (!architecture) {
    return null;
  }

  if (rawText.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText) as unknown;
    const imported = normalizePromptImport(architecture, parsed);
    if (Object.keys(imported).length === 0) {
      return "Import JSON has no supported keys for this template.";
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Import JSON is invalid: ${message}`;
  }
}

export function PromptEditor({
  architecture,
  promptDrafts,
  onChangePrompt,
  onMergePromptDrafts,
  onImportValidationChange,
}: PromptEditorProps) {
  const [jsonText, setJsonText] = useState(
    () =>
      globalThis.localStorage?.getItem("ccr-sandbox-instructions-json") ?? "",
  );

  const lastAppliedRef = useRef<{
    jsonText: string;
    architectureId: string | undefined;
  }>({
    jsonText: "",
    architectureId: undefined,
  });

  useEffect(() => {
    globalThis.localStorage?.setItem("ccr-sandbox-instructions-json", jsonText);
    if (!architecture || jsonText.trim().length === 0) return;

    if (
      lastAppliedRef.current.jsonText === jsonText &&
      lastAppliedRef.current.architectureId === architecture.id
    ) {
      return;
    }

    // Auto-apply JSON instructions
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const imported = normalizePromptImport(architecture, parsed);
      if (Object.keys(imported).length > 0) {
        onMergePromptDrafts(imported);
        lastAppliedRef.current = { jsonText, architectureId: architecture.id };
      }
    } catch {
      // Ignore parse errors silently during auto-apply
    }
  }, [jsonText, architecture, onMergePromptDrafts]);

  const [importError, setImportError] = useState<string | null>(null);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [collapsedPrompts, setCollapsedPrompts] = useState<PromptCollapseMap>(
    () => buildInitialPromptCollapseMap(architecture),
  );

  useEffect(() => {
    setCollapsedPrompts(buildInitialPromptCollapseMap(architecture));
  }, [architecture]);

  const jsonValidationError = getJsonValidationError(architecture, jsonText);

  useEffect(() => {
    onImportValidationChange(jsonValidationError);
  }, [jsonValidationError, onImportValidationChange]);

  async function applyJsonText(rawText = jsonText): Promise<void> {
    if (!architecture) {
      return;
    }

    const validationError = getJsonValidationError(architecture, rawText);
    if (validationError) {
      setImportError(validationError);
      return;
    }

    try {
      const parsed = JSON.parse(rawText) as unknown;
      const imported = normalizePromptImport(architecture, parsed);
      if (Object.keys(imported).length === 0) {
        throw new Error(
          "The JSON file did not contain any recognized prompt keys for this architecture.",
        );
      }

      onMergePromptDrafts(imported);
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImportError(message);
    }
  }

  async function handleFileUpload(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !architecture) {
      return;
    }

    try {
      const rawText = await readJsonText(file);
      setJsonText(rawText);
      await applyJsonText(rawText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImportError(message);
    }
  }

  if (!architecture) {
    return (
      <div className="panel prompts-panel stack">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Instructions</p>
            <h2>Review instructions</h2>
          </div>
          <span className="badge">Loading...</span>
        </div>
        <div className="log-entry muted">Loading instruction fields...</div>
      </div>
    );
  }

  const promptSlots = getPromptSlots(architecture);
  const missingPromptLabels = getMissingPromptLabels(
    architecture,
    promptDrafts,
  );
  const promptStatus =
    missingPromptLabels.length === 0
      ? "All required instructions are ready"
      : `${missingPromptLabels.length} required instruction(s) missing`;
  const sampleJson = buildSamplePromptJson(architecture);
  const hasCollapsiblePrompts = architecture.mode !== "single";

  function isPromptCollapsed(promptId: string): boolean {
    if (!hasCollapsiblePrompts) {
      return false;
    }

    return collapsedPrompts[promptId] ?? true;
  }

  function togglePromptCollapse(promptId: string): void {
    setCollapsedPrompts((current) => ({
      ...current,
      [promptId]: !(current[promptId] ?? true),
    }));
  }

  function setAllPromptsCollapsed(collapsed: boolean): void {
    setCollapsedPrompts(
      Object.fromEntries(promptSlots.map((slot) => [slot.id, collapsed])),
    );
  }

  async function copySampleJson(): Promise<void> {
    try {
      await navigator.clipboard.writeText(sampleJson);
      setImportError(null);
    } catch {
      setImportError("Unable to copy sample JSON to clipboard.");
    }
  }

  return (
    <div className="panel prompts-panel stack">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Instructions</p>
          <h2>Review instructions</h2>
        </div>
        <span
          className={`badge ${missingPromptLabels.length === 0 ? "badge-completed" : "badge-failed"}`}
        >
          {promptStatus}
        </span>
      </div>

      <p className="muted">
        Fill all required instruction boxes before running. If helpful, you can
        import JSON and still edit each field after import.
      </p>

      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setIsPromptModalOpen(true)}
        >
          Open instruction editor
        </button>
      </div>

      {isPromptModalOpen ? (
        <dialog
          className="output-overlay"
          open
          aria-label="Instruction editor modal"
        >
          <div className="panel output-dialog prompt-editor-dialog stack">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Instruction editor</p>
                <h2>Edit required instructions</h2>
              </div>
              <div className="button-row">
                {hasCollapsiblePrompts ? (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setAllPromptsCollapsed(true)}
                    >
                      Minimize all prompts
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setAllPromptsCollapsed(false)}
                    >
                      Expand all prompts
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsPromptModalOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>

            <div className="prompt-scroll-box">
              <div className="stack file-grid">
                {promptSlots.map((slot, index) => {
                  const collapsed = isPromptCollapsed(slot.id);
                  const promptText = promptDrafts[slot.id] ?? "";

                  return (
                    <section key={slot.id} className="file-card prompt-card">
                      <div className="file-card-header">
                        <div>
                          <p className="file-label">
                            {architecture.mode === "single"
                              ? "Single instruction"
                              : `Instruction ${index + 1}`}
                          </p>
                          <h3>{slot.label}</h3>
                        </div>
                        <div className="prompt-card-actions">
                          <span className="badge">Required</span>
                          {hasCollapsiblePrompts ? (
                            <button
                              type="button"
                              className="link-button prompt-toggle-button"
                              onClick={() => togglePromptCollapse(slot.id)}
                            >
                              {collapsed ? "Expand" : "Minimize"}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <p className="prompt-purpose muted">{slot.purpose}</p>

                      {collapsed ? (
                        <div className="prompt-collapsed muted">
                          {promptText.trim().length > 0
                            ? "Instruction text hidden. Expand to edit."
                            : "Instruction minimized by default. Expand to edit."}
                        </div>
                      ) : (
                        <label className="field">
                          <span>Prompt text</span>
                          <textarea
                            rows={8}
                            required
                            value={promptText}
                            onChange={(event) =>
                              onChangePrompt(slot.id, event.target.value)
                            }
                            placeholder={
                              architecture.mode === "single"
                                ? "Write the single review prompt here."
                                : `Write instructions for ${slot.label.toLowerCase()}.`
                            }
                          />
                        </label>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        </dialog>
      ) : null}

      <div className="stack">
        <label className="field compact-field">
          <span>Import instructions JSON</span>
          <textarea
            rows={6}
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            placeholder={buildImportPlaceholder(architecture)}
          />
        </label>

        <div className="prompt-json-sample">
          <p className="muted">Sample JSON (copy, edit, then apply):</p>
          <pre>{sampleJson}</pre>
          <div className="button-row">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setJsonText(sampleJson)}
            >
              Use sample
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void copySampleJson()}
            >
              Copy sample
            </button>
          </div>
        </div>

        {jsonValidationError ? (
          <div className="error-banner">{jsonValidationError}</div>
        ) : null}
        {importError ? <div className="error-banner">{importError}</div> : null}

        <p className="muted">
          Supported keys: stage1 to stage6, combine for the parallel combiner,
          and review for the single prompt architecture.
        </p>
      </div>
    </div>
  );
}
