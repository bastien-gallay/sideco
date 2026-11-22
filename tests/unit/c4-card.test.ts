/**
 * A C4 card reads as C4 draws it: a person looks like one, and every element
 * shows its description under its name, since that description is half of
 * what the diagram says.
 */
import { describe, expect, test } from "bun:test";
import { PAGE_STYLE } from "../../src/domain/export/html.ts";
import { findFormat } from "../../src/domain/formats.ts";
import { NODE_H } from "../../src/domain/layout/graph.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { KIND_H, PERSON_HEAD } from "../../src/domain/layout/scene.ts";
import { cardMarkup, SVG_STYLE } from "../../src/domain/render/svg.ts";
import { table } from "../support.ts";

const SHOP = `
board new "Boutique" --format c4-context --id boutique
add person "Client"
detail P1 "Achète **en ligne**, depuis [le site](https://example.com)"
add system "Boutique" --from P1 --edge "passe commande"
detail S1 "Catalogue, panier, paiement, suivi des commandes et des retours, factures envoyées par mail"
add external "Stripe" --from S1 --edge "encaisse via"
`;

const cards = (script: string) => layoutBoard(table(script).board()).cards;
const cardOf = (script: string, id: string) => {
  const found = cards(script).find((c) => c.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
};

describe("a C4 person", () => {
  test("has a shape of its own", () => {
    expect(findFormat("c4-context")?.types.find((t) => t.id === "person")?.shape).toBe("person");
  });

  test("is drawn with a head and shoulders above its name, inside the card", () => {
    const svg = cardMarkup(cardOf(SHOP, "P1"));
    expect(svg).toContain('class="card-person"');
    expect(svg).toMatch(/<circle [^>]*r="/);
    expect(cardMarkup(cardOf(SHOP, "S1"))).not.toContain("card-person");
  });
});

describe("a C4 card's description", () => {
  test("shows under the name, as plain words: the detail's marks are left out", () => {
    expect(cardOf(SHOP, "P1").blurb).toEqual(["Achète en ligne, depuis le", "site"]);
  });

  test("is shown whole when it holds in five lines, on a card wider than a sticky", () => {
    const s1 = cardOf(SHOP, "S1");
    expect(s1.w).toBe(200);
    expect(s1.blurb?.join(" ")).toBe(
      "Catalogue, panier, paiement, suivi des commandes et des retours, factures envoyées par mail",
    );
  });

  test("is cut to five lines past that, the last ending with …", () => {
    const long = "Encaisse les paiements par carte et rembourse. ".repeat(4);
    const blurb = cardOf(`${SHOP}\ndetail X1 "${long}"`, "X1").blurb ?? [];
    expect(blurb).toHaveLength(5);
    expect(blurb.at(-1)?.endsWith("…")).toBe(true);
  });

  test("makes every node of the board as tall as the one that says the most, so the rows stay even", () => {
    const all = cards(SHOP);
    const heights = new Set(all.map((c) => c.h));
    expect(heights.size).toBe(1);
    expect(all[0]?.h).toBeGreaterThan(NODE_H);
    expect(cardOf(SHOP, "X1").blurb).toBeUndefined();
  });

  test("is drawn smaller than the name, under it", () => {
    const svg = cardMarkup(cardOf(SHOP, "P1"));
    expect(svg).toContain('class="card-blurb"');
    // In full ink: at 11px on the grey of an external system, a faded line fell under 4.5:1.
    const rule = /\.card-blurb \{[^}]*\}/.exec(SVG_STYLE)?.[0];
    expect(rule).toBeDefined();
    expect(rule).not.toContain("opacity");
    const name = Number(/class="card-label[^"]*"[^>]*><tspan x="[^"]+" y="([\d.]+)"/.exec(svg)?.[1]);
    const blurb = Number(/class="card-blurb"[^>]*><tspan x="[^"]+" y="([\d.]+)"/.exec(svg)?.[1]);
    expect(blurb).toBeGreaterThan(name);
  });

  test("adds nothing to the nodes when no element has one: they hold the name, the kind and the head", () => {
    const bare = SHOP.split("\n")
      .filter((line) => !line.startsWith("detail"))
      .join("\n");
    expect(new Set(cards(bare).map((c) => c.h))).toEqual(new Set([NODE_H + KIND_H + PERSON_HEAD]));
  });

  test("stays off the cards of other workshops: a flow's detail is only marked", () => {
    const flow = cardOf(
      `board new "Parcours" --format flow --id parcours
add step "Payer"
detail S1 "Par carte"`,
      "S1",
    );
    expect(flow.blurb).toBeUndefined();
    expect(flow.hasDetail).toBe(true);
  });
});

describe("a C4 card is drawn as c4model draws it now (Q1)", () => {
  const tone = "light-dark(var(--tone-light), var(--tone-dark))";

  test("an outline in the colour of its kind, on the page, not a filled box", () => {
    const svg = cardMarkup(cardOf(SHOP, "P1"));
    expect(svg).toContain('<g class="card-outline" style="--tone-light:#08427B;--tone-dark:#8EC1F5">');
    const rule = /\.card-outline \.card-shape \{[^}]*\}/.exec(SVG_STYLE)?.[0] ?? "";
    expect(rule).toContain("fill: var(--sideco-bg, #FFFFFF)");
    expect(rule).toContain(`stroke: ${tone}`);
  });

  test("its words in that colour too, its name in bold", () => {
    const words = /\.card-outline > text[^{]*\{[^}]*\}/.exec(SVG_STYLE)?.[0] ?? "";
    expect(words).toContain(`fill: ${tone}`);
    expect(/\.card-outline \.card-label \{[^}]*\}/.exec(SVG_STYLE)?.[0]).toContain("font-weight: 600");
  });

  test("other workshops keep their stickies", () => {
    const flow = cards(`board new "Parcours" --format flow --id parcours\nadd step "Payer"`)[0];
    expect(flow && cardMarkup(flow)).not.toContain("card-outline");
  });

  test("the published page says it may be dark, so the outline takes its dark tone there", () => {
    expect(PAGE_STYLE).toContain(":root { color-scheme: light dark;");
  });

  // WCAG 2.2 AA: 4.5:1 for words of 11 to 13 px, which share the outline's colour.
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };
  const kinds = findFormat("c4-context")?.types ?? [];

  test.each(kinds.map((k) => [k.id, k.fill, k.dark ?? "#000000"]))(
    "%s reads at 4.5:1 or more on white, and on the dark page and export (T219)",
    (_, light, dark) => {
      expect(contrast(light, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      for (const page of ["#17191D", "#15181C"]) expect(contrast(dark, page)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("a C4 card says what it is", () => {
  const yOf = (svg: string, cls: string): number =>
    Number(new RegExp(`class="${cls}[^"]*"[^>]*><tspan x="[^"]+" y="([\\d.]+)"`).exec(svg)?.[1]);

  test("its kind in brackets, between its name and its description, in the reader's language", () => {
    const p1 = layoutBoard(table(SHOP).board(), "fr").cards.find((c) => c.id === "P1");
    expect(p1?.kind).toBe("[Personne]");
    const svg = p1 ? cardMarkup(p1) : "";
    expect(svg).toContain(">[Personne]</tspan>");
    expect(yOf(svg, "card-kind")).toBeGreaterThan(yOf(svg, "card-label"));
    expect(yOf(svg, "card-blurb")).toBeGreaterThan(yOf(svg, "card-kind"));
  });

  test("a person's head and shoulders stand at least 24 px tall, above the name", () => {
    const svg = cardMarkup(cardOf(SHOP, "P1"));
    const mark =
      /<g class="card-person"[^>]*><circle cx="[^"]+" cy="([\d.]+)" r="([\d.]+)"\/><path d="M[\d.]+ ([\d.]+)a/.exec(
        svg,
      );
    const [cy, r, foot] = [Number(mark?.[1]), Number(mark?.[2]), Number(mark?.[3])];
    expect(foot - (cy - r)).toBeGreaterThanOrEqual(24);
    // The name's baseline, less the height of its letters, clears the shoulders.
    expect(yOf(svg, "card-label") - 12).toBeGreaterThan(foot);
  });
});
