export default function LibraryPage() {
  return (
    <div className="main-empty">
      <svg className="main-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <h2 className="main-empty-title">Your Game Library</h2>
      <p className="main-empty-subtitle">
        Select a game from the sidebar to view details, or import games to get started building your collection.
      </p>
    </div>
  );
}
