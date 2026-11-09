import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { useChapter, useMeta } from "../api";
import { openAsk } from "../components/AskDrawer";
import { lastReadingPath } from "../lib";
import { signIn, syncAvailable, useSync } from "../sync";
import "../landing.css";

/** The front door: what Testimonia is, shown with the library itself rather than described. */

const IMG = "/landing";

const HISTORY: { year: string; title: string; text: string; img: string; to: string; contain?: boolean }[] = [
  { year: "AD 70", title: "The Temple falls", text: "Rome destroys Jerusalem; Josephus records the siege.", img: "titus.jpg", to: "/library?view=timeline" },
  { year: "c. AD 108", title: "Ignatius of Antioch", text: "Seven letters on the way to martyrdom, full of the Gospels.", img: "ignatius.jpg", to: "/read/John/1?v=John.1.1&t=fathers" },
  { year: "c. AD 150", title: "Papyrus 52", text: "The oldest known fragment of the New Testament: John 18.", img: "p52.jpg", to: "/read/John/18?v=John.18.31", contain: true },
  { year: "c. AD 200", title: "Papyrus 66", text: "An early codex of John that reads “the only-begotten God” at 1:18.", img: "p66.jpg", to: "/read/John/1?v=John.1.18&t=text" },
  { year: "AD 325", title: "The Council of Nicaea", text: "Bishops gather to settle how to confess the Word of John 1.", img: "nicaea.jpg", to: "/library?view=story" },
  { year: "c. AD 350", title: "Codex Sinaiticus", text: "A whole Greek Bible on parchment, four columns to a page.", img: "sinaiticus.jpg", to: "/manuscripts" },
  { year: "AD 405", title: "Jerome’s Vulgate", text: "The Bible in Latin, the text of the West for a thousand years.", img: "jerome.jpg", to: "/read/John/1" },
  { year: "AD 1008", title: "The Leningrad Codex", text: "The oldest complete Hebrew Bible, the basis of today’s editions.", img: "leningrad.jpg", to: "/read/Gen/1" },
  { year: "AD 1611", title: "The King James Version", text: "The English Bible of four centuries, here beside the modern ones.", img: "kjv.jpg", to: "/read/John/1" },
];

const FEATURES: { kicker: string; title: string; text: ReactNode; img: string; to: string; cta: string }[] = [
  {
    kicker: "Original languages",
    title: "Every Greek and Hebrew word, under the text",
    text: "Read any chapter word by word: the Hebrew Bible, the Greek New Testament and the Greek Septuagint, each word with its gloss and parsing. Tap a word for its full study — what it means, how it is translated, every place it occurs.",
    img: "shot-interlinear.jpg",
    to: "/read/John/1",
    cta: "Open the interlinear",
  },
  {
    kicker: "Manuscripts",
    title: "Where the copies differ, explained in plain words",
    text: "Some 15,000 places where the printed editions or the manuscripts read differently — “God” or “Son” at John 1:18 — with the papyri and codices that read each way, and the text as the earliest manuscripts actually wrote it.",
    img: "shot-variants.jpg",
    to: "/read/John/1?v=John.1.18&t=text",
    cta: "See John 1:18",
  },
  {
    kicker: "The church fathers",
    title: "Who quoted each verse first, and when",
    text: "Tens of thousands of quotations from the early church — Ignatius, Justin, Irenaeus, Tertullian, Origen and the rest — linked to the verse they quote, dated, and opened in the full text of the work they wrote.",
    img: "shot-fathers.jpg",
    to: "/read/John/1?v=John.1.1&t=fathers",
    cta: "Who quoted John 1:1",
  },
  {
    kicker: "The land",
    title: "The places of a passage, on a map beside it",
    text: "Every place a chapter names, numbered in the order the text names them. Follow Paul through Acts, pin the places you are studying, save them as sets, and measure the walk from one town to the next.",
    img: "shot-map.jpg",
    to: "/read/Acts/13",
    cta: "Map Acts 13",
  },
  {
    kicker: "The times",
    title: "Who ruled, what happened, who was writing",
    text: "A timeline of kings, governors and emperors, events and writers from the monarchy of Israel to the Council of Chalcedon — and for any verse, who was ruling when it happened.",
    img: "shot-timeline.jpg",
    to: "/library?view=timeline",
    cta: "Open the timeline",
  },
  {
    kicker: "The library",
    title: "Read the early church in its own words",
    text: "The Apostolic Fathers, the apologists and the great teachers of the first centuries, with Josephus, Tacitus and Pliny — every work readable in full, every Scripture it quotes one tap away.",
    img: "shot-reader.jpg",
    to: "/library",
    cta: "Browse the library",
  },
];

const QUESTIONS = [
  "What did the church fathers before Nicaea say about John 1:1?",
  "Why do some manuscripts read “God” and others “Son” in John 1:18?",
  "Where did Paul go on his first journey? Show it on the map.",
  "What do Josephus and Tacitus say about Jesus?",
];

function useCount(target: number | null): string {
  // the numbers count up once, the first time they appear
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!target) return;
    const start = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 1200);
      setN(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return target ? n.toLocaleString() : "…";
}

function Stat({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="lp-stat">
      <strong>{useCount(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

/** John 1:1 from the library itself: the English, and the Greek word by word, every word a link to its study. */
function LiveVerse() {
  const { data } = useChapter("John", 1, ["kjva", "bsb", "tagnt"]);
  const v = data?.verses.find((x) => x.verse === 1);
  const words = v?.words.tagnt ?? [];
  return (
    <div className="lp-verse">
      <div className="lp-verse-ref">John 1:1</div>
      <p className="lp-verse-en">{v?.texts.kjva?.text ?? "In the beginning was the Word, and the Word was with God, and the Word was God."}</p>
      <div className="lp-verse-words" lang="grc">
        {words.length
          ? words.map((w) => (
              <Link key={w.pos} className="lp-word" to={`/read/John/1?v=John.1.1&t=words&w=${encodeURIComponent(w.lemma_id ?? w.strong ?? "")}`} title={`${w.gloss ?? ""} — open the word study`}>
                <span className="greek">{w.surface}</span>
                <small>{w.gloss}</small>
              </Link>
            ))
          : "Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν, καὶ θεὸς ἦν ὁ λόγος."
              .split(" ")
              .map((w, i) => (
                <span key={i} className="lp-word">
                  <span className="greek">{w}</span>
                </span>
              ))}
      </div>
      <div className="lp-verse-facts">
        <Link to="/read/John/1?v=John.1.1&t=fathers">✝ Quoted by the early church fathers →</Link>
        <Link to="/read/John/1?v=John.1.1&t=text">◆ As the manuscripts read it →</Link>
        <Link to="/read/John/1?v=John.1.1&t=words&w=G3056">λόγος · the word study →</Link>
      </div>
      <p className="lp-verse-tip">Tap any Greek word to see what it means and everywhere it occurs.</p>
    </div>
  );
}

export default function LandingPage() {
  const meta = useMeta();
  const sync = useSync();
  const goHome = sync.ready && !!sync.user && !new URLSearchParams(window.location.search).has("welcome");
  const counts = meta.data?.counts;
  const translations = meta.data ? meta.data.editions.filter((e) => e.kind !== "interlinear").length : null;
  const reading = lastReadingPath();
  const returning = reading !== "/read/John/1";
  const where = returning ? reading.replace(/^\/read\/([^/]+)\/(\d+).*$/, (_m, b: string, c: string) => `${meta.data?.books.find((x) => x.osis === b)?.name ?? b} ${c}`) : null;

  // signed in: straight to your desk (/?welcome shows this page anyway)
  if (goHome) return <Navigate to="/home" replace />;
  return (
    <div className="lp">
      {/* ------------------------------------------------------------------ hero */}
      <section className="lp-hero">
        <div className="lp-hero-text">
          <p className="lp-kicker">A free, open-source Bible study library</p>
          <h1>The Bible and its earliest witnesses</h1>
          <p className="lp-lede">
            Read the Hebrew and Greek with the translations, see where the manuscripts differ, and find which early Christians quoted each verse —
            with a map, a timeline and an assistant that knows the whole library.
          </p>
          <div className="lp-actions">
            {returning ? (
              <Link className="lp-btn primary" to={reading}>
                Continue reading {where}
              </Link>
            ) : (
              <Link className="lp-btn primary" to="/read/John/1">
                Start reading
              </Link>
            )}
            <Link className="lp-btn" to="/library">
              Browse the library
            </Link>
            {syncAvailable && !sync.user && (
              <button className="lp-btn ghost" onClick={() => void signIn()}>
                Sign in to sync
              </button>
            )}
          </div>
          <p className="lp-note">Free · No ads, no tracking · Works on your phone · Install it like an app</p>
        </div>
        <div className="lp-columns" aria-hidden>
          {[HISTORY.slice(0, 5), HISTORY.slice(4)].map((col, i) => (
            <div key={i} className={`lp-col ${i ? "down" : "up"}`}>
              {[0, 1].map((rep) => (
                <div key={rep} className="lp-run">
                  {col.map((h) => (
                    <figure key={h.img} className={`lp-tile${h.contain ? " contain" : ""}`}>
                      <img src={`${IMG}/${h.img}`} alt="" />
                      <figcaption>
                        <b>{h.year}</b> {h.title}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ history ticker */}
      <div className="lp-ticker" aria-label="Moments in the history of the text">
        <div className="lp-ticker-track">
          {[0, 1].map((rep) => (
            <p key={rep} aria-hidden={rep === 1}>
              {HISTORY.map((h) => (
                <Link key={h.year + rep} to={h.to} tabIndex={rep ? -1 : 0}>
                  <b>{h.year}</b> {h.text}
                </Link>
              ))}
            </p>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------------ live verse */}
      <section className="lp-section lp-split">
        <div>
          <p className="lp-kicker">Try it here</p>
          <h2>One verse, everything behind it</h2>
          <p className="lp-body">
            This is the library itself, not a picture of it. Every verse of the Bible opens like this: the text in your translations, the original
            words, how the manuscripts read it, who in the early church quoted it, the places and people it names, and what was happening in the
            world when it was written.
          </p>
          <Link className="lp-link" to="/read/John/1">
            Read John 1 →
          </Link>
        </div>
        <LiveVerse />
      </section>

      {/* ------------------------------------------------------------------ numbers */}
      <section className="lp-stats" aria-label="The library in numbers">
        <Stat value={translations} label="translations and editions" />
        <Stat value={counts?.works ?? null} label="early Christian and ancient works" />
        <Stat value={counts?.citations ?? null} label="quotations of Scripture, linked" />
        <Stat value={counts?.commentary ?? null} label="comments by the fathers" />
      </section>

      {/* ------------------------------------------------------------------ features */}
      <section className="lp-section">
        <p className="lp-kicker center">What is inside</p>
        <h2 className="center">A whole study library, in one place</h2>
        <div className="lp-features">
          {FEATURES.map((f, i) => (
            <article key={f.title} className={`lp-feature${i % 2 ? " flip" : ""}`}>
              <div className="lp-feature-text">
                <p className="lp-kicker">{f.kicker}</p>
                <h3>{f.title}</h3>
                <p className="lp-body">{f.text}</p>
                <Link className="lp-link" to={f.to}>
                  {f.cta} →
                </Link>
              </div>
              <Link className="lp-shot" to={f.to} tabIndex={-1} aria-hidden>
                <img src={`${IMG}/${f.img}`} alt="" loading="lazy" />
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ assistant */}
      <section className="lp-section lp-ask">
        <div>
          <p className="lp-kicker">The study assistant</p>
          <h2>Ask, and it reads the library for you</h2>
          <p className="lp-body">
            An assistant that searches the texts, reads the fathers in full, studies the Greek and Hebrew, opens the map and keeps your notes — and
            tells you where every answer comes from. Use your own key for Claude, ChatGPT, Gemini, DeepSeek and others, or a model on your own
            computer. Your key never leaves your device.
          </p>
        </div>
        <div className="lp-questions">
          {QUESTIONS.map((q) => (
            <button key={q} className="lp-question" onClick={() => openAsk(null, q)}>
              <span aria-hidden>✦</span> {q}
            </button>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ history strip */}
      <section className="lp-section">
        <p className="lp-kicker center">From the Temple to the King James</p>
        <h2 className="center">Sixteen centuries of the text, one tap each</h2>
        <div className="lp-history">
          {HISTORY.map((h) => (
            <Link key={h.year} className="lp-moment" to={h.to}>
              <div className={`lp-moment-img${h.contain ? " contain" : ""}`}>
                <img src={`${IMG}/${h.img}`} alt="" loading="lazy" />
              </div>
              <span className="lp-moment-year">{h.year}</span>
              <strong>{h.title}</strong>
              <span className="lp-moment-text">{h.text}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ yours */}
      <section className="lp-section lp-pillars">
        <div className="lp-pillar">
          <h3>Your study, everywhere</h3>
          <p>
            Highlights, notes, pinned places, saved maps and your conversations. Sign in and they follow you between phone and computer — or use it
            without an account, and everything stays on your device.
          </p>
        </div>
        <div className="lp-pillar">
          <h3>Open, and credited</h3>
          <p>
            Built on openly licensed texts and data — STEPBible, OpenBible, the Leningrad Codex, the Septuagint, CNTR, the Christian Classics Ethereal
            Library and more — every source named. The code is open source.
          </p>
        </div>
        <div className="lp-pillar">
          <h3>Quiet by design</h3>
          <p>No ads, no tracking, no paywall. Large type, a calm reading page, light and dark themes, and an app you can install on your phone.</p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ last call */}
      <section className="lp-final">
        <h2>Open the Bible with the early church</h2>
        <div className="lp-actions center">
          <Link className="lp-btn primary" to={returning ? reading : "/read/John/1"}>
            {returning ? `Continue reading ${where}` : "Start reading"}
          </Link>
          <Link className="lp-btn" to="/atlas">
            Explore the atlas
          </Link>
        </div>
      </section>

      <footer className="lp-foot">
        <p>
          Texts and data from openly licensed sources, <a href="https://github.com/sammyboi1801/testimonia/blob/main/CREDITS.md">credited in full</a>. The
          fathers’ texts from the <a href="https://www.ccel.org/">Christian Classics Ethereal Library</a>. Historical images from Wikimedia Commons, public
          domain or CC0: Papyrus 66 (Bibliotheca Bodmeriana), the Arch of Titus, the Menologion of Basil II, Papyrus 52 (John Rylands Library), the
          Nicaea icon, Codex Sinaiticus, Caravaggio’s <i>Saint Jerome Writing</i>, the Leningrad Codex and the 1611 King James title page.
        </p>
        <p>
          <a href="https://github.com/sammyboi1801/testimonia">Open source on GitHub</a> · No tracking, no ads
        </p>
      </footer>
    </div>
  );
}
