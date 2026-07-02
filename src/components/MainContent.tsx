import { Outlet } from "react-router-dom";

export default function MainContent() {
  return (
    <main className="main-content">
      <Outlet />
    </main>
  );
}
