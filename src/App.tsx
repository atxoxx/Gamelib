import { HashRouter, Routes, Route } from "react-router-dom";
import TopNav from "./components/TopNav";
import Sidebar from "./components/Sidebar";
import MainContent from "./components/MainContent";
import BigScreenLayout from "./components/BigScreenLayout";
import LibraryPage from "./pages/LibraryPage";
import HomePage from "./pages/HomePage";
import GamePage from "./pages/GamePage";
import StorePage from "./pages/StorePage";
import StoreGameDetail from "./pages/StoreGameDetail";
import CommunityPage from "./pages/CommunityPage";
import SettingsPage from "./pages/SettingsPage";
import FriendsPage from "./pages/FriendsPage";
import ActivityPage from "./pages/ActivityPage";
import StoragePage from "./pages/StoragePage";
import WishlistPage from "./pages/WishlistPage";
import NewsPage from "./pages/NewsPage";
import DealsPage from "./pages/deals/DealsPage";
import DownloadsPage from "./pages/DownloadsPage";
import AchievementsPage from "./pages/AchievementsPage";
import { GameProvider } from "./context/GameContext";
import { ToastProvider } from "./context/ToastContext";
import { ActivityProvider } from "./context/ActivityContext";
import { WishlistProvider } from "./context/WishlistContext";
import { DensityProvider } from "./context/DensityContext";
import { SplashProvider } from "./context/SplashContext";
import { DownloadProvider } from "./context/DownloadContext";
import { SourceProvider } from "./context/SourceContext";
import { ThemeProvider } from "./context/ThemeContext";
import { AchievementProvider } from "./context/AchievementContext";
import { SettingsProvider } from "./context/SettingsContext";
import { SessionNotesProvider } from "./context/SessionNotesContext";
import { BigScreenProvider, useBigScreen } from "./context/BigScreenContext";
import {
  SidebarCollapseProvider,
  useSidebarCollapse,
} from "./context/SidebarCollapseContext";
import { GamepadProvider } from "./hooks/GamepadProvider";
import { LandingRedirect } from "./components/LandingRedirect";
import Splashscreen from "./components/Splashscreen";
import "./App.css";
import "./store.css";

function AppLayout() {
  const { isBigScreen } = useBigScreen();

  // When Big Screen Mode is active, render the PS5-inspired layout
  // instead of the standard desktop grid. The BigScreenLayout handles
  // its own <Outlet /> so routes work identically in both layouts.
  if (isBigScreen) {
    return <BigScreenLayout />;
  }

  return (
    <SidebarCollapseProvider>
      <AppShellLayout />
    </SidebarCollapseProvider>
  );
}

/**
 * Inner shell mounted inside <SidebarCollapseProvider> so it can
 * read the icon-rail collapse state via `useSidebarCollapse()`
 * and apply it to the layout grid. Kept separate from `AppLayout`
 * so the Big-Screen branch doesn't pay for the provider mount.
 *
 * The grid collapse is a CSS class swap (no state in this
 * component) so we just read once and pass it down — there is no
 * reason to useEffect and re-toggle: the IconRail toggle inside
 * the sidebar mutates the same context value, and React re-renders
 * this component on the next render of the provider value.
 */
function AppShellLayout() {
  const { isIconRail } = useSidebarCollapse();

  return (
    <div className={`app-layout${isIconRail ? " sidebar-icon-rail" : ""}`}>
      <div className="app-topnav">
        <TopNav />
      </div>
      <div className={`app-sidebar${isIconRail ? " sidebar-icon-rail" : ""}`}>
        <Sidebar />
      </div>
      <div className="app-main">
        <MainContent />
      </div>
    </div>
  );
}

/**
 * Inner shell mounted inside <BigScreenProvider> so it can read
 * `isBigScreen` via `useBigScreen()`. The <GamepadProvider> lives
 * here (not inside <BigScreenLayout>) so that `useGamepad()` is
 * safe to call from any page in the app — desktop pages, the
 * TopNav, the Sidebar — without a try/catch fallback. The
 * `enabled` flag keeps the rAF loop asleep on desktop and wakes
 * it on the next animation frame when Big Screen flips on.
 */
function AppShell() {
  const { isBigScreen } = useBigScreen();
  return (
    <GamepadProvider enabled={isBigScreen}>
      <Routes>
        <Route element={<AppLayout />}>
          {/* L6: default landing page — read from
              SettingsContext so changes the user makes
              in Settings apply on the *next* mount
              (without a full reload). See
              ./components/LandingRedirect.tsx for the
              resolved-target computation; <Navigate>
              itself only sees the resolved path. */}
          <Route index element={<LandingRedirect />} />
          <Route path="home" element={<HomePage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="library/:gameId" element={<GamePage />} />
          <Route path="wishlist" element={<WishlistPage />} />
          <Route path="news" element={<NewsPage />} />
          <Route path="deals" element={<DealsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="achievements" element={<AchievementsPage />} />
          <Route path="downloads" element={<DownloadsPage />} />
          <Route path="storage" element={<StoragePage />} />
          <Route path="store" element={<StorePage />} />
          <Route path="store/:gameSlug" element={<StoreGameDetail />} />
          <Route path="community" element={<CommunityPage />} />
          <Route path="friends" element={<FriendsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </GamepadProvider>
  );
}

function App() {
  return (
    <HashRouter>
      <ThemeProvider>
      <ToastProvider>
        <SplashProvider>
          <GameProvider>
            <ActivityProvider>
              <AchievementProvider>
              <DensityProvider>
                <WishlistProvider>
                  <SourceProvider>
                    <DownloadProvider>
                      <SettingsProvider>
                        <SessionNotesProvider>
                        <BigScreenProvider>
                        <AppShell />
                        </BigScreenProvider>
                        </SessionNotesProvider>
                      </SettingsProvider>
                    </DownloadProvider>
                  </SourceProvider>
                </WishlistProvider>
              </DensityProvider>
              </AchievementProvider>
            </ActivityProvider>
          </GameProvider>
          {/* Splash overlay mounted INSIDE the SplashProvider subtree so
           *  useSplash() resolves correctly. Position is fixed with
           *  z-index 9500 so it floats above all routes regardless of
           *  its DOM nesting depth. Renders nothing when no launch is
           *  in flight. */}
          <Splashscreen />
        </SplashProvider>
      </ToastProvider>
      </ThemeProvider>
    </HashRouter>
  );
}

export default App;