/**
 * A C4 card reads as C4 draws it: a person looks like one, and every element
 * shows its description under its name, since that description is half of
 * what the diagram says.
 */
import { describe, expect, test } from "bun:test";
import { findFormat } from "../../src/domain/formats.ts";
import { NODE_H } from "../../src/domain/layout/graph.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { cardMarkup } from "../../src/domain/render/svg.ts";
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
    expect(cardOf(SHOP, "P1").blurb).toEqual(["Achète en ligne, depuis", "le site"]);
  });

  test("is cut to three lines, the last ending with …", () => {
    const blurb = cardOf(SHOP, "S1").blurb ?? [];
    expect(blurb).toHaveLength(3);
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
    const name = Number(/class="card-label[^"]*"[^>]*><tspan x="[^"]+" y="([\d.]+)"/.exec(svg)?.[1]);
    const blurb = Number(/class="card-blurb"[^>]*><tspan x="[^"]+" y="([\d.]+)"/.exec(svg)?.[1]);
    expect(blurb).toBeGreaterThan(name);
  });

  test("leaves the nodes as they were when no element has one", () => {
    const bare = SHOP.split("\n")
      .filter((line) => !line.startsWith("detail"))
      .join("\n");
    expect(new Set(cards(bare).map((c) => c.h))).toEqual(new Set([NODE_H]));
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
