import { Outlet, useLocation } from "react-router-dom";
import BigScreenHeader from "./BigScreenHeader";
import FocusRing from "./ui/FocusRing";
import VirtualCursor from "./ui/VirtualCursor";
import GamepadHint from "./ui/GamepadHint";
import { useGamepad } from "../hooks/GamepadProvider";

export default function BigScreenLayout() {
  const gamepad = useGamepad();
  const location = useLocation();

  const dashboardPaths = [
    "/store",
    "/library",
    "/wishlist",
    "/deals",
    "/activity",
    "/news",
    "/community",
    "/achievements",
    "/downloads",
    "/storage",
    "/plugins",
    "/settings"
  ];
  const isDashboardRoute = dashboardPaths.some((path) => location.pathname === path);

  return (
    <div className="bigscreen-layout" data-bigscreen="true">
      {/* PS5-inspired Top Navigation Header */}
      <BigScreenHeader />

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
    </div>
  );
}