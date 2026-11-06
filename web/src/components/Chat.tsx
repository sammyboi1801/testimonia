import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PRESETS, loadConfig, loadKey, runsInBrowser, saveConfig, saveKey, type AiConfig } from "../agent/providers";
import { runInBrowser, runOnServer, type AgentEvent, type Turn } from "../agent/run";

interface Message {
  role: "user" | "assistant";
  content: string;
  steps?: string[]; // tools used while answering
  notice?: string;
  error?: string;
}

const CHAT_KEY = "testimonia.ai.chat";
const SUGGESTIONS = [
  "Why do some manuscripts read “God” and others “Son” in John 1:18?",
  "What did the church fathers before Nicaea say about the Logos?",
  "What do Josephus and Tacitus say about Jesus?",
  "Explain the Greek word μονογενής and how it is translated.",
];

function loadChat(): Message[] {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY) ?? "[]") as Message[];
  } catch {
    return [];
  }
}

function markdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
}

/** The study assistant: bring your own key, any provider; answers grounded in the library, with links.
 *  Used full-page (/ask) and in the drawer that opens from anywhere (`compact`). */
export function Chat({ context, initial, compact = false }: { context: string | null; initial?: string; compact?: boolean }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AiConfig>(loadConfig);
  const [key, setKey] = useState(loadKey);
  const [setup, setSetup] = useState(() => !loadKey() && !PRESETS.find((p) => p.id === loadConfig().preset)?.local);
  const [messages, setMessages] = useState<Message[]>(loadChat);
  const [input, setInput] = useState(initial ?? (context ? `What should I know about ${context}?` : ""));
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const preset = PRESETS.find((p) => p.id === config.preset) ?? PRESETS[0]!;
  const inBrowser = runsInBrowser(config);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* storage unavailable */
    }
  }, [messages]);
  useEffect(() => {
    // braces matter: scrollIntoView returns a Promise in current browsers, and an effect must not return one
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  function choosePreset(id: string) {
    const p = PRESETS.find((x) => x.id === id)!;
    const next: AiConfig = { ...config, preset: id, protocol: p.protocol, baseUrl: p.baseUrl ?? "", model: p.models?.[0] ?? "" };
    setConfig(next);
    saveConfig(next);
  }
  function update(patch: Partial<AiConfig>) {
    const next = { ...config, ...patch };
    setConfig(next);
    saveConfig(next);
    if ("remember" in patch) saveKey(key, next.remember);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    if (preset.needsKey && !key) {
      setSetup(true);
      return;
    }
    if (!config.model) {
      setSetup(true);
      return;
    }
    const history: Turn[] = messages.filter((m) => m.content && !m.error).map((m) => ({ role: m.role, content: m.content }));
    const turns: Turn[] = [...history, { role: "user", content: q }];
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "", steps: [] }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const on = (e: AgentEvent) =>
      setMessages((all) => {
        const copy = [...all];
        const last = { ...copy[copy.length - 1]! };
        if (e.type === "text") last.content += e.text;
        else if (e.type === "tool") last.steps = [...(last.steps ?? []), e.summary];
        else if (e.type === "notice") last.notice = e.message;
        else if (e.type === "error") last.error = e.message;
        copy[copy.length - 1] = last;
        return copy;
      });
    try {
      await (inBrowser ? runInBrowser : runOnServer)(config, key, turns, context, on, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) on({ type: "error", message: String(e) });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  // links in answers are app links (/read/…, /library/…): follow them inside the app
  function onAnswerClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (a && href?.startsWith("/")) {
      e.preventDefault();
      navigate(href);
    }
  }

  const rendered = useMemo(() => messages.map((m) => (m.role === "assistant" ? markdown(m.content) : "")), [messages]);

  return (
    <div className={compact ? "ask-chat compact" : "ask-chat"}>
      <header className="ask-head">
        {!compact && <h1>Ask</h1>}
        <button className="ask-model" onClick={() => setSetup(!setup)} title="Choose the model">
          <span className="muted small">Model</span> {preset.label}
          {config.model && <span className="muted"> · {config.model}</span>} ▾
        </button>
        {messages.length > 0 && (
          <button className="link-btn" onClick={() => setMessages([])} disabled={busy}>
            New conversation
          </button>
        )}
      </header>

      {setup && (
        <section className="ask-setup">
          <div className="ask-grid">
            <label>
              Provider
              <select value={config.preset} onChange={(e) => choosePreset(e.target.value)}>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <input list="ask-models" value={config.model} placeholder={preset.modelHint} onChange={(e) => update({ model: e.target.value.trim() })} />
              <datalist id="ask-models">
                {(preset.models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            {config.protocol === "openai" && (
              <label className="wide">
                Endpoint (OpenAI-compatible)
                <input value={config.baseUrl} placeholder="https://…/v1" onChange={(e) => update({ baseUrl: e.target.value.trim() })} />
              </label>
            )}
            <label className="wide">
              API key {preset.needsKey ? "" : "(optional)"}
              <input
                type="password"
                value={key}
                autoComplete="off"
                placeholder={preset.needsKey ? "Paste your key" : "Not needed for most local servers"}
                onChange={(e) => {
                  setKey(e.target.value.trim());
                  saveKey(e.target.value.trim(), config.remember);
                }}
              />
            </label>
          </div>
          <label className="ask-remember">
            <input type="checkbox" checked={config.remember} onChange={(e) => update({ remember: e.target.checked })} />
            Remember the key on this device
          </label>
          <p className="ask-privacy">
            {inBrowser
              ? "This model runs on your computer: your browser talks to it directly, and Testimonia only supplies the library tools."
              : "Your key stays in this browser" +
                (config.remember ? " (saved on this device)" : " for this session") +
                ". It is sent with each question to answer it and is never stored or logged by Testimonia. Usage is billed to your account."}
            {preset.keyUrl && (
              <>
                {" "}
                <a href={preset.keyUrl} target="_blank" rel="noreferrer">
                  Get a key ↗
                </a>
              </>
            )}
          </p>
          {preset.note && <p className="ask-privacy">{preset.note}</p>}
          <button className="btn" onClick={() => setSetup(false)}>
            Done
          </button>
        </section>
      )}

      <div className="ask-thread" onClick={onAnswerClick}>
        {messages.length === 0 && (
          <div className="ask-empty">
            <p className="muted">
              Ask about any passage, word, writer or event. Answers are grounded in the library — translations, manuscripts, the fathers, Josephus — and link to
              their sources.
            </p>
            {context && <p className="ask-context">About {context}</p>}
            <div className="search-examples">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ask-q">
              {m.content}
            </div>
          ) : (
            <div key={i} className="ask-a">
              {(m.steps?.length ?? 0) > 0 && (
                <div className="ask-steps">
                  {m.steps!.map((s, j) => (
                    <span key={j} className="tag">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {m.notice && <p className="muted small">{m.notice}</p>}
              {m.content ? (
                <div className="ask-md" dangerouslySetInnerHTML={{ __html: rendered[i]! }} />
              ) : (
                !m.error && busy && i === messages.length - 1 && <p className="muted">Reading the library…</p>
              )}
              {m.error && <p className="error">{m.error}</p>}
            </div>
          ),
        )}
        <div ref={end} />
      </div>

      <form className="ask-input" onSubmit={submit}>
        <textarea
          value={input}
          rows={2}
          placeholder="Ask a question…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!input.trim()}>
            Ask
          </button>
        )}
      </form>
      <p className="muted small ask-foot">
        AI answers can be wrong. Check the linked sources. {inBrowser ? "Running in your browser." : "Runs through the Testimonia server with your key."}
      </p>
    </div>
  );
}
