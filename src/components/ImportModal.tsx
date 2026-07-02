import { useState, useRef, useEffect } from "react";
import { gameNameFromPath } from "../types/game";

export interface ExeInfo {
  path: string;
  size: number;
  modifiedAt: number;
}

interface ImportModalProps {
  exeInfos: ExeInfo[];
  onConfirm: (selectedPaths: string[]) => void;
  onCancel: () => void;
}

export default function ImportModal({
  exeInfos,
  onConfirm,
  onCancel,
}: ImportModalProps) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(exeInfos.map((e) => e.path))
  );
  const selectAllRef = useRef<HTMLInputElement>(null);

  const allSelected = selected.size === exeInfos.length;
  const someSelected = selected.size > 0 && selected.size < exeInfos.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(exeInfos.map((e) => e.path)));
    }
  }

  function formatSize(bytes: number): string {
    if (bytes === 0) return "—";
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(0)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(1)} GB`;
  }

  function formatDate(timestamp: number): string {
    if (timestamp === 0) return "—";
    const d = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  }

  function getDirectory(fullPath: string): string {
    const parts = fullPath.split(/[\\/]/);
    parts.pop();
    return parts.join("\\");
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal import-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title">Select Games to Import</h2>
            <p className="modal-subtitle">
              Found {exeInfos.length} executable{exeInfos.length !== 1 ? "s" : ""}{" "}
              in the selected folder
            </p>
          </div>
        </div>

        <div className="modal-select-bar">
          <label className="modal-select-all">              <input
                type="checkbox"
                checked={allSelected}
                ref={selectAllRef}
                onChange={toggleAll}
              />
            <span>
              {allSelected
                ? "Deselect All"
                : `Select All (${selected.size}/${exeInfos.length})`}
            </span>
          </label>
        </div>

        <div className="modal-exe-list">
          <div className="modal-exe-list-header">
            <span className="modal-exe-col-check" />
            <span className="modal-exe-col-icon-header" />
            <span className="modal-exe-col-name">Name</span>
            <span className="modal-exe-col-size">Size</span>
            <span className="modal-exe-col-date">Modified</span>
          </div>
          {exeInfos.map((exe) => {
            const displayName = gameNameFromPath(exe.path);
            const dir = getDirectory(exe.path);
            const isChecked = selected.has(exe.path);

            return (
              <label
                key={exe.path}
                className={`modal-exe-item${isChecked ? " selected" : ""}`}
              >
                <div className="modal-exe-col-check">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(exe.path)}
                  />
                </div>
                <div className="modal-exe-col-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <div className="modal-exe-col-name modal-exe-info">
                  <span className="modal-exe-name">{displayName}</span>
                  <span className="modal-exe-path" title={exe.path}>
                    {dir}
                  </span>
                </div>
                <span className="modal-exe-col-size">{formatSize(exe.size)}</span>
                <span className="modal-exe-col-date">{formatDate(exe.modifiedAt)}</span>
              </label>
            );
          })}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {selected.size} game{selected.size !== 1 ? "s" : ""} selected
          </span>
          <div className="modal-footer-actions">
            <button className="modal-btn modal-btn-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="modal-btn modal-btn-confirm"
              disabled={selected.size === 0}
              onClick={() => {
                const selectedPaths = exeInfos
                  .filter((e) => selected.has(e.path))
                  .map((e) => e.path);
                onConfirm(selectedPaths);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Import Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
