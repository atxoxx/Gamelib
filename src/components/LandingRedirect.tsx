// LandingRedirect — resolves the user's configured default landing
// page (L6) and replaces the current URL with the matching route.
//
// Used as the `<Route index element={...}>` for the hash router's
// root path. The redirect is only meaningful on cold start (when the
// hash is the bare `#/` or empty); for any future nav to a non-root
// route, the router's normal resolution takes over.
//
// Why a tiny component instead of inlining the navigate in App.tsx:
// the resolver has to look up the settings state, and inlining
// inside the route element means the SettingsContext value (which
// lives in scope of the router tree) is the same one the rest of
// the app sees — any change the user makes in Settings takes effect
// on the next sign-in / hard reload, exactly the UX the user asked
// for in the spec ("which tab to open on launch").
//
// We choose <Navigate replace> so the user doesn't end up with the
// landing redirect in their browser history (which would re-fire
// after every Back button press, trapping them at the landing page).
// `replace` overwrites the current history entry instead of pushing.

import { Navigate } from "react-router-dom";
import { useSettings, type LandingPage } from "../context/SettingsContext";

const LANDING_TO_PATH: Record<LandingPage, string> = {
  home: "/home",
  library: "/library",
  store: "/store",
  wishlist: "/wishlist",
  deals: "/deals",
  activity: "/activity",
  achievements: "/achievements",
  downloads: "/downloads",
  storage: "/storage",
  news: "/news",
  community: "/community",
};

export function LandingRedirect() {
  const { landingPage } = useSettings();
  const target = LANDING_TO_PATH[landingPage] ?? "/library";
  return <Navigate to={target} replace />;
}
