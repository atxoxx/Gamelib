import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Describes the "feel" of a theme so the UI can tag it with the right
 * emoji/label (e.g. "🎮 Vibrant", "🧘 Calm", "♿ High-Contrast").
 */
export type ThemeDescriptor = "vibrant" | "calm" | "high-contrast" | "minimal";

export interface ThemeMeta {
  name: string;
  descriptor: ThemeDescriptor;
  author?: string;
  createdAt?: string;
  isCustom?: boolean;
}

export interface ThemeConfig {
  id: string;
  meta: ThemeMeta;
}

/** Well-known built-in themes. */
const BUILTIN_THEMES: ThemeConfig[] = [
  {
    id: "dark",
    meta: { name: "Default Dark", descriptor: "vibrant" },
  },
  {
    id: "light",
    meta: { name: "Light Mode", descriptor: "minimal" },
  },
  {
    id: "nord",
    meta: { name: "Nord Ice", descriptor: "calm" },
  },
  {
    id: "cyberpunk",
    meta: { name: "Cyberpunk", descriptor: "vibrant" },
  },
  {
    id: "emerald",
    meta: { name: "Emerald", descriptor: "calm" },
  },
  {
    id: "dracula",
    meta: { name: "Dracula", descriptor: "vibrant" },
  },
  {
    id: "solarized",
    meta: { name: "Solarized", descriptor: "calm" },
  },
  {
    id: "tokyonight",
    meta: { name: "Tokyo Night", descriptor: "calm" },
  },
  {
    id: "gruvbox",
    meta: { name: "Gruvbox", descriptor: "minimal" },
  },
  {
    id: "catppuccin",
    meta: { name: "Catppuccin", descriptor: "vibrant" },
  },
  {
    id: "sunset",
    meta: { name: "Sunset", descriptor: "vibrant" },
  },
  {
    id: "oceanic",
    meta: { name: "Oceanic", descriptor: "calm" },
  },
  {
    id: "rosepine",
    meta: { name: "Rose Pine", descriptor: "minimal" },
  },
  {
    id: "synthwave",
    meta: { name: "Synthwave", descriptor: "vibrant" },
  },
  {
    id: "forest",
    meta: { name: "Forest", descriptor: "calm" },
  },
  {
    id: "desert",
    meta: { name: "Desert Mirage", descriptor: "minimal" },
  },
  {
    id: "aurora",
    meta: { name: "Aurora", descriptor: "vibrant" },
  },
];

const STORAGE_KEY = "gamelib-theme";
const SYSTEM_SYNC_KEY = "gamelib-theme-system-sync";
const CUSTOM_THEMES_KEY = "gamelib-custom-themes";

// ── Helpers ────────────────────────────────────────────────────────────

function loadThemes(): ThemeConfig[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return [...BUILTIN_THEMES];
    const custom: Array<{ id: string; meta: ThemeMeta }> = JSON.parse(raw);
    return [...BUILTIN_THEMES, ...custom];
  } catch {
    return [...BUILTIN_THEMES];
  }
}

function applyTheme(themeId: string) {
  document.documentElement.setAttribute("data-theme", themeId);
}

function resolveSystemTheme(): "dark" | "light" {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

// ── Context type ───────────────────────────────────────────────────────

interface ThemeContextValue {
  /** Currently active theme id. */
  currentTheme: string;
  /** Switch to a theme by id. Persisted to localStorage. */
  setTheme: (themeId: string) => void;
  /** All available themes (builtin + custom). */
  themes: ThemeConfig[];
  /** Add a user-defined custom theme. */
  addCustomTheme: (theme: ThemeConfig) => void;
  /** Remove a user-defined custom theme. No-op on builtins. */
  removeCustomTheme: (themeId: string) => void;
  /** Whether the system-preference sync toggle is on. */
  systemSync: boolean;
  /** Toggle system preference sync. */
  setSystemSync: (on: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themes, setThemes] = useState<ThemeConfig[]>(loadThemes);
  const [systemSync, setSystemSyncState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SYSTEM_SYNC_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [currentTheme, setCurrentThemeState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "dark";
    } catch {
      return "dark";
    }
  });

  // Apply theme on mount and on change
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  // Listen for OS color-scheme changes when systemSync is on
  useEffect(() => {
    if (!systemSync) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const osTheme = resolveSystemTheme();
      setCurrentThemeState(osTheme);
      try {
        localStorage.setItem(STORAGE_KEY, osTheme);
      } catch {
        /* ignore */
      }
    };
    mq.addEventListener("change", handler);
    // Immediately sync to current OS preference
    handler();
    return () => mq.removeEventListener("change", handler);
  }, [systemSync]);

  const setTheme = useCallback(
    (themeId: string) => {
      setCurrentThemeState(themeId);
      try {
        localStorage.setItem(STORAGE_KEY, themeId);
      } catch {
        /* ignore */
      }
    },
    []
  );

  const setSystemSync = useCallback(
    (on: boolean) => {
      setSystemSyncState(on);
      try {
        localStorage.setItem(SYSTEM_SYNC_KEY, String(on));
      } catch {
        /* ignore */
      }
      if (on) {
        const osTheme = resolveSystemTheme();
        setCurrentThemeState(osTheme);
        try {
          localStorage.setItem(STORAGE_KEY, osTheme);
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  const addCustomTheme = useCallback((theme: ThemeConfig) => {
    setThemes((prev) => {
      const filtered = prev.filter((t) => t.id !== theme.id);
      const next = [...filtered, { ...theme, meta: { ...theme.meta, isCustom: true } }];
      try {
        const custom = next.filter((t) =>
          !BUILTIN_THEMES.some((b) => b.id === t.id)
        );
        localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(custom));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const removeCustomTheme = useCallback((themeId: string) => {
    // Never remove builtins
    if (BUILTIN_THEMES.some((b) => b.id === themeId)) return;
    setThemes((prev) => {
      const next = prev.filter((t) => t.id !== themeId);
      try {
        const custom = next.filter((t) =>
          !BUILTIN_THEMES.some((b) => b.id === t.id)
        );
        localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(custom));
      } catch {
        /* ignore */
      }
      return next;
    });
    // If the removed theme was active, fall back to dark
    if (currentTheme === themeId) {
      setTheme("dark");
    }
  }, [currentTheme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      currentTheme,
      setTheme,
      themes,
      addCustomTheme,
      removeCustomTheme,
      systemSync,
      setSystemSync,
    }),
    [currentTheme, setTheme, themes, addCustomTheme, removeCustomTheme, systemSync, setSystemSync]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
