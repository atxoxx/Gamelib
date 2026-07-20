import { useCallback, useEffect, useState } from "react";
import { STORE_PRESETS_KEY, type StoreFilterPreset } from "../types/game";

/**
 * useStorePresets: named filter presets persisted to localStorage. Lets
 * power users snapshot a full browse configuration (facets + sources +
 * sort) and restore it in one click.
 */
export function useStorePresets() {
  const [presets, setPresets] = useState<StoreFilterPreset[]>(() => {
    try {
      const raw = localStorage.getItem(STORE_PRESETS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as StoreFilterPreset[];
      }
    } catch {
      /* ignore */
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORE_PRESETS_KEY, JSON.stringify(presets));
    } catch {
      /* ignore */
    }
  }, [presets]);

  /** Save a new preset. Returns the created preset (with generated id). */
  const save = useCallback(
    (preset: Omit<StoreFilterPreset, "id">): StoreFilterPreset => {
      const created: StoreFilterPreset = {
        ...preset,
        id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      };
      setPresets((prev) => [created, ...prev]);
      return created;
    },
    []
  );

  const remove = useCallback((id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { presets, save, remove };
}
