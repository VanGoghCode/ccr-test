export interface OutputPanelProps {
  open: boolean;
  markdown: string;
  runStatus: "idle" | "running" | "completed" | "failed";
  architectureName?: string;
  fileCount: number;
  onCopy?: () => void;
  onClose: () => void;
}

export function OutputPanel({
  open,
  markdown,
  runStatus,
  architectureName,
  fileCount,
  onCopy,
  onClose,
}: OutputPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <dialog className="output-overlay" open aria-label="CCR.md output viewer">
      <div className="panel output-dialog stack">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Review result</p>
            <h2>Review report</h2>
          </div>
          <div className="meta-row">
            <span className={`badge badge-${runStatus}`}>{runStatus}</span>
            <span className="badge">
              {architectureName ?? "No architecture"}
            </span>
            <span className="badge">{fileCount} files</span>
            <button
              type="button"
              className="secondary-button"
              onClick={onCopy}
              disabled={markdown.length === 0}
            >
              Copy
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>

        <label className="field output-field">
          <span>Exact markdown report</span>
          <textarea
            className="output-markdown"
            readOnly
            value={markdown || "Run a review to generate the report."}
          />
        </label>
      </div>
    </dialog>
  );
}
