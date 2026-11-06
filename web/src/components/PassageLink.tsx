import { Link } from "react-router-dom";
import { passageUrl } from "../studyLib";

/**
 * A quiet link to the passage guide of the section a verse belongs to (the server expands a single verse to its
 * section). `variant`: "panel" under the study panel's heading, "heading" beside a section heading in the reader,
 * "outline" beside a heading in a book's outline.
 */
export function PassageLink({ osis, end, title, variant = "panel" }: { osis: string; end?: string; title?: string; variant?: "panel" | "heading" | "outline" }) {
  const label = variant === "panel" ? "Study this passage →" : variant === "heading" ? "Passage guide" : "guide";
  return (
    <Link
      className={`passage-link pl-${variant}`}
      to={passageUrl(osis, end)}
      aria-label={title ? `Passage guide: ${title}` : "Passage guide for this section"}
      title="Variants, the fathers, cross references and notes for the whole section"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </Link>
  );
}
