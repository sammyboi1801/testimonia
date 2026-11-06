import { useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMeta } from "../api";
import { osisLabel } from "../lib";

export const GITHUB_URL = "https://github.com/sammyboi1801/testimonia";
const LAST_READ = "testimonia.lastRead";
const COMMONS = "https://commons.wikimedia.org/wiki/File:";

/** Remember the chapter being read, so the front page can offer to continue there. */
export function rememberReading(book: string, chapter: number): void {
  try {
    localStorage.setItem(LAST_READ, JSON.stringify({ book, chapter }));
  } catch {
    /* private mode: nothing to remember */
  }
}

function lastReading(): { book: string; chapter: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_READ) ?? "null") as { book?: string; chapter?: number } | null;
    return v?.book && v.chapter ? { book: v.book, chapter: v.chapter } : null;
  } catch {
    return null;
  }
}

interface Picture {
  src: string;
  alt: string;
  caption: string;
  file: string; // Wikimedia Commons file name (source and licence)
  fit?: "contain"; // tall or fragile objects are shown whole, not cropped
  position?: string;
}

interface Entry {
  year: number;
  when: string;
  label: string;
  title: string;
  text: ReactNode;
  link: { to: string; label: string };
  picture?: Picture;
}

const ENTRIES: Entry[] = [
  {
    year: 70,
    when: "AD 70",
    label: "Jewish and Roman sources",
    title: "The fall of the Temple",
    text: (
      <>
        Roman forces under Titus destroy Jerusalem and its Temple. Josephus, who witnessed the siege, recorded it;
        his works, with those of Tacitus, Suetonius and Pliny, are in the library alongside the early Christian
        writers.
      </>
    ),
    link: { to: "/library?view=timeline", label: "Open the timeline" },
    picture: {
      src: "/landing/titus.jpg",
      alt: "Relief on the Arch of Titus showing the Temple menorah carried in triumph",
      caption: "Arch of Titus, Rome, c. AD 81. Photo: Laurel Lodged, public domain",
      file: "Carrying_off_the_Menorah_from_the_Temple_in_Jerusalem_depicted_on_a_frieze_on_the_Arch_of_Titus_in_the_Forum_Romanum.JPG",
      position: "50% 35%",
    },
  },
  {
    year: 108,
    when: "c. AD 108",
    label: "Church fathers",
    title: "Ignatius of Antioch",
    text: (
      <>
        On his way to Rome, Ignatius writes seven letters to the churches, drawing on the Gospels and Paul.
        Testimonia links quotations like his, from the first century to Augustine, to the verses they quote.
      </>
    ),
    link: { to: "/read/John/1?v=John.1.1&t=fathers", label: "Who quoted John 1:1" },
    picture: {
      src: "/landing/ignatius.jpg",
      alt: "Byzantine miniature of Ignatius of Antioch",
      caption: "Menologion of Basil II, c. AD 1000. Public domain",
      file: "Ignatius_of_Antioch_(Menologion_of_Basil_II).jpg",
    },
  },
  {
    year: 150,
    when: "c. AD 125–175",
    label: "Manuscripts",
    title: "The oldest fragment of the New Testament",
    text: (
      <>
        A scrap of papyrus with a few lines of John 18 on each side, found in Egypt and now in Manchester. It is the
        earliest surviving piece of any New Testament book.
      </>
    ),
    link: { to: "/read/John/18?v=John.18.31", label: "Read John 18:31" },
    picture: {
      src: "/landing/p52.jpg",
      alt: "Papyrus 52, a small fragment of the Gospel of John",
      caption: "Papyrus 52, John Rylands Library, Manchester. Public domain",
      file: "P52_recto.jpg",
      fit: "contain",
    },
  },
  {
    year: 200,
    when: "c. AD 200",
    label: "Textual variants",
    title: "Papyrus 66 and John 1:18",
    text: (
      <>
        An early papyrus codex of John reads “the only-begotten <em>God</em>” at John 1:18, where most later
        manuscripts read “the only-begotten <em>Son</em>”. Testimonia records around 15,000 places where the printed
        editions differ and explains each one.
      </>
    ),
    link: { to: "/read/John/1?v=John.1.18&t=text", label: "See the variant" },
    picture: {
      src: "/landing/p66.jpg",
      alt: "Papyrus 66, an early codex of the Gospel of John",
      caption: "Papyrus 66, Bibliotheca Bodmeriana, Cologny. Public domain",
      file: "Geneva,_Bodmer_Lab_Ms_Papyrus_66_(P.Bodmer_II_-_PB_2)_fol._1r.jpg",
    },
  },
  {
    year: 325,
    when: "AD 325",
    label: "Councils",
    title: "The Council of Nicaea",
    text: (
      <>
        Bishops from across the empire agree a creed, in a debate that turned on how to read passages such as John
        1:1. The library distinguishes the writers before Nicaea from those after it.
      </>
    ),
    link: { to: "/library?view=story", label: "Browse by century" },
    picture: {
      src: "/landing/nicaea.jpg",
      alt: "Icon of the First Council of Nicaea",
      caption: "Icon of the First Council of Nicaea. Public domain",
      file: "Nicaea_icon.jpg",
      position: "50% 20%",
    },
  },
  {
    year: 350,
    when: "c. AD 350",
    label: "The Greek text",
    title: "Codex Sinaiticus",
    text: (
      <>
        One of the oldest near-complete Bibles, written in Greek capitals on parchment. Its readings underlie the
        critical editions that Testimonia presents word by word, each word with its lexicon entry and grammar.
      </>
    ),
    link: { to: "/read/John/1?mode=interlinear", label: "John 1, interlinear" },
  },
  {
    year: 405,
    when: "AD 382–405",
    label: "Translations",
    title: "Jerome’s Vulgate",
    text: (
      <>
        Jerome translates the Scriptures into Latin from the Hebrew and Greek. The Vulgate is read alongside the
        Septuagint and English translations from Tyndale to the present day.
      </>
    ),
    link: { to: "/read/John/1", label: "Read in parallel" },
    picture: {
      src: "/landing/jerome.jpg",
      alt: "Caravaggio's painting of Saint Jerome writing",
      caption: "Caravaggio, Saint Jerome Writing, 1605–06. Galleria Borghese. Public domain",
      file: "Saint_Jerome_Writing-Caravaggio_(1605-6).jpg",
    },
  },
  {
    year: 1008,
    when: "AD 1008",
    label: "The Hebrew text",
    title: "The Leningrad Codex",
    text: (
      <>
        Copied in Cairo, it is the oldest complete manuscript of the Hebrew Bible. Its text, with every vowel and
        accent, is the Hebrew presented in Testimonia.
      </>
    ),
    link: { to: "/read/Gen/1?mode=original", label: "Genesis 1 in Hebrew" },
    picture: {
      src: "/landing/leningrad.jpg",
      alt: "Decorated carpet page of the Leningrad Codex",
      caption: "Leningrad Codex, carpet page. National Library of Russia. Public domain",
      file: "Leningrad_Codex_Carpet_Page_closeup.jpg",
    },
  },
  {
    year: 1611,
    when: "AD 1611",
    label: "English Bibles",
    title: "The King James Version",
    text: (
      <>
        The Authorised Version is published. Testimonia sets it beside Tyndale, the Geneva Bible, Douay–Rheims and
        modern translations, together with the translators’ own notes.
      </>
    ),
    link: { to: "/read/John/1", label: "Compare translations" },
    picture: {
      src: "/landing/kjv.jpg",
      alt: "Title page of the 1611 King James Bible",
      caption: "Title page of the first edition, 1611. Public domain",
      file: "King-James-Version-Bible-first-edition-title-page-1611.png",
      fit: "contain",
    },
  },
];

function Figure({ p, className }: { p: Picture; className?: string }) {
  return (
    <figure className={`lp-figure${p.fit === "contain" ? " contain" : ""}${className ? ` ${className}` : ""}`}>
      <div className="lp-image">
        <img src={p.src} alt={p.alt} loading="lazy" decoding="async" style={p.position ? { objectPosition: p.position } : undefined} />
      </div>
      <figcaption>
        <a href={COMMONS + p.file} target="_blank" rel="noreferrer">
          {p.caption}
        </a>
      </figcaption>
    </figure>
  );
}

/** The front page: what Testimonia is, and the history of the text it follows. */
export function HomePage() {
  const meta = useMeta();
  const last = useMemo(lastReading, []);
  const root = useRef<HTMLDivElement>(null);
  const yearRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const entries = [...el.querySelectorAll<HTMLElement>("[data-year]")];
    const history = el.querySelector<HTMLElement>(".lp-history");
    const reveal = new IntersectionObserver(
      (items) =>
        items.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("seen");
            reveal.unobserve(e.target);
          }
        }),
      { threshold: 0.15 },
    );
    el.querySelectorAll(".lp-reveal").forEach((n) => reveal.observe(n));

    let frame = 0;
    const update = () => {
      frame = 0;
      const mid = el.getBoundingClientRect().top + el.clientHeight * 0.45;
      let year = entries[0] ? Number(entries[0].dataset.year) : 70;
      for (let i = 0; i < entries.length; i++) {
        const a = entries[i]!.getBoundingClientRect().top;
        const b = entries[i + 1]?.getBoundingClientRect().top;
        if (mid < a) break;
        const ya = Number(entries[i]!.dataset.year);
        const yb = Number(entries[i + 1]?.dataset.year);
        year = b !== undefined && mid < b ? Math.round(ya + ((mid - a) / (b - a)) * (yb - ya)) : ya;
      }
      if (yearRef.current) yearRef.current.textContent = `AD ${year}`;
      if (history) {
        const r = history.getBoundingClientRect();
        history.style.setProperty("--progress", String(Math.min(1, Math.max(0, (mid - r.top) / r.height))));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      reveal.disconnect();
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const toHistory = (e: MouseEvent) => {
    e.preventDefault();
    root.current?.querySelector("#history")?.scrollIntoView({ behavior: "smooth" });
  };

  const books = meta.data?.books ?? [];
  const counts = meta.data?.counts;
  const begin = last ? `/read/${last.book}/${last.chapter}` : "/read/John/1";
  const beginLabel = last ? `Continue ${osisLabel(`${last.book}.${last.chapter}`, books)}` : "Start reading";

  return (
    <div className="lp" ref={root}>
      <section className="lp-hero">
        <div className="lp-hero-text">
          <p className="lp-kicker">Open-source Bible study library</p>
          <h1>The Bible and its earliest witnesses</h1>
          <p className="lp-lede">
            Read the Hebrew and Greek texts with their ancient and modern translations, see where the manuscripts
            differ, and find which early Christian writers quoted each verse, and when.
          </p>
          <div className="lp-actions">
            <Link to={begin} className="lp-btn lp-btn-primary">
              {beginLabel}
            </Link>
            <Link to="/library" className="lp-btn">
              Browse the library
            </Link>
          </div>
          <p className="lp-note">
            Free and open source · No account · Works on your phone ·{" "}
            <a href="#history" onClick={toHistory}>
              The history behind it ↓
            </a>
          </p>
        </div>
        <Figure
          className="lp-hero-figure"
          p={{
            src: "/landing/sinaiticus.jpg",
            alt: "A page of Codex Sinaiticus, written in four columns of Greek capitals",
            caption: "Codex Sinaiticus, 4th century. British Library. Photo: VistaSunset, CC0",
            file: "End_of_1_John_and_beginning_of_2_John_in_Sinaiticus.jpg",
          }}
        />
      </section>

      <section className="lp-history" id="history">
        <header className="lp-section-head lp-reveal">
          <p className="lp-kicker">Two thousand years of witnesses</p>
          <h2>How the text reached us, and where to find it in Testimonia</h2>
        </header>
        <div className="lp-timeline">
          <aside className="lp-clock" aria-hidden>
            <span ref={yearRef}>AD 70</span>
          </aside>
          <ol className="lp-entries">
            {ENTRIES.map((e) => (
              <li key={e.year} className={`lp-entry lp-reveal${e.picture ? "" : " text-only"}`} data-year={e.year}>
                <div className="lp-entry-text">
                  <p className="lp-when">
                    <strong>{e.when}</strong> · {e.label}
                  </p>
                  <h3>{e.title}</h3>
                  <p>{e.text}</p>
                  <Link to={e.link.to} className="lp-more">
                    {e.link.label} →
                  </Link>
                </div>
                {e.picture && <Figure p={e.picture} />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-close lp-reveal">
        <h2>All of it, side by side</h2>
        <p>
          {counts ? (
            <>
              {meta.data!.editions.length} texts and translations, {counts.works.toLocaleString()} early writings,{" "}
              {counts.citations.toLocaleString()} quotations of Scripture and {counts.commentary.toLocaleString()}{" "}
              verse comments, linked verse by verse.
            </>
          ) : (
            <>Texts, translations, manuscripts and early writers, linked verse by verse.</>
          )}{" "}
          Notes and highlights are kept in your browser, and an optional assistant can search the library with an AI
          key of your own.
        </p>
        <div className="lp-actions">
          <Link to={begin} className="lp-btn lp-btn-primary">
            {beginLabel}
          </Link>
          <a href={GITHUB_URL} className="lp-btn">
            View on GitHub
          </a>
        </div>
      </section>

      <footer className="lp-foot">
        <span>
          Built on openly licensed data, <a href={`${GITHUB_URL}/blob/main/CREDITS.md`}>credited in full</a>. Images
          from Wikimedia Commons (public domain or CC0).
        </span>
        <span>
          <a href={GITHUB_URL}>GitHub</a> · MIT licence
        </span>
      </footer>
    </div>
  );
}
