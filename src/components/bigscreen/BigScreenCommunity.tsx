import { useMemo } from "react";
import { useActivity } from "../../context/ActivityContext";
import { useAchievements } from "../../context/AchievementContext";
import { useGames } from "../../context/GameContext";
import { useFocusable } from "../../hooks/useFocusable";

function formatHours(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k h`;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function BigScreenCommunity() {
  const { getAllStats, sessions } = useActivity();
  const { cache } = useAchievements();
  const { games } = useGames();

  const stats = useMemo(() => getAllStats(), [getAllStats]);

  // Count total achievements across all cached games
  const achievementCounts = useMemo(() => {
    let total = 0;
    let unlocked = 0;
    for (const gid of Object.keys(cache.games)) {
      const g = cache.games[gid];
      total += g.total;
      unlocked += g.unlocked;
    }
    return { total, unlocked };
  }, [cache]);

  // Total achievements completion %
  const achievementPct = achievementCounts.total > 0
    ? Math.round((achievementCounts.unlocked / achievementCounts.total) * 100)
    : 0;

  // Ranked top games (most played)
  const topGames = useMemo(() => {
    const maxMin = stats.topGames.length > 0 ? stats.topGames[0].minutes : 0;
    return stats.topGames.map((g) => {
      const libGame = games.find((lg) => lg.id === g.gameId);
      return {
        ...g,
        coverArtUrl: libGame?.coverArtUrl,
        platform: libGame?.platform,
        pct: maxMin > 0 ? Math.round((g.minutes / maxMin) * 100) : 0,
      };
    });
  }, [stats.topGames, games]);

  // Quick stats lists
  const focusStatsCard1 = useFocusable(() => {});
  const focusStatsCard2 = useFocusable(() => {});
  const focusStatsCard3 = useFocusable(() => {});
  const focusStatsCard4 = useFocusable(() => {});

  return (
    <div className="bigscreen-system-section-view" style={{ padding: "40px", overflowY: "auto", height: "100%" }}>
      <h2 style={{ marginBottom: "24px" }}>Gamer Statistics</h2>

      {/* KPI Cards Row */}
      <div className="bigscreen-gamepage-2col" data-cols="4" style={{ marginBottom: "30px", gap: "20px" }}>
        <div className="bigscreen-widget-card" {...focusStatsCard1} style={{ padding: "20px" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "8px" }}>Total Playtime</div>
          <div style={{ fontSize: "28px", fontWeight: "700", color: "var(--color-accent)" }}>{formatHours(stats.totalPlayTimeMin)}</div>
          <div style={{ fontSize: "11px", marginTop: "6px", color: "var(--color-text-muted)" }}>Across all launches</div>
        </div>

        <div className="bigscreen-widget-card" {...focusStatsCard2} style={{ padding: "20px" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "8px" }}>Achievements</div>
          <div style={{ fontSize: "28px", fontWeight: "700", color: "#10b981" }}>{achievementCounts.unlocked} / {achievementCounts.total}</div>
          <div style={{ fontSize: "11px", marginTop: "6px", color: "var(--color-text-muted)" }}>{achievementPct}% unlocked</div>
        </div>

        <div className="bigscreen-widget-card" {...focusStatsCard3} style={{ padding: "20px" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "8px" }}>Library Size</div>
          <div style={{ fontSize: "28px", fontWeight: "700", color: "white" }}>{games.length} Games</div>
          <div style={{ fontSize: "11px", marginTop: "6px", color: "var(--color-text-muted)" }}>Imported from all sources</div>
        </div>

        <div className="bigscreen-widget-card" {...focusStatsCard4} style={{ padding: "20px" }}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "8px" }}>Launch Activity</div>
          <div style={{ fontSize: "28px", fontWeight: "700", color: "var(--color-warning)" }}>{sessions.length} Launches</div>
          <div style={{ fontSize: "11px", marginTop: "6px", color: "var(--color-text-muted)" }}>Gameplay sessions tracked</div>
        </div>
      </div>

      {/* Main Grid: Left side Top Played, Right side breakdowns */}
      <div className="bigscreen-gamepage-2col" data-cols="2" style={{ gap: "30px", alignItems: "flex-start" }}>
        
        {/* Top Played Games */}
        <div className="bigscreen-widget-card" style={{ padding: "24px" }}>
          <h3 style={{ marginTop: 0, marginBottom: "20px" }}>Most Played Games</h3>
          {topGames.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>No playtime tracked yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {topGames.slice(0, 5).map((g) => {
                const gameFocusProps = useFocusable(() => {});
                return (
                  <div
                    key={g.gameId}
                    {...gameFocusProps}
                    className="bigscreen-system-menu-item"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                      padding: "10px 14px",
                      border: "1px solid transparent",
                      borderRadius: "8px",
                      background: "rgba(255, 255, 255, 0.02)",
                    }}
                  >
                    <div style={{ width: "36px", height: "48px", borderRadius: "4px", overflow: "hidden", background: "var(--color-bg-tertiary)" }}>
                      {g.coverArtUrl ? (
                        <img src={g.coverArtUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center", opacity: 0.1 }}>
                          🎮
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "14px", fontWeight: "600", color: "white" }}>{g.gameName}</div>
                      <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                        {formatHours(g.minutes)} ({g.sessions} launches)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Breakdown by Genre and Platform */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%" }}>
          <div className="bigscreen-widget-card" style={{ padding: "24px" }}>
            <h3 style={{ marginTop: 0, marginBottom: "16px" }}>Playtime by Genre</h3>
            {stats.genreBreakdown.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>No genres tracked yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {stats.genreBreakdown.slice(0, 5).map((gen) => (
                  <div key={gen.genre} style={{ fontSize: "13px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span>{gen.genre}</span>
                      <span style={{ color: "var(--color-text-muted)" }}>{formatHours(gen.minutes)}</span>
                    </div>
                    <div style={{ height: "6px", borderRadius: "3px", background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "var(--color-accent)", width: `${Math.min(100, (gen.minutes / stats.totalPlayTimeMin) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bigscreen-widget-card" style={{ padding: "24px" }}>
            <h3 style={{ marginTop: 0, marginBottom: "16px" }}>Playtime by Platform</h3>
            {stats.platformBreakdown.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>No platforms tracked yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {stats.platformBreakdown.slice(0, 5).map((plat) => (
                  <div key={plat.platform} style={{ fontSize: "13px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span>{plat.platform}</span>
                      <span style={{ color: "var(--color-text-muted)" }}>{formatHours(plat.minutes)}</span>
                    </div>
                    <div style={{ height: "6px", borderRadius: "3px", background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "var(--color-warning)", width: `${Math.min(100, (plat.minutes / stats.totalPlayTimeMin) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
