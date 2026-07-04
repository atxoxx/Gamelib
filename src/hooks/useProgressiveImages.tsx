import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Hook that progressively downloads a cover image when its element enters
 * the viewport. Uses `IntersectionObserver` with 200 px root margin so
 * images start loading slightly before the user scrolls to them.
 *
 * Usage in a component:
 * ```tsx
 * const [coverUrl, imgRef] = useProgressiveImage(game.coverUrl);
 * return <img ref={imgRef} src={coverUrl ?? placeholder} />;
 * ```
 *
 * Returns a tuple of `[loadedUrl, refCallback]`:
 * - `loadedUrl` starts as the original URL and is replaced with a base64
 *   data URL once the download completes.
 * - `refCallback` is a function ref to attach to the `<img>` element.
 */
export function useProgressiveImage(
  url: string | null
): [string | null, (node: HTMLElement | null) => void] {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(url);
  const downloadingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Reset whenever the source URL changes
  useEffect(() => {
    setLoadedUrl(url);
    downloadingRef.current = false;
  }, [url]);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const refCallback = useCallback(
    (node: HTMLElement | null) => {
      // Disconnect previous observer if any
      observerRef.current?.disconnect();

      if (!node || !url || downloadingRef.current) return;

      observerRef.current = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !downloadingRef.current) {
            downloadingRef.current = true;

            invoke<string | null>("download_image", { url })
              .then((base64) => {
                if (base64) setLoadedUrl(base64);
              })
              .catch(() => {
                // Silently keep the original URL on failure
              });
          }
        },
        { rootMargin: "200px" }
      );

      observerRef.current.observe(node);
    },
    [url]
  );

  return [loadedUrl, refCallback];
}
