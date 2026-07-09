import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import type { Game } from "../../types/game";
import { Button } from "../../components/ui";

interface Props {
  /** Installed games whose size hasn't been measured yet. The bar hides
   *  itself when this array is empty (nothing to do -> nothing shown). */
  unsizedGames: Game[];
}

interface DetectResult {
  sizeBytes: number;
  rootPath: string;
}

/** Phase-6 toolbar action: "Recalculate missing".
 *
 *  Iterates the provided unsized-games list one at a time, invoking the
 *  Rust `detect_game_size` command for each. Sequential on purpose --
 *  the disk-walker is single-threaded and a fan-out would just contend
 *  for the same IO queue. Per-row failures are isolated: a single bad
 *  exe path doesn't abort the batch.
 *
 *  Cancellation: clicking Stop sets a flag the loop checks before each
 *  iteration. The currently-running iteration still completes (the
 *  Rust command can't be safely interrupted from JS) but no further
 *  rows are processed.
 *
 *  Idempotent: rows whose measurement succeeded are filtered out of
 *  the work list up-front, so clicking the button twice in a row is
 *  safe -- the second run will see an empty-or-shorter list and either
 *  hide or finish faster.
 */
export function BulkRecalcBar({ unsizedGames }: Props) {
  const { updateGame } = useGames();
  const { showToast } = useToast();

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  // Ref (not state) so the in-flight for-loop reads the CURRENT value
  // when checking `if (abortedRef.current) break`. A useState would
  // close over the value at the time the run() callback was created,
  // making Stop a no-op for any iteration after the click.
  const abortedRef = useRef(false);

  // Split the input into games that have a real exe path (worth trying)
  // and games missing it (Store-shelf with `path === ""`). Skipping the
  // latter up-front prevents flooding the toast with Rust errors like
  // "Folder does not exist: .".
  const target = unsizedGames.filter((g) => g.path && g.path.trim() !== "");
  const skipped = unsizedGames.length - target.length;

  const run = useCallback(async () => {
    if (running || target.length === 0) return;
    setRunning(true);
    setDone(0);
    setTotal(target.length);
    abortedRef.current = false;

    const failures: { gameId: string; gameName: string; error: string }[] = [];

    for (let i = 0; i < target.length; i++) {
      if (abortedRef.current) break;
      const game = target[i];
      try {
        const result = await invoke<DetectResult>("detect_game_size", {
          exePath: game.path,
          gameName: game.name,
          rootOverride: null,
        });
        updateGame(game.id, {
          sizeBytes: result.sizeBytes,
          sizeRootPath: result.rootPath,
          sizeDetectedAt: new Date().toISOString(),
        });
      } catch (err) {
        failures.push({
          gameId: game.id,
          gameName: game.name,
          error: typeof err === "string" ? err : String(err),
        });
      }
      setDone((d) => d + 1);
    }

    const succeeded = target.length - failures.length;
    const wasAborted = abortedRef.current;
    const stopped = wasAborted ? " (stopped)" : "";

    if (failures.length === 0 && !wasAborted) {
      showToast(
        `Recalculated ${succeeded} game${succeeded === 1 ? "" : "s"}${stopped}.`,
        "success"
      );
    } else if (failures.length === 0) {
      showToast(`Stopped at ${succeeded} (no failures).`, "info");
    } else if (wasAborted) {
      showToast(
        `Stopped at ${succeeded}. ${failures.length} failed.`,
        "info"
      );
    } else {
      showToast(
        `${succeeded} recalculated. ${failures.length} failed -- check toast log.`,
        "error"
      );
    }

    setRunning(false);
  }, [running, target, updateGame, showToast]);

  const stop = useCallback(() => {
    abortedRef.current = true;
  }, []);

  if (target.length === 0) {
    // Hide entirely when there's nothing meaningful to do. The "N
    // missing" counter in the parent toolbar still surfaces the broader
    // picture (including the skipped no-exe-path games).
    return null;
  }

  if (running) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      <div className="storage__bulk-recalc storage__bulk-recalc--running">
        <span className="storage__bulk-progress" aria-live="polite">
          Recalculating {done}/{total} ({pct}%)
        </span>
        <Button
          variant="ghost"
          onClick={stop}
        >
          Stop
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="primary"
      onClick={run}
      title={
        skipped > 0
          ? `Recalculate ${target.length} of ${unsizedGames.length} missing (${skipped} skipped -- missing exe path).`
          : `Recalculate ${target.length} missing game${target.length === 1 ? "" : "s"}.`
      }
    >
      Recalculate {target.length} missing
    </Button>
  );
}
