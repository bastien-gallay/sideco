import { describe, expect, test } from "bun:test";
import { linkRows } from "../../src/web/link-rows.ts";
import { FLOW, KANBAN, table } from "../support.ts";

describe("the links of a card, as its Detail tab lists them (S310)", () => {
  const board = table(FLOW).board();

  test("the links it leads by first, then those it comes by, each with the card at its other end", () => {
    expect(linkRows(board, "D1")).toEqual([
      { src: "D1", dst: "F2", out: true, other: "F2 Expédier", label: "oui" },
      { src: "D1", dst: "F3", out: true, other: "F3 Commander au fournisseur", label: "non" },
      { src: "F1", dst: "D1", out: false, other: "F1 Recevoir la commande", label: undefined },
      { src: "F3", dst: "D1", out: false, other: "F3 Commander au fournisseur", label: "à réception" },
    ]);
  });

  test("a card without links has none to list", () => {
    expect(linkRows(table(KANBAN).board(), "T1")).toEqual([]);
  });
});
