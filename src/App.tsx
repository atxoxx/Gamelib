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
import WishlistPage from "./pages/WishlistPage";
import { GameProvider } from "./context/GameContext";
import { ToastProvider } from "./context/ToastContext";
import { ActivityProvider } from "./context/ActivityContext";
import { WishlistProvider } from "./context/WishlistContext";
import { DensityProvider } from "./context/DensityContext";
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

function App() {
  useEffect(() => {
    const savedTheme = localStorage.getItem("gamelib-theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
  }, []);

  return (
    <HashRouter>
      <ToastProvider>
        <GameProvider>
        <ActivityProvider>
        <DensityProvider>
        <WishlistProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/library" replace />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="library/:gameId" element={<GamePage />} />
            <Route path="wishlist" element={<WishlistPage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="store" element={<StorePage />} />
            <Route path="store/:gameSlug" element={<StoreGameDetail />} />
            <Route path="community" element={<CommunityPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="plugins" element={<PluginsPage />} />
          </Route>
        </Routes>
        </WishlistProvider>
        </DensityProvider>
        </ActivityProvider>
        </GameProvider>
      </ToastProvider>
    </HashRouter>
  );
}

export default App;
