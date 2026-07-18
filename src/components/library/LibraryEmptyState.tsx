import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { gameNameFromPath } from "../../types/game";

interface LibraryEmptyStateProps {
  onImported?: () => void;
}

/**
 * Empty state for the Library page (shown when `games.length === 0`).
 * A 3-card quick-action grid: import a single .exe, scan a folder, or
 * browse the Store.
 */
export default function LibraryEmptyState({ onImported }: LibraryEmptyStateProps) {
  const navigate = useNavigate();
  const { importLocalGames } = useGames();
  const { showToast } = useToast();

  async function handleImportExe() {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: "Import a Game Executable",
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (filePath && typeof filePath === "string") {
        await importLocalGames([{ path: filePath, metadata: null }]);
        showToast(`Imported ${gameNameFromPath(filePath)}`, "success");
        onImported?.();
      }
    } catch (err) {
      console.error("Import failed:", err);
      showToast(`Import failed: ${err}`, "error");
    }
  }

  function handleBrowseStore() {
    navigate("/store");
  }

  function handleScanFolder() {
    const sidebarImportBtn = document.querySelector<HTMLButtonElement>(".sidebar-import-btn");
    if (sidebarImportBtn) {
      sidebarImportBtn.scrollIntoView({ block: "center" });
      sidebarImportBtn.click();
      showToast("Pick 'Import Folder' from the sidebar menu to scan a directory.", "info");
    }
  }

  return (
    <div className="lib-empty">
      <div className="lib-empty-orb" aria-hidden />
      <div className="lib-empty-icon" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </div>

      <h2 className="lib-empty-title">Welcome to Gamelib</h2>
      <p className="lib-empty-subtitle">
        Your collection is looking a little empty. Pick a path below to get started — you can always import more games later.
      </p>

      <div className="lib-empty-actions">
        <button type="button" className="lib-empty-card" onClick={handleImportExe}>
          <div className="lib-empty-card-icon lib-empty-card-icon--accent">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <div className="lib-empty-card-text">
            <h3 className="lib-empty-card-title">Import an EXE</h3>
            <p className="lib-empty-card-desc">Add a single game executable. Quickest way to start.</p>
          </div>
          <span className="lib-empty-card-cta" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </button>

        <button type="button" className="lib-empty-card" onClick={handleScanFolder}>
          <div className="lib-empty-card-icon lib-empty-card-icon--info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </div>
          <div className="lib-empty-card-text">
            <h3 className="lib-empty-card-title">Scan a Folder</h3>
            <p className="lib-empty-card-desc">Bulk-import every .exe in a directory at once.</p>
          </div>
          <span className="lib-empty-card-cta" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </button>

        <button type="button" className="lib-empty-card" onClick={handleBrowseStore}>
          <div className="lib-empty-card-icon lib-empty-card-icon--success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
          </div>
          <div className="lib-empty-card-text">
            <h3 className="lib-empty-card-title">Browse the Store</h3>
            <p className="lib-empty-card-desc">Discover and track new releases from the IGDB catalog.</p>
          </div>
          <span className="lib-empty-card-cta" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  );
}
