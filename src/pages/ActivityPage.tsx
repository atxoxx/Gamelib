import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import html2canvas from "html2canvas";
import { prepareClonedDocumentForCanvasCapture } from "../utils/color";
import { useActivity } from "../context/ActivityContext";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { ActivityDashboard } from "./activity/ActivityDashboard";
import { ActivityGantt } from "./activity/ActivityGantt";
import { ActivitySessions } from "./activity/ActivitySessions";
import { ActivityPerformance } from "./activity/ActivityPerformance";
import * as Icons from "./activity/Icons";
import "./activity/ActivityPage.css";

type TabType = "dashboard" | "timeline" | "sessions" | "performance";
type DateRangePreset = "7d" | "30d" | "90d" | "all";
type AggregationType = "day" | "week" | "month";
type ChartType = "bar" | "line";

import { useBigScreen } from "../context/BigScreenContext";
import BigScreenHome from "../components/bigscreen/BigScreenHome";

export default function ActivityPage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenHome />;
  }
  const { sessions, deleteSession } = useActivity();
  const { games } = useGames();
  // Toast feedback for screenshot success / error (matches the rest of
  // the app instead of throwing a native alert()).
  const { showToast } = useToast();

  // Tab & Filter States
  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [dateRange, setDateRange] = useState<DateRangePreset>("7d");
  const [aggregation, setAggregation] = useState<AggregationType>("day");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  // Determine date boundaries based on timeframe preset
  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    const endStr = today.toISOString().slice(0, 10);
    const start = new Date(today);

    if (dateRange === "7d") {
      start.setDate(today.getDate() - 6);
    } else if (dateRange === "30d") {
      start.setDate(today.getDate() - 29);
    } else if (dateRange === "90d") {
      start.setDate(today.getDate() - 89);
    } else {
      // All time
      if (sessions.length > 0) {
        const sortedDates = sessions.map((s) => s.date.slice(0, 10)).sort();
        return { startDate: sortedDates[0], endDate: endStr };
      }
      start.setFullYear(today.getFullYear() - 1);
    }

    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: endStr,
    };
  }, [dateRange, sessions]);

  // Dynamically extract all available game platforms
  const availablePlatforms = useMemo(() => {
    const set = new Set<string>();
    games.forEach((g) => {
      if (g.platform) set.add(g.platform);
    });
    return Array.from(set).sort();
  }, [games]);

  // Handler to export session history to a CSV file
  const handleExportCSV = () => {
    if (sessions.length === 0) {
      alert("No sessions to export!");
      return;
    }

    const headers = [
      "Session ID",
      "Game Name",
      "Game ID",
      "Date Played",
      "Duration (Minutes)",
      "Platform",
      "Avg FPS",
      "Min FPS",
      "Max FPS",
      "Avg CPU Usage (%)",
      "Avg GPU Usage (%)",
      "Avg RAM Usage (%)",
      "Avg CPU Temp (°C)",
      "Avg GPU Temp (°C)",
    ];

    const rows = sessions.map((s) => {
      const game = games.find((g) => g.id === s.gameId);
      return [
        s.id,
        s.gameName,
        s.gameId,
        s.date,
        s.durationMin,
        game?.platform || "Local",
        s.metrics?.avgFps || "—",
        s.metrics?.minFps || "—",
        s.metrics?.maxFps || "—",
        s.metrics?.avgCpuUsage || "—",
        s.metrics?.avgGpuUsage || "—",
        s.metrics?.avgRamUsage || "—",
        s.metrics?.avgCpuTemp || "—",
        s.metrics?.avgGpuTemp || "—",
      ];
    });

    const csvContent = [headers.join(","), ...rows.map((row) => row.map((val) => `"${val}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `gamelib_activity_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // `showToast` is destructured at the top of this component alongside
  // the other hooks.

  const handleCaptureScreenshot = async () => {
    try {
      const container = document.querySelector(".activity__container");
      if (!container) return;

      // Capture the *entire* activity view in height, not just the
      // currently-visible portion. scrollHeight reflects the full
      // rendered panel including content below the fold; passing it as
      // both `height` and `windowHeight` lets html2canvas paint the
      // complete layout in one pass instead of viewport-clipped pixels.
      const fullHeight = (container as HTMLElement).scrollHeight;
      const fullWidth = (container as HTMLElement).scrollWidth;

      const canvas = await html2canvas(container as HTMLElement, {
        backgroundColor: "#0f1117",
        scale: 2,
        logging: false,
        useCORS: true,
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        // html2canvas 1.4.1 doesn't understand CSS Color Module L4
        // `color-mix(in srgb, …)` and throws "Attempting to parse an
        // unsupported color function 'color'". The project uses
        // color-mix in 170+ rules, so we rewrite every `color-mix()`
        // in the clone to a literal rgb() / rgba() before html2canvas
        // reads computed styles (see src/utils/color.ts).
        onclone: prepareClonedDocumentForCanvasCapture,
      });

      const dataUrl = canvas.toDataURL("image/png");

      const filePath = await save({
        title: "Save Activity Screenshot",
        defaultPath: `gamelib_activity_screenshot_${new Date().toISOString().slice(0, 10)}.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });

      if (!filePath) return;

      await invoke("save_screenshot", { filePath, base64Data: dataUrl });
      showToast("Activity screenshot saved", "success");
    } catch (error) {
      console.error("Screenshot error:", error);
      showToast(`Failed to save screenshot: ${error}`, "error");
    }
  };

  return (
    <div className="activity__container">
      {/* Page Header */}
      <header className="activity__header">
        <div className="activity__header-left">
          <h1 className="activity__title">Activity Page</h1>
          
          {/* Main Navigation Tabs */}
          <nav className="activity__tabs">
            <button
              type="button"
              className={`activity__tab-btn ${activeTab === "dashboard" ? "activity__tab-btn--active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              <Icons.LayoutDashboard size={13} />
              Dashboard
            </button>
            <button
              type="button"
              className={`activity__tab-btn ${activeTab === "timeline" ? "activity__tab-btn--active" : ""}`}
              onClick={() => setActiveTab("timeline")}
            >
              <Icons.GanttChart size={13} />
              Timeline
            </button>
            <button
              type="button"
              className={`activity__tab-btn ${activeTab === "sessions" ? "activity__tab-btn--active" : ""}`}
              onClick={() => setActiveTab("sessions")}
            >
              <Icons.History size={13} />
              Sessions Log
            </button>
            <button
              type="button"
              className={`activity__tab-btn ${activeTab === "performance" ? "activity__tab-btn--active" : ""}`}
              onClick={() => setActiveTab("performance")}
            >
              <Icons.BarChart3 size={13} />
              Performance
            </button>
          </nav>
        </div>

        {/* Global Toolbar Filters */}
        <div className="activity__header-right">
          <div className="activity-toolbar">
            {/* Timeframe Presets */}
            <div className="activity-toolbar__group activity-toolbar__date-range">
              {(["7d", "30d", "90d", "all"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`activity-toolbar__pill ${dateRange === preset ? "activity-toolbar__pill--active" : ""}`}
                  onClick={() => setDateRange(preset)}
                >
                  {preset === "all" ? "All Time" : preset.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="activity-toolbar__divider" />

            {/* Platform/Source Selector */}
            <div className="activity-toolbar__group">
              <Icons.Filter size={11} className="activity-toolbar__filter-icon" />
              <select
                className="activity-toolbar__select"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                <option value="all">Source: All</option>
                {availablePlatforms.map((plat) => (
                  <option key={plat} value={plat}>
                    {plat}
                  </option>
                ))}
              </select>
            </div>

            {/* Dashboard Specific Sub-options */}
            {activeTab === "dashboard" && (
              <>
                <div className="activity-toolbar__divider" />

                {/* Aggregation interval (Day/Week/Month) */}
                <div className="activity-toolbar__group">
                  <span className="activity-toolbar__label">Interval</span>
                  <div className="activity-toolbar__segmented">
                    {(["day", "week", "month"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`activity-toolbar__segmented-btn ${
                          aggregation === mode ? "activity-toolbar__segmented-btn--active" : ""
                        }`}
                        onClick={() => setAggregation(mode)}
                      >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="activity-toolbar__divider" />

                {/* Chart Type (Bar / Line) */}
                <div className="activity-toolbar__group">
                  <div className="activity-toolbar__icon-toggle">
                    <button
                      type="button"
                      className={`activity-toolbar__icon-btn ${
                        chartType === "bar" ? "activity-toolbar__icon-btn--active" : ""
                      }`}
                      onClick={() => setChartType("bar")}
                      title="Bar Chart"
                    >
                      <Icons.BarChart3 size={11} />
                    </button>
                    <button
                      type="button"
                      className={`activity-toolbar__icon-btn ${
                        chartType === "line" ? "activity-toolbar__icon-btn--active" : ""
                      }`}
                      onClick={() => setChartType("line")}
                      title="Line Chart"
                    >
                      <Icons.TrendingUp size={11} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Action Actions */}
          <div className="activity__export-actions">
            <button
              type="button"
              className="activity__icon-btn"
              onClick={handleCaptureScreenshot}
              title="Capture screenshot / Print"
            >
              <Icons.Camera size={13} />
            </button>
            <button
              type="button"
              className="activity__icon-btn"
              onClick={handleExportCSV}
              title="Export CSV"
            >
              <Icons.Download size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* Tab Router Content Panels */}
      <main style={{ marginTop: "20px", flex: 1, minHeight: 0 }}>
        {activeTab === "dashboard" && (
          <ActivityDashboard
            sessions={sessions}
            games={games}
            dateRange={dateRange}
            startDate={startDate}
            endDate={endDate}
            aggregation={aggregation}
            chartType={chartType}
            sourceFilter={sourceFilter}
          />
        )}

        {activeTab === "timeline" && (
          <ActivityGantt
            sessions={sessions}
            games={games}
            startDate={startDate}
            endDate={endDate}
          />
        )}

        {activeTab === "sessions" && (
          <ActivitySessions
            sessions={sessions}
            games={games}
            onDeleteSession={deleteSession}
          />
        )}

        {activeTab === "performance" && (
          <ActivityPerformance
            sessions={sessions}
            games={games}
          />
        )}
      </main>
    </div>
  );
}
