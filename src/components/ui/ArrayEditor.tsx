import { useState, type ReactNode } from "react";

export interface ArrayEditorColumn<T> {
  key: keyof T & string;
  label: string;
  type?: "text" | "number" | "select" | "textarea";
  options?: string[];
  placeholder?: string;
  width?: string;
}

interface ArrayEditorProps<T> {
  value: T[];
  onChange: (next: T[]) => void;
  columns: ArrayEditorColumn<T>[];
  createEmpty: () => T;
  addLabel?: string;
  emptyText?: string;
  /** Optional custom row renderer for richer cells (e.g. review preview). */
  renderCell?: (column: ArrayEditorColumn<T>, row: T, rowIndex: number, set: (patch: Partial<T>) => void) => ReactNode;
}

/**
 * Generic add/remove/edit row editor used for structured arrays that used to
 * be raw JSON textareas (Releases, Community Reviews, Supported Languages).
 */
export function ArrayEditor<T>({
  value,
  onChange,
  columns,
  createEmpty,
  addLabel = "Add row",
  emptyText = "Nothing added yet.",
  renderCell,
}: ArrayEditorProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<T>(createEmpty());

  const updateRow = (rowIndex: number, patch: Partial<T>) => {
    onChange(value.map((r, i) => (i === rowIndex ? { ...r, ...patch } : r)));
  };

  const removeRow = (rowIndex: number) => {
    onChange(value.filter((_, i) => i !== rowIndex));
  };

  const addRow = () => {
    const row = { ...createEmpty(), ...draft } as T;
    const hasContent = columns.some((c) => {
      const v = row[c.key];
      return typeof v === "string" ? v.trim() !== "" : v != null;
    });
    onChange([...value, hasContent ? row : createEmpty()]);
    setDraft(createEmpty());
    setExpanded(false);
  };

  const setDraftField = (key: keyof T & string, v: unknown) => {
    setDraft((d) => ({ ...d, [key]: v }));
  };

  return (
    <div className="array-editor">
      {value.length === 0 ? (
        <p className="array-editor-empty">{emptyText}</p>
      ) : (
        <div className="array-editor-rows">
          {value.map((row, rowIndex) => (
            <div className="array-editor-row" key={rowIndex}>
              {columns.map((col) => (
                <div className="array-editor-cell" style={{ flex: col.width ? `0 0 ${col.width}` : 1 }} key={col.key}>
                  {renderCell ? (
                    renderCell(col, row, rowIndex, (patch) => updateRow(rowIndex, patch))
                  ) : (
                    <>
                      <label className="array-editor-cell-label">{col.label}</label>
                      {col.type === "select" ? (
                        <select
                          className="edit-input array-editor-input"
                          value={String(row[col.key] ?? "")}
                          onChange={(e) => updateRow(rowIndex, { [col.key]: e.target.value } as Partial<T>)}
                        >
                          <option value="">—</option>
                          {col.options?.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : col.type === "textarea" ? (
                        <textarea
                          className="edit-input edit-textarea array-editor-input"
                          rows={2}
                          value={String(row[col.key] ?? "")}
                          placeholder={col.placeholder}
                          onChange={(e) => updateRow(rowIndex, { [col.key]: e.target.value } as Partial<T>)}
                        />
                      ) : (
                        <input
                          className="edit-input array-editor-input"
                          type={col.type === "number" ? "number" : "text"}
                          value={String(row[col.key] ?? "")}
                          placeholder={col.placeholder}
                          onChange={(e) =>
                            updateRow(rowIndex, {
                              [col.key]: col.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value,
                            } as Partial<T>)
                          }
                        />
                      )}
                    </>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="array-editor-remove"
                aria-label="Remove row"
                onClick={() => removeRow(rowIndex)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {expanded ? (
        <div className="array-editor-add">
          {columns.map((col) => (
            <div className="array-editor-cell" style={{ flex: col.width ? `0 0 ${col.width}` : 1 }} key={col.key}>
              <label className="array-editor-cell-label">{col.label}</label>
              {col.type === "select" ? (
                <select
                  className="edit-input array-editor-input"
                  value={String(draft[col.key] ?? "")}
                  onChange={(e) => setDraftField(col.key, e.target.value)}
                >
                  <option value="">—</option>
                  {col.options?.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="edit-input array-editor-input"
                  type={col.type === "number" ? "number" : "text"}
                  value={String(draft[col.key] ?? "")}
                  placeholder={col.placeholder}
                  onChange={(e) => setDraftField(col.key, col.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
                />
              )}
            </div>
          ))}
          <div className="array-editor-add-actions">
            <button type="button" className="edit-btn edit-btn-secondary" onClick={addRow}>Add</button>
            <button type="button" className="edit-btn edit-btn-ghost" onClick={() => { setExpanded(false); setDraft(createEmpty()); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="array-editor-add-trigger" onClick={() => setExpanded(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {addLabel}
        </button>
      )}
    </div>
  );
}
