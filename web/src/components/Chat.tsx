import DOMPurify from "dompurify";
import { marked } from "marked";
import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PRESETS, loadConfig, loadKey, runsInBrowser, saveConfig, saveKey, type AiConfig } from "../agent/providers";
import { runInBrowser, runOnServer, type AgentEvent, type Turn } from "../agent/run";
import { HIGHLIGHTS, useNotes, type Highlight } from "../notes";
import { screenContext } from "./AskDrawer";

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

// Past conversations, kept in this browser like the notes: newest first, the open one remembered.
interface Conversation {
  id: string;
  title: string;
  updated: string; // ISO
  messages: Message[];
}
const CHATS_KEY = "testimonia.ai.chats.v1";
const CURRENT_KEY = "testimonia.ai.current";
const MAX_CHATS = 100;

function loadChats(): Conversation[] {
  try {
    const list = JSON.parse(localStorage.getItem(CHATS_KEY) ?? "null") as Conversation[] | null;
    if (Array.isArray(list)) return list;
    // the single chat kept before history existed becomes the first conversation
    const old = JSON.parse(localStorage.getItem(CHAT_KEY) ?? "[]") as Message[];
    return old.length ? [{ id: newId(), title: titleOf(old), updated: new Date().toISOString(), messages: old }] : [];
  } catch {
    return [];
  }
}
function saveChats(list: Conversation[]) {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(list.slice(0, MAX_CHATS)));
  } catch {
    /* storage full or unavailable */
  }
}
function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function titleOf(messages: Message[]): string {
  const q = messages.find((m) => m.role === "user")?.content ?? "New conversation";
  return q.replace(/\s+/g, " ").slice(0, 80);
}
function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** The list of past conversations: open one, start a new one, or delete. */
function History({ chats, current, onOpen, onNew, onDelete, onClose }: { chats: Conversation[]; current: string; onOpen: (id: string) => void; onNew: () => void; onDelete: (id: string) => void; onClose: () => void }) {
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase();
  const shown = q ? chats.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q))) : chats;
  return (
    <section className="ask-history">
      <div className="ah-head">
        <strong>Conversations</strong>
        <button className="btn primary" onClick={onNew}>
          + New
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Close history">
          ✕
        </button>
      </div>
      {chats.length > 6 && <input className="ah-find" placeholder="Search conversations…" value={find} onChange={(e) => setFind(e.target.value)} />}
      {shown.length === 0 && <p className="muted small">{chats.length ? "No conversation matches." : "No conversations yet."}</p>}
      <ul className="ah-list">
        {shown.map((c) => (
          <li key={c.id} className={c.id === current ? "on" : ""}>
            <button className="ah-open" onClick={() => onOpen(c.id)}>
              <span className="ah-title">{c.title}</span>
              <span className="ah-meta">
                {when(c.updated)} · {c.messages.filter((m) => m.role === "user").length} questions
              </span>
            </button>
            <button className="ah-del" onClick={() => onDelete(c.id)} aria-label={`Delete “${c.title}”`} title="Delete">
              🗑
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function markdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
}

/** One answer, rendered from markdown; memoised so earlier answers are not re-parsed on every streamed word. */
const Answer = memo(function Answer({ text }: { text: string }) {
  const html = useMemo(() => markdown(text), [text]);
  return <div className="ask-md" dangerouslySetInnerHTML={{ __html: html }} />;
});

/** The nearest ancestor that scrolls (the drawer's chat area, or the page). */
function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const { overflowY } = getComputedStyle(n);
    if (overflowY === "auto" || overflowY === "scroll") return n;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/** "read work: x §3" → { verb: "Reading", what: "x" }: steps grouped by what they did, for a calm summary. */
function stepParts(s: string): { verb: string; what: string } {
  const [head, ...rest] = s.split(": ");
  const what = rest.join(": ").replace(/\s*§.*$/, "");
  const verb = (head ?? s).replace(/^\w/, (c) => c.toUpperCase());
  return { verb, what };
}

/** What the assistant is doing: one animated line while it works (the current step and a count), folding into
 *  "Used N sources ▸" afterwards, which opens to the steps grouped (repeats counted, not listed). */
function Activity({ steps, live }: { steps: string[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const groups: { label: string; n: number }[] = [];
  for (const s of steps) {
    const { verb, what } = stepParts(s);
    const label = what ? `${verb}: ${what}` : verb;
    const g = groups.find((x) => x.label === label);
    if (g) g.n++;
    else groups.push({ label, n: 1 });
  }
  const current = steps.length ? stepParts(steps[steps.length - 1]!) : null;
  return (
    <div className={`ask-activity${live ? " live" : ""}`}>
      <button className="act-line" onClick={() => setOpen(!open)} disabled={!steps.length} aria-expanded={open}>
        <span className="act-orb" aria-hidden />
        {live ? (
          <span className="act-now" key={steps.length}>
            {current ? `${current.verb}${current.what ? ` · ${current.what}` : ""}` : "Thinking"}
            <span className="act-dots" aria-hidden />
          </span>
        ) : (
          <span>
            Used {steps.length} {steps.length === 1 ? "step" : "steps"}
          </span>
        )}
        {steps.length > 0 && <span className="act-count">{live ? steps.length : open ? "▾" : "▸"}</span>}
      </button>
      {open && (
        <ol className="act-list">
          {groups.map((g) => (
            <li key={g.label}>
              {g.label}
              {g.n > 1 && <span className="act-n">×{g.n}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The study assistant: bring your own key, any provider; answers grounded in the library, with links.
 *  Used full-page (/ask) and in the drawer that opens from anywhere (`compact`). */
export function Chat({ context, initial, compact = false }: { context: string | null; initial?: string; compact?: boolean }) {
  const navigate = useNavigate();
  const notesApi = useNotes();
  const [config, setConfig] = useState<AiConfig>(loadConfig);
  const [key, setKey] = useState(loadKey);
  const [setup, setSetup] = useState(() => !loadKey() && !PRESETS.find((p) => p.id === loadConfig().preset)?.local);
  const [chats, setChats] = useState<Conversation[]>(loadChats);
  const [chatId, setChatId] = useState<string>(() => {
    const saved = localStorage.getItem(CURRENT_KEY);
    const list = loadChats();
    return saved && list.some((c) => c.id === saved) ? saved : (list[0]?.id ?? newId());
  });
  const [messages, setMessages] = useState<Message[]>(() => loadChats().find((c) => c.id === chatId)?.messages ?? []);
  const [showHistory, setShowHistory] = useState(false);
  function openChat(id: string) {
    if (busy) return;
    setChatId(id);
    setMessages(chats.find((c) => c.id === id)?.messages ?? []);
    setShowHistory(false);
  }
  function newChat() {
    if (busy) return;
    setChatId(newId());
    setMessages([]);
    setShowHistory(false);
  }
  function deleteChat(id: string) {
    const next = chats.filter((c) => c.id !== id);
    setChats(next);
    saveChats(next);
    if (id === chatId) newChat();
  }
  const [input, setInput] = useState(initial ?? (context ? `What should I know about ${context}?` : ""));
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const preset = PRESETS.find((p) => p.id === config.preset) ?? PRESETS[0]!;
  const inBrowser = runsInBrowser(config);

  useEffect(() => {
    if (busy) return; // saved once the answer is complete, not on every streamed word
    try {
      localStorage.setItem(CURRENT_KEY, chatId);
    } catch {
      /* storage unavailable */
    }
    if (!messages.length) return; // an empty new chat is not kept until something is asked
    setChats((all) => {
      const rest = all.filter((c) => c.id !== chatId);
      const prev = all.find((c) => c.id === chatId);
      const unchanged = prev && prev.messages.length === messages.length && prev.messages.at(-1)?.content === messages.at(-1)?.content;
      if (unchanged) return all;
      const next = [{ id: chatId, title: titleOf(messages), updated: new Date().toISOString(), messages: messages.slice(-80) }, ...rest];
      saveChats(next);
      return next;
    });
  }, [messages, busy, chatId]);
  // Follow the answer while it streams, but only while the reader is at the bottom, and only by scrolling the
  // chat's own scroller: scrollIntoView would also scroll the page, which made the screen jump on phones.
  const follow = useRef(true);
  useEffect(() => {
    const box = scroller(end.current);
    if (!box) return;
    const onScroll = () => {
      follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const box = scroller(end.current);
    if (!box || !follow.current || !messages.length) return; // nothing to follow yet: keep the page at the top
    const frame = requestAnimationFrame(() => {
      box.scrollTop = box.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
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
    follow.current = true; // a new question always scrolls into view
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "", steps: [] }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const on = (e: AgentEvent) => {
      // the assistant can open pages (the atlas at a place, a verse, a chapter of a work); the chat stays open
      if (e.type === "navigate" && e.link.startsWith("/")) {
        navigate(e.link);
        e = { type: "tool", name: "show_in_app", summary: `opened ${e.link}` };
      }
      // changes to the reader's notes, asked for in the chat, applied here (notes live in this browser)
      if (e.type === "note") {
        if (!e.osis) return;
        const label = e.osis.replace(/^([^.]+)\.(\d+)\.(\d+)$/, "$1 $2:$3");
        const cur = notesApi.get(e.osis);
        if (e.action === "remove") notesApi.remove(e.osis);
        else if (e.action === "highlight") {
          const want = e.highlight;
          notesApi.set(e.osis, { highlight: (HIGHLIGHTS.find((h) => h.id === want)?.id ?? null) as Highlight | null });
        }
        else if (e.action === "replace") notesApi.set(e.osis, { text: e.text });
        else notesApi.set(e.osis, { text: cur?.text ? `${cur.text}\n\n${e.text}` : e.text });
        const verb = { add: "noted", replace: "rewrote note on", remove: "removed note on", highlight: "highlighted" }[e.action];
        e = { type: "tool", name: "notes", summary: `${verb} ${label}` };
      }
      const ev = e;
      setMessages((all) => {
        const copy = [...all];
        const last = { ...copy[copy.length - 1]! };
        if (ev.type === "text") last.content += ev.text;
        else if (ev.type === "tool") last.steps = [...(last.steps ?? []), ev.summary];
        else if (ev.type === "notice") last.notice = ev.message;
        else if (ev.type === "error") last.error = ev.message;
        copy[copy.length - 1] = last;
        return copy;
      });
    };
    // what is on screen now (it follows the reader around the site), plus what the chat was opened about
    const where = [context ? `asked about ${context}` : "", screenContext()].filter(Boolean).join("; ");
    try {
      const brief = Object.values(notesApi.notes)
        .filter((n) => n.text || n.highlight)
        .map((n) => ({ osis: n.osis, text: n.text.slice(0, 2000), highlight: n.highlight }))
        .slice(0, 5000);
      await (inBrowser ? runInBrowser : runOnServer)(config, key, turns, where, on, ctrl.signal, brief);
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

  return (
    <div className={compact ? "ask-chat compact" : "ask-chat"}>
      <header className="ask-head">
        {!compact && <h1>Ask</h1>}
        <button className="ask-model" onClick={() => setSetup(!setup)} title="Choose the model">
          <span className="muted small">Model</span> {preset.label}
          {config.model && <span className="muted"> · {config.model}</span>} ▾
        </button>
        <span className="ah-actions">
          <button className="chip" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} title="Past conversations">
            ☰ History{chats.length ? ` · ${chats.length}` : ""}
          </button>
          {messages.length > 0 && (
            <button className="chip" onClick={newChat} disabled={busy} title="Start a new conversation">
              + New
            </button>
          )}
        </span>
      </header>
      {showHistory && <History chats={chats} current={chatId} onOpen={openChat} onNew={newChat} onDelete={deleteChat} onClose={() => setShowHistory(false)} />}

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
              {((m.steps?.length ?? 0) > 0 || (busy && i === messages.length - 1)) && (
                <Activity steps={m.steps ?? []} live={busy && i === messages.length - 1} />
              )}
              {m.notice && <p className="muted small">{m.notice}</p>}
              {m.content && <Answer text={m.content} />}
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
