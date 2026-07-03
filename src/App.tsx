import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import TopNav from "./components/TopNav";
import Sidebar from "./components/Sidebar";
import MainContent from "./components/MainContent";
import LibraryPage from "./pages/LibraryPage";
import GamePage from "./pages/GamePage";
import StorePage from "./pages/StorePage";
import CommunityPage from "./pages/CommunityPage";
import SettingsPage from "./pages/SettingsPage";
import PluginsPage from "./pages/PluginsPage";
import ActivityPage from "./pages/ActivityPage";
import { GameProvider } from "./context/GameContext";
import { ToastProvider } from "./context/ToastContext";
import { ActivityProvider } from "./context/ActivityContext";
import "./App.css";

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
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/library" replace />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="library/:gameId" element={<GamePage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="store" element={<StorePage />} />
            <Route path="community" element={<CommunityPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="plugins" element={<PluginsPage />} />
          </Route>
        </Routes>
        </ActivityProvider>
        </GameProvider>
      </ToastProvider>
    </HashRouter>
  );
}

export default App;
