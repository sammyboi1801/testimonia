import { useSearchParams } from "react-router-dom";
import { Chat } from "../components/Chat";

/** /ask — the study assistant full-page (?about=John.1.18 starts from a verse). */
export function AskPage() {
  const [params] = useSearchParams();
  const about = params.get("about");
  const context = about ? about.replace(/^([1-4]?[A-Za-z]+)\.(\d+)\.(\d+)$/, "$1 $2:$3") : null;
  return (
    <div className="page ask-page">
      <Chat context={context} />
    </div>
  );
}
