import { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import BigScreenHeader from "./BigScreenHeader";
import FocusRing from "./ui/FocusRing";
import VirtualCursor from "./ui/VirtualCursor";
import GamepadHint from "./ui/GamepadHint";
import BigScreenSearchOverlay from "./bigscreen/BigScreenSearchOverlay";
import { useGamepad } from "../hooks/GamepadProvider";

export default function BigScreenLayout() {
  const gamepad = useGamepad();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);

  // Open the global search overlay with the `/` key (desktop keyboard on
  // the TV box) or a dedicated gamepad-binding press handled in the header.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !searchOpen) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const dashboardPaths = [
    "/store",
    "/library",
    "/wishlist",
    "/deals",
    "/activity",
    "/news",
    "/community",
    "/friends",
    "/achievements",
    "/downloads",
    "/storage",
    "/settings"
  ];
  const isDashboardRoute = dashboardPaths.some((path) => location.pathname === path);

  return (
    <div className="bigscreen-layout" data-bigscreen="true">
      {/* PS5-inspired Top Navigation Header */}
      <BigScreenHeader onOpenSearch={() => setSearchOpen(true)} />

      {/* Main content area */}
      <main className={`bigscreen-main${isDashboardRoute ? " bigscreen-main--with-header" : ""}`}>
        <Outlet />
      </main>

      {/* Controller focus ring overlay */}
      <FocusRing gamepad={gamepad} />

      {/* Virtual mouse pointer (right stick) */}
      <VirtualCursor gamepad={gamepad} />

      {/* Live button-mapping legend (low-opacity reference card) */}
      <GamepadHint gamepad={gamepad} />

      {/* Global quick-search overlay (opened from header search button
          or the `/` keyboard shortcut). */}
      <BigScreenSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}