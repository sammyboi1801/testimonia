import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "system" | "light" | "dark";
export type FathersScope = "pre-nicene" | "to-451" | "all";
export type Design = "vellum" | "folio" | "atelier" | "archive";
export type ReadingMode = "parallel" | "interlinear" | "original" | "reading";
export type PanelTab = "text" | "fathers" | "links" | "words";
export type MarkKind = "var" | "fat" | "quo";

export const MODES: { id: ReadingMode; label: string; hint: string }[] = [
  { id: "parallel", label: "Parallel", hint: "Translations side by side" },
  { id: "interlinear", label: "Interlinear", hint: "A translation with the Greek/Hebrew words beneath" },
  { id: "original", label: "Original", hint: "Greek/Hebrew text beside a translation" },
  { id: "reading", label: "Reading", hint: "One text in flowing paragraphs" },
];

export const DESIGNS: { id: Design; label: string; note: string; swatch: [string, string, string]; font: string }[] = [
  { id: "vellum", label: "Vellum", note: "cream · Garamond · sienna", swatch: ["#f7f2ea", "#9a5b2e", "#2b2620"], font: '"EB Garamond", serif' },
  { id: "folio", label: "Folio", note: "book paper · Fraunces · olive", swatch: ["#f2ece2", "#5f6b3a", "#2e2a24"], font: '"Fraunces", serif' },
  { id: "atelier", label: "Atelier", note: "ivory · Crimson · terracotta", swatch: ["#f6f2ec", "#b4532a", "#262421"], font: '"Crimson Pro", serif' },
  { id: "archive", label: "Archive", note: "brown paper · Spectral · green", swatch: ["#ece4d6", "#2f5d50", "#33291f"], font: '"Spectral", serif' },
];

/** Design tokens a user may override (see styles.css). */
export const COLOR_TOKENS = [
  { id: "accent", label: "Accent", hint: "headings, active tabs, red letters" },
  { id: "link", label: "Links", hint: "references and clickable names" },
  { id: "variant", label: "Variants", hint: "words that differ between editions" },
  { id: "numeral", label: "Verse numbers", hint: "" },
  { id: "bg", label: "Page", hint: "background behind the text" },
  { id: "panel", label: "Panels", hint: "top bar and study panel" },
  { id: "ink", label: "Text", hint: "main reading colour" },
  { id: "muted", label: "Quiet text", hint: "labels and notes" },
  { id: "rule", label: "Lines", hint: "borders and dividers" },
  { id: "select", label: "Highlight", hint: "selected verse" },
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number]["id"];
export type ColorOverrides = Partial<Record<ColorToken, string>>;

export const ACCENT_PRESETS = ["#9a5b2e", "#b4532a", "#8c2f2f", "#6b3f6e", "#3d5a80", "#2f5d50", "#5f6b3a", "#a07a2c"];

/** Bundled (offline) faces, plus a few common system fonts for Hebrew. */
export const FONTS = {
  display: [
    { id: "cormorant", label: "Cormorant Garamond", css: '"Cormorant Garamond", Georgia, serif' },
    { id: "fraunces", label: "Fraunces", css: '"Fraunces", Georgia, serif' },
    { id: "crimson", label: "Crimson Pro", css: '"Crimson Pro", Georgia, serif' },
    { id: "spectral", label: "Spectral", css: '"Spectral", Georgia, serif' },
    { id: "felipa", label: "Felipa (calligraphic)", css: '"Felipa", "Cormorant Garamond", serif' },
    { id: "charm", label: "Charm (calligraphic)", css: '"Charm", "Cormorant Garamond", serif' },
  ],
  text: [
    { id: "eb-garamond", label: "EB Garamond", css: '"EB Garamond", Georgia, serif' },
    { id: "cormorant", label: "Cormorant Garamond", css: '"Cormorant Garamond", Georgia, serif' },
    { id: "crimson", label: "Crimson Pro", css: '"Crimson Pro", Georgia, serif' },
    { id: "spectral", label: "Spectral", css: '"Spectral", Georgia, serif' },
    { id: "source-serif", label: "Source Serif", css: '"Source Serif 4", Georgia, serif' },
    { id: "fraunces", label: "Fraunces", css: '"Fraunces", Georgia, serif' },
    { id: "gentium", label: "Gentium Book", css: '"Gentium Book Plus", Georgia, serif' },
  ],
  ui: [
    { id: "instrument", label: "Instrument Sans", css: '"Instrument Sans", system-ui, sans-serif' },
    { id: "work", label: "Work Sans", css: '"Work Sans", system-ui, sans-serif' },
    { id: "plex", label: "IBM Plex Sans", css: '"IBM Plex Sans", system-ui, sans-serif' },
    { id: "karla", label: "Karla", css: '"Karla", system-ui, sans-serif' },
    { id: "system", label: "System font", css: "system-ui, sans-serif" },
  ],
  greek: [
    { id: "gentium", label: "Gentium Book", css: '"Gentium Book Plus", "Gentium Plus", serif' },
    { id: "eb-garamond", label: "EB Garamond", css: '"EB Garamond", serif' },
  ],
  hebrew: [
    { id: "noto", label: "Noto Serif Hebrew", css: '"Noto Serif Hebrew", serif' },
    { id: "sbl", label: "SBL Hebrew (if installed)", css: '"SBL Hebrew", "Noto Serif Hebrew", serif' },
    { id: "ezra", label: "Ezra SIL (if installed)", css: '"Ezra SIL", "Noto Serif Hebrew", serif' },
    { id: "times", label: "Times New Roman", css: '"Times New Roman", "Noto Serif Hebrew", serif' },
  ],
} as const;
export type FontRole = keyof typeof FONTS;
const FONT_VARS: Record<FontRole, string> = { display: "--font-display", text: "--font-text", ui: "--font-ui", greek: "--greek", hebrew: "--hebrew" };

export const MARK_INFO: Record<MarkKind, { label: string; meaning: string; minorLabel: string; symbols: string[]; token: ColorToken }> = {
  var: {
    label: "Editions differ",
    meaning: "the Greek or Hebrew editions read differently here",
    minorLabel: "Also mark spelling and word-order differences (faded)",
    symbols: ["◆", "◇", "●", "‡", "*", "V"],
    token: "variant",
  },
  fat: {
    label: "Quoted by the fathers",
    meaning: "early Christian writers quote this verse",
    minorLabel: "Also mark verses quoted only after AD 325 (faded)",
    symbols: ["✝", "✠", "☩", "+", "●", "F"],
    token: "accent",
  },
  quo: {
    label: "Old ↔ New Testament",
    meaning: "one Testament quotes or alludes to the other here",
    minorLabel: "",
    symbols: ["↺", "⇄", "»", "¶", "●", "Q"],
    token: "link",
  },
};

export interface MarkPref {
  show: boolean;
  minor: boolean; // also show the weaker form, faded
  symbol: string;
  color: string | null; // null = follow the design
}

export interface Settings {
  editions: string[]; // translation columns in the reader
  mode: ReadingMode;
  theme: Theme;
  design: Design;
  fathers: FathersScope;
  fontScale: number;
  colors: { light: ColorOverrides; dark: ColorOverrides };
  fonts: Partial<Record<FontRole, string>>;
  lineSpacing: number | null;
  marks: { size: number } & Record<MarkKind, MarkPref>;
  display: { verseNumbers: boolean; headings: boolean; redLetter: boolean; underline: boolean; glosses: boolean };
  hover: { cards: boolean; delay: number };
  speech: { enabled: boolean; rate: number; grc: string | null; hbo: string | null };
  panel: { tab: PanelTab; glance: boolean };
}

export const DEFAULTS: Settings = {
  editions: ["kjva", "bsb"],
  mode: "parallel",
  theme: "system",
  design: "vellum",
  fathers: "pre-nicene",
  fontScale: 1,
  colors: { light: {}, dark: {} },
  fonts: {},
  lineSpacing: null,
  marks: {
    size: 1.3,
    var: { show: true, minor: true, symbol: "◆", color: null },
    fat: { show: true, minor: true, symbol: "✝", color: null },
    quo: { show: true, minor: false, symbol: "↺", color: null },
  },
  display: { verseNumbers: true, headings: true, redLetter: true, underline: true, glosses: true },
  hover: { cards: true, delay: 260 },
  speech: { enabled: true, rate: 0.8, grc: null, hbo: null },
  panel: { tab: "text", glance: true },
};
const KEY = "testimonia.settings.v1";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** Deep-merge saved values onto the defaults, keeping only keys (and types) the defaults know about. */
function mergeKnown<T>(base: T, saved: unknown): T {
  if (!isObj(base) || !isObj(saved)) return base;
  const out: Obj = { ...base };
  for (const [k, def] of Object.entries(base)) {
    if (!(k in saved)) continue;
    const v = saved[k];
    if (isObj(def) && Object.keys(def).length) out[k] = mergeKnown(def, v);
    else if (isObj(def)) out[k] = isObj(v) ? v : def; // free-form maps (colour/font overrides)
    else if (def === null || v === null || typeof v === typeof def) out[k] = v;
  }
  return out as T;
}

export function normalize(saved: unknown): Settings {
  return mergeKnown(DEFAULTS, saved);
}

function load(): Settings {
  let s = DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) s = normalize(JSON.parse(raw));
  } catch {
    /* private mode / corrupted value: fall back to defaults */
  }
  // ?design=folio&theme=light&mode=interlinear in the URL overrides (handy for previews and sharing a look)
  const q = new URLSearchParams(window.location.search);
  const design = q.get("design");
  const theme = q.get("theme");
  if (design && DESIGNS.some((d) => d.id === design)) s = { ...s, design: design as Design };
  if (theme === "light" || theme === "dark" || theme === "system") s = { ...s, theme };
  const display = q.get("display");
  if (display && FONTS.display.some((f) => f.id === display)) s = { ...s, fonts: { ...s.fonts, display } };
  const mode = q.get("mode");
  if (mode && MODES.some((m) => m.id === mode)) s = { ...s, mode: mode as ReadingMode };
  return s;
}

interface Ctx {
  settings: Settings;
  /** Resolved theme (system preference applied). */
  dark: boolean;
  update: (patch: Partial<Settings>) => void;
  replace: (next: Settings) => void;
}

const SettingsContext = createContext<Ctx | null>(null);

function useSystemDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: keep in memory */
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  const systemDark = useSystemDark();
  const dark = settings.theme === "dark" || (settings.theme === "system" && systemDark);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      save(next);
      return next;
    });
  }, []);
  const replace = useCallback((next: Settings) => {
    save(next);
    setSettings(next);
  }, []);
  useEffect(() => applyToDocument(settings, dark), [settings, dark]);
  const value = useMemo(() => ({ settings, dark, update, replace }), [settings, dark, update, replace]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/** Push settings onto <html>: theme/design attributes, CSS variable overrides and display switches. */
function applyToDocument(s: Settings, dark: boolean) {
  const root = document.documentElement;
  const css = root.style;
  if (s.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", s.theme);
  root.setAttribute("data-design", s.design);
  css.setProperty("--font-scale", String(s.fontScale));

  const colors = dark ? s.colors.dark : s.colors.light;
  for (const t of COLOR_TOKENS) {
    const v = colors[t.id];
    if (v) css.setProperty(`--${t.id}`, v);
    else css.removeProperty(`--${t.id}`);
  }
  // keep the soft accent wash in step with a custom accent
  if (colors.accent) css.setProperty("--accent-soft", `color-mix(in srgb, ${colors.accent} ${dark ? 22 : 14}%, var(--panel))`);
  else css.removeProperty("--accent-soft");

  for (const role of Object.keys(FONT_VARS) as FontRole[]) {
    const font = FONTS[role].find((f) => f.id === s.fonts[role]);
    if (font) css.setProperty(FONT_VARS[role], font.css);
    else css.removeProperty(FONT_VARS[role]);
  }
  if (s.lineSpacing) css.setProperty("--text-leading", String(s.lineSpacing));
  else css.removeProperty("--text-leading");

  css.setProperty("--mk-scale", String(s.marks.size));
  for (const kind of ["var", "fat", "quo"] as MarkKind[]) {
    const c = s.marks[kind].color;
    if (c) css.setProperty(`--mk-${kind}`, c);
    else css.removeProperty(`--mk-${kind}`);
  }
  for (const [k, on] of Object.entries(s.display)) root.setAttribute(`data-${k.toLowerCase()}`, on ? "on" : "off");
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
