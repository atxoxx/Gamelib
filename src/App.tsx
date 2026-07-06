import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import TopNav from "./components/TopNav";
import Sidebar from "./components/Sidebar";
import MainContent from "./components/MainContent";
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
import DealsPage from "./pages/deals/DealsPage";
import { GameProvider } from "./context/GameContext";
import { ToastProvider } from "./context/ToastContext";
import { ActivityProvider } from "./context/ActivityContext";
import { WishlistProvider } from "./context/WishlistContext";
import { DensityProvider } from "./context/DensityContext";
import { SplashProvider } from "./context/SplashContext";
import { DownloadProvider } from "./context/DownloadContext";
import { SourceProvider } from "./context/SourceContext";
import Splashscreen from "./components/Splashscreen";
import DownloadProgress from "./components/DownloadProgress";
import "./App.css";
import "./store.css";

function AppLayout() {
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

function ThemeBootstrap() {
  useEffect(() => {
    const savedTheme = localStorage.getItem("gamelib-theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
  }, []);
  return null;
}

function App() {
  return (
    <HashRouter>
      <ThemeBootstrap />
      <ToastProvider>
        <SplashProvider>
          <GameProvider>
            <ActivityProvider>
              <DensityProvider>
                <WishlistProvider>
                  <SourceProvider>
                    <DownloadProvider>
                      <Routes>
                        <Route element={<AppLayout />}>
                          <Route index element={<Navigate to="/library" replace />} />
                          <Route path="library" element={<LibraryPage />} />
                          <Route path="library/:gameId" element={<GamePage />} />
                          <Route path="wishlist" element={<WishlistPage />} />
                          <Route path="deals" element={<DealsPage />} />
                          <Route path="activity" element={<ActivityPage />} />
                          <Route path="storage" element={<StoragePage />} />
                          <Route path="store" element={<StorePage />} />
                          <Route path="store/:gameSlug" element={<StoreGameDetail />} />
                          <Route path="community" element={<CommunityPage />} />
                          <Route path="settings" element={<SettingsPage />} />
                          <Route path="plugins" element={<PluginsPage />} />
                        </Route>
                      </Routes>
                      {/* Floating download-progress overlay. Mounted
                       *  INSIDE DownloadProvider so useDownloads() works,
                       *  OUTSIDE Routes so it floats above every page. */}
                      <DownloadProgress />
                    </DownloadProvider>
                  </SourceProvider>
                </WishlistProvider>
              </DensityProvider>
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
    </HashRouter>
  );
}

export default App;
