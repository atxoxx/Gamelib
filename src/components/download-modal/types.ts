export type DownloadStep =
  | "checking"
  | "results"
  | "starting"
  | "error"
  | "fetching_metadata"
  | "file_selection";

/** How the results list is ordered. */
export type SortKey = "date" | "source" | "relevance";

import type { MatchedDownload } from "../../types/source";

/** A source match plus a stable id (assigned per search) so selection
 *  survives re-sorting of the list. */
export type DisplayMatch = MatchedDownload & { id: string };
