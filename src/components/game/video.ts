/**
 * Video URL helpers for YouTube and Twitch trailers.
 *
 *  Lives in its own file (not the VideosSection component) so the
 *  same logic can be reused by the Store GameDetail page without
 *  re-implementing the embed/parent-parameter dance.
 *
 *  Twitch embeds require a `parent=` query parameter matching the
 *  embedding page's hostname; otherwise the player rejects the
 *  embed (error 1000). We pass the runtime hostname plus the
 *  common Tauri + localhost fallbacks so dev, prod, and Tauri 1.x
 *  builds all work.
 */

export function getVideoEmbedUrl(url: string): string | null {
  if (!url) return null;

  const buildParents = (): string => {
    const hosts = new Set<string>(["localhost", "127.0.0.1", "tauri.localhost"]);
    if (typeof window !== "undefined" && window.location?.hostname) {
      hosts.add(window.location.hostname);
    }
    return Array.from(hosts)
      .map((h) => `parent=${encodeURIComponent(h)}`)
      .join("&");
  };

  // Twitch VOD
  const twitchVod = url.match(/twitch\.tv\/videos\/(\d+)/i);
  if (twitchVod) {
    const t = url.match(/[?&]t=([0-9hms]+)/i);
    const time = t ? `&time=${t[1]}` : "";
    return `https://player.twitch.tv/?video=v${twitchVod[1]}${time}&${buildParents()}&autoplay=false`;
  }
  // Twitch clip
  const twitchClip = url.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/[^/]+\/clip\/)([A-Za-z0-9_-]+)/i);
  if (twitchClip) {
    return `https://clips.twitch.tv/embed?clip=${twitchClip[1]}&${buildParents()}`;
  }
  // Twitch live channel
  const twitchChannel = url.match(/^https?:\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)\/?$/i);
  if (twitchChannel) {
    const ch = twitchChannel[1].toLowerCase();
    const reserved = new Set([
      "videos", "directory", "settings", "subs", "wallet", "drops",
      "prime", "turbo", "login", "signup", "about",
    ]);
    if (!reserved.has(ch)) {
      return `https://player.twitch.tv/?channel=${twitchChannel[1]}&${buildParents()}&autoplay=false`;
    }
  }
  // YouTube
  let id = "";
  if (url.includes("watch?v=")) {
    id = url.split("watch?v=")[1]?.split("&")[0] || "";
  } else if (url.includes("youtu.be/")) {
    id = url.split("youtu.be/")[1]?.split("?")[0] || "";
  } else if (url.includes("youtube.com/embed/")) {
    id = url.split("youtube.com/embed/")[1]?.split("?")[0] || "";
  } else {
    id = url;
  }
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

export function getVideoThumbnail(
  url: string
): { kind: "youtube"; src: string } | { kind: "twitch" } | null {
  if (!url) return null;
  if (/youtube\.com|youtu\.be/i.test(url)) {
    let ytId = "";
    if (url.includes("watch?v=")) ytId = url.split("watch?v=")[1]?.split("&")[0] || "";
    else if (url.includes("youtu.be/")) ytId = url.split("youtu.be/")[1]?.split("?")[0] || "";
    else if (url.includes("youtube.com/embed/")) ytId = url.split("youtube.com/embed/")[1]?.split("?")[0] || "";
    else ytId = url;
    if (ytId) return { kind: "youtube", src: `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` };
  }
  if (/twitch\.tv|clips\.twitch\.tv/i.test(url)) {
    return { kind: "twitch" };
  }
  return null;
}
