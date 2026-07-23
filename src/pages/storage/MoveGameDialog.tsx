import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useToast } from "../../context/ToastContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { formatSize, type Game } from "../../types/game";
import { Button } from "../../components/ui";
import { relocateExe } from "./utils";

interface MoveProgressPayload {
  gameId: string;
  copiedBytes: number;
  totalBytes: number;
  phase: string;
}

interface Props {
  /** One or many installed games to relocate. The dialog moves them
   *  sequentially into the same destination folder. */
  games: Game[];
  /** Called once per successfully-moved game so the page can rewrite the
   *  record's `path` / `sizeRootPath` and refresh staleness. */
  onMoved: (game: Game, toPath: string, newExe: string) => void;
  onClose: () => void;
}

/** Move / relocate install folders between drives.
 *
 *  Presents a destination picker, then streams the Rust `game-move-progress`
 *  events into a single progress bar. Moves are sequential so the disk
 *  walker isn't contending with itself, and each game's record is patched as
 *  soon as its move completes (so a mid-batch failure doesn't lose the work
 *  already done). */
export function MoveGameDialog({ games, onMoved, onClose }: Props) {
  const { showToast } = useToast();
  const { unit } = useSizeUnit();

  const [destDir, setDestDir] = useState("");
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<"idle" | "copying" | "verifying" | "cleaning">("idle");
  const [copied, setCopied] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Listen for progress ticks for the whole batch. Moves run sequentially,
  // so at any moment only the current game is emitting — we can map the
  // latest tick straight onto the visible progress bar.
  useEffect(() => {
    let cancelled = false;
    listen<MoveProgressPayload>("game-move-progress", (e) => {
      if (cancelled) return;
      setCopied(e.payload.copiedBytes);
      setTotal(e.payload.totalBytes);
      setPhase(e.payload.phase as typeof phase);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenRef.current = fn;
    });
    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  async function pickDestination() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Select destination folder",
    });
    if (typeof picked === "string" && picked.trim() !== "") {
      setDestDir(picked);
    }
  }

  async function run() {
    if (!destDir || running) return;
    setRunning(true);
    setErrors([]);
    const failed: string[] = [];

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      setCurrent(i);
      setCopied(0);
      setTotal(0);
      setPhase("copying");
      const fromRoot = g.sizeRootPath || g.path;
      if (!fromRoot) {
        failed.push(`${g.name}: no install folder known`);
        continue;
      }
      try {
        const result = await invoke<{ toPath: string; sizeBytes: number }>(
          "move_game_install",
          { gameId: g.id, fromRoot, destDir }
        );
        const newExe = relocateExe(g.path, fromRoot, result.toPath);
        onMoved(g, result.toPath, newExe);
        setDone((d) => d + 1);
      } catch (err) {
        const msg = typeof err === "string" ? err : String(err);
        failed.push(`${g.name}: ${msg}`);
        console.error("move_game_install failed for", g.name, err);
      }
    }

    setRunning(false);
    setPhase("idle");
    if (failed.length === 0) {
      showToast(
        `Moved ${done} game${done === 1 ? "" : "s"} to ${destDir}`,
        "success"
      );
      onClose();
    } else {
      setErrors(failed);
      showToast(
        `Moved ${done} of ${games.length}. ${failed.length} failed — see details.`,
        "error"
      );
    }
  }

  const pct = total > 0 ? Math.min(100, (copied / total) * 100) : 0;
  const phaseLabel =
    phase === "verifying"
      ? "Verifying…"
      : phase === "cleaning"
        ? "Cleaning up old folder…"
        : "Copying…";

  const multiple = games.length > 1;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={() => !running && onClose()}
      role="presentation"
    >
      <div
        className="modal move-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-dialog-title"
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 7h13l-3-3" />
              <path d="M21 17H8l3 3" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="move-dialog-title">
              {multiple ? `Move ${games.length} games` : `Move ${games[0]?.name ?? ""}`}
            </h2>
          </div>
        </div>

        <div className="modal-body move-dialog-body">
          {!running && errors.length === 0 && (
            <>
              <p className="move-dialog-lead">
                Choose a destination folder. Each game keeps its own folder
                name, so it will be copied underneath the location you pick.
              </p>
              <button
                type="button"
                className="move-dialog-dest"
                onClick={pickDestination}
                disabled={running}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                <span className="move-dialog-dest-value">
                  {destDir || "Select destination folder…"}
                </span>
              </button>
              {multiple && (
                <ul className="move-dialog-list">
                  {games.map((g) => (
                    <li key={g.id} className="move-dialog-list-item">
                      <span className="move-dialog-list-name">{g.name}</span>
                      <span className="move-dialog-list-size">
                        {formatSize(g.sizeBytes, unit)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {running && (
            <div className="move-dialog-progress">
              <div className="move-dialog-progress-head">
                <span>
                  {multiple
                    ? `Moving ${current + 1} of ${games.length}: ${games[current]?.name ?? ""}`
                    : `Moving ${games[0]?.name ?? ""}`}
                </span>
                <span className="move-dialog-progress-pct">{pct.toFixed(0)}%</span>
              </div>
              <div className="move-dialog-progress-track">
                <div
                  className="move-dialog-progress-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="move-dialog-progress-meta">
                {phaseLabel}{" "}
                {total > 0 && (
                  <span className="move-dialog-progress-bytes">
                    {formatSize(copied, unit)} / {formatSize(total, unit)}
                  </span>
                )}
              </div>
            </div>
          )}

          {!running && errors.length > 0 && (
            <div className="move-dialog-errors">
              <p className="move-dialog-errors-title">
                {done} moved, {errors.length} failed:
              </p>
              <ul>
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              <button
                type="button"
                className="move-dialog-dest"
                onClick={pickDestination}
              >
                <span className="move-dialog-dest-value">Choose a different folder…</span>
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {multiple && !running && errors.length === 0
              ? `${formatSize(
                  games.reduce((s, g) => s + (g.sizeBytes ?? 0), 0),
                  unit
                )} total`
              : " "}
          </span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose} disabled={running}>
              {errors.length > 0 ? "Close" : "Cancel"}
            </Button>
            {errors.length === 0 && (
              <Button
                variant="primary"
                onClick={run}
                isLoading={running}
                disabled={!destDir || running}
              >
                {running ? "Moving…" : "Move here"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
