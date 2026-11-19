import { describe, expect, test } from "bun:test";
import { parseMarkdown } from "../../src/web/markdown.ts";

describe("a detail read as simple markdown", () => {
  test("plain words are one paragraph, and its lines stay lines", () => {
    expect(parseMarkdown("Paiement par carte.\nVirement refusé.")).toEqual([
      {
        kind: "p",
        lines: [
          [{ kind: "text", text: "Paiement par carte." }],
          [{ kind: "text", text: "Virement refusé." }],
        ],
      },
    ]);
  });

  test("an empty line parts two paragraphs", () => {
    expect(parseMarkdown("Un.\n\nDeux.").map((b) => b.kind)).toEqual(["p", "p"]);
  });

  test("bold, italic and code inside a line", () => {
    expect(parseMarkdown("**Règle** : *jamais* `null`")).toEqual([
      {
        kind: "p",
        lines: [
          [
            { kind: "strong", children: [{ kind: "text", text: "Règle" }] },
            { kind: "text", text: " : " },
            { kind: "em", children: [{ kind: "text", text: "jamais" }] },
            { kind: "text", text: " " },
            { kind: "code", text: "null" },
          ],
        ],
      },
    ]);
  });

  test("a link keeps its words and its address", () => {
    expect(parseMarkdown("Voir [la doc](https://example.org/a?b=1).")[0]).toEqual({
      kind: "p",
      lines: [
        [
          { kind: "text", text: "Voir " },
          { kind: "link", href: "https://example.org/a?b=1", children: [{ kind: "text", text: "la doc" }] },
          { kind: "text", text: "." },
        ],
      ],
    });
  });

  test("a link to anything but the web or a mail stays words", () => {
    expect(parseMarkdown("[clic](javascript:alert(1))")).toEqual([
      { kind: "p", lines: [[{ kind: "text", text: "[clic](javascript:alert(1))" }]] },
    ]);
  });

  test("HTML is shown as written, never read as markup", () => {
    expect(parseMarkdown("<b>gras</b> <img src=x onerror=alert(1)>")).toEqual([
      { kind: "p", lines: [[{ kind: "text", text: "<b>gras</b> <img src=x onerror=alert(1)>" }]] },
    ]);
  });

  test("a list with dashes, and one with numbers", () => {
    expect(parseMarkdown("- un\n- **deux**\n\n1. premier\n2. second")).toEqual([
      {
        kind: "ul",
        items: [
          [{ kind: "text", text: "un" }],
          [{ kind: "strong", children: [{ kind: "text", text: "deux" }] }],
        ],
      },
      {
        kind: "ol",
        start: 1,
        items: [[{ kind: "text", text: "premier" }], [{ kind: "text", text: "second" }]],
      },
    ]);
  });

  test("a list right under a line of text starts its own block", () => {
    expect(parseMarkdown("Étapes :\n* payer\n* livrer").map((b) => b.kind)).toEqual(["p", "ul"]);
  });

  test("a numbered list keeps its first number", () => {
    expect(parseMarkdown("3. trois\n4. quatre")[0]).toMatchObject({ kind: "ol", start: 3 });
  });

  test("a fenced block is code, as written, markup and all", () => {
    expect(parseMarkdown("Avant\n```\nif (a) **b**\n  retrait\n```\nAprès")).toEqual([
      { kind: "p", lines: [[{ kind: "text", text: "Avant" }]] },
      { kind: "pre", text: "if (a) **b**\n  retrait" },
      { kind: "p", lines: [[{ kind: "text", text: "Après" }]] },
    ]);
  });

  test("a fence never closed runs to the end", () => {
    expect(parseMarkdown("```ts\nconst a = 1;")).toEqual([{ kind: "pre", text: "const a = 1;" }]);
  });

  test("a mark never closed stays as typed", () => {
    expect(parseMarkdown("2 * 3 = 6, **presque")).toEqual([
      { kind: "p", lines: [[{ kind: "text", text: "2 * 3 = 6, **presque" }]] },
    ]);
  });

  test("an underscore inside a word is not italic", () => {
    expect(parseMarkdown("snake_case_name")).toEqual([
      { kind: "p", lines: [[{ kind: "text", text: "snake_case_name" }]] },
    ]);
  });

  test("bold inside a link, code inside bold", () => {
    expect(parseMarkdown("**voir `x`**")[0]).toEqual({
      kind: "p",
      lines: [
        [
          {
            kind: "strong",
            children: [
              { kind: "text", text: "voir " },
              { kind: "code", text: "x" },
            ],
          },
        ],
      ],
    });
  });

  test("nothing written, nothing shown", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n")).toEqual([]);
  });
});
