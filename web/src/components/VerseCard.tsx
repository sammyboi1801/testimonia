import { useEffect, useRef, useState } from "react";
import { useBackClose } from "../backClose";

/** A verse as an image, set in the app's style, to share on WhatsApp, Instagram and the like. */

export interface CardVerse {
  text: string;
  label: string; // "John 3:16"
  edition: string | null; // "BSB"
  url: string; // where it opens in the app
}

const SIZES = { post: { w: 1080, h: 1350, label: "Post" }, story: { w: 1080, h: 1920, label: "Story" } } as const;
type Size = keyof typeof SIZES;

const INK = "#2a2118";
const ACCENT = "#9a5b2e";
const MUTED = "#8a7660";

let logo: Promise<HTMLImageElement | null> | null = null;
const loadLogo = () =>
  (logo ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/favicon.svg";
  }));

/** Lines of `text` that fit `width` at the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

async function draw(canvas: HTMLCanvasElement, v: CardVerse, size: Size) {
  const { w, h } = SIZES[size];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  await Promise.all([
    document.fonts.load('400 60px "EB Garamond"'),
    document.fonts.load('600 60px "Cormorant Garamond"'),
    document.fonts.load('italic 600 60px "Cormorant Garamond"'),
  ]).catch(() => undefined);

  // parchment: a warm light from the top left, deepening to the edges
  const bg = ctx.createRadialGradient(w * 0.25, h * 0.05, 0, w * 0.4, h * 0.3, h * 1.05);
  bg.addColorStop(0, "#fdf8ee");
  bg.addColorStop(0.55, "#f4e9d5");
  bg.addColorStop(1, "#e4cfac");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // a fine inner rule, like a printed page
  ctx.strokeStyle = "rgba(154, 91, 46, 0.28)";
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, w - 96, h - 96);

  // the mark
  const img = await loadLogo();
  const top = 120;
  if (img) ctx.drawImage(img, w / 2 - 36, top, 72, 72);
  ctx.fillStyle = ACCENT;
  ctx.font = '600 30px "Cormorant Garamond", Georgia, serif';
  ctx.textAlign = "center";
  ctx.letterSpacing = "8px";
  ctx.fillText("TESTIMONIA", w / 2 + 4, top + 122);
  ctx.letterSpacing = "0px";

  // the verse: as large as fits
  const text = `“${v.text.trim().replace(/^[“"]|[”"]$/g, "")}”`;
  const boxW = w - 220;
  const boxTop = top + 200;
  const boxH = h - boxTop - 300;
  let px = size === "story" ? 92 : 76;
  let lines: string[] = [];
  for (; px >= 34; px -= 2) {
    ctx.font = `400 ${px}px "EB Garamond", Georgia, serif`;
    lines = wrap(ctx, text, boxW);
    if (lines.length * px * 1.42 <= boxH) break;
  }
  const lead = px * 1.42;
  const blockH = lines.length * lead;
  let y = boxTop + (boxH - blockH) / 2 + px;
  ctx.fillStyle = INK;
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += lead;
  }

  // the reference, under a short rule
  y += 34;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 40, y - 30);
  ctx.lineTo(w / 2 + 40, y - 30);
  ctx.stroke();
  ctx.fillStyle = ACCENT;
  ctx.font = 'italic 600 52px "Cormorant Garamond", Georgia, serif';
  ctx.fillText(v.label, w / 2, y + 30);
  if (v.edition) {
    ctx.fillStyle = MUTED;
    ctx.font = '400 28px "EB Garamond", Georgia, serif';
    ctx.letterSpacing = "4px";
    ctx.fillText(v.edition.toUpperCase(), w / 2 + 2, y + 78);
    ctx.letterSpacing = "0px";
  }

  // where to read more
  ctx.fillStyle = MUTED;
  ctx.font = '400 28px "EB Garamond", Georgia, serif';
  ctx.fillText("testimonia.web.app", w / 2, h - 108);
}

export function VerseCard({ verse, onClose }: { verse: CardVerse; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>("post");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useBackClose(true, onClose);

  useEffect(() => {
    let alive = true;
    const c = canvas.current;
    if (!c) return;
    void draw(c, verse, size).then(() => {
      if (alive) setPreview(c.toDataURL("image/png"));
    });
    return () => {
      alive = false;
    };
  }, [verse, size]);

  const fileName = `${verse.label.replace(/[^\w]+/g, "-").replace(/-+$/, "").toLowerCase()}.png`;
  const blob = () => new Promise<Blob | null>((res) => canvas.current?.toBlob(res, "image/png") ?? res(null));

  const share = async () => {
    setBusy(true);
    try {
      const b = await blob();
      if (!b) return;
      const file = new File([b], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: verse.label, text: verse.url });
      else save(b);
    } catch {
      /* the reader closed the share sheet */
    } finally {
      setBusy(false);
    }
  };
  const save = (b: Blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="vcard-layer" onClick={onClose}>
      <div className="vcard-sheet" role="dialog" aria-label={`Image card for ${verse.label}`} onClick={(e) => e.stopPropagation()}>
        <div className="vcard-head">
          <div className="vcard-sizes" role="tablist">
            {(Object.keys(SIZES) as Size[]).map((s) => (
              <button key={s} role="tab" aria-selected={size === s} className={size === s ? "on" : ""} onClick={() => setSize(s)}>
                {SIZES[s].label}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={`vcard-preview ${size}`}>{preview ? <img src={preview} alt={`${verse.label}: ${verse.text}`} /> : <div className="skel" />}</div>
        <canvas ref={canvas} hidden />
        <div className="vcard-actions">
          <button className="btn primary" onClick={() => void share()} disabled={!preview || busy}>
            Share
          </button>
          <button className="btn" onClick={() => void blob().then((b) => b && save(b))} disabled={!preview}>
            Save image
          </button>
        </div>
      </div>
    </div>
  );
}
