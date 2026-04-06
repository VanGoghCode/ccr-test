import { useEffect, useReducer, useRef, useState } from "react";
import {
  fetchArchitectures,
  startSandboxRun,
  subscribeToSandboxRun,
} from "./api";
import { ApiTestWidget } from "./components/ApiTestWidget";
import { ArchitectureSwitcher } from "./components/ArchitectureSwitcher";
import { FileSetEditor } from "./components/FileSetEditor";
import { LLMInspector } from "./components/LLMInspector";
import { OutputPanel } from "./components/OutputPanel";
import { PromptEditor } from "./components/PromptEditor";
import {
  buildReviewRequest,
  createInitialSandboxState,
  getPromptCoverageLabels,
  getPromptDraftsForArchitecture,
  getSelectedArchitecture,
  sandboxReducer,
} from "./state";

type ClientLogLevel = "debug" | "info" | "warn" | "error";

export function App() {
  const [state, dispatch] = useReducer(
    sandboxReducer,
    undefined,
    createInitialSandboxState,
  );
  const [loadingArchitectures, setLoadingArchitectures] = useState(true);
  const [architectureError, setArchitectureError] = useState<string | null>(
    null,
  );
  const [showOutput, setShowOutput] = useState(false);
  const [promptImportValidationError, setPromptImportValidationError] =
    useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  function appendClientLog(
    level: ClientLogLevel,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    dispatch({
      type: "append-log",
      entry: {
        timestamp: new Date().toISOString(),
        level,
        message,
        details,
      },
    });
  }

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        setLoadingArchitectures(true);
        const architectures = await fetchArchitectures();
        if (!active) {
          return;
        }

        dispatch({ type: "set-architectures", architectures });
        setArchitectureError(null);
      } catch (error) {
        if (!active) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setArchitectureError(message);
      } finally {
        if (active) {
          setLoadingArchitectures(false);
        }
      }
    })();

    return () => {
      active = false;
      streamRef.current?.close();
    };
  }, []);

  async function runSandboxReview() {
    const architecture = getSelectedArchitecture(state);
    if (!architecture) {
      return;
    }

    if (state.fileDrafts.length === 0) {
      appendClientLog("warn", "Run blocked because no files are uploaded.", {
        architectureId: architecture.id,
      });
      dispatch({
        type: "set-run-status",
        status: "failed",
        errorMessage: "Upload at least one file before running the review.",
      });
      return;
    }

    const promptDrafts = getPromptDraftsForArchitecture(state, architecture.id);
    if (promptImportValidationError) {
      appendClientLog(
        "warn",
        "Run blocked because Import instructions JSON is invalid.",
        {
          architectureId: architecture.id,
          error: promptImportValidationError,
        },
      );
      dispatch({
        type: "set-run-status",
        status: "failed",
        errorMessage: "Fix Import instructions JSON before running the review.",
      });
      return;
    }

    const missingPromptLabels = getPromptCoverageLabels(
      architecture,
      promptDrafts,
    );
    if (missingPromptLabels.length > 0) {
      appendClientLog(
        "warn",
        "Run blocked because some required prompts are missing.",
        {
          architectureId: architecture.id,
          missingPrompts: missingPromptLabels,
        },
      );
      dispatch({
        type: "set-run-status",
        status: "failed",
        errorMessage: `Fill all prompts before running: ${missingPromptLabels.join(", ")}.`,
      });
      return;
    }

    streamRef.current?.close();
    dispatch({ type: "clear-run" });
    dispatch({ type: "set-run-status", status: "running" });
    appendClientLog("info", "Submitting review run.", {
      architectureId: architecture.id,
      fileCount: state.fileDrafts.length,
    });

    try {
      const reviewRequest = buildReviewRequest(state);
      const response = await startSandboxRun(reviewRequest);
      appendClientLog("info", "Review run accepted by sandbox API.", {
        runId: response.runId,
      });
      dispatch({
        type: "set-run-status",
        status: "running",
        runId: response.runId,
      });

      const source = subscribeToSandboxRun(response.runId, {
        onLog: (entry) => dispatch({ type: "append-log", entry }),
        onResult: (report) => {
          dispatch({
            type: "append-log",
            entry: {
              timestamp: new Date().toISOString(),
              level: "info",
              message: "Review run completed.",
              details: {
                runId: response.runId,
                markdownLength: report.markdown.length,
              },
            },
          });
          dispatch({
            type: "set-output",
            markdown: report.markdown,
            rawModelOutput: report.rawModelOutput,
          });
          dispatch({
            type: "set-run-status",
            status: "completed",
            runId: response.runId,
          });
          source.close();
        },
        onError: (error) => {
          dispatch({
            type: "append-log",
            entry: {
              timestamp: new Date().toISOString(),
              level: "error",
              message: "Review run failed.",
              details: {
                runId: response.runId,
                error,
              },
            },
          });
          dispatch({
            type: "set-run-status",
            status: "failed",
            runId: response.runId,
            errorMessage: error,
          });
          source.close();
        },
        onStatus: (status) => {
          if (status === "completed") {
            dispatch({
              type: "set-run-status",
              status: "completed",
              runId: response.runId,
            });
          }
        },
      });

      streamRef.current = source;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendClientLog("error", "Unable to start review run.", {
        architectureId: architecture.id,
        error: message,
      });
      dispatch({
        type: "set-run-status",
        status: "failed",
        errorMessage: message,
      });
    }
  }

  async function copyOutput() {
    if (state.outputMarkdown.length === 0) {
      return;
    }

    await navigator.clipboard.writeText(state.outputMarkdown);
  }

  const selectedArchitecture = getSelectedArchitecture(state);
  const selectedPromptDrafts = selectedArchitecture
    ? getPromptDraftsForArchitecture(state, selectedArchitecture.id)
    : {};
  const missingPromptLabels = selectedArchitecture
    ? getPromptCoverageLabels(selectedArchitecture, selectedPromptDrafts)
    : [];
  const canRunReview = Boolean(
    selectedArchitecture &&
      !loadingArchitectures &&
      state.fileDrafts.length > 0 &&
      missingPromptLabels.length === 0 &&
      !promptImportValidationError,
  );
  const readyFileCount = state.fileDrafts.filter(
    (draft) => draft.sampleCode.trim().length > 0,
  ).length;

  return (
    <div className="app-shell">
      <header className="topbar panel">
        <div className="topbar-brand">
          <p className="eyebrow">CCR Sandbox</p>
          <h1>Critical Code Reviewer</h1>
        </div>

        <div className="topbar-controls">
          <ArchitectureSwitcher
            architectures={state.architectures}
            selectedArchitectureId={state.selectedArchitectureId}
            onSelect={(architectureId) =>
              dispatch({ type: "select-architecture", architectureId })
            }
            disabled={loadingArchitectures}
          />

          <span
            className={`badge ${missingPromptLabels.length === 0 ? "badge-completed" : "badge-failed"}`}
          >
            {selectedArchitecture
              ? missingPromptLabels.length === 0
                ? "Instructions ready"
                : `${missingPromptLabels.length} instructions missing`
              : loadingArchitectures
                ? "Loading templates"
                : "No template selected"}
          </span>

          {promptImportValidationError ? (
            <span className="badge badge-failed">Fix Import JSON</span>
          ) : null}

          <span className={`badge badge-${state.runStatus}`}>
            {state.runStatus === "idle" ? "Not started" : state.runStatus}
          </span>

          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowOutput(true)}
            disabled={state.outputMarkdown.length === 0}
          >
            View report
          </button>

          {state.runStatus === "running" ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                streamRef.current?.close();
                dispatch({
                  type: "append-log",
                  entry: {
                    timestamp: new Date().toISOString(),
                    level: "warn",
                    message: "Review run cancelled by user.",
                  },
                });
                dispatch({
                  type: "set-run-status",
                  status: "failed",
                  errorMessage: "Review aborted by user.",
                });
              }}
            >
              Cancel review
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() => void runSandboxReview()}
              disabled={!canRunReview}
            >
              Run review
            </button>
          )}
        </div>
      </header>

      <section className="panel quick-start">
        <div className="quick-start-grid">
          <div className="quick-step">
            <h3>Add files</h3>
            <p className="muted">Upload or paste the code you want reviewed.</p>
            <span className="badge">{readyFileCount} file(s) ready</span>
          </div>
          <div className="quick-step">
            <h3>Add instructions</h3>
            <p className="muted">
              Fill each required instruction box for your template.
            </p>
            <span
              className={`badge ${missingPromptLabels.length === 0 ? "badge-completed" : "badge-failed"}`}
            >
              {missingPromptLabels.length === 0
                ? "All required instructions filled"
                : `${missingPromptLabels.length} still needed`}
            </span>
          </div>
          <div className="quick-step">
            <h3>Run and review</h3>
            <p className="muted">
              Generate the report and open it from View report.
            </p>
            <span className={`badge badge-${state.runStatus}`}>
              {state.runStatus}
            </span>
          </div>
        </div>
      </section>

      {architectureError ? (
        <div className="error-banner">{architectureError}</div>
      ) : null}

      <main className="workspace">
        <section className="input-column">
          <PromptEditor
            key={selectedArchitecture?.id ?? "loading"}
            architecture={selectedArchitecture}
            promptDrafts={selectedPromptDrafts}
            onChangePrompt={(promptId, value) => {
              if (!selectedArchitecture) {
                return;
              }

              dispatch({
                type: "update-prompt",
                architectureId: selectedArchitecture.id,
                promptId,
                value,
              });
            }}
            onMergePromptDrafts={(promptDrafts) => {
              if (!selectedArchitecture) {
                return;
              }

              dispatch({
                type: "merge-prompt-drafts",
                architectureId: selectedArchitecture.id,
                promptDrafts,
              });
            }}
            onImportValidationChange={setPromptImportValidationError}
          />
        </section>

        <section className="log-column">
          <FileSetEditor
            fileDrafts={state.fileDrafts}
            onImportFiles={(fileDrafts) =>
              dispatch({ type: "replace-file-drafts", fileDrafts })
            }
            onRemoveFile={(fileId) => dispatch({ type: "remove-file", fileId })}
            metadata={state.metadata}
            onChangeMetadata={(metadata) =>
              dispatch({ type: "set-metadata", metadata })
            }
          />
        </section>
      </main>

      <LLMInspector
        promptText={state.sentPrompt}
        rawModelOutput={state.rawModelOutput}
        runStatus={state.runStatus}
      />

      <OutputPanel
        open={showOutput}
        markdown={state.outputMarkdown}
        runStatus={state.runStatus}
        architectureName={selectedArchitecture?.label}
        fileCount={state.fileDrafts.length}
        onCopy={() => void copyOutput()}
        onClose={() => setShowOutput(false)}
      />

      <ApiTestWidget />
    </div>
  );
}
