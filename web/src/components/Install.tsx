import { useEffect, useState, useSyncExternalStore } from "react";

/** Installing as an app — always optional: everything works the same in the browser.
 *  Android/desktop Chrome and Edge hand us an install prompt; iPhone has none, so we show how to add it from Share. */

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: PromptEvent | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // keep the browser's own banner back; we offer it quietly instead
  deferred = e as PromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  notify();
});

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** "prompt" (one tap installs), "ios" (show the steps), or null (installed already, or the browser can't). */
export function useInstall(): "prompt" | "ios" | null {
  const has = useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => !!deferred,
  );
  if (isStandalone()) return null;
  if (has) return "prompt";
  return isIos() ? "ios" : null;
}

async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  notify();
}

function IosSteps({ onClose }: { onClose: () => void }) {
  return (
    <div className="install-sheet" role="dialog" aria-label="Add to Home Screen" onClick={onClose}>
      <div className="install-box" onClick={(e) => e.stopPropagation()}>
        <strong>Add Testimonia to your Home Screen</strong>
        <ol>
          <li>
            Tap <b>Share</b>{" "}
            <svg width="16" height="18" viewBox="0 0 16 20" aria-label="the Share icon" style={{ verticalAlign: "-3px" }}>
              <path d="M8 1v12M4 5l4-4 4 4M2 9v9h12V9" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>{" "}
            in the browser bar
          </li>
          <li>
            Choose <b>Add to Home Screen</b>
          </li>
        </ol>
        <p className="muted small">Or keep using it here in the browser. Nothing changes either way.</p>
        <button className="btn" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}

/** A button that installs (or shows the iPhone steps); renders nothing where installing doesn't apply. */
export function InstallButton({ className = "btn", label = "Install app" }: { className?: string; label?: string }) {
  const mode = useInstall();
  const [steps, setSteps] = useState(false);
  if (!mode) return null;
  return (
    <>
      <button className={className} onClick={() => (mode === "prompt" ? void promptInstall() : setSteps(true))}>
        {label}
      </button>
      {steps && <IosSteps onClose={() => setSteps(false)} />}
    </>
  );
}

const DISMISSED = "testimonia.install.dismissed";
const VISITS = "testimonia.install.visits";

/** A small card on the home page from the third visit on, until it's dismissed. */
export function InstallCard() {
  const mode = useInstall();
  const [visits] = useState(() => {
    try {
      return Number(localStorage.getItem(VISITS) ?? 0);
    } catch {
      return 0;
    }
  });
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      const today = new Date().toDateString();
      if (localStorage.getItem(VISITS + ".day") !== today) {
        localStorage.setItem(VISITS + ".day", today);
        localStorage.setItem(VISITS, String(visits + 1));
      }
    } catch {
      /* private mode */
    }
  }, [visits]);
  if (!mode || hidden || visits < 2) return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* ignore */
    }
  };
  return (
    <section className="install-card">
      <div>
        <strong>Add Testimonia to your home screen</strong>
        <p className="muted small">Opens full screen like an app. The browser works just as well.</p>
      </div>
      <div className="install-card-actions">
        <InstallButton className="btn primary" label={mode === "ios" ? "Show me how" : "Install"} />
        <button className="btn ghost" onClick={close} aria-label="Not now">
          Not now
        </button>
      </div>
    </section>
  );
}
