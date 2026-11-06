import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "system" | "light" | "dark";
export type FathersScope = "pre-nicene" | "to-451" | "all";

export interface Settings {
  editions: string[]; // translation columns in the reader
  original: boolean; // show the Hebrew/Greek interlinear column
  theme: Theme;
  fathers: FathersScope;
  fontScale: number;
}

const DEFAULTS: Settings = { editions: ["kjva", "bsb"], original: true, theme: "system", fathers: "pre-nicene", fontScale: 1 };
const KEY = "testimonia.settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* private mode / corrupted value: fall back to defaults */
  }
  return DEFAULTS;
}

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: keep in memory */
      }
      return next;
    });
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
    root.style.setProperty("--font-scale", String(settings.fontScale));
  }, [settings.theme, settings.fontScale]);
  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
