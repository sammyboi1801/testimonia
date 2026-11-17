import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichAnswer, linkKind } from "./components/RichAnswer";
import { SettingsProvider } from "./settings";

const books = [
  { osis: "John", name: "John" },
  { osis: "Gen", name: "Genesis" },
];

function draw(text: string, live = false): HTMLElement {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsProvider>
        <RichAnswer text={text} books={books} live={live} />
      </SettingsProvider>
    </QueryClientProvider>,
  );
  const box = document.createElement("div");
  box.innerHTML = html;
  return box;
}

describe("the assistant's answer, drawn richly", () => {
  it("knows what each link opens", () => {
    expect(linkKind("/read/John/1?v=John.1.1")).toBe("verse");
    expect(linkKind("/read/John/1?v=John.1.1&w=G3056")).toBe("word");
    expect(linkKind("/library/irenaeus.haer@anf01/12")).toBe("work");
    expect(linkKind("/atlas?place=corinth")).toBe("place");
    expect(linkKind("/place/corinth")).toBe("place");
    expect(linkKind("/person/paul")).toBe("person");
    expect(linkKind("/manuscript/GA:P66")).toBe("manuscript");
    expect(linkKind("https://doi.org/10.1/x")).toBe("external");
    expect(linkKind("/rulers")).toBe("page");
  });

  it("gives links a sign of what they open, and sends outside links to a new tab", () => {
    const box = draw("See [Corinth](/atlas?place=corinth), [Irenaeus](/library/irenaeus.haer@anf01/12) and [a study](https://doi.org/10.1/x).");
    expect(box.querySelector("a.cl-place svg")).not.toBeNull();
    expect(box.querySelector("a.cl-work")?.getAttribute("href")).toBe("/library/irenaeus.haer@anf01/12");
    const out = box.querySelector("a.cl-external")!;
    expect(out.getAttribute("target")).toBe("_blank");
    expect(out.getAttribute("rel")).toContain("noopener");
  });

  it("turns a verse on its own line into a card, but not a verse inside a sentence", () => {
    const box = draw("The key verse:\n\n[John 1:1](/read/John/1?v=John.1.1)\n\nAnd [Genesis 1:1](/read/Gen/1?v=Gen.1.1) echoes it.");
    expect(box.querySelectorAll("figure.ans-verse")).toHaveLength(1);
    expect(box.querySelector("figure.ans-verse figcaption a")?.textContent).toBe("John 1:1");
    expect(box.querySelector("p a.cl-verse")?.textContent).toBe("Genesis 1:1");
  });

  it("waits to make a card of the line still being written", () => {
    const box = draw("Look:\n\n[John 1:1](/read/John/1?v=John.1.1)", true);
    expect(box.querySelector("figure.ans-verse")).toBeNull();
    expect(draw("Look:\n\n[John 1:1](/read/John/1?v=John.1.1)", false).querySelector("figure.ans-verse")).not.toBeNull();
  });

  it("draws a quotation with its writer's name beneath", () => {
    const box = draw("> The Word was with God.\n>\n> — [Ignatius, To the Antiochians 4](/library/ign@anf01/4)");
    const q = box.querySelector("blockquote.ans-quote")!;
    expect(q.querySelector("p.ans-cite a.cl-work")?.textContent).toBe("Ignatius, To the Antiochians 4");
    expect(q.querySelectorAll("p:not(.ans-cite)")).toHaveLength(1);
  });

  it("shows Wikimedia images inline and leaves any other image as a link", () => {
    const box = draw("![Veronese, The Wedding at Cana](https://upload.wikimedia.org/x/cana.jpg)\n\n![tracker](https://evil.example/p.gif)");
    expect(box.querySelector(".ans-fig img")?.getAttribute("src")).toBe("https://upload.wikimedia.org/x/cana.jpg");
    expect(box.querySelector(".ans-fig .ans-cap")?.textContent).toBe("Veronese, The Wedding at Cana");
    expect(box.querySelector('img[src^="https://evil"]')).toBeNull();
    expect(box.querySelector('a[href="https://evil.example/p.gif"]')).not.toBeNull();
  });

  it("removes anything unsafe the model might write", () => {
    const box = draw('Hi <img src=x onerror="alert(1)"> <script>alert(2)</script> [x](javascript:alert(3))');
    expect(box.innerHTML).not.toContain("onerror");
    expect(box.innerHTML).not.toContain("<script");
    expect(box.innerHTML).not.toContain("javascript:");
  });

  it("plain references become verse links, as before", () => {
    expect(draw("As John 1:1 says.").querySelector("a.cl-verse")).not.toBeNull();
  });
});
