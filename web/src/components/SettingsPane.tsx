import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  ACCENT_PRESETS,
  COLOR_TOKENS,
  DEFAULTS,
  DESIGNS,
  FONTS,
  MARK_INFO,
  MODES,
  normalize,
  useSettings,
  type ColorToken,
  type FathersScope,
  type FontRole,
  type MarkKind,
  type MarkPref,
  type PanelTab,
  type Settings,
  type Theme,
} from "../settings";
import { listVoices, speak, speechSupported, voicesReady, type SpeechLang } from "../speech";
import { Mark } from "./Marks";

const SECTIONS = [
  { id: "look", label: "Look" },
  { id: "colours", label: "Colours" },
  { id: "type", label: "Type" },
  { id: "marks", label: "Marks" },
  { id: "reading", label: "Reading" },
  { id: "words", label: "Words" },
  { id: "speech", label: "Pronunciation" },
  { id: "panel", label: "Study panel" },
  { id: "backup", label: "Backup" },
] as const;

const MARK_KINDS: MarkKind[] = ["var", "fat", "quo"];

/** Read the live value of a design token (after the design, theme and overrides are applied). */
function readToken(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v) ? `#${[...v.slice(1)].map((c) => c + c).join("")}` : "#888888";
}

export function SettingsPane({ onClose }: { onClose: () => void }) {
  const { settings, dark, update, replace } = useSettings();
  const body = useRef<HTMLDivElement>(null);
  const [tokens, setTokens] = useState<Record<string, string>>({});

  // token values change with design/theme; read them after the provider has applied the new settings
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setTokens(Object.fromEntries(COLOR_TOKENS.map((t) => [t.id, readToken(t.id)]))),
    );
    return () => cancelAnimationFrame(id);
  }, [settings, dark]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    body.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const themeKey = dark ? "dark" : "light";
  const colors = settings.colors[themeKey];
  const setColor = (t: ColorToken, v: string | null) => {
    const next = { ...colors };
    if (v) next[t] = v;
    else delete next[t];
    update({ colors: { ...settings.colors, [themeKey]: next } });
  };
  const setMark = (k: MarkKind, patch: Partial<MarkPref>) => update({ marks: { ...settings.marks, [k]: { ...settings.marks[k], ...patch } } });
  const sub = <K extends "display" | "hover" | "speech" | "panel">(key: K, patch: Partial<Settings[K]>) =>
    update({ [key]: { ...settings[key], ...patch } } as Partial<Settings>);
  const jump = (id: string) => body.current?.querySelector(`#set-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="settings-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="settings" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="settings-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
            ✕
          </button>
        </header>
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => jump(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="settings-body" ref={body} tabIndex={-1}>
          <Section id="look" title="Look">
            <div className="design-cards">
              {DESIGNS.map((d) => (
                <button key={d.id} className={`design-card${settings.design === d.id ? " on" : ""}`} onClick={() => update({ design: d.id })}>
                  <span className="dc-sample" style={{ background: d.swatch[0], color: d.swatch[2], fontFamily: d.font }}>
                    <span style={{ color: d.swatch[1] }}>In the beginning</span> was the Word
                  </span>
                  <span className="dc-name">{d.label}</span>
                  <span className="dc-note">{d.note}</span>
                </button>
              ))}
            </div>
            <Row label="Theme">
              <Segmented<Theme>
                value={settings.theme}
                options={[
                  ["system", "Match system"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ]}
                onChange={(theme) => update({ theme })}
              />
            </Row>
          </Section>

          <Section
            id="colours"
            title="Colours"
            note={`Changes apply to the ${themeKey} theme of ${DESIGNS.find((d) => d.id === settings.design)?.label}; the ${dark ? "light" : "dark"} theme keeps its own.`}
          >
            <Row label="Accent presets">
              <div className="swatches">
                {ACCENT_PRESETS.map((c) => (
                  <button key={c} className="swatch" style={{ background: c }} title={c} onClick={() => setColor("accent", c)} />
                ))}
              </div>
            </Row>
            {COLOR_TOKENS.map((t) => (
              <Row key={t.id} label={t.label} hint={t.hint}>
                <ColorField value={colors[t.id] ?? tokens[t.id] ?? "#888888"} custom={!!colors[t.id]} onChange={(v) => setColor(t.id, v)} />
              </Row>
            ))}
            <button className="link-btn" onClick={() => update({ colors: { ...settings.colors, [themeKey]: {} } })}>
              Reset colours to the design
            </button>
          </Section>

          <Section id="type" title="Type">
            <Row label="Text size" hint={`${Math.round(settings.fontScale * 100)}%`}>
              <Range min={0.8} max={1.6} step={0.05} value={settings.fontScale} onChange={(fontScale) => update({ fontScale })} />
            </Row>
            <Row label="Line spacing" hint={settings.lineSpacing ? settings.lineSpacing.toFixed(2) : "design default"}>
              <Range min={1.3} max={2.3} step={0.05} value={settings.lineSpacing ?? 1.65} onChange={(lineSpacing) => update({ lineSpacing })} />
            </Row>
            {(
              [
                ["display", "Titles & logo"],
                ["text", "Reading text"],
                ["ui", "Labels & menus"],
                ["greek", "Greek"],
                ["hebrew", "Hebrew"],
              ] as [FontRole, string][]
            ).map(([role, label]) => (
              <Row key={role} label={label}>
                <select
                  value={settings.fonts[role] ?? ""}
                  onChange={(e) => update({ fonts: { ...settings.fonts, [role]: e.target.value || undefined } })}
                >
                  <option value="">Design default</option>
                  {FONTS[role].map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Row>
            ))}
            <div className="type-sample">
              <p className="ts-display">Testimonia · The Word Became Flesh</p>
              <p className="ts-text">In the beginning was the Word, and the Word was with God.</p>
              <p className="greek">Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν</p>
              <p className="hebrew" dir="rtl">
                בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ
              </p>
            </div>
            <button className="link-btn" onClick={() => update({ fonts: {}, lineSpacing: null, fontScale: 1 })}>
              Reset type
            </button>
          </Section>

          <Section id="marks" title="Margin marks" note="The small signs beside each verse number.">
            <div className="mark-preview" aria-hidden>
              <span className="gutter">
                <span className="vnum">18</span>
                <span className="marks">
                  {MARK_KINDS.filter((k) => settings.marks[k].show).map((k) => (
                    <Mark key={k} kind={k} />
                  ))}
                </span>
              </span>
              <span className="vtext">No man hath seen God at any time; the only begotten Son…</span>
            </div>
            <Row label="Size" hint={`${Math.round(settings.marks.size * 100)}%`}>
              <Range min={0.8} max={2} step={0.1} value={settings.marks.size} onChange={(size) => update({ marks: { ...settings.marks, size } })} />
            </Row>
            {MARK_KINDS.map((k) => {
              const p = settings.marks[k];
              const info = MARK_INFO[k];
              return (
                <div key={k} className={`mark-card${p.show ? "" : " off"}`}>
                  <div className="mark-card-head">
                    <Toggle checked={p.show} onChange={(show) => setMark(k, { show })} />
                    <Mark kind={k} />
                    <span>
                      <strong>{info.label}</strong>
                      <span className="muted"> — {info.meaning}</span>
                    </span>
                  </div>
                  {p.show && (
                    <>
                      <Row label="Symbol">
                        <div className="symbols">
                          {info.symbols.map((s) => (
                            <button key={s} className={p.symbol === s ? "on" : ""} onClick={() => setMark(k, { symbol: s })}>
                              {s}
                            </button>
                          ))}
                          <input
                            className="symbol-input"
                            value={info.symbols.includes(p.symbol) ? "" : p.symbol}
                            placeholder="own"
                            maxLength={2}
                            aria-label="Custom symbol"
                            onChange={(e) => e.target.value.trim() && setMark(k, { symbol: e.target.value.trim() })}
                          />
                        </div>
                      </Row>
                      <Row label="Colour">
                        <ColorField value={p.color ?? tokens[info.token] ?? "#888888"} custom={!!p.color} onChange={(color) => setMark(k, { color })} />
                      </Row>
                      {info.minorLabel && (
                        <Row label={info.minorLabel}>
                          <Toggle checked={p.minor} onChange={(minor) => setMark(k, { minor })} />
                        </Row>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            <button className="link-btn" onClick={() => update({ marks: DEFAULTS.marks })}>
              Reset marks
            </button>
          </Section>

          <Section id="reading" title="Reading">
            <Row label="Open chapters in">
              <select value={settings.mode} onChange={(e) => update({ mode: e.target.value as Settings["mode"] })}>
                {MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Verse numbers">
              <Toggle checked={settings.display.verseNumbers} onChange={(verseNumbers) => sub("display", { verseNumbers })} />
            </Row>
            <Row label="Section headings" hint="“The Word Became Flesh”…">
              <Toggle checked={settings.display.headings} onChange={(headings) => sub("display", { headings })} />
            </Row>
            <Row label="Translators' footnotes" hint="small letters in the text; rest on one to read it">
              <Toggle checked={settings.display.footnotes} onChange={(footnotes) => sub("display", { footnotes })} />
            </Row>
            <Row label="Words of Christ in colour">
              <Toggle checked={settings.display.redLetter} onChange={(redLetter) => sub("display", { redLetter })} />
            </Row>
            <Row label="Underline on hover" hint="verses and links">
              <Toggle checked={settings.display.underline} onChange={(underline) => sub("display", { underline })} />
            </Row>
          </Section>

          <Section id="words" title="Greek & Hebrew words">
            <Row label="English under each word" hint="interlinear mode">
              <Toggle checked={settings.display.glosses} onChange={(glosses) => sub("display", { glosses })} />
            </Row>
            <Row label="Hover cards" hint="meaning and parsing when you rest on a word">
              <Toggle checked={settings.hover.cards} onChange={(cards) => sub("hover", { cards })} />
            </Row>
            {settings.hover.cards && (
              <Row label="Card delay" hint={`${settings.hover.delay} ms`}>
                <Range min={0} max={1200} step={20} value={settings.hover.delay} onChange={(delay) => sub("hover", { delay })} />
              </Row>
            )}
          </Section>

          <Section id="speech" title="Pronunciation" note="Uses the voices installed on this computer — modern Greek and modern Hebrew, not ancient pronunciation.">
            <SpeechSettings settings={settings} onChange={(patch) => sub("speech", patch)} />
          </Section>

          <Section id="panel" title="Study panel">
            <Row label="Summary box" hint="the three lines above the tabs">
              <Toggle checked={settings.panel.glance} onChange={(glance) => sub("panel", { glance })} />
            </Row>
            <Row label="Open on tab">
              <Segmented<PanelTab>
                value={settings.panel.tab}
                options={[
                  ["text", "Text"],
                  ["fathers", "Fathers"],
                  ["links", "Links"],
                  ["words", "Words"],
                ]}
                onChange={(tab) => sub("panel", { tab })}
              />
            </Row>
            <Row label="Fathers shown">
              <Segmented<FathersScope>
                value={settings.fathers}
                options={[
                  ["pre-nicene", "Pre-Nicene"],
                  ["to-451", "to 451"],
                  ["all", "All"],
                ]}
                onChange={(fathers) => update({ fathers })}
              />
            </Row>
          </Section>

          <Section id="backup" title="Backup" note="Settings live in this browser. Save them to a file to move them to another computer.">
            <Backup settings={settings} onLoad={replace} />
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="set-section" id={`set-${id}`}>
      <h3>{title}</h3>
      {note && <p className="set-note">{note}</p>}
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <span className="set-label">
        {label}
        {hint && <span className="set-hint">{hint}</span>}
      </span>
      <span className="set-control">{children}</span>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`switch${checked ? " on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span className="segmented">
      {options.map(([id, label]) => (
        <button key={id} className={value === id ? "on" : ""} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </span>
  );
}

function Range({ min, max, step, value, onChange }: { min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
}

function ColorField({ value, custom, onChange }: { value: string; custom: boolean; onChange: (v: string | null) => void }) {
  return (
    <span className="color-field">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <code>{value}</code>
      {custom && (
        <button className="link-btn" onClick={() => onChange(null)} title="Back to the design's colour">
          reset
        </button>
      )}
    </span>
  );
}

function SpeechSettings({ settings, onChange }: { settings: Settings; onChange: (p: Partial<Settings["speech"]>) => void }) {
  const [voices, setVoices] = useState<Record<SpeechLang, SpeechSynthesisVoice[]>>({ grc: [], hbo: [] });
  useEffect(() => {
    let live = true;
    void voicesReady().then(() => live && setVoices({ grc: listVoices("grc"), hbo: listVoices("hbo") }));
    return () => {
      live = false;
    };
  }, []);
  if (!speechSupported()) return <p className="set-note">This browser has no speech synthesis.</p>;
  const s = settings.speech;
  const samples: Record<SpeechLang, string> = { grc: "Ἐν ἀρχῇ ἦν ὁ λόγος", hbo: "בְּרֵאשִׁית בָּרָא אֱלֹהִים" };
  return (
    <>
      <Row label="Speaker buttons">
        <Toggle checked={s.enabled} onChange={(enabled) => onChange({ enabled })} />
      </Row>
      {s.enabled && (
        <>
          <Row label="Speed" hint={`${s.rate.toFixed(2)}×`}>
            <Range min={0.4} max={1.3} step={0.05} value={s.rate} onChange={(rate) => onChange({ rate })} />
          </Row>
          {(["grc", "hbo"] as SpeechLang[]).map((lang) => (
            <Row key={lang} label={lang === "grc" ? "Greek voice" : "Hebrew voice"}>
              {voices[lang].length ? (
                <span className="voice-row">
                  <select value={s[lang] ?? ""} onChange={(e) => onChange({ [lang]: e.target.value || null })}>
                    <option value="">Best available</option>
                    {voices[lang].map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <button className="link-btn" onClick={() => void speak(samples[lang], lang, s.rate, s[lang])}>
                    ▶ test
                  </button>
                </span>
              ) : (
                <span className="set-hint">None installed — add one in Windows Settings › Time &amp; language › Speech</span>
              )}
            </Row>
          ))}
        </>
      )}
    </>
  );
}

function Backup({ settings, onLoad }: { settings: Settings; onLoad: (s: Settings) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  function exportFile() {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "testimonia-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      onLoad(normalize(JSON.parse(await f.text())));
      setMsg(`Loaded ${f.name}`);
    } catch {
      setMsg(`${f.name} is not a Testimonia settings file`);
    }
  }
  return (
    <div className="backup">
      <button className="btn" onClick={exportFile}>
        Save settings to a file
      </button>
      <button className="btn" onClick={() => file.current?.click()}>
        Load from a file…
      </button>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={importFile} />
      <button
        className="btn danger"
        onClick={() => window.confirm("Reset every setting to its default?") && onLoad({ ...DEFAULTS, editions: settings.editions })}
      >
        Reset everything
      </button>
      {msg && <p className="set-note">{msg}</p>}
    </div>
  );
}
