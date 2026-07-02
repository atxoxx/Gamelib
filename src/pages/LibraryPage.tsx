import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import type { Game } from "../types/game";

export default function LibraryPage() {
  const navigate = useNavigate();
  const { games, setSelectedGameId } = useGames();

  if (games.length === 0) {
    return (
      <div className="main-empty">
        <svg className="main-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <h2 className="main-empty-title">Your Game Library</h2>
        <p className="main-empty-subtitle">
          Import games using the + button in the sidebar to start building your collection.
        </p>
      </div>
    );
  }

  function handleCardClick(game: Game) {
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  return (
    <div className="library-grid">
      <h2 className="library-heading">Library ({games.length})</h2>
      <div className="library-cards">
        {games.map((game) => (
          <div
            key={game.id}
            className="library-card"
            onClick={() => handleCardClick(game)}
          >
            <div className="library-card-cover">
              {game.coverArtUrl ? (
                <img src={game.coverArtUrl} alt={game.name} />
              ) : (
                <div className="library-card-cover-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
              )}
            </div>
            <div className="library-card-body">
              <h3 className="library-card-name">{game.name}</h3>
              <span className="library-card-platform">{game.platform}</span>
              {game.notes ? (
                <p className="library-card-notes">{game.notes}</p>
              ) : (
                <p className="library-card-notes library-card-notes-empty">
                  No notes
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
