import DOMPurify from "dompurify";
import { marked } from "marked";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CONFIG_KEY, PRESETS, loadConfig, loadKey, onAiChange, runsInBrowser, saveConfig, saveKey, type AiConfig } from "../agent/providers";
import { runInBrowser, runOnServer, type AgentEvent, type Turn } from "../agent/run";
import { HIGHLIGHTS, useNotes, type Highlight } from "../notes";
import { openMap, pins } from "../pins";
import { onRemoteChange } from "../sync";
import { screenContext } from "./AskDrawer";
import { copyText } from "../studyLib";
import { useMeta } from "../api";
import { linkRefs, Peek, peekable, type PeekTarget } from "./VersePeek";

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
  model?: string; // which assistant answered: 'DeepSeek', 'Claude (Anthropic)'
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
                {c.model ? `${c.model} · ` : ""}
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

const NO_BOOKS: { osis: string; name: string }[] = [];

function markdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
}

/** One answer, rendered from markdown; memoised so earlier answers are not re-parsed on every streamed word. */
export const Answer = memo(function Answer({ text, books }: { text: string; books: { osis: string; name: string }[] }) {
  // plain references ("John 3:16") become links too, so every verse can be peeked at
  const html = useMemo(() => markdown(linkRefs(text, books)), [text, books]);
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
export function Chat({
  context,
  initial,
  compact = false,
  requestId,
  onBusy,
}: {
  context: string | null;
  initial?: string;
  compact?: boolean;
  requestId?: number; // a new request (the drawer reopened about something): refresh the suggested question
  onBusy?: (busy: boolean) => void;
}) {
  const navigate = useNavigate();
  const notesApi = useNotes();
  const [config, setConfig] = useState<AiConfig>(loadConfig);
  useEffect(() => {
    return onRemoteChange(CONFIG_KEY, () => setConfig(loadConfig())); // chosen on another device
  }, []);
  const [key, setKey] = useState(loadKey);
  useEffect(() => {
    // a key lent by another open tab, or added there
    return onAiChange(() => setKey(loadKey()));
  }, []);
  const [setup, setSetup] = useState(() => !loadKey() && !PRESETS.find((p) => p.id === loadConfig().preset)?.local);
  const [chats, setChats] = useState<Conversation[]>(loadChats);
  useEffect(() => {
    return onRemoteChange(CHATS_KEY, () => setChats(loadChats()));
  }, []); // chats from another device
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
  useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);
  const firstRequest = useRef(requestId);
  const suggested = useRef(initial ?? (context ? `What should I know about ${context}?` : ""));
  useEffect(() => {
    if (requestId === undefined || requestId === firstRequest.current) return;
    // a new suggestion replaces the old one, never what the reader typed themselves
    const next = initial ?? (context ? `What should I know about ${context}?` : "");
    setInput((cur) => (!cur.trim() || cur === suggested.current || initial ? next : cur));
    suggested.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);
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
      const next = [{ id: chatId, title: titleOf(messages), updated: new Date().toISOString(), messages: messages.slice(-80), model: prev?.model ?? preset.label }, ...rest];
      saveChats(next);
      return next;
    });
  }, [messages, busy, chatId]);
  // Follow the answer while it streams, but only while the reader is at the bottom, and only by scrolling the
  // chat's own scroller: scrollIntoView would also scroll the page, which made the screen jump on phones.
  const follow = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const box = scroller(end.current);
    if (!box) return;
    const onScroll = () => {
      follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      setAtBottom(follow.current);
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

  async function ask(question: string, base?: Message[]) {
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
    const prior = base ?? messages;
    // the last 30 messages are plenty of context; older ones only make each request slower and dearer
    const history: Turn[] = prior.filter((m) => m.content && !m.error).slice(-30).map((m) => ({ role: m.role, content: m.content }));
    const turns: Turn[] = [...history, { role: "user", content: q }];
    follow.current = true; // a new question always scrolls into view
    setMessages([...prior, { role: "user", content: q }, { role: "assistant", content: "", steps: [] }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    // text that resumes after a tool step is a new paragraph, not glued to the last sentence ("reported.There is…")
    let afterTool = false;
    const on = (e: AgentEvent) => {
      // the assistant can open pages (the atlas at a place, a verse, a chapter of a work); the chat stays open
      if (e.type === "navigate" && e.link.startsWith("/")) {
        navigate(e.link);
        e = { type: "tool", name: "show_in_app", summary: `opened ${e.link}` };
      }
      // the map beside the text, and pins: the assistant shows and keeps places
      if (e.type === "map") {
        openMap({ ref: e.ref, person: e.person, event: e.event, places: e.places, title: e.title });
        e = { type: "tool", name: "map", summary: `mapped ${e.title ?? "places"}` };
      } else if (e.type === "pins") {
        if (e.action === "add") pins.add(e.places);
        else if (e.action === "remove") pins.remove(e.places);
        else pins.saveSet(e.name ?? "My places", e.places);
        e = { type: "tool", name: "pins", summary: e.action === "save_set" ? `saved set “${e.name}”` : `${e.action === "add" ? "pinned" : "unpinned"} ${e.places.length} places` };
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
      const gap = ev.type === "text" && afterTool;
      if (ev.type === "tool") afterTool = true;
      else if (ev.type === "text") afterTool = false;
      setMessages((all) => {
        const copy = [...all];
        const last = { ...copy[copy.length - 1]! };
        if (ev.type === "text") last.content += gap && last.content && !/\n\s*$/.test(last.content) ? `\n\n${ev.text.replace(/^\s+/, "")}` : ev.text;
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

  // links in answers are app links: a verse opens in a small box beside the chat; anything else opens its page
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  const books = useMeta().data?.books ?? NO_BOOKS;
  function onAnswerClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href?.startsWith("/")) return;
    e.preventDefault();
    if (peekable(href)) setPeek({ href, rect: a.getBoundingClientRect(), label: a.textContent ?? undefined });
    else navigate(href);
  }

  // Retry: ask the last question again, from just before it
  function retry() {
    if (busy) return;
    const i = messages.map((m) => m.role).lastIndexOf("user");
    if (i < 0) return;
    void ask(messages[i]!.content, messages.slice(0, i));
  }
  const [copied, setCopied] = useState<number | null>(null);
  async function copyAnswer(i: number) {
    if (await copyText(messages[i]!.content)) {
      setCopied(i);
      window.setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    }
  }
  function jumpDown() {
    const box = scroller(end.current);
    follow.current = true;
    setAtBottom(true);
    box?.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }
  // the composer grows with what is typed, up to a few lines
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = box.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 168)}px`;
  }, [input]);
  const shortLabel = preset.label.replace(/\s*\(.*\)\s*$/, "");

  const title = messages.length > 0 ? titleOf(messages) : "New conversation";
  return (
    <div className={compact ? "ask-chat compact" : "ask-chat wide"}>
      {!compact && (
        // the conversations down the side, as in other chat apps (wide screens)
        <aside className="ask-side" aria-label="Conversations">
          <button className="as-new" onClick={newChat} disabled={busy}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            New chat
          </button>
          <div className="as-list">
            {chats.length === 0 && <p className="muted small as-empty">Your conversations appear here.</p>}
            {chats.map((c) => (
              <div key={c.id} className={`as-item${c.id === chatId ? " on" : ""}`}>
                <button className="as-open" onClick={() => openChat(c.id)} title={c.title}>
                  <span className="as-title">{c.title}</span>
                  <span className="as-when">{when(c.updated)}</span>
                </button>
                <button className="as-del" onClick={() => deleteChat(c.id)} aria-label={`Delete “${c.title}”`} title="Delete">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}
      <section className="ask-main">
        {/* always in sight: which conversation, which model, history and a new chat */}
        <header className="ask-head">
          <button className={`ah-icon ah-history${showHistory ? " on" : ""}`} onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} title="Past conversations" aria-label="Past conversations">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
            </svg>
            {chats.length > 0 && <span className="ah-count">{chats.length}</span>}
          </button>
          <span className="ah-title" title={title}>
            {title}
          </span>
          <button className={`ac-chip ah-model${setup ? " on" : ""}`} onClick={() => setSetup(!setup)} title={`${preset.label}${config.model ? ` · ${config.model}` : ""} — change the model or key`}>
            {shortLabel}
            {config.model && <span className="ah-model-name"> · {config.model}</span>} ▾
          </button>
          <button className="ah-icon" onClick={newChat} disabled={busy || messages.length === 0} title="New conversation" aria-label="New conversation">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        </header>
        {showHistory && <History chats={chats} current={chatId} onOpen={openChat} onNew={newChat} onDelete={deleteChat} onClose={() => setShowHistory(false)} />}
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
          {messages.map((m, i) => {
            const last = i === messages.length - 1;
            const live = busy && last;
            return m.role === "user" ? (
              <div key={i} className="ask-q">
                {m.content}
              </div>
            ) : (
              <div key={i} className={`ask-a${live ? " streaming" : ""}`}>
                {((m.steps?.length ?? 0) > 0 || live) && <Activity steps={m.steps ?? []} live={live} />}
                {m.notice && <p className="muted small">{m.notice}</p>}
                {m.content && <Answer text={m.content} books={books} />}
                {m.error && (
                  <p className="ask-error">
                    {/fetch|network|load failed|connection/i.test(m.error) ? "The connection dropped." : m.error}
                    {last && !busy && (
                      <button className="link-btn" onClick={retry}>
                        Retry
                      </button>
                    )}
                  </p>
                )}
                {!live && m.content && (
                  <div className="ask-actions">
                    <button onClick={() => void copyAnswer(i)}>{copied === i ? "✓ Copied" : "Copy"}</button>
                    {last && !m.error && <button onClick={retry}>Retry</button>}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={end} />
          {!atBottom && messages.length > 0 && (
            <button className="ask-jump" onClick={jumpDown} aria-label="Jump to the latest">
              ↓
            </button>
          )}
        </div>

        <form className="ask-composer" onSubmit={submit}>
          <textarea
            ref={box}
            value={input}
            rows={1}
            placeholder="Ask a question…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !window.matchMedia("(pointer: coarse)").matches) {
                e.preventDefault();
                void ask(input);
              }
            }}
          />
          <div className="ac-row">
            <span className="ac-spacer" />
            {busy ? (
              <button type="button" className="ac-send stop" onClick={() => abort.current?.abort()} aria-label="Stop">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" /></svg>
              </button>
            ) : (
              <button type="submit" className="ac-send" disabled={!input.trim()} aria-label="Ask">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
                </svg>
              </button>
            )}
          </div>
        </form>
        <p className="ask-foot">AI can be wrong. Check the linked sources.</p>
      </section>
      {setup && (
        // the model and key in a dialog of their own, over a dimmed page
        <div className="ask-modal-layer" onPointerDown={(e) => e.target === e.currentTarget && setSetup(false)}>
          <section className="ask-modal ask-setup" role="dialog" aria-label="Assistant settings">
            <header className="am-head">
              <strong>Assistant settings</strong>
              <button className="icon-btn" onClick={() => setSetup(false)} aria-label="Close">
                ✕
              </button>
            </header>
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
        </div>
      )}
      {peek && <Peek target={peek} onClose={() => setPeek(null)} />}
    </div>
  );
}
