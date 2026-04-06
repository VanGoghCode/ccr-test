import type { LoadedPromptArchitecture } from "../../../src/core/types";

export interface ArchitectureSwitcherProps {
  architectures: LoadedPromptArchitecture[];
  selectedArchitectureId: string;
  onSelect: (architectureId: string) => void;
  disabled?: boolean;
}

export function ArchitectureSwitcher({
  architectures,
  selectedArchitectureId,
  onSelect,
  disabled = false,
}: ArchitectureSwitcherProps) {
  return (
    <label className="architecture-switcher architecture-switcher-highlight">
      <span className="architecture-switcher-label">
        <span className="eyebrow">Template</span>
        <span>Review template</span>
      </span>
      <select
        className="select-control"
        value={selectedArchitectureId}
        onChange={(event) => onSelect(event.target.value)}
        disabled={disabled || architectures.length === 0}
      >
        {architectures.length === 0 ? (
          <option value="">Loading...</option>
        ) : null}
        {architectures.map((architecture) => (
          <option key={architecture.id} value={architecture.id}>
            {architecture.label}
          </option>
        ))}
      </select>
    </label>
  );
}
