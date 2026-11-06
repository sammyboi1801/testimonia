import { Link, useSearchParams } from "react-router-dom";
import { Bookshelf } from "../components/Bookshelf";
import { ReadingLinks } from "../components/ReadingLinks";
import { StoryView } from "../components/Story";
import { TimelineView } from "../components/Timeline";

type View = "shelf" | "timeline" | "story";
const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "shelf", label: "Bookshelf", hint: "Authors by era" },
  { id: "timeline", label: "Timeline", hint: "Zoomable chart of people and events" },
  { id: "story", label: "Story", hint: "Century by century, top to bottom" },
];

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("view");
  const view: View = raw === "timeline" || raw === "story" ? raw : "shelf";
  const setView = (v: View) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v === "shelf") n.delete("view");
        else n.set("view", v);
        n.delete("sel");
        return n;
      },
      { replace: true },
    );

  return (
    <div className={view === "timeline" ? "page page-wide" : view === "story" ? "page page-story" : "page page-shelf"}>
      <div className="library-head">
        <h1>Library</h1>
        <div className="seg view-switch" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? "on" : ""} title={v.hint} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
          <Link to="/atlas" className="seg-link" title="Map of the places of the Bible">
            Atlas
          </Link>
        </div>
        <ReadingLinks />
        <Link to="/manuscripts" className="library-aside-link" title="Papyri, codices and Dead Sea Scrolls">
          Manuscripts →
        </Link>
      </div>
      {view === "timeline" ? <TimelineView /> : view === "story" ? <StoryView /> : <Bookshelf />}
    </div>
  );
}
