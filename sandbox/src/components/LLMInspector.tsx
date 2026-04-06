export interface LLMInspectorProps {
  promptText: string;
  rawModelOutput: string;
  runStatus: "idle" | "running" | "completed" | "failed";
}

export function LLMInspector({
  promptText,
  rawModelOutput,
  runStatus,
}: LLMInspectorProps) {
  return (
    <div className="panel stack" style={{ margin: "1rem" }}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Details</p>
          <h2>LLM Communication Inspector</h2>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div className="field compact-field">
          <span>Exact Prompt Sent to LLM</span>
          <textarea
            readOnly
            rows={10}
            value={promptText || "Not initiated yet. Run a review."}
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "0.8rem",
              whiteSpace: "pre",
            }}
          />
        </div>

        <div className="field compact-field">
          <span>Exact LLM Response</span>
          <textarea
            readOnly
            rows={15}
            value={
              rawModelOutput ||
              (runStatus === "idle"
                ? "Waiting for review to start..."
                : "Waiting for LLM response...")
            }
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "0.8rem",
              whiteSpace: "pre-wrap",
            }}
          />
        </div>
      </div>
    </div>
  );
}
