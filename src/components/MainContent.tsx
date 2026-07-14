import { Outlet, useLocation } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";

/**
 * MainContent — the routed page outlet for the AppLayout shell.
 *
 * Wraps `<Outlet />` in an `<ErrorBoundary>` so a render-time crash
 * inside any page (Store, Library, Settings, etc.) preserves the
 * topnav + sidebar and surfaces a friendly error UI in the page area
 * instead of unmounting the entire React tree. Without this boundary
 * any uncaught render exception blanks the whole window — a
 * deceptively bad failure mode that has caused the "Store page goes
 * blank" symptom more than once.
 *
 * Keying `<Outlet />` on `location.pathname` is what keeps the
 * boundary useful across navigation. Without a key the `<Outlet />`
 * element identity stays the same on every route change so React
 * keeps the boundary instance alive — and its `state.error` — even
 * when the user navigates away from the crashed page. The key
 * forces a fresh `<Outlet />` (and boundary) on each pathname so
 * state always starts at `error: null`.
 *
 * See `./ErrorBoundary.tsx` for the comprehensive rationale.
 */
export default function MainContent() {
  const location = useLocation();
  return (
    <main className="main-content">
      <ErrorBoundary key={location.pathname}>
        <Outlet />
      </ErrorBoundary>
    </main>
  );
}
