import type { Highlight, Note } from "../notes";

/** A verse's colour on the Notes page: its whole-verse highlight, else the colour of its highlighted words. */
export function colourOf(n: Note): Highlight | null {
  return n.highlight ?? n.marks?.[0]?.color ?? null;
}

export interface NoteGroup {
  notes: Note[]; // consecutive verses, in order
  colour: Highlight | null;
}

/**
 * One card per highlight: neighbouring verses in the same chapter with the same colour are one highlight (a
 * selection across verses is saved verse by verse). A group holds at most one written note, so every note keeps
 * its own box; a note without a highlight stands alone. `sorted` must be in Bible order.
 */
export function groupNotes(sorted: Note[]): NoteGroup[] {
  const groups: NoteGroup[] = [];
  for (const n of sorted) {
    const colour = colourOf(n);
    const g = groups[groups.length - 1];
    const last = g?.notes[g.notes.length - 1];
    if (g && last && colour && g.colour === colour && follows(last.osis, n.osis) && !(n.text.trim() && g.notes.some((m) => m.text.trim()))) {
      g.notes.push(n);
    } else {
      groups.push({ notes: [n], colour });
    }
  }
  return groups;
}

function follows(a: string, b: string): boolean {
  const [ba, ca, va] = a.split(".");
  const [bb, cb, vb] = b.split(".");
  return ba === bb && ca === cb && Number(vb) === Number(va) + 1;
}
