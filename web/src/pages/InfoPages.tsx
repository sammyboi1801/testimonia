import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { sendFeedback } from "../sync";

const REPO = "https://github.com/sammyboi1801/testimonia";

function useTitle(title: string, noindex = false) {
  useEffect(() => {
    document.title = `${title} | Testimonia`;
    if (!noindex) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [title, noindex]);
}

/** What Testimonia is, where its texts come from, and a way to send feedback. */
export function AboutPage() {
  useTitle("About");
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);
  return (
    <div className="page info-page">
      <h1>About Testimonia</h1>
      <p className="info-lead">
        Testimonia is a free online study Bible. Read any chapter with the Greek and Hebrew behind it, what the early church wrote about each verse, the
        manuscripts, the places and the timeline.
      </p>

      <h2>What is inside</h2>
      <ul>
        <li>Translations side by side, with the Greek New Testament, the Hebrew Bible and the Septuagint.</li>
        <li>Every word linked to its lexicon entry, with its grammar in plain words.</li>
        <li>The church fathers and classic commentaries, verse by verse, with the earliest writers first.</li>
        <li>Manuscripts, including where the earliest copies leave out a verse.</li>
        <li>Maps of the places named in each chapter, people and rulers, and a timeline.</li>
        <li>An optional study assistant that answers from these sources and links to them.</li>
      </ul>

      <h2>Sources</h2>
      <p>
        Every text and dataset is in the public domain or openly licensed. Each one is <a href={`${REPO}/blob/main/CREDITS.md`}>credited in full</a> with its
        licence.
      </p>

      <h2>Open source</h2>
      <p>
        The code is free to use and change under the MIT licence, on <a href={REPO}>GitHub</a>. There are no ads and nothing to pay for. Read{" "}
        <Link to="/privacy">how your data is handled</Link>.
      </p>

      <Feedback />
    </div>
  );
}

function Feedback() {
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (message.trim().length < 3) return;
    setState("sending");
    const ok = await sendFeedback(message.trim(), contact);
    setState(ok ? "sent" : "failed");
    if (ok) setMessage("");
  }

  const issue = `${REPO}/issues/new?title=${encodeURIComponent("Feedback")}&body=${encodeURIComponent(message)}`;
  return (
    <section className="info-feedback" id="feedback">
      <h2>Send feedback</h2>
      <p className="muted">Found a mistake, something broken, or an idea? It goes straight to the person who builds this. No account needed.</p>
      {state === "sent" ? (
        <p className="info-thanks" role="status">
          Thank you. Your message was sent.{" "}
          <button className="link-btn" onClick={() => setState("idle")}>
            Send another
          </button>
        </p>
      ) : (
        <form onSubmit={submit}>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder="What did you notice? A verse reference helps."
            aria-label="Your message"
            required
          />
          <input
            type="email"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            maxLength={200}
            placeholder="Your email, only if you would like a reply"
            aria-label="Your email (optional)"
          />
          <div className="info-send">
            <button className="btn primary" type="submit" disabled={state === "sending" || message.trim().length < 3}>
              {state === "sending" ? "Sending…" : "Send"}
            </button>
            {state === "failed" && (
              <span className="muted" role="alert">
                That did not go through. You can <a href={issue}>open an issue on GitHub</a> instead.
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

/** Plain facts about what is stored, where, and what is sent. */
export function PrivacyPage() {
  useTitle("Privacy");
  return (
    <div className="page info-page">
      <h1>Privacy</h1>
      <p className="info-lead">Testimonia has no ads and sells nothing. Here is everything it stores and sends.</p>

      <h2>Without an account</h2>
      <p>
        Your notes, highlights, reading place and settings stay in this browser. Nothing about them is sent anywhere. Clearing your browser data removes
        them, so <Link to="/notes">export your notes</Link> if you want a copy.
      </p>

      <h2>Visit counts</h2>
      <p>
        Page visits are counted with <a href="https://www.goatcounter.com/">GoatCounter</a>, which sets no cookies and does not store your IP address. Each
        count sends the page address and title, the site that linked you here and your screen width. It never includes what you search for or write.
      </p>

      <h2>If you sign in</h2>
      <p>
        Signing in is optional. It keeps your notes, highlights, saved chats and settings in sync between your devices, stored with Google Firebase under
        your account. Only you can read them. Deleting your account (in the account menu) deletes them.
      </p>

      <h2>The study assistant</h2>
      <p>
        The assistant uses an AI provider you choose, with your own key. Your key stays in your browser and is never synced. When you ask a question, the
        question and your key pass through our server to that provider, which answers under its own privacy terms. Our server does not keep your questions.
        Your chats are saved in your browser, and in your account if you sign in.
      </p>

      <h2>Feedback</h2>
      <p>Messages sent from the About page are stored so they can be read and answered. Your email is included only if you add it.</p>

      <h2>Servers</h2>
      <p>
        The site is served by Google Firebase and Google Cloud. Like any web server, they keep short-lived technical logs (such as your IP address and the
        page requested) to run the service and keep it secure.
      </p>

      <h2>Questions</h2>
      <p>
        Ask through the <Link to="/about#feedback">feedback form</Link> or on <a href={`${REPO}/issues`}>GitHub</a>.
      </p>
    </div>
  );
}

/** Any address the app does not know. */
export function NotFoundPage() {
  useTitle("Page not found", true);
  const path = useLocation().pathname;
  return (
    <div className="page info-page info-missing">
      <h1>Page not found</h1>
      <p className="info-lead">
        There is nothing at <code>{path}</code>. The link may be old or mistyped.
      </p>
      <p>Type a passage or a word in the search box above, or go to:</p>
      <ul className="info-links">
        <li>
          <Link to="/read/John/1">Read the Bible</Link>
        </li>
        <li>
          <Link to="/library">The library</Link>
        </li>
        <li>
          <Link to="/">The front page</Link>
        </li>
      </ul>
    </div>
  );
}
