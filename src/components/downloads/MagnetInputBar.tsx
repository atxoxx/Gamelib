// Inline magnet-link / .torrent URL input.
//
// Sits at the top of the Downloads page so a power user can paste a
// URI and start a download without going through the GamePage →
// DownloadModal flow. Mirrors the same validation as `torrent_add`
// (the Rust command only accepts `magnet:`, `http://`, `https://`).
//
// Why include this on the dedicated page (and not just the modal)?
//
//   * Quick-add is the #1 use case once a user is "in the
//     downloads mindset" and just wants to drop in the next
//     magnet from their clipboard.
//   * It doesn't conflict with the modal — the modal is the
//     "browse, pick a source, save path" flow; this is the
//     "I already have a URI" flow.
//
// Two conveniences layered on top of the basic paste-and-add flow:
//
//   1. Default save path — when the user has set a default download
//      folder in Settings (and hasn't enabled "always ask"), we skip
//      the folder picker and drop the download straight in.
//   2. Drag-and-drop — dropping a magnet link (as text) or a
//      `.torrent` file URL onto the bar fills the input, so the user
//      can drag from a browser without copying to the clipboard.

import { useState } from "react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";

const URI_PATTERN = /^(magnet:|https?:\/\/)/i;

/** Resolve the save folder: honour the configured default unless the
 *  user asked to always be prompted (or no default is set). Returns
 *  null when the user cancels the picker. */
async function resolveSavePath(
  selectSavePath: () => Promise<string | null>,
): Promise<string | null> {
  const defaultPath = localStorage.getItem("gamelib-default-download-path") || "";
  const alwaysAsk = localStorage.getItem("gamelib-download-always-ask-path") !== "false";
  if (defaultPath && !alwaysAsk) {
    return defaultPath;
  }
  return selectSavePath();
}

export default function MagnetInputBar() {
  const { addDownload, addDirectDownload, selectSavePath } = useDownloads();
  const { showToast } = useToast();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function startFromUri(rawUri: string) {
    const trimmed = rawUri.trim();
    if (!trimmed) return;
    if (!URI_PATTERN.test(trimmed)) {
      showToast("Must be a magnet: link or http(s):// .torrent URL", "error");
      return;
    }
    setSubmitting(true);
    try {
      const path = await resolveSavePath(selectSavePath);
      if (!path) {
        return;
      }

      const isMagnet = trimmed.startsWith("magnet:");
      const isTorrentFile = trimmed.endsWith(".torrent") || trimmed.includes(".torrent?");
      const isDirect = !isMagnet && !isTorrentFile;

      if (isDirect) {
        let filename = "download.zip";
        try {
          const urlObj = new URL(trimmed);
          const lastSeg = urlObj.pathname.substring(urlObj.pathname.lastIndexOf('/') + 1);
          if (lastSeg && lastSeg.includes('.')) {
            filename = lastSeg;
          }
        } catch {}

        const fullPath = `${path}/${filename}`.replace(/\\/g, "/");
        await addDirectDownload(trimmed, fullPath, null, "Manual Direct Link");
      } else {
        await addDownload(trimmed, path, null, "Direct link");
      }

      showToast("Download added", "success");
      setValue("");
    } catch (err) {
      showToast(`Couldn't add download: ${err}`, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdd() {
    await startFromUri(value);
  }

  // Drag-and-drop: accept plain text (a magnet link dragged from a
  // browser) or a URI list. We only *fill* the input on drop — we
  // don't auto-start, so the user gets a chance to eyeball the URI
  // before committing. If the dropped text is a valid URI we could
  // start it directly, but filling is the safer default.
  function extractUriFromDrop(e: React.DragEvent): string | null {
    const uriList = e.dataTransfer.getData("text/uri-list");
    const plain = e.dataTransfer.getData("text/plain");
    const candidate = (uriList || plain || "").trim();
    if (candidate && URI_PATTERN.test(candidate)) {
      // A uri-list may contain multiple lines; take the first URI-ish one.
      const first = candidate.split(/\r?\n/).find((l) => URI_PATTERN.test(l.trim()));
      return (first ?? candidate).trim();
    }
    return null;
  }

  return (
    <div
      className={`dl-magnet-bar${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!submitting) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (submitting) return;
        const uri = extractUriFromDrop(e);
        if (uri) {
          setValue(uri);
        } else {
          showToast("Dropped item isn't a magnet or .torrent URL", "error");
        }
      }}
    >
      <svg
        className="dl-magnet-bar-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      <input
        className="dl-magnet-bar-input"
        type="text"
        placeholder="Paste or drop a magnet link or .torrent URL…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !submitting) handleAdd();
        }}
        disabled={submitting}
        spellCheck={false}
        autoComplete="off"
        aria-label="Magnet link or torrent URL"
      />
      <Button
        variant="primary"
        onClick={handleAdd}
        disabled={!value.trim() || submitting}
        isLoading={submitting}
        size="sm"
      >
        Add
      </Button>
    </div>
  );
}
