import { useState, useMemo } from "react";
import { useAchievements } from "../context/AchievementContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useFocusable } from "../hooks/useFocusable";
import {
  type Game,
  type Achievement,
  getAchievementRarity,
  RARITY_LABELS,
  RARITY_COLORS,
} from "../types/game";
import { useToast } from "../context/ToastContext";

type SortKey = "default" | "name" | "rarity" | "unlockDate";
type FilterKey = "all" | "unlocked" | "locked";

export default function AchievementsTab({ game }: { game: Game }) {
  const { isBigScreen } = useBigScreen();
  const { getGameAchievements, syncGameAchievements, isSyncing } = useAchievements();
  const { showToast } = useToast();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [syncing, setSyncing] = useState(false);

  const achievementData = getGameAchievements(game.id);
  const achievements = achievementData?.achievements ?? [];
  const total = achievementData?.total ?? 0;
  const unlocked = achievementData?.unlocked ?? 0;
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  // Filter & sort
  const displayAchievements = useMemo(() => {
    let list = [...achievements];

    // Filter
    if (filter === "unlocked") list = list.filter((a) => a.achieved);
    if (filter === "locked") list = list.filter((a) => !a.achieved);

    // Sort
    if (sort === "name") {
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else if (sort === "rarity") {
      list.sort((a, b) => a.percent - b.percent); // rarest first
    } else if (sort === "unlockDate") {
      list.sort((a, b) => {
        if (a.achieved && !b.achieved) return -1;
        if (!a.achieved && b.achieved) return 1;
        return b.unlockTime - a.unlockTime;
      });
    }
    // "default" keeps the backend's original sort (unlocked by date desc, then locked by rarity desc)

    return list;
  }, [achievements, filter, sort]);

  async function handleSync() {
    if (!game.steamAppId) {
      showToast("This game has no Steam AppID", "error");
      return;
    }
    setSyncing(true);
    try {
      await syncGameAchievements(game.id, game.steamAppId);
      showToast("Achievements synced!", "success");
    } catch (err) {
      showToast(`Achievement sync failed: ${err}`, "error");
    } finally {
      setSyncing(false);
    }
  }

  const emptySyncFocus = useFocusable(handleSync);
  const toolbarSyncFocus = useFocusable(handleSync);

  const formatDate = (ts: number) => {
    if (ts === 0) return "";
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Rarity distribution for the stats bar
  const rarityBreakdown = useMemo(() => {
    const counts = { common: 0, uncommon: 0, rare: 0, ultra_rare: 0 };
    for (const a of achievements) {
      counts[getAchievementRarity(a.percent)]++;
    }
    return counts;
  }, [achievements]);

  // ─── Empty state ──────────────────────────────────────────────────
  if (!game.steamAppId) {
    return (
      <div className="achievements-empty">
        <div className="achievements-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 15l-2 5-1-3-3-1 5-2z" />
            <path d="M18.364 5.636a9 9 0 0 1-12.728 12.728" />
          </svg>
        </div>
        <h3>Achievements not available</h3>
        <p>Achievements are currently supported for Steam games only.<br />This game has no Steam integration.</p>
      </div>
    );
  }

  if (!achievementData) {
    return (
      <div className="achievements-empty">
        <div className="achievements-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="8" r="6" />
            <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
          </svg>
        </div>
        <h3>No achievements data</h3>
        <p>Click "Sync" to fetch achievements from Steam.</p>
        <button
          className="achievements-sync-btn"
          {...(isBigScreen ? emptySyncFocus : { onClick: handleSync })}
          disabled={syncing || isSyncing}
        >
          {syncing ? (
            <>
              <span className="achievements-spinner" />
              Syncing…
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              Sync from Steam
            </>
          )}
        </button>
      </div>
    );
  }

  // ─── Main achievements view ───────────────────────────────────────
  return (
    <div className="achievements-tab">
      {/* ── Header Stats ──────────────────────────────────────────── */}
      <div className="achievements-header">
        <div className="achievements-progress-section">
          <div className="achievements-ring-wrap">
            <svg className="achievements-ring" viewBox="0 0 120 120">
              <circle
                className="achievements-ring-bg"
                cx="60" cy="60" r="52"
                stroke="var(--color-bg-tertiary)"
                strokeWidth="8"
                fill="transparent"
              />
              <circle
                className="achievements-ring-fill"
                cx="60" cy="60" r="52"
                strokeWidth="8"
                stroke={pct >= 100 ? "#10b981" : "var(--color-accent)"}
                strokeDasharray={2 * Math.PI * 52}
                strokeDashoffset={2 * Math.PI * 52 * (1 - pct / 100)}
                strokeLinecap="round"
                fill="transparent"
                transform="rotate(-90 60 60)"
              />
            </svg>
            <div className="achievements-ring-label">
              <span className="achievements-ring-pct">{pct}%</span>
              <span className="achievements-ring-sub">{unlocked}/{total}</span>
            </div>
          </div>
        </div>

        <div className="achievements-stats-cards">
          <div className="achievements-stat-card">
            <span className="achievements-stat-value achievements-stat-unlocked">{unlocked}</span>
            <span className="achievements-stat-label">Unlocked</span>
          </div>
          <div className="achievements-stat-card">
            <span className="achievements-stat-value achievements-stat-locked">{total - unlocked}</span>
            <span className="achievements-stat-label">Locked</span>
          </div>
          <div className="achievements-stat-card">
            <span className="achievements-stat-value">{total}</span>
            <span className="achievements-stat-label">Total</span>
          </div>
        </div>

        {/* Rarity distribution mini bar */}
        {total > 0 && (
          <div className="achievements-rarity-bar-wrap">
            <div className="achievements-rarity-bar">
              {(["ultra_rare", "rare", "uncommon", "common"] as const).map((tier) => {
                const count = rarityBreakdown[tier];
                if (count === 0) return null;
                return (
                  <div
                    key={tier}
                    className="achievements-rarity-segment"
                    style={{
                      width: `${(count / total) * 100}%`,
                      backgroundColor: RARITY_COLORS[tier],
                    }}
                    title={`${RARITY_LABELS[tier]}: ${count}`}
                  />
                );
              })}
            </div>
            <div className="achievements-rarity-legend">
              {(["ultra_rare", "rare", "uncommon", "common"] as const).map((tier) => (
                <span key={tier} className="achievements-rarity-legend-item">
                  <span className="achievements-rarity-dot" style={{ backgroundColor: RARITY_COLORS[tier] }} />
                  {RARITY_LABELS[tier]} ({rarityBreakdown[tier]})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Filter & Sort bar ────────────────────────────────────── */}
      <div className="achievements-toolbar">
        <div className="achievements-filters">
          {(["all", "unlocked", "locked"] as const).map((f) => (
            <AchievementFilterButton
              key={f}
              f={f}
              active={filter === f}
              total={total}
              unlocked={unlocked}
              setFilter={setFilter}
              isBigScreen={isBigScreen}
            />
          ))}
        </div>
        <div className="achievements-sort">
          <label className="achievements-sort-label">Sort:</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="achievements-sort-select"
          >
            <option value="default">Default</option>
            <option value="name">Name</option>
            <option value="rarity">Rarity</option>
            <option value="unlockDate">Unlock Date</option>
          </select>
        </div>
        <button
          className="achievements-sync-btn achievements-sync-btn-sm"
          {...(isBigScreen ? toolbarSyncFocus : { onClick: handleSync })}
          disabled={syncing || isSyncing}
          title="Sync achievements from Steam"
        >
          {syncing ? (
            <span className="achievements-spinner" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Achievement Grid ─────────────────────────────────────── */}
      <div className="achievements-grid">
        {displayAchievements.map((a) => (
          <AchievementCard key={a.apiName} achievement={a} formatDate={formatDate} isBigScreen={isBigScreen} />
        ))}
      </div>

      {displayAchievements.length === 0 && (
        <div className="achievements-no-results">
          No {filter !== "all" ? filter : ""} achievements found.
        </div>
      )}

      {/* Last synced footer */}
      {achievementData.lastSynced && (
        <div className="achievements-last-synced">
          Last synced: {new Date(achievementData.lastSynced).toLocaleString()}
        </div>
      )}
    </div>
  );
}

// ─── Achievement Card ─────────────────────────────────────────────────

function AchievementCard({
  achievement: a,
  formatDate,
  isBigScreen,
}: {
  achievement: Achievement;
  formatDate: (ts: number) => string;
  isBigScreen?: boolean;
}) {
  const focusProps = useFocusable(() => {});
  const rarity = getAchievementRarity(a.percent);
  return (
    <div
      className={`achievement-card ${a.achieved ? "unlocked" : "locked"}`}
      {...(isBigScreen ? focusProps : {})}
    >
      <div className="achievement-card-icon">
        <img
          src={a.achieved ? a.icon : a.iconGray}
          alt={a.displayName}
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      <div className="achievement-card-body">
        <div className="achievement-card-header">
          <h4 className="achievement-card-name">{a.displayName}</h4>
          <span
            className={`achievement-rarity-badge rarity-${rarity}`}
            style={{ backgroundColor: `${RARITY_COLORS[rarity]}22`, color: RARITY_COLORS[rarity], borderColor: `${RARITY_COLORS[rarity]}44` }}
          >
            {a.percent.toFixed(1)}%
          </span>
        </div>
        <p className="achievement-card-desc">{a.description}</p>
        {a.achieved && a.unlockTime > 0 && (
          <span className="achievement-card-date">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {formatDate(a.unlockTime)}
          </span>
        )}
      </div>
    </div>
  );
}

interface AchievementFilterButtonProps {
  f: FilterKey;
  active: boolean;
  total: number;
  unlocked: number;
  setFilter: (f: FilterKey) => void;
  isBigScreen?: boolean;
}

function AchievementFilterButton({
  f,
  active,
  total,
  unlocked,
  setFilter,
  isBigScreen,
}: AchievementFilterButtonProps) {
  const focusProps = useFocusable(() => setFilter(f));
  return (
    <button
      className={`achievements-filter-btn ${active ? "active" : ""}`}
      {...(isBigScreen ? focusProps : { onClick: () => setFilter(f) })}
    >
      {f === "all" ? `All (${total})` : f === "unlocked" ? `Unlocked (${unlocked})` : `Locked (${total - unlocked})`}
    </button>
  );
}
