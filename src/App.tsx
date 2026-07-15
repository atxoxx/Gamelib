import { HashRouter, Routes, Route } from "react-router-dom";
import TopNav from "./components/TopNav";
import Sidebar from "./components/Sidebar";
import MainContent from "./components/MainContent";
import BigScreenLayout from "./components/BigScreenLayout";
import LibraryPage from "./pages/LibraryPage";
import GamePage from "./pages/GamePage";
import StorePage from "./pages/StorePage";
import StoreGameDetail from "./pages/StoreGameDetail";
import CommunityPage from "./pages/CommunityPage";
import SettingsPage from "./pages/SettingsPage";
import PluginsPage from "./pages/PluginsPage";
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
import { BigScreenProvider, useBigScreen } from "./context/BigScreenContext";
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
    <div className="app-layout">
      <div className="app-topnav">
        <TopNav />
      </div>
      <div className="app-sidebar">
        <Sidebar />
      </div>
      <div className="app-main">
        <MainContent />
      </div>
    </div>
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
                      <BigScreenProvider>
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
                          <Route path="settings" element={<SettingsPage />} />
                          <Route path="plugins" element={<PluginsPage />} />
                        </Route>
                      </Routes>
                      </BigScreenProvider>
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
