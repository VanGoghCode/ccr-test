import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { type FileDraft, createImportedFileDrafts } from "../state";

export interface FileSetEditorProps {
  fileDrafts: FileDraft[];
  onImportFiles: (fileDrafts: FileDraft[]) => void;
  onRemoveFile: (fileId: string) => void;
  metadata: string;
  onChangeMetadata: (metadata: string) => void;
}

export function FileSetEditor({
  fileDrafts,
  onImportFiles,
  onRemoveFile,
  metadata,
  onChangeMetadata,
}: FileSetEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isContextCollapsed, setIsContextCollapsed] = useState(true);

  function openFilePicker(): void {
    fileInputRef.current?.click();
  }

  async function importFiles(files: FileList | File[]): Promise<void> {
    const uploadedFiles = Array.from(files).filter(
      (file) => file.name.trim().length > 0,
    );

    if (uploadedFiles.length === 0) {
      setImportError("No valid files were detected. Try Browse files.");
      return;
    }

    try {
      const importedDrafts = await createImportedFileDrafts(uploadedFiles);
      onImportFiles(importedDrafts);
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImportError(message);
    }
  }

  function extractDroppedFiles(dataTransfer: DataTransfer): File[] {
    const itemFiles = Array.from(dataTransfer.items ?? []).flatMap((item) => {
      if (item.kind !== "file") {
        return [];
      }

      const file = item.getAsFile();
      return file ? [file] : [];
    });

    if (itemFiles.length > 0) {
      return itemFiles;
    }

    return Array.from(dataTransfer.files ?? []);
  }

  async function handleFileInputChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const files = event.currentTarget.files;
    if (!files || files.length === 0) {
      return;
    }

    const filesArray = Array.from(files);
    event.currentTarget.value = "";

    await importFiles(filesArray);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsDropActive(false);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    setIsDropActive(false);
    await importFiles(extractDroppedFiles(event.dataTransfer));
  }

  function handleRemoveFile(fileId: string): void {
    onRemoveFile(fileId);
    setImportError(null);
  }

  return (
    <div className="panel inputs-panel inputs-panel-spaced stack">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Inputs</p>
          <h2>Files to review</h2>
        </div>
      </div>

      <div
        className={`file-dropzone ${isDropActive ? "file-dropzone-active" : ""}`}
        onDragOver={(event) => handleDragOver(event)}
        onDragEnter={(event) => handleDragOver(event)}
        onDragLeave={(event) => handleDragLeave(event)}
        onDrop={(event) => void handleDrop(event)}
      >
        <div>
          <p className="eyebrow">Quick upload</p>
          <h3>Drop one or more files here</h3>
          <p className="muted">
            Uploaded files replace the current list and auto-fill file name,
            path, and contents.
          </p>
        </div>

        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            onClick={openFilePicker}
          >
            Browse files
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.pyi,.java,.go,.rs,.cs,.cpp,.c,.h,.hpp,.json,.md,.txt,.yaml,.yml"
          className="visually-hidden"
          onChange={(event) => void handleFileInputChange(event)}
        />

        <p className="muted">
          Current upload set: {fileDrafts.length} file(s).
        </p>

        {fileDrafts.length > 0 ? (
          <section className="file-card uploaded-files-card stack">
            <div className="file-card-header">
              <div>
                <p className="file-label">Uploaded files</p>
              </div>
            </div>
            <div className="uploaded-file-list">
              {fileDrafts.map((draft) => (
                <div key={draft.id} className="uploaded-file-row">
                  <span className="stage-path">{draft.fileName}</span>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => handleRemoveFile(draft.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {importError ? <div className="error-banner">{importError}</div> : null}

      <section className="file-card optional-context-card">
        <div className="file-card-header">
          <div>
            <p className="file-label">F2</p>
            <h3>Extra context (optional)</h3>
          </div>
          <button
            type="button"
            className="link-button file-toggle-button"
            onClick={() => setIsContextCollapsed((current) => !current)}
          >
            {isContextCollapsed ? "Expand" : "Minimize"}
          </button>
        </div>

        {isContextCollapsed ? (
          <p className="muted file-collapsed-note">
            Add useful notes such as purpose, risk, or expected behavior.
          </p>
        ) : (
          <label className="field compact-field">
            <span>Extra context</span>
            <textarea
              rows={4}
              value={metadata}
              onChange={(event) => onChangeMetadata(event.target.value)}
              placeholder="Add PR context, intent, risk notes, or testing notes."
            />
          </label>
        )}
      </section>
    </div>
  );
}
