import { useCallback, useEffect, useState } from "react";

export type HashView = "home" | "review" | "search" | "notebook" | "settings" | "stats";

const VALID_VIEWS: readonly HashView[] = [
  "home",
  "review",
  "search",
  "notebook",
  "settings",
  "stats",
];

function parseHash(): HashView {
  const raw = window.location.hash.replace(/^#\/?/, "").split(/[?/]/)[0];
  return VALID_VIEWS.includes(raw as HashView) ? (raw as HashView) : "home";
}

/**
 * Hash-based routing for GitHub Pages compatibility (RAY-315).
 *
 * Maps URL hash fragments to app views:
 * - `#/review`, `#/settings`, etc. for specific views
 * - No hash or unknown hash → home
 *
 * On refresh the browser preserves the hash, so the current view is restored
 * without server-side routing configuration.
 */
export function useHashRoute(): [HashView, (view: HashView) => void] {
  const [view, setView] = useState<HashView>(parseHash);

  useEffect(() => {
    const onPopState = () => setView(parseHash());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: HashView) => {
    setView(next);
    const url = next === "home" ? window.location.pathname + window.location.search : `#/${next}`;
    history.pushState(null, "", url);
  }, []);

  return [view, navigate];
}
