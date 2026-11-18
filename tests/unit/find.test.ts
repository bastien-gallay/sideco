import { describe, expect, test } from "bun:test";
import { findCards, mentions, resolvedDiscussions } from "../../src/web/view.ts";
import { ORDERING, table } from "../support.ts";

describe("finding a card by its id or its words", () => {
  const t = table(ORDERING);
  t.do({ kind: "annotate", board: "commande", id: "C2", detail: "Règle : réserver avant de payer" });
  const board = t.board();

  test("an id finds that card first, whatever its case", () => {
    expect(findCards(board, "e1")[0]).toBe("E1");
  });

  test("words find the cards whose label holds them, accents and case aside", () => {
    expect(findCards(board, "reserve")).toEqual(["P1", "C2", "E2"]);
    expect(findCards(board, "STOCK MANQUE")).toEqual(["H1"]);
  });

  test("a card found by its detail comes after those found by their label", () => {
    expect(findCards(board, "payer")).toEqual(["C2"]);
    expect(findCards(board, "réserver")).toEqual(["P1", "C2"]);
  });

  test("nothing to look for finds nothing", () => {
    expect(findCards(board, "  ")).toEqual([]);
    expect(findCards(board, "licorne")).toEqual([]);
  });
});

describe("the ids named in a message become links to what they name", () => {
  test("a known id is cut out of the words around it", () => {
    expect(mentions("Relis N37 puis C2, merci", new Set(["N37", "C2"]))).toEqual([
      "Relis ",
      { id: "N37" },
      " puis ",
      { id: "C2" },
      ", merci",
    ]);
  });

  test("an id nobody knows stays words", () => {
    expect(mentions("Voir T99.", new Set(["T1"]))).toEqual(["Voir T99."]);
    expect(mentions("", new Set())).toEqual([]);
  });
});

describe("resolved discussions stay within reach", () => {
  test("they are listed apart, the latest opened first, with what was said", () => {
    const t = table(ORDERING);
    t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human");
    t.do({ kind: "note", board: "commande", text: "Et le paiement ?" }, "human");
    t.do({ kind: "note", board: "commande", text: "Encore ouverte" }, "human");
    t.script('reply N1 "Le stock"');
    t.script("resolve N1");
    t.script("resolve N2");
    const resolved = resolvedDiscussions(t.board());
    expect(resolved.map((d) => d.id)).toEqual(["N2", "N1"]);
    expect(resolved[1]?.on).toEqual({ id: "P1", label: "Quand commande passée, réserver le stock" });
    expect(resolved[1]?.notes.map((n) => n.text)).toEqual(["Qui réserve ?", "Le stock"]);
  });
});
