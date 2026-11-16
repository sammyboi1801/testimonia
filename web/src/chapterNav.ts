/** Which way the reader is moving between chapters, so the next one slides in from the right side. Set just before
 *  navigating (an arrow, a swipe), read once by the reader when the new chapter arrives. */
export type NavDir = "next" | "prev";

let pending: NavDir | null = null;

export const markNav = (dir: NavDir) => {
  pending = dir;
};

export const takeNav = (): NavDir | null => {
  const d = pending;
  pending = null;
  return d;
};

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
