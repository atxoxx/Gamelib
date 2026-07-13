/**
 * Barrel for the Game page card components.
 *
 *  Importing cards from a single path keeps the parent page
 *  clean (`import { InfoKpiCard, RatingsKpiCard, ... } from
 *  '../components/game'`) and lets the cards be reused by the
 *  Store GameDetail page without duplicating the directory
 *  layout in the import paths.
 */

export { default as GameHero } from "./GameHero";
export { default as GameStatusDropdown } from "./GameStatusDropdown";
export { default as GameLaunchActions } from "./GameLaunchActions";

export { default as InfoKpiCard } from "./InfoKpiCard";
export { default as RatingsKpiCard } from "./RatingsKpiCard";
export { default as TimeToBeatCard } from "./TimeToBeatCard";
export { default as SpecsCard } from "./SpecsCard";
export { default as ReleasesCard } from "./ReleasesCard";
export { default as LanguagesSection } from "./LanguagesSection";

export { default as AboutSection } from "./AboutSection";
export { default as StorylineSection } from "./StorylineSection";
export { default as ScreenshotsSection } from "./ScreenshotsSection";
export { default as VideosSection } from "./VideosSection";

/*
 * `GameDetailsCard` and `RelatedContentCard` were removed in favor of an
 * inline executable-path row inside `InfoKpiCard` (E3-UI consolidation).
 * The path click handler opens the containing folder via the OS file
 * manager, so the standalone "Details" / "Related Content" cards are no
 * longer needed.
 */

export { SectionTitle, TimeToBeatRow, StatusDot, formatPlayTimeCompact } from "./shared";
export { getVideoEmbedUrl, getVideoThumbnail } from "./video";
