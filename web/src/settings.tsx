import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "system" | "light" | "dark";
export type FathersScope = "pre-nicene" | "to-451" | "all";
export type Design = "vellum" | "folio" | "atelier" | "archive";
export type ReadingMode = "parallel" | "interlinear" | "original" | "reading";

export const MODES: { id: ReadingMode; label: string; hint: string }[] = [
  { id: "parallel", label: "Parallel", hint: "Translations side by side" },
  { id: "interlinear", label: "Interlinear", hint: "A translation with the Greek/Hebrew words beneath" },
  { id: "original", label: "Original", hint: "Greek/Hebrew text beside a translation" },
  { id: "reading", label: "Reading", hint: "One text in flowing paragraphs" },
];

export const DESIGNS: { id: Design; label: string; note: string }[] = [
  { id: "vellum", label: "Vellum", note: "cream · Garamond · sienna" },
  { id: "folio", label: "Folio", note: "book paper · Fraunces · olive" },
  { id: "atelier", label: "Atelier", note: "ivory · Crimson · terracotta" },
  { id: "archive", label: "Archive", note: "brown paper · Spectral · green" },
];

export interface Settings {
  editions: string[]; // translation columns in the reader
  mode: ReadingMode;
  theme: Theme;
  design: Design;
  fathers: FathersScope;
  fontScale: number;
}

const DEFAULTS: Settings = {
  editions: ["kjva", "bsb"],
  mode: "parallel",
  theme: "system",
  design: "vellum",
  fathers: "pre-nicene",
  fontScale: 1,
};
const KEY = "testimonia.settings.v1";

function load(): Settings {
  let s = DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* private mode / corrupted value: fall back to defaults */
  }
  // ?design=folio&theme=light&mode=interlinear in the URL overrides (handy for previews and sharing a look)
  const q = new URLSearchParams(window.location.search);
  const design = q.get("design");
  const theme = q.get("theme");
  if (design && DESIGNS.some((d) => d.id === design)) s = { ...s, design: design as Design };
  if (theme === "light" || theme === "dark" || theme === "system") s = { ...s, theme };
  const mode = q.get("mode");
  if (mode && MODES.some((m) => m.id === mode)) s = { ...s, mode: mode as ReadingMode };
  return s;
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
    root.setAttribute("data-design", settings.design);
    root.style.setProperty("--font-scale", String(settings.fontScale));
  }, [settings.theme, settings.design, settings.fontScale]);
  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
