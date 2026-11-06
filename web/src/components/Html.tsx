import DOMPurify from "dompurify";
import { useMemo, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { isStrong, parseOsis, verseUrl } from "../lib";

const ALLOWED_ATTR = ["class", "data-ref", "data-t", "data-n", "lang", "href", "title", "dir", "id"];

/** Move inline footnotes (<span class="note">) to a numbered list at the end, leaving superscript markers. */
function liftFootnotes(html: string, idPrefix: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;
  const notes = [...root.querySelectorAll("span.note")];
  if (!notes.length) return html;
  const list = doc.createElement("ol");
  list.className = "footnotes";
  notes.forEach((note, i) => {
    const n = i + 1;
    const marker = doc.createElement("sup");
    marker.className = "fn-marker";
    marker.innerHTML = `<a href="#${idPrefix}-fn${n}" id="${idPrefix}-ref${n}">${n}</a>`;
    const li = doc.createElement("li");
    li.id = `${idPrefix}-fn${n}`;
    li.innerHTML = note.innerHTML;
    list.appendChild(li);
    note.replaceWith(marker);
  });
  root.appendChild(list);
  return root.innerHTML;
}

/**
 * Renders HTML that comes from source datasets (lexicons, commentaries, ancient works) safely:
 * sanitised with DOMPurify, footnotes lifted to the end, and Scripture / Strong's links turned
 * into in-app navigation.
 */
export function Html({
  html,
  className,
  onWord,
  footnotes = false,
  idPrefix = "n",
}: {
  html: string;
  className?: string;
  onWord?: (strong: string) => void;
  footnotes?: boolean;
  idPrefix?: string;
}) {
  const navigate = useNavigate();
  const clean = useMemo(() => {
    const safe = DOMPurify.sanitize(html, { ALLOWED_ATTR, FORBID_TAGS: ["style", "script", "iframe", "form", "img"] });
    return footnotes ? liftFootnotes(safe, idPrefix) : safe;
  }, [html, footnotes, idPrefix]);

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const ref = a.getAttribute("data-ref") ?? a.getAttribute("data-t");
    if (ref) {
      const target = ref.replace(/^LXX\./, "");
      if (isStrong(target)) {
        e.preventDefault();
        if (onWord) onWord(target);
        return;
      }
      const osis = parseOsis(target) ? target : /^[1-4]?[A-Za-z]+\.\d+$/.test(target) ? `${target}.1` : null;
      if (osis) {
        e.preventDefault();
        navigate(verseUrl(osis));
        return;
      }
    }
    const href = a.getAttribute("href");
    if (href?.startsWith("#")) {
      e.preventDefault();
      document.getElementById(href.slice(1))?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (href && /^https?:/.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  }

  return <div className={`html ${className ?? ""}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: clean }} />;
}
