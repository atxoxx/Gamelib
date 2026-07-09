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

import { useState } from "react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";

const URI_PATTERN = /^(magnet:|https?:\/\/)/i;

export default function MagnetInputBar() {
  const { addDownload, selectSavePath } = useDownloads();
  const { showToast } = useToast();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!URI_PATTERN.test(trimmed)) {
      showToast("Must be a magnet: link or http(s):// .torrent URL", "error");
      return;
    }
    setSubmitting(true);
    try {
      const path = await selectSavePath();
      if (!path) {
        // User cancelled the folder picker — treat as a soft cancel,
        // don't toast (the picker already shows itself).
        return;
      }
      await addDownload(trimmed, path, null, "Direct link");
      showToast("Download added", "success");
      setValue("");
    } catch (err) {
      showToast(`Couldn't add download: ${err}`, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dl-magnet-bar">
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
        placeholder="Paste a magnet link or .torrent URL…"
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
