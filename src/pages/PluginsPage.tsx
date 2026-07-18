import { useBigScreen } from "../context/BigScreenContext";
import BigScreenSystem from "../components/bigscreen/BigScreenSystem";

export default function PluginsPage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenSystem />;
  }
  return (
    <div className="page-placeholder">
      <svg className="page-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <h2 className="page-placeholder-title">Plugins</h2>
      <p className="page-placeholder-subtitle">Extend Gamelib with community plugins for scrapers, themes, and integrations — coming soon.</p>
    </div>
  );
}
