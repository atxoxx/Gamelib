import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { gameNameFromPath } from "../../types/game";

interface LibraryEmptyStateProps {
  /**
   * Optional callback fired when the user successfully imports a
   * single executable. Lets the parent close any wrapping modals
   * (e.g. a "first-run" wizard) once the import completes.
   */
  onImported?: () => void;
}

/**
 * Empty state for the Library page.
 *
 * Shown when `games.length === 0` — i.e. the user hasn't imported any
 * games yet. Replaces the old single-line "Your Game Library" hint
 * with a 3-card quick-action grid: import a single .exe, scan a
 * folder of executables, or browse the Store.
 *
 * Note: the folder-scan flow opens the multi-file Import modal. We
 * keep the import flow state local to the page rather than
 * duplicating the modal here — when a folder is scanned, the
 * `ImportModal` mounted by `LibraryPage` re-renders with the new
 * exes. This keeps the modal in one place instead of having two
 * `ImportModal`s competing.
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

  return (
    <div className="library-empty-hero">
      {/* Decorative gradient orb — pure visual sugar, sits behind the
          content with `aria-hidden` so screen readers skip it. */}
      <div className="library-empty-hero-orb" aria-hidden />

      <div className="library-empty-hero-icon" aria-hidden>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </div>

      <h2 className="library-empty-hero-title">Welcome to Gamelib</h2>
      <p className="library-empty-hero-subtitle">
        Your collection is looking a little empty. Pick a path below to
        get started — you can always import more games later.
      </p>

      <div className="library-empty-hero-actions">
        <button
          type="button"
          className="library-empty-hero-card"
          onClick={handleImportExe}
        >
          <div className="library-empty-hero-card-icon library-empty-hero-card-icon--accent">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <div className="library-empty-hero-card-text">
            <h3 className="library-empty-hero-card-title">Import an EXE</h3>
            <p className="library-empty-hero-card-desc">
              Add a single game executable. Quickest way to start.
            </p>
          </div>
          <span className="library-empty-hero-card-cta" aria-hidden>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </button>

        <button
          type="button"
          className="library-empty-hero-card"
          onClick={() => {
            // Trigger the same "import folder" flow as the sidebar
            // menu by dispatching a click on the sidebar's import
            // button. The Sidebar's import button toggles a popover
            // menu; rather than duplicate the menu UI here, we
            // just send the user to the existing affordance.
            // A more thorough refactor would lift the import state
            // into a shared hook — see the comment in LibraryPage.
            const sidebarImportBtn = document.querySelector<HTMLButtonElement>(
              ".sidebar-import-btn"
            );
            if (sidebarImportBtn) {
              sidebarImportBtn.scrollIntoView({ block: "center" });
              sidebarImportBtn.click();
              showToast(
                "Pick 'Import Folder' from the sidebar menu to scan a directory.",
                "info"
              );
            }
          }}
        >
          <div className="library-empty-hero-card-icon library-empty-hero-card-icon--info">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </div>
          <div className="library-empty-hero-card-text">
            <h3 className="library-empty-hero-card-title">Scan a Folder</h3>
            <p className="library-empty-hero-card-desc">
              Bulk-import every .exe in a directory at once.
            </p>
          </div>
          <span className="library-empty-hero-card-cta" aria-hidden>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </button>

        <button
          type="button"
          className="library-empty-hero-card"
          onClick={handleBrowseStore}
        >
          <div className="library-empty-hero-card-icon library-empty-hero-card-icon--success">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
          </div>
          <div className="library-empty-hero-card-text">
            <h3 className="library-empty-hero-card-title">Browse the Store</h3>
            <p className="library-empty-hero-card-desc">
              Discover and track new releases from the IGDB catalog.
            </p>
          </div>
          <span className="library-empty-hero-card-cta" aria-hidden>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  );
}
