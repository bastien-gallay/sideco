/**
 * The page's search: the same finding as `sideco find`, ordered for who is
 * looking at a board: its own cards first, the one named by its id at the top,
 * then the other boards', each with the board it is on.
 */
import { describe, expect, test } from "bun:test";
import { findHits } from "../../src/web/view.ts";
import { FLOW, KANBAN, table } from "../support.ts";

const ids = (hits: ReturnType<typeof findHits>): string[] => hits.map((hit) => `${hit.board} ${hit.id}`);

describe("the page's search", () => {
  test("the board shown comes first, then the others in their order, each hit with its board's title", () => {
    const t = table(KANBAN).script(FLOW).script('add task "Commande groupée"', "human", "sprint");
    const hits = findHits(t.ws, "commande", "sprint");
    expect(ids(hits)).toEqual(["sprint T5", "livraison F1", "livraison F3"]);
    expect(hits.map((hit) => [hit.title, hit.here])).toEqual([
      ["Sprint 12", true],
      ["Livraison", false],
      ["Livraison", false],
    ]);
  });

  test("on its board, the card named by the id comes before those that cite it", () => {
    const t = table(KANBAN).script('detail T1 "Avant T2."');
    expect(ids(findHits(t.ws, "t2", "sprint"))).toEqual(["sprint T2", "sprint T1"]);
  });

  test("a card named by the words comes before one where they are only in its detail", () => {
    const t = table(KANBAN).script('detail T1 "Publier ensuite."');
    const hits = findHits(t.ws, "publier", "sprint");
    expect(ids(hits)).toEqual(["sprint T4", "sprint T1"]);
    expect(hits[1]?.where).toEqual({ in: "detail", text: "Publier ensuite." });
  });

  test("a note on the board itself is not a card to go to; nothing typed finds nothing", () => {
    const t = table(KANBAN).script('note "Publier vendredi"');
    expect(ids(findHits(t.ws, "vendredi", "sprint"))).toEqual([]);
    expect(findHits(t.ws, "  ", "sprint")).toEqual([]);
  });
});
