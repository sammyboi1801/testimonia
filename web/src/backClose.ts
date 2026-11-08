import { useEffect, useRef } from "react";

/** Phone "Back" (Android gesture, browser button) closes an open sheet or drawer first, as in a native app,
 *  instead of leaving the page. While `open`, one history entry stands for the sheet; Back pops it and closes;
 *  closing by ✕ or a tap removes that entry so history stays as it was. */
export function useBackClose(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const marker = { sheet: Math.random().toString(36).slice(2) };
    window.history.pushState({ ...(window.history.state ?? {}), ...marker }, "");
    let popped = false;
    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // closed some other way: drop the entry this sheet added (only if it is still the current one)
      if (!popped && (window.history.state as { sheet?: string } | null)?.sheet === marker.sheet) window.history.back();
    };
  }, [open]);
}
