import { useEffect, useState } from "react";

/**
 * useGameAccent
 *
 * Samples the dominant color from a game's cover/hero art using a
 * tiny off-DOM <canvas>, then returns a CSS color string suitable
 * for tinting the hero (accent stripe, status dot, KPI tiles) with
 * the game's own palette. Falls back to `null` so callers can keep
 * using the global `--color-accent`.
 *
 * Design notes:
 *  - We draw the image scaled down to 16×16 (cheap) and read the
 *    center-weighted average — good enough for a pleasant tint and
 *    avoids the cost of a full dominant-color algorithm.
 *  - CORS: Tauri `asset://` / `http(s)://` images with
 *    crossOrigin="anonymous" decode fine locally; if sampling throws
 *    (tainted canvas / broken URL) we simply keep the fallback.
 *  - The effect is debounced off the main paint: it runs after the
 *    image loads, not on every render.
 */
export function useGameAccent(imageUrl: string | null | undefined): string | null {
  const [accent, setAccent] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setAccent(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        // Weight by luminance-ish center bias so a bright logo
        // doesn't wash the tint to white; skip near-black/near-white.
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const pr = data[i];
            const pg = data[i + 1];
            const pb = data[i + 2];
            const max = Math.max(pr, pg, pb);
            const min = Math.min(pr, pg, pb);
            if (max - min < 12) continue; // skip greys / near-black
            if (max > 248) continue; // skip near-white
            // center bias
            const dx = x - size / 2;
            const dy = y - size / 2;
            const w = 1 + (size - Math.hypot(dx, dy)) / size;
            r += pr * w;
            g += pg * w;
            b += pb * w;
            count += w;
          }
        }
        if (count === 0) return;
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        // Lift saturation slightly so muted covers still read as a tint.
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min < 30) {
          const boost = 40;
          const mid = (max + min) / 2;
          r = Math.min(255, Math.round(mid + (r - mid) * 1.4 + boost * 0.0));
          g = Math.min(255, Math.round(mid + (g - mid) * 1.4));
          b = Math.min(255, Math.round(mid + (b - mid) * 1.4));
        }
        setAccent(`rgb(${r}, ${g}, ${b})`);
      } catch {
        // tainted canvas / decode failure → keep fallback
      }
    };

    img.onerror = () => {
      if (!cancelled) setAccent(null);
    };

    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return accent;
}
