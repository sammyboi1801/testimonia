import { useSearchParams } from "react-router-dom";
import { Bookshelf } from "../components/Bookshelf";
import { TimelineView } from "../components/Timeline";

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "timeline" ? "timeline" : "shelf";
  const setView = (v: "shelf" | "timeline") =>
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
    <div className={view === "timeline" ? "page page-wide" : "page page-shelf"}>
      <div className="library-head">
        <h1>Library</h1>
        <div className="seg view-switch" role="tablist" aria-label="View">
          <button className={view === "shelf" ? "on" : ""} onClick={() => setView("shelf")}>
            Bookshelf
          </button>
          <button className={view === "timeline" ? "on" : ""} onClick={() => setView("timeline")}>
            Timeline
          </button>
        </div>
      </div>
      {view === "timeline" ? <TimelineView /> : <Bookshelf />}
    </div>
  );
}
