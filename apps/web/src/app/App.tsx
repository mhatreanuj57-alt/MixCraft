import { useEffect, useState } from "react";
import ConnectionsPage from "../pages/ConnectionsPage";
import OverviewPage from "../pages/OverviewPage";

export default function App() {
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (pathname === "/connections") {
    return <ConnectionsPage />;
  }

  return <OverviewPage />;
}
