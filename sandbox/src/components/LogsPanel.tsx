import type { SandboxLogItem } from "../state";

export interface LogsPanelProps {
  logs: SandboxLogItem[];
  errorMessage?: string;
}

export function LogsPanel({ logs, errorMessage }: LogsPanelProps) {
  const latestStageLog = [...logs]
    .reverse()
    .find((entry) => typeof entry.details?.stageLabel === "string");

  const latestStageLabel = latestStageLog?.details?.stageLabel;
  const latestStageNumber = latestStageLog?.details?.stageNumber;
  const latestStageCount = latestStageLog?.details?.stageCount;
  const latestStageStatus = latestStageLog?.details?.stageStatus;
  const stageStatusText =
    latestStageStatus === "completed"
      ? "Completed"
      : latestStageStatus === "started"
        ? "Started"
        : "In progress";

  return (
    <div className="panel logs-panel stack">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Activity</p>
          <h2>What happened</h2>
        </div>
        <span className="badge">{logs.length} entries</span>
      </div>

      {latestStageLog && typeof latestStageLabel === "string" ? (
        <div className="log-stage-status">
          <span className="badge badge-running">{stageStatusText}</span>
          <strong>{latestStageLabel}</strong>
          {typeof latestStageNumber === "number" &&
          typeof latestStageCount === "number" ? (
            <span className="muted">
              ({latestStageNumber}/{latestStageCount})
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="log-list">
        {errorMessage ? (
          <div className="log-entry log-error">{errorMessage}</div>
        ) : null}
        {logs.length === 0 ? (
          <div className="log-entry muted">No logs yet.</div>
        ) : null}
        {logs.map((entry) => (
          <article key={entry.id} className={`log-entry log-${entry.level}`}>
            <div className="log-entry-content">
              <span className="log-time">
                [{new Date(entry.timestamp).toLocaleTimeString()}]
              </span>
              <span className={`log-level-badge level-${entry.level}`}>
                {entry.level.toUpperCase()}
              </span>
              <span className="log-message">{entry.message}</span>
            </div>
            {entry.details && Object.keys(entry.details).length > 0 ? (
              <pre className="log-details">
                {JSON.stringify(entry.details, null, 2)}
              </pre>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
