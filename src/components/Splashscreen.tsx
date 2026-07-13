import { useEffect, useRef } from "react";
import {
  useSplash,
} from "../context/SplashContext";
import type { Game } from "../types/game";

/**
 * Minimum visibility before fade-out begins. Holds the splash long
 * enough that the user actually reads "Game is launching" instead
 * of seeing a flash.
 */
const MIN_VISIBILITY_MS = 1400;

/**
 * Fade-out animation duration. Matches the CSS transition on
 * `.splashscreen-card` so we tear down the React subtree after the
 * visual fade completes.
 */
const FADE_OUT_MS = 250;

/** Errors get a shorter hold so the user can see "Launch failed"
 *  without sitting on a useless card for the full min-visibility
 *  window. */
const ERROR_HOLD_REDUCTION_MS = 600;

/**
 * Helper: convert IGDB's time-to-beat (seconds) into whole hours.
 * Returns `null` when the value is missing/zero so callers can render
 * `null` gracefully instead of "0h".
 */
function ttbSecondsToHours(s: number | undefined | null): number | null {
  if (!s || s <= 0) return null;
  return Math.round(s / 3600);
}

/** Format a large minute count as "Xh Ym" / "Xh" / "Ym". */
function formatMinutes(min: number): string {
  if (!min || min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Relative date string ("3 days ago", "Yesterday", etc.). */
function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Unknown";
  const deltaMs = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  if (deltaMs < day) return "Today";
  if (deltaMs < 2 * day) return "Yesterday";
  if (deltaMs < 7 * day) return `${Math.floor(deltaMs / day)} days ago`;
  if (deltaMs < 30 * day) return `${Math.floor(deltaMs / (7 * day))} weeks ago`;
  return new Date(iso).toLocaleDateString();
}

interface InfoCardProps {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}

function InfoCard({ icon, label, children }: InfoCardProps) {
  return (
    <div className="splashscreen-info-card">
      <span className="splashscreen-info-icon">{icon}</span>
      <div className="splashscreen-info-body">
        <span className="splashscreen-info-label">{label}</span>
        <span className="splashscreen-info-value">{children}</span>
      </div>
    </div>
  );
}

/**
 * Splashscreen — pure in-process overlay rendered at the top level of
 * the Tauri main window. It reads its data from the SplashContext
 * (a single shared React state), renders nothing when no record is
 * set, and self-closes its CSS fade + React unmount when status
 * flips to "started" or "error" via the useSplash().close() callback.
 */
export default function Splashscreen() {
  const { record, close } = useSplash();
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScheduledStartedAtRef = useRef<number | null>(null);

  // Lifecycle: when status flips to "started" or "error", enforce the
  // min-visibility hold then schedule a fade-out. Discriminated by
  // `record.startedAt` so a same-status re-poll never double-schedules.
  useEffect(() => {
    if (!record) return;
    if (record.status !== "started" && record.status !== "error") return;
    if (lastScheduledStartedAtRef.current === record.startedAt) return;
    lastScheduledStartedAtRef.current = record.startedAt;

    const elapsed = Date.now() - record.startedAt;
    const reduction = record.status === "error" ? ERROR_HOLD_REDUCTION_MS : 0;
    const holdMs = Math.max(0, MIN_VISIBILITY_MS - elapsed - reduction);

    const id = setTimeout(() => beginClose(), holdMs);
    return () => {
      clearTimeout(id);
      // Also cancel any pending fade-out close timer inherited from a
      // previously-visible record. Without this, a queued close() from
      // the *previous* launch could fire 250 ms after a fresh open() and
      // prematurely tear down the new splash.
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
    // close / beginClose deliberately omitted — they're stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  // Clear any pending fade timer on unmount (e.g. context provider
  // teardown, route change).
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  // Begin fade-out CSS class flip, then teardown the React subtree.
  // Removing-then-adding the class guarantees the CSS animation re-fires
  // even when a previous launch left .splashscreen-fading on the same
  // root node (e.g. user clicked Play on a different game mid-fade).
  const beginClose = () => {
    const root = document.querySelector(".splashscreen-root");
    if (root) {
      root.classList.remove("splashscreen-fading");
      root.classList.add("splashscreen-fading");
    }
    fadeTimerRef.current = setTimeout(() => close(), FADE_OUT_MS);
  };

  // Render nothing when there's no active launch in flight.
  if (!record) return null;

  // ── Derive displayed info from record (no ActivityContext here) ──
  const game: Game = record.game;
  const lastSession = record.lastSession;
  const lastSessionDate = lastSession ? relativeDate(lastSession.date) : null;
  const lastSessionDuration = lastSession ? formatMinutes(lastSession.durationMin) : null;
  const lastSessionFps = lastSession?.metrics?.avgFps;

  const ttbMain = ttbSecondsToHours(game.timeToBeat?.normally);
  const ttbComplete = ttbSecondsToHours(game.timeToBeat?.completely);
  const hasTtb = ttbMain !== null || ttbComplete !== null;

  const totalPlayTime = game.playTime || "0h";
  const hasPlayed = totalPlayTime !== "0h" && totalPlayTime !== "0m";

  return (
    <div
      className="splashscreen-root"
      role="dialog"
      aria-modal="true"
      aria-label={`Launching ${game.name}`}
    >
      <div className="splashscreen-card animate-scale-up">
        {/* Hero artwork + gradient fallback */}
        <div className="splashscreen-hero">
          {game.bannerUrl || game.coverArtUrl ? (
            <img
              src={game.bannerUrl || game.coverArtUrl!}
              alt=""
              className="splashscreen-hero-img"
            />
          ) : (
            <div className="splashscreen-hero-gradient" />
          )}
          <div className="splashscreen-hero-fade" />

          {game.logoUrl ? (
            <img
              src={game.logoUrl}
              alt={game.name}
              className="splashscreen-logo"
            />
          ) : (
            <h2 className="splashscreen-title-only">{game.name}</h2>
          )}
        </div>

        {/* Title block under the hero */}
        <div className="splashscreen-title-block">
          {game.logoUrl && (
            <h2 className="splashscreen-title">{game.name}</h2>
          )}
          {(game.developer || game.publisher) && (
            <span className="splashscreen-subtitle">
              {[game.developer, game.publisher].filter(Boolean).join(" • ")}
            </span>
          )}
        </div>

        {/* Info card row: time-to-beat / last played / total play time */}
        <div className="splashscreen-info-row">
          {hasTtb && (
            <InfoCard
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              }
              label="Time to Beat"
            >
              {ttbMain !== null && <span>Main · {ttbMain}h</span>}
              {ttbComplete !== null && (
                <span className="splashscreen-info-divider">
                  Complete · {ttbComplete}h
                </span>
              )}
            </InfoCard>
          )}

          <InfoCard
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            }
            label="Last Played"
          >
            {lastSessionDate ? (
              <>
                <span>{lastSessionDate}</span>
                {lastSessionDuration && (
                  <span className="splashscreen-info-divider">
                    {lastSessionDuration}
                    {typeof lastSessionFps === "number" && lastSessionFps > 0 && ` · ${Math.round(lastSessionFps)} FPS`}
                  </span>
                )}
              </>
            ) : (
              <span className="splashscreen-info-muted">First time playing</span>
            )}
          </InfoCard>

          <InfoCard
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            }
            label="Total Play Time"
          >
            <span>{hasPlayed ? totalPlayTime : "0h"}</span>
          </InfoCard>
        </div>

        {/* Status pill — drives the user's focus while the splash is up */}
        <div className="splashscreen-status" aria-live="polite">
          <span className="splashscreen-status-dot" />
          <span className="splashscreen-status-text">
            {record.status === "started"
              ? "Game is launching"
              : record.status === "error"
              ? "Launch failed"
              : "Launching"}
            {record.status === "launching" && (
              <span className="splashscreen-status-dots" aria-hidden="true">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
