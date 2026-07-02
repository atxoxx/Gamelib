import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import TopNav from "./components/TopNav";
import Sidebar from "./components/Sidebar";
import MainContent from "./components/MainContent";
import LibraryPage from "./pages/LibraryPage";
import StorePage from "./pages/StorePage";
import CommunityPage from "./pages/CommunityPage";
import SettingsPage from "./pages/SettingsPage";
import PluginsPage from "./pages/PluginsPage";
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
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/library" replace />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="store" element={<StorePage />} />
          <Route path="community" element={<CommunityPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="plugins" element={<PluginsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
