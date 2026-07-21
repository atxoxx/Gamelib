import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";

interface SessionNote {
  tags: string[];
  note: string;
}

interface SessionNotesContextType {
  getNote: (sessionId: string) => SessionNote;
  setTags: (sessionId: string, tags: string[]) => void;
  setNote: (sessionId: string, note: string) => void;
  getAllNotes: () => Record<string, SessionNote>;
}

const STORAGE_KEY = "gamelib-session-notes";

const SessionNotesContext = createContext<SessionNotesContextType | null>(null);

function loadAll(): Record<string, SessionNote> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore corrupt storage
  }
  return {};
}

function saveAll(all: Record<string, SessionNote>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function SessionNotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Record<string, SessionNote>>(() => loadAll());

  useEffect(() => {
    saveAll(notes);
  }, [notes]);

  const getNote = useCallback(
    (sessionId: string): SessionNote => {
      return notes[sessionId] ?? { tags: [], note: "" };
    },
    [notes]
  );

  const setTags = useCallback((sessionId: string, tags: string[]) => {
    setNotes((prev) => {
      const next = { ...prev };
      const current = next[sessionId] ?? { tags: [], note: "" };
      next[sessionId] = { ...current, tags };
      return next;
    });
  }, []);

  const setNote = useCallback((sessionId: string, note: string) => {
    setNotes((prev) => {
      const next = { ...prev };
      const current = next[sessionId] ?? { tags: [], note: "" };
      next[sessionId] = { ...current, note };
      return next;
    });
  }, []);

  const getAllNotes = useCallback(() => notes, [notes]);

  const value = useMemo(
    () => ({ getNote, setTags, setNote, getAllNotes }),
    [getNote, setTags, setNote, getAllNotes]
  );

  return <SessionNotesContext.Provider value={value}>{children}</SessionNotesContext.Provider>;
}

export function useSessionNotes(): SessionNotesContextType {
  const ctx = useContext(SessionNotesContext);
  if (!ctx) {
    throw new Error("useSessionNotes must be used within a SessionNotesProvider");
  }
  return ctx;
}
