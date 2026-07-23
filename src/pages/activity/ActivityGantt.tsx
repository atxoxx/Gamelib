import { useState, useMemo, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import html2canvas from "html2canvas";
import { prepareClonedDocumentForCanvasCapture } from "../../utils/color";
import { useToast } from "../../context/ToastContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import type { Game, GameSession, SessionMetrics } from "../../types/game";
import { formatPlayTime } from "../../types/game";

export interface ActivityGanttProps {
  sessions: GameSession[];
  games: Game[];
  startDate: string;
  endDate: string;
  /** Platform/source filter from the global toolbar. "all" = no filter. */
  sourceFilter?: string;
}

/**
 * Timeline / Gantt view. Renders one row per day within the active date range.
 * Each row contains horizontal bars for every gameplay session that day,
 * positioned by time-of-day and sized by duration.
 *
 * Date handling: `session.date` is the session END time (recorded by
 * `recordSession` as `new Date().toISOString()` when the game exits).
 * We compute the start time as `end - durationMin` and split the session
 * across every calendar day it touches, so sessions that cross midnight are
 * drawn as a continuation bar on the following day instead of being truncated.
 */

/** A single within-day slice of a session (a session may span multiple days). */
interface Segment {
  id: string; // unique per day: `${sessionId}#${dayIndex}`
  sessionId: string;
  gameId: string;
  gameName: string;
  startMin: number; // minutes from local midnight [0, 1440)
  endMin: number; // minutes from local midnight (<= 1440)
  lane: number; // vertical lane for overlap stacking
  absoluteStart: Date;
  absoluteEnd: Date;
  durationMin: number; // full session duration
  isContinuation: boolean; // started on a previous day
  continuationTail: boolean; // continues onto the next day
  metrics?: SessionMetrics;
}

interface DayBucket {
  key: string; // YYYY-MM-DD
  label: string;
  sortKey: number; // ms
  isToday: boolean;
  segments: Segment[];
  maxLane: number; // number of lanes used
  totalMin: number; // total played minutes that day
}

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;
const MAX_CONTINUOUS_DAYS = 120; // draw a continuous axis up to this many days
const SAMPLED_CAP = 60; // when the range is huge, show this many recent days

// Lane geometry (px)
const ROW_PAD = 4;
const LANE_STEP = 16;
const BAR_H = 14;
const MIN_BAR_W_PCT = 0.4;

// Distinct categorical palette — top-played games get the cleanest colors.
const PALETTE = [
  "#4cc9f0", "#f72585", "#b5e48c", "#ffd166", "#ff7b54",
  "#9b5de5", "#00bbf9", "#fee440", "#f15bb5", "#06d6a0",
  "#ef476f", "#8338ec", "#fb5607", "#3a86ff", "#ffbe0b",
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getHourBuckets(sessions: GameSession[]): { hour: number; mins: number }[] {
  const counts = new Array(24).fill(0);
  for (const s of sessions) {
    const end = new Date(s.date).getTime();
    const start = end - s.durationMin * MINUTE;
    let cursor = start;
    while (cursor < end) {
      const d = new Date(cursor);
      const hour = d.getHours();
      const hourStart = new Date(d);
      hourStart.setHours(hour, 0, 0, 0);
      const hourEnd = hourStart.getTime() + 60 * MINUTE;
      const overlap = Math.max(0, Math.min(end, hourEnd) - Math.max(cursor, hourStart.getTime()));
      if (overlap > 0) {
        counts[hour] += overlap / MINUTE;
      }
      cursor = hourEnd;
      if (cursor <= hourStart.getTime()) break;
    }
  }
  return counts.map((mins, hour) => ({ hour, mins }));
}

function getHeatmapIntensity(mins: number): string {
  if (mins <= 0) return "activity-gantt__heatmap-cell--empty";
  if (mins < 15) return "activity-gantt__heatmap-cell--low";
  if (mins < 45) return "activity-gantt__heatmap-cell--medium";
  if (mins < 90) return "activity-gantt__heatmap-cell--high";
  return "activity-gantt__heatmap-cell--peak";
}

export function ActivityGantt({
  sessions,
  games,
  startDate,
  endDate,
  sourceFilter = "all",
}: ActivityGanttProps) {
  const { showToast } = useToast();
  const { getNote, setTags, setNote } = useSessionNotes();
  const ganttRef = useRef<HTMLDivElement>(null);

  const [highlightGame, setHighlightGame] = useState<string | null>(null);
  const [selected, setSelected] = useState<Segment | null>(null);
  const [showAllLegend, setShowAllLegend] = useState(false);
  const [hover, setHover] = useState<{
    seg: Segment;
    bucketKey: string;
    pct: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [editingTagsText, setEditingTagsText] = useState("");

  // ── 1. Build id→Game lookup ───────────────────────────────────────────
  const gameById = useMemo(() => {
    const m = new Map<string, Game>();
    games.forEach((g) => m.set(g.id, g));
    return m;
  }, [games]);

  // ── 2. Filter sessions by range + source/platform ─────────────────────
  const filtered = useMemo(() => {
    const rangeStart = new Date(startDate + "T00:00:00").getTime();
    const rangeEnd = new Date(endDate + "T23:59:59.999").getTime();

    return sessions.filter((s) => {
      const endTime = new Date(s.date).getTime();
      const startTime = endTime - s.durationMin * MINUTE;
      if (startTime < rangeStart) return false;
      if (endTime > rangeEnd + DAY_MS) return false;
      if (sourceFilter !== "all") {
        const plat = gameById.get(s.gameId)?.platform;
        if (plat !== sourceFilter) return false;
      }
      return true;
    });
  }, [sessions, startDate, endDate, sourceFilter, gameById]);

  // ── 3. Split into per-day segments + continuous/sampled axis ──────────
  const { buckets, sampled, totalDayCount } = useMemo(() => {
    const todayKey = ymd(new Date());
    const rangeStart = new Date(startDate + "T00:00:00");
    const rangeEnd = new Date(endDate + "T23:59:59.999");
    const startMs = rangeStart.getTime();
    const endMs = rangeEnd.getTime();

    const segmentsByDay = new Map<string, Segment[]>();
    const dayMeta = new Map<string, { sortKey: number; label: string }>();

    for (const sess of filtered) {
      const endT = new Date(sess.date).getTime();
      const startT = endT - sess.durationMin * MINUTE;
      const totalDays = Math.ceil((endT - startT) / DAY_MS) + 1;
      const cursor = new Date(startT);
      cursor.setHours(0, 0, 0, 0);

      for (let d = 0; d < totalDays; d++) {
        const dayStart = new Date(cursor);
        dayStart.setDate(cursor.getDate() + d);
        const dayStartMs = dayStart.getTime();
        const dayEndMs = dayStartMs + DAY_MS;

        const segStart = Math.max(startT, dayStartMs);
        const segEnd = Math.min(endT, dayEndMs);
        if (segEnd - segStart < MINUTE) continue; // skip sub-minute slivers

        const key = ymd(dayStart);
        const startMin = (segStart - dayStartMs) / MINUTE;
        const endMin = (segEnd - dayStartMs) / MINUTE;

        const seg: Segment = {
          id: `${sess.id}#${d}`,
          sessionId: sess.id,
          gameId: sess.gameId,
          gameName: sess.gameName,
          startMin,
          endMin,
          lane: 0,
          absoluteStart: new Date(segStart),
          absoluteEnd: new Date(segEnd),
          durationMin: sess.durationMin,
          isContinuation: segStart > startT + MINUTE,
          continuationTail: segEnd < endT - MINUTE,
          metrics: sess.metrics,
        };

        if (!segmentsByDay.has(key)) {
          segmentsByDay.set(key, []);
          dayMeta.set(key, { sortKey: dayStartMs, label: formatDateLabel(dayStart) });
        }
        segmentsByDay.get(key)!.push(seg);
      }
    }

    const makeBucket = (key: string, segs: Segment[]): DayBucket => {
      const sorted = [...segs].sort((a, b) => a.startMin - b.startMin);
      const laneEnds: number[] = [];
      for (const s of sorted) {
        let lane = laneEnds.findIndex((e) => e <= s.startMin + 0.01);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(s.endMin);
        } else {
          laneEnds[lane] = s.endMin;
        }
        s.lane = lane;
      }
      const maxLane = Math.max(1, laneEnds.length);
      const totalMin = segs.reduce((a, s) => a + (s.endMin - s.startMin), 0);
      const meta = dayMeta.get(key);
      const sortKey = meta ? meta.sortKey : new Date(key + "T00:00:00").getTime();
      const label = meta ? meta.label : formatDateLabel(new Date(sortKey));
      return {
        key,
        label,
        sortKey,
        isToday: key === todayKey,
        segments: sorted,
        maxLane,
        totalMin,
      };
    };

    const windowDays = Math.round((endMs - startMs) / DAY_MS) + 1;

    if (windowDays <= MAX_CONTINUOUS_DAYS) {
      // Continuous axis: every day in range, including empty ones.
      const out: DayBucket[] = [];
      const cur = new Date(rangeStart);
      for (let d = 0; d < windowDays; d++) {
        const day = new Date(cur);
        day.setDate(cur.getDate() + d);
        const key = ymd(day);
        out.push(makeBucket(key, segmentsByDay.get(key) ?? []));
      }
      return { buckets: out, sampled: false, totalDayCount: out.length };
    }

    // Huge range: sample the most recent days that actually have data.
    const sampledBuckets = Array.from(segmentsByDay.keys())
      .map((k) => ({ k, sortKey: dayMeta.get(k)?.sortKey ?? 0 }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-SAMPLED_CAP)
      .map(({ k }) => makeBucket(k, segmentsByDay.get(k)!));

    return {
      buckets: sampledBuckets,
      sampled: true,
      totalDayCount: segmentsByDay.size,
    };
  }, [filtered, startDate, endDate]);

  // ── 3b. Time-of-day play-pattern heatmap data ────────────────────────
  const hourBuckets = useMemo(() => getHourBuckets(filtered), [filtered]);
  const maxHourMins = useMemo(
    () => Math.max(1, ...hourBuckets.map((h) => h.mins)),
    [hourBuckets]
  );

  // ── 4. Game totals → rank → stable color map ──────────────────────────
  const { colorMap, topGames, allGameCount } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const b of buckets) {
      for (const s of b.segments) {
        totals.set(s.gameId, (totals.get(s.gameId) || 0) + (s.endMin - s.startMin));
      }
    }
    const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const map = new Map<string, string>();
    ranked.forEach(([id], i) => {
      map.set(id, PALETTE[i % PALETTE.length]);
    });
    return {
      colorMap: map,
      topGames: ranked.slice(0, 8),
      allGameCount: ranked.length,
    };
  }, [buckets]);

  const colorForGame = useCallback(
    (id: string) => colorMap.get(id) ?? PALETTE[0],
    [colorMap],
  );

  const totalPlayedMinutes = useMemo(
    () => buckets.reduce((sum, b) => sum + b.totalMin, 0),
    [buckets],
  );

  // ── Export the timeline as a PNG ──────────────────────────────────────
  const handleExportImage = async () => {
    const el = ganttRef.current;
    if (!el) return;
    try {
      const fullHeight = el.scrollHeight;
      const fullWidth = el.scrollWidth;
      const canvas = await html2canvas(el, {
        backgroundColor: "#0f1117",
        scale: 2,
        logging: false,
        useCORS: true,
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        onclone: prepareClonedDocumentForCanvasCapture,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const filePath = await save({
        title: "Save Timeline",
        defaultPath: `gameindex_timeline_${new Date().toISOString().slice(0, 10)}.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      if (!filePath) return;
      await invoke("save_screenshot", { filePath, base64Data: dataUrl });
      showToast("Timeline image saved", "success");
    } catch (error) {
      console.error("Timeline export error:", error);
      showToast(`Failed to save timeline: ${error}`, "error");
    }
  };

  const nowMin = useMemo(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
  }, []);

  const tickHours = [0, 6, 12, 18, 24];

  // ── Empty state ──────────────────────────────────────────────────────
  if (totalPlayedMinutes === 0) {
    return (
      <div className="section-panel">
        <div className="section-panel__empty">
          No gameplay sessions recorded in the selected date range.
        </div>
      </div>
    );
  }

  const legendGames = showAllLegend ? topGames : topGames.slice(0, 8);
  const overflowCount = allGameCount - topGames.length;

  const openNoteEditor = (sessionId: string) => {
    const existing = getNote(sessionId);
    setEditingNoteId(sessionId);
    setEditingNoteText(existing.note);
    setEditingTagsText(existing.tags.join(", "));
  };

  const saveNoteEditor = () => {
    if (!editingNoteId) return;
    const tags = editingTagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setTags(editingNoteId, tags);
    setNote(editingNoteId, editingNoteText);
    setEditingNoteId(null);
  };

  return (
    <div className="activity-gantt" ref={ganttRef}>
      {/* ── Header / actions ──────────────────────────────────────── */}
      <div className="activity-gantt__head">
        <div className="activity-gantt__head-title">Daily Timeline</div>
        <button
          type="button"
          className="activity-gantt__export-btn"
          onClick={handleExportImage}
          title="Save timeline as image"
        >
          Save Image
        </button>
      </div>

      {sampled && (
        <div className="activity-gantt__caption">
          Showing the {buckets.length} most recent days with activity (of{" "}
          {totalDayCount} days in range). Narrow the date range for a full
          continuous view.
        </div>
      )}

      {/* ── Legend (interactive highlight) ─────────────────────────── */}
      <div className="activity-gantt__legend">
        {legendGames.map(([gameId, minutes]) => {
          const g = gameById.get(gameId);
          const active = highlightGame === gameId;
          const dimmed = highlightGame !== null && !active;
          return (
            <button
              key={gameId}
              type="button"
              className={`activity-gantt__legend-item ${
                active ? "activity-gantt__legend-item--active" : ""
              } ${dimmed ? "activity-gantt__legend-item--dim" : ""}`}
              onClick={() =>
                setHighlightGame((prev) => (prev === gameId ? null : gameId))
              }
              title={`${g?.name || "Unknown"} · click to isolate`}
            >
              <span
                className="activity-gantt__legend-dot"
                style={{ background: colorForGame(gameId) }}
              />
              {g?.iconUrl ? (
                <img className="activity-gantt__legend-icon" src={g.iconUrl} alt="" />
              ) : null}
              <span className="activity-gantt__legend-label">
                {g?.name || "Unknown"} · {formatPlayTime(minutes)}
              </span>
            </button>
          );
        })}

        {!showAllLegend && overflowCount > 0 && (
          <button
            type="button"
            className="activity-gantt__legend-more"
            onClick={() => setShowAllLegend(true)}
          >
            + {overflowCount} more game{overflowCount === 1 ? "" : "s"}
          </button>
        )}
        {showAllLegend && allGameCount > topGames.length && (
          <button
            type="button"
            className="activity-gantt__legend-more"
            onClick={() => setShowAllLegend(false)}
          >
            Show less
          </button>
        )}

        {highlightGame && (
          <button
            type="button"
            className="activity-gantt__legend-clear"
            onClick={() => setHighlightGame(null)}
          >
            Clear filter
          </button>
        )}

        <span className="activity-gantt__legend-total">
          {formatPlayTime(totalPlayedMinutes)} total
        </span>
      </div>

      {/* ── Time-of-day play-pattern heatmap ───────────────────────── */}
      <div className="activity-gantt__heatmap">
        <div className="activity-gantt__heatmap-header">Play pattern</div>
        <div className="activity-gantt__heatmap-track">
          {hourBuckets.map(({ hour, mins }) => {
            const pct = (mins / maxHourMins) * 100;
            const cls = getHeatmapIntensity(mins);
            return (
              <div
                key={hour}
                className={`activity-gantt__heatmap-cell ${cls}`}
                style={{ height: `${Math.max(8, pct)}%` }}
                title={`${String(hour).padStart(2, "0")}:00 — ${formatPlayTime(Math.round(mins))}`}
              />
            );
          })}
        </div>
        <div className="activity-gantt__heatmap-axis">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
      </div>

      {/* ── Timeline header (00:00 … 24:00) ───────────────────────── */}
      <div className="activity-gantt__timeline-header">
        <div className="activity-gantt__date-col" />
        <div className="activity-gantt__time-axis">
          {tickHours.map((h) => (
            <span
              key={h}
              className="activity-gantt__time-label"
              style={{ left: `${(h / 24) * 100}%` }}
            >
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        <div className="activity-gantt__row-total" />
      </div>

      {/* ── Day rows (scrollable) ─────────────────────────────────── */}
      <div className="activity-gantt__rows">
        {buckets.map((bucket) => {
          const rowHeight = Math.max(
            28,
            ROW_PAD + (bucket.maxLane - 1) * LANE_STEP + BAR_H + ROW_PAD,
          );
          const nowPct = bucket.isToday ? (nowMin / (24 * 60)) * 100 : null;

          return (
            <div
              key={bucket.key}
              className={`activity-gantt__row ${
                bucket.segments.length ? "activity-gantt__row--has-data" : ""
              }`}
              style={{ height: rowHeight }}
            >
              <div className="activity-gantt__date-col">
                <span
                  className={`activity-gantt__date-label ${
                    bucket.isToday ? "activity-gantt__date-label--today" : ""
                  }`}
                >
                  {bucket.label}
                </span>
              </div>

              <div
                className="activity-gantt__bar-area"
                style={{ height: rowHeight }}
              >
                {/* Vertical grid lines aligned to the axis ticks */}
                {tickHours.map((h) => (
                  <div
                    key={h}
                    className="activity-gantt__grid-line"
                    style={{ left: `${(h / 24) * 100}%` }}
                  />
                ))}

                {/* "Now" marker for today */}
                {nowPct !== null && (
                  <div
                    className="activity-gantt__now-marker"
                    style={{ left: `${nowPct}%` }}
                  />
                )}

                {/* Hover crosshair */}
                {hover?.bucketKey === bucket.key && (
                  <div
                    className="activity-gantt__crosshair"
                    style={{ left: `${hover.pct}%` }}
                  />
                )}

                {bucket.segments.map((seg) => {
                  const left = (seg.startMin / (24 * 60)) * 100;
                  const widthPct = Math.max(
                    MIN_BAR_W_PCT,
                    ((seg.endMin - seg.startMin) / (24 * 60)) * 100,
                  );
                  const top = ROW_PAD + seg.lane * LANE_STEP;
                  const isDim = highlightGame !== null && highlightGame !== seg.gameId;

                  const timeStr = seg.absoluteStart.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const endStr = seg.absoluteEnd.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const segDur = Math.round(seg.endMin - seg.startMin);
                  const note = getNote(seg.sessionId);

                  return (
                    <div
                      key={seg.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${seg.gameName}, ${formatPlayTime(
                        segDur,
                      )}, ${timeStr} to ${endStr}`}
                      className={`activity-gantt__bar ${
                        isDim ? "activity-gantt__bar--dim" : ""
                      } ${seg.isContinuation ? "activity-gantt__bar--cont-start" : ""} ${
                        seg.continuationTail ? "activity-gantt__bar--cont-end" : ""
                      }`}
                      style={{
                        left: `${left}%`,
                        width: `${widthPct}%`,
                        top: `${top}px`,
                        height: `${BAR_H}px`,
                        background: colorForGame(seg.gameId),
                      }}
                      onClick={() => setSelected(seg)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(seg);
                        }
                      }}
                      onMouseEnter={(e) =>
                        setHover({
                          seg,
                          bucketKey: bucket.key,
                          pct: left + widthPct / 2,
                          clientX: e.clientX,
                          clientY: e.clientY,
                        })
                      }
                      onMouseMove={(e) =>
                        setHover((prev) =>
                          prev && prev.seg.id === seg.id
                            ? { ...prev, clientX: e.clientX, clientY: e.clientY }
                            : prev,
                        )
                      }
                      onMouseLeave={() =>
                        setHover((prev) => (prev?.seg.id === seg.id ? null : prev))
                      }
                    >
                      {note.tags.length > 0 && (
                        <span className="activity-gantt__bar-tags" title={note.tags.join(", ")}>
                          {note.tags.slice(0, 2).join(", ")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="activity-gantt__row-total">
                {bucket.totalMin > 0 ? formatPlayTime(bucket.totalMin) : ""}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Floating tooltip ──────────────────────────────────────── */}
      {hover && (
        <div
          className="activity-gantt__tooltip"
          style={{ left: hover.clientX + 14, top: hover.clientY + 14 }}
        >
          <span className="activity-gantt__tooltip-game">
            <span
              className="activity-gantt__tooltip-dot"
              style={{ background: colorForGame(hover.seg.gameId) }}
            />
            {hover.seg.gameName}
            {hover.seg.isContinuation ? " (cont.)" : ""}
          </span>
          <span className="activity-gantt__tooltip-time">
            {hover.seg.absoluteStart.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            –{" "}
            {hover.seg.absoluteEnd.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="activity-gantt__tooltip-duration">
            {formatPlayTime(Math.round(hover.seg.endMin - hover.seg.startMin))} this day
          </span>
          {(() => {
            const g = gameById.get(hover.seg.gameId);
            if (!g) return null;
            return (
              <span className="activity-gantt__tooltip-meta">
                {g.platform ? <span className="activity-gantt__tooltip-chip">{g.platform}</span> : null}
                {hover.seg.metrics?.avgFps ? (
                  <span className="activity-gantt__tooltip-chip">
                    {Math.round(hover.seg.metrics.avgFps)} FPS
                  </span>
                ) : null}
                {hover.seg.metrics?.avgCpuUsage != null ? (
                  <span className="activity-gantt__tooltip-chip">
                    CPU {Math.round(hover.seg.metrics.avgCpuUsage)}%
                  </span>
                ) : null}
                {hover.seg.metrics?.avgGpuUsage != null ? (
                  <span className="activity-gantt__tooltip-chip">
                    GPU {Math.round(hover.seg.metrics.avgGpuUsage)}%
                  </span>
                ) : null}
              </span>
            );
          })()}
          {(() => {
            const note = getNote(hover.seg.sessionId);
            if (!note.tags.length && !note.note) return null;
            return (
              <span className="activity-gantt__tooltip-note">
                {note.tags.length > 0 && (
                  <span className="activity-gantt__tooltip-tags">
                    {note.tags.map((t) => (
                      <span key={t} className="activity-gantt__tooltip-tag">{t}</span>
                    ))}
                  </span>
                )}
                {note.note ? <span className="activity-gantt__tooltip-text">{note.note}</span> : null}
              </span>
            );
          })()}
        </div>
      )}

      {/* ── Session detail modal ─────────────────────────────────── */}
      {selected && (
        <div
          className="modal-backdrop"
          onClick={() => setSelected(null)}
          role="presentation"
        >
          <div
            className="modal activity-gantt__detail"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${selected.gameName} session details`}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelected(null);
            }}
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h2 className="modal-title">
                  <span
                    className="activity-gantt__detail-dot"
                    style={{ background: colorForGame(selected.gameId) }}
                  />
                  {selected.gameName}
                </h2>
                <p className="modal-subtitle">
                  {selected.absoluteStart.toLocaleDateString(undefined, {
                    weekday: "long",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="modal-body activity-gantt__detail-body">
              <div className="activity-gantt__detail-grid">
                <div>
                  <span className="activity-gantt__detail-k">Time</span>
                  <span className="activity-gantt__detail-v">
                    {selected.absoluteStart.toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    –{" "}
                    {selected.absoluteEnd.toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div>
                  <span className="activity-gantt__detail-k">Duration</span>
                  <span className="activity-gantt__detail-v">
                    {formatPlayTime(selected.durationMin)}
                  </span>
                </div>
                <div>
                  <span className="activity-gantt__detail-k">Platform</span>
                  <span className="activity-gantt__detail-v">
                    {gameById.get(selected.gameId)?.platform || "Local"}
                  </span>
                </div>
                {selected.metrics?.resolution && (
                  <div>
                    <span className="activity-gantt__detail-k">Resolution</span>
                    <span className="activity-gantt__detail-v">
                      {selected.metrics.resolution}
                    </span>
                  </div>
                )}
                {selected.metrics && (
                  <>
                    <div>
                      <span className="activity-gantt__detail-k">Avg FPS</span>
                      <span className="activity-gantt__detail-v">
                        {selected.metrics.avgFps}
                      </span>
                    </div>
                    <div>
                      <span className="activity-gantt__detail-k">FPS range</span>
                      <span className="activity-gantt__detail-v">
                        {selected.metrics.minFps}–{selected.metrics.maxFps}
                      </span>
                    </div>
                    <div>
                      <span className="activity-gantt__detail-k">CPU / GPU</span>
                      <span className="activity-gantt__detail-v">
                        {selected.metrics.avgCpuUsage}% / {selected.metrics.avgGpuUsage}%
                      </span>
                    </div>
                    <div>
                      <span className="activity-gantt__detail-k">CPU / GPU temp</span>
                      <span className="activity-gantt__detail-v">
                        {selected.metrics.avgCpuTemp}° / {selected.metrics.avgGpuTemp}°
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="activity-gantt__notes-section">
                <div className="activity-gantt__notes-header">
                  <span className="activity-gantt__notes-title">Tags</span>
                  {editingNoteId === selected.sessionId ? (
                    <div className="activity-gantt__notes-actions">
                      <button
                        type="button"
                        className="activity-gantt__notes-save"
                        onClick={saveNoteEditor}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="activity-gantt__notes-cancel"
                        onClick={() => setEditingNoteId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="activity-gantt__notes-edit"
                      onClick={() => openNoteEditor(selected.sessionId)}
                    >
                      Edit
                    </button>
                  )}
                </div>
                {editingNoteId === selected.sessionId ? (
                  <input
                    type="text"
                    className="activity-gantt__notes-input"
                    placeholder="Comma-separated tags"
                    value={editingTagsText}
                    onChange={(e) => setEditingTagsText(e.target.value)}
                    autoFocus
                  />
                ) : (
                  <div className="activity-gantt__tags-list">
                    {getNote(selected.sessionId).tags.map((t) => (
                      <span key={t} className="activity-gantt__tag">{t}</span>
                    ))}
                    {getNote(selected.sessionId).tags.length === 0 && (
                      <span className="activity-gantt__notes-empty">No tags</span>
                    )}
                  </div>
                )}

                <div className="activity-gantt__notes-header">
                  <span className="activity-gantt__notes-title">Note</span>
                  {editingNoteId === selected.sessionId && (
                    <div className="activity-gantt__notes-actions">
                      <button
                        type="button"
                        className="activity-gantt__notes-save"
                        onClick={saveNoteEditor}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="activity-gantt__notes-cancel"
                        onClick={() => setEditingNoteId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                {editingNoteId === selected.sessionId ? (
                  <textarea
                    className="activity-gantt__notes-textarea"
                    placeholder="Add a note for this session..."
                    value={editingNoteText}
                    onChange={(e) => setEditingNoteText(e.target.value)}
                    rows={3}
                  />
                ) : (
                  <div className="activity-gantt__note-text">
                    {getNote(selected.sessionId).note || <span className="activity-gantt__notes-empty">No note</span>}
                  </div>
                )}
              </div>

              {selected.isContinuation || selected.continuationTail ? (
                <p className="activity-gantt__detail-note">
                  This session spans midnight and is split across multiple days in
                  the timeline.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
