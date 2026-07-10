// Reusable destructive-action confirmation modal.
//
// Destructive actions in the app (currently: "delete download from
// disk") need a confirmation step before they run — the action is
// irreversible and the user should see *what* they're about to lose
// (name, size, save path) before they click. We render via a
// React Portal (`document.body`) so callers that have CSS
// `overflow: hidden` (the top-nav Downloads popover) don't clip
// the overlay.
//
// The modal is visually small but rich: bold title, descriptive body
// children, optional inline warning (for the auto-extract case where
// only archives are deleted, not the installed game), and a
// two-button footer (Cancel / Confirm). Cancel is the default —
// focused on mount, closes on Enter, Escape, or backdrop click.
//
// We deliberately do NOT use the native `window.confirm()`: native
// confirms are thread-blocking, visually jarring, and don't allow
// bold typography for the torrent name. A custom modal lets the
// confirmation read as part of the same design language as the rest
// of the app.

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

export interface ConfirmModalProps {
  /** Open state. When false, the portal renders `null`. */
  open: boolean;
  /** Bold headline (e.g. "Delete Game Name from disk?"). */
  title: ReactNode;
  /** Supporting paragraph(s). Optional. Rendered under the title. */
  message?: ReactNode;
  /**
   * Optional inline warning block (e.g. for the auto-extract case
   * where the deletion only wipes archives and leaves the installed
   * game untouched). Rendered with a yellow accent so it reads as
   * a warning, not a regular paragraph.
   */
  warning?: ReactNode;
  /** Label of the destructive action button. Defaults to "Delete". */
  confirmLabel?: ReactNode;
  /** Label of the cancel button. Defaults to "Cancel". */
  cancelLabel?: ReactNode;
  /** Disable both buttons while async work is in flight. */
  busy?: boolean;
  /** Called when the user confirms. Should resolve any pending work. */
  onConfirm: () => void;
  /** Called on cancel/backdrop/Escape. */
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  warning,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the Cancel button on open. Putting focus on Cancel
  // (NOT Delete) deliberately protects against Enter-spamming
  // through muscle memory: the user has to tab past Cancel — or
  // click Delete specifically — to commit an irreversible action.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      cancelRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [open]);

  // Escape to cancel — except while busy, so an in-flight delete
  // can't be orphaned by a stray key-press.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      data-busy={busy ? "true" : undefined}
      onMouseDown={busy ? undefined : onCancel}
      role="presentation"
    >
      <div
        className="modal confirm-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="modal-header">
          <div className="modal-header-icon modal-header-icon--danger">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="confirm-modal-title">
              {title}
            </h2>
          </div>
        </div>

        <div className="modal-body confirm-modal-body">
          {message}
          {warning && (
            <div className="confirm-modal-warning" role="note">
              {warning}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">&nbsp;</span>
          <div className="modal-footer-actions">
            <Button
              variant="ghost"
              ref={cancelRef}
              onClick={onCancel}
              disabled={busy}
            >
              {cancelLabel}
            </Button>
            <Button
              variant="danger"
              onClick={onConfirm}
              isLoading={busy}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
