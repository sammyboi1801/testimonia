// Mapping a text selection in the reader to character offsets in the verse text, so a highlighted phrase can be
// stored as numbers and drawn again later. Footnote letters (sup.fn) are part of the page but not of the verse
// text, so they are skipped.

/** [start, end) of `range` within the verse text of `container`, or null when nothing of it is selected. */
export function rangeOffsets(container: HTMLElement, range: Range): { start: number; end: number } | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("sup.fn") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let acc = 0;
  let start = -1;
  let end = -1;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (range.intersectsNode(n)) {
      const s = n === range.startContainer ? range.startOffset : 0;
      const e = n === range.endContainer ? range.endOffset : len;
      if (start < 0) start = acc + s;
      end = acc + e;
    }
    acc += len;
  }
  return start >= 0 && end > start ? { start, end } : null;
}

/** Trim a selection to whole words: no stray spaces or half-words at either end. */
export function snapToWords(text: string, start: number, end: number): { start: number; end: number } {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  while (s > 0 && /[\p{L}\p{M}’'-]/u.test(text[s - 1]!) && /[\p{L}\p{M}]/u.test(text[s]!)) s--;
  while (e < text.length && /[\p{L}\p{M}’'-]/u.test(text[e]!) && /[\p{L}\p{M}]/u.test(text[e - 1]!)) e++;
  return { start: s, end: e };
}
