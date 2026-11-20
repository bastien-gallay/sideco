/**
 * C4, level 1: who uses the system, and what it depends on. Persons, the
 * system, the systems outside it, and labelled links, drawn top-down on the
 * graph layout of a flow, and exported in Mermaid's own C4 notation.
 */
import { describe, expect, test } from "bun:test";
import { describeBoard } from "../../src/domain/digest.ts";
import { toMermaid } from "../../src/domain/export/mermaid.ts";
import { findFormat } from "../../src/domain/formats.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { table } from "../support.ts";

const SHOP = `
board new "Boutique" --format c4-context --id boutique
add person "Client"
detail P1 "Achète en ligne"
add system "Boutique" --from P1 --edge "passe commande"
detail S1 "Catalogue, panier, paiement"
add external "Stripe" --from S1 --edge "encaisse via"
add external "Brevo" --from S1 --edge "envoie les mails via"
`;

describe("a C4 system context", () => {
  test("has persons, the system and external systems, on the graph layout", () => {
    const format = findFormat("c4-context");
    expect(format?.layout).toBe("graph");
    expect(format?.types.map((t) => [t.id, t.prefix])).toEqual([
      ["person", "P"],
      ["system", "S"],
      ["external", "X"],
    ]);
    expect(
      table(SHOP)
        .board()
        .elements.map((e) => e.id),
    ).toEqual(["P1", "S1", "X1", "X2"]);
  });

  test("ranks the person above the system, and the system above what it depends on", () => {
    const cards = layoutBoard(table(SHOP).board()).cards;
    const y = (id: string): number => cards.find((c) => c.id === id)?.y ?? Number.NaN;
    expect(y("P1")).toBeLessThan(y("S1"));
    expect(y("S1")).toBeLessThan(y("X1"));
    expect(y("X1")).toBe(y("X2"));
  });

  test("exports to Mermaid's C4 notation: the detail is the description, links say what they do", () => {
    expect(toMermaid(table(SHOP).board())).toBe(
      [
        "C4Context",
        "  title Boutique",
        '  Person(P1, "Client", "Achète en ligne")',
        '  System(S1, "Boutique", "Catalogue, panier, paiement")',
        '  System_Ext(X1, "Stripe")',
        '  System_Ext(X2, "Brevo")',
        '  Rel(P1, S1, "passe commande")',
        '  Rel(S1, X1, "encaisse via")',
        '  Rel(S1, X2, "envoie les mails via")',
      ].join("\n"),
    );
  });

  test("a quote in a name does not end the Mermaid string; a link without a label still relates", () => {
    const t = table(SHOP).script('add external "Le \\"vieux\\" ERP"\nlink P1 X3');
    const out = toMermaid(t.board());
    expect(out).toContain(`System_Ext(X3, "Le 'vieux' ERP")`);
    expect(out).toContain('Rel(P1, X3, "")');
  });

  test("the agent reads the elements and the links as on a flow", () => {
    const said = describeBoard(table(SHOP).board());
    expect(said).toContain('P1 person "Client"');
    expect(said).toContain('S1 -> X1 "encaisse via"');
  });
});
