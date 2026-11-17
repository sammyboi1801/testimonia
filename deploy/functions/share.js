// Shared verse links that look good wherever they are pasted.
//   /v/John.3.16       a tiny page whose preview tags (Open Graph) carry the verse and its picture; people are sent
//                      straight on to the verse in the reader
//   /og/John.3.16.png  that picture: the verse set in the app's style, 1200×630 (made once, then kept by the CDN)
//   /v/John.3.16-John.3.18 and /og/John.3.16-John.3.18.png  the same for a passage (one book, up to 40 verses)
// The verse text comes from the site's own static files, so nothing here touches the Testimonia server.
const fs = require("fs");
const path = require("path");
const satori = require("satori").default;
const { Resvg } = require("@resvg/resvg-js");

const SITE = "https://testimonia.web.app";
const EDITIONS = ["bsb", "web", "kjva", "brenton", "dra"]; // the first that has the verse
const font = (f) => fs.readFileSync(path.join(__dirname, "fonts", f));
const FONTS = [
  { name: "EB Garamond", data: font("eb-garamond-latin-400-normal.woff"), weight: 400, style: "normal" },
  { name: "EB Garamond", data: font("eb-garamond-latin-ext-400-normal.woff"), weight: 400, style: "normal" },
  { name: "Cormorant", data: font("cormorant-garamond-latin-600-normal.woff"), weight: 600, style: "normal" },
  { name: "Cormorant", data: font("cormorant-garamond-latin-600-italic.woff"), weight: 600, style: "italic" },
];
const MARK = `data:image/svg+xml;base64,${font("mark.svg").toString("base64")}`;
const OSIS = /^([1-4]?[A-Za-z]+)\.(\d{1,3})\.(\d{1,3})$/;
// a passage: John.3.16-John.3.18, or across chapters of one book (John.3.36-John.4.2)
const RANGE = /^([1-4]?[A-Za-z]+)\.(\d{1,3})\.(\d{1,3})-\1\.(\d{1,3})\.(\d{1,3})$/;
const MAX_VERSES = 40;
const MAX_CHAPTERS = 3;

let books = null; // osis -> name, from the site's library summary
async function bookName(osis) {
  if (!books) {
    const r = await fetch(`${SITE}/data/lib/meta.json`);
    const meta = await r.json();
    books = Object.fromEntries(meta.books.map((b) => [b.osis, b.name]));
    books.__editions = Object.fromEntries(meta.editions.map((e) => [e.id, e.abbrev || e.id.toUpperCase()]));
  }
  return books[osis] || osis;
}

/** The verse's text in the first edition that has it: { text, edition }. */
async function verseText(osis) {
  const r = await fetch(`${SITE}/data/verse/${encodeURIComponent(osis)}.json`);
  if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return null;
  const g = await r.json();
  for (const id of EDITIONS) {
    const t = (g.texts || []).find((x) => x.edition_id === id);
    if (t && t.text) return { text: t.text.trim(), edition: t.abbrev || id.toUpperCase() };
  }
  const any = (g.texts || []).find((x) => x.language === "eng" && x.text);
  return any ? { text: any.text.trim(), edition: any.abbrev || any.edition_id } : null;
}

const getJson = async (p) => {
  const r = await fetch(`${SITE}/data/${p}`);
  return r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null;
};

/** A passage's text, verse after verse, in the first edition that has all of it: { text, edition }. */
async function passageText(book, c1, v1, c2, v2) {
  const chapters = [];
  for (let c = c1; c <= c2; c++) chapters.push(c);
  const bases = await Promise.all(chapters.map((c) => getJson(`chapter/${book}/${c}.json`)));
  if (bases.some((b) => !b || !b.present)) return null;
  const keys = [];
  bases.forEach((b, i) => {
    for (const v of b.verses) {
      const c = chapters[i];
      if ((c > c1 || v.verse >= v1) && (c < c2 || v.verse <= v2)) keys.push(String(v.vkey));
    }
  });
  if (!keys.length || keys.length > MAX_VERSES) return null;
  const ed = EDITIONS.find((e) => bases.every((b) => b.present.includes(e)));
  if (!ed) return null;
  const texts = await Promise.all(chapters.map((c) => getJson(`text/${ed}/${book}/${c}.json`)));
  const all = Object.assign({}, ...texts.map((t) => t || {}));
  const text = keys.map((k) => (all[k] && all[k].text ? all[k].text.trim() : "")).filter(Boolean).join(" ");
  if (!text) return null;
  await bookName(book);
  return { text, edition: books.__editions[ed] || ed.toUpperCase() };
}

/** "John 3:16", "John 3:16–18", "John 3:36–4:2" */
const label = (name, c1, v1, c2, v2) => (c1 === c2 && v1 === v2 ? `${name} ${c1}:${v1}` : c1 === c2 ? `${name} ${c1}:${v1}–${v2}` : `${name} ${c1}:${v1}–${c2}:${v2}`);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const readerUrl = (book, c1, v1, c2, v2) => {
  const osis = `${book}.${c1}.${v1}`;
  // the reader marks a range within one chapter (?to=); across chapters it opens at the first verse
  const to = c1 === c2 && v2 > v1 ? `&to=${v2}` : "";
  return `/read/${book}/${c1}?v=${osis}${to}#v${v1}`;
};

/** "John.3.16" or "John.3.16-John.3.18" -> [book, c1, v1, c2, v2], or null. */
function parseRef(ref) {
  let m = ref.match(OSIS);
  if (m) return [m[1], +m[2], +m[3], +m[2], +m[3]];
  m = ref.match(RANGE);
  if (!m) return null;
  const [book, c1, v1, c2, v2] = [m[1], +m[2], +m[3], +m[4], +m[5]];
  if (c2 < c1 || (c2 === c1 && v2 < v1) || c2 - c1 >= MAX_CHAPTERS) return null;
  return [book, c1, v1, c2, v2];
}

/** The picture: parchment, the mark, the verse as large as it fits, the reference under a short rule. */
async function card(ref, text, edition) {
  const t = text.length > 420 ? `${text.slice(0, 410).replace(/\s+\S*$/, "")}…` : text;
  const size = t.length < 110 ? 50 : t.length < 200 ? 42 : t.length < 300 ? 36 : 31;
  const el = (type, style, children) => ({ type, props: { style, children } });
  const tree = el(
    "div",
    {
      width: 1200, height: 630, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "56px 110px", position: "relative",
      backgroundImage: "radial-gradient(circle at 22% 10%, #fdf8ee 0%, #f4e9d5 55%, #e4cfac 100%)",
      fontFamily: "EB Garamond", color: "#2a2118",
    },
    [
      el("div", { position: "absolute", top: 28, left: 28, right: 28, bottom: 28, border: "2px solid rgba(154,91,46,0.26)", display: "flex" }, []),
      el("div", { position: "absolute", top: 46, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 14 }, [
        { type: "img", props: { src: MARK, width: 38, height: 38 } },
        el("div", { fontFamily: "Cormorant", fontWeight: 600, fontSize: 22, letterSpacing: 6, color: "#9a5b2e" }, "TESTIMONIA"),
      ]),
      el("div", { display: "flex", textAlign: "center", fontSize: size, lineHeight: 1.38, marginTop: 30 }, `“${t}”`),
      el("div", { width: 70, height: 2, backgroundColor: "#9a5b2e", marginTop: 30, display: "flex" }, []),
      el("div", { display: "flex", alignItems: "baseline", gap: 14, marginTop: 14 }, [
        el("div", { fontFamily: "Cormorant", fontStyle: "italic", fontWeight: 600, fontSize: 40, color: "#9a5b2e" }, ref),
        el("div", { fontSize: 20, letterSpacing: 3, color: "#8a7660" }, edition),
      ]),
    ],
  );
  const svg = await satori(tree, { width: 1200, height: 630, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}

async function handle(req, res) {
  const m = req.path.match(/^\/(v|og)\/(.+?)(\.png)?$/);
  const osis = m && decodeURIComponent(m[2]);
  const r = osis && parseRef(osis);
  if (!r) {
    res.status(404).send("Not a verse link");
    return;
  }
  const [book, c1, v1, c2, v2] = r;
  const single = c1 === c2 && v1 === v2;
  const [name, verse] = await Promise.all([bookName(book), single ? verseText(osis) : passageText(book, c1, v1, c2, v2)]);
  if (!verse) {
    res.redirect(302, readerUrl(book, c1, v1, c2, v2));
    return;
  }
  const ref = label(name, c1, v1, c2, v2);
  // shared pictures and pages never change: browsers keep them a day, the CDN for a year
  res.set("cache-control", "public, max-age=86400, s-maxage=31536000");
  if (m[1] === "og") {
    res.set("content-type", "image/png");
    res.send(await card(ref, verse.text, verse.edition));
    return;
  }
  const to = readerUrl(book, c1, v1, c2, v2);
  const quote = verse.text.length > 300 ? `${verse.text.slice(0, 290).replace(/\s+\S*$/, "")}…` : verse.text;
  const desc = `“${quote}” (${ref}, ${verse.edition})`;
  res.set("content-type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(ref)} | Testimonia</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Testimonia">
<meta property="og:title" content="${esc(ref)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}/v/${esc(osis)}">
<meta property="og:image" content="${SITE}/og/${esc(osis)}.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(desc)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${SITE}${esc(to)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>location.replace(${JSON.stringify(to)})</script>
</head><body style="font-family:Georgia,serif;background:#f6f1e7;color:#2a2118;padding:40px">
<p>${esc(desc)}</p><p><a href="${esc(to)}">Open ${esc(ref)} in Testimonia</a></p></body></html>`);
}

module.exports = { handle, card };
