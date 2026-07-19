// Tiny shared signal used to jump from the Wishlist page straight into the
// Friends "Wishlist Shares" tab with a specific game pre-selected for sharing.
// Kept outside React state so any component can push a request that the
// Friends page consumes on mount.

export interface PendingSuggestion {
  gameId: string;
  gameName: string;
  coverUrl?: string | null;
}

let pending: PendingSuggestion | null = null;
let listener: ((p: PendingSuggestion) => void) | null = null;

export function requestShareToFriends(payload: PendingSuggestion): void {
  pending = payload;
  if (listener) listener(payload);
}

export function consumePendingSuggestion(): PendingSuggestion | null {
  const p = pending;
  pending = null;
  return p;
}

export function onPendingSuggestion(cb: (p: PendingSuggestion) => void): () => void {
  listener = cb;
  return () => {
    if (listener === cb) listener = null;
  };
}
