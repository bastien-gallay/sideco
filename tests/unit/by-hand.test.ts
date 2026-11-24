import { describe, expect, test } from "bun:test";
import { describeBoard, describeCard, describeChanges } from "../../src/domain/digest.ts";
import { type Card, layoutBoard, type Scene } from "../../src/domain/layout/index.ts";
import { FLOW, KANBAN, table } from "../support.ts";

// The flow of support.ts: F1 → D1 → F2 (oui) and F3 (non), F2 → O1, F3 → D1.
const card = (scene: Scene, id: string): Card => {
  const found = scene.cards.find((c) => c.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
};
const where = (scene: Scene, id: string) => ({ x: card(scene, id).x, y: card(scene, id).y });
const overlaps = (a: Card, b: Card): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("a diagram placed by hand (S344)", () => {
  test("placing one card puts the whole board by hand: the card goes there, the others stay where they were", () => {
    const t = table(FLOW);
    const before = layoutBoard(t.board());
    t.script("place F3 600 40", "human");
    const after = layoutBoard(t.board());
    expect(t.board().byHand).toBe(true);
    expect(where(after, "F3")).toEqual({ x: 600, y: 40 });
    for (const id of ["F1", "D1", "F2", "O1"]) expect(where(after, id)).toEqual(where(before, id));
  });

  test("by hand, a card keeps the size the links gave it: every node as tall as the others", () => {
    const t = table(FLOW);
    const auto = layoutBoard(t.board());
    t.script("place F3 600 40", "human");
    const hand = layoutBoard(t.board());
    for (const c of auto.cards)
      expect({ w: card(hand, c.id).w, h: card(hand, c.id).h }).toEqual({ w: c.w, h: c.h });
  });

  test("by hand, a link drawn moves no card, and every link is a curve from card to card", () => {
    const t = table(FLOW).script("place F3 600 40", "human");
    const before = layoutBoard(t.board());
    t.script("link O1 F1");
    const after = layoutBoard(t.board());
    for (const c of before.cards) expect(where(after, c.id)).toEqual({ x: c.x, y: c.y });
    expect(after.connectors).toHaveLength(t.board().edges.length);
    for (const link of after.connectors) expect(link.d).toContain("C");
  });

  test("the page may place several cards at once: those it sees where they are drawn", () => {
    const t = table(FLOW);
    t.do({
      kind: "place",
      board: "livraison",
      cards: [
        { id: "F1", x: 40, y: 40 },
        { id: "D1", x: 300, y: 40 },
      ],
    });
    const scene = layoutBoard(t.board());
    expect(where(scene, "D1")).toEqual({ x: 300, y: 40 });
  });

  test("auto gives the drawing by the links back, and keeps the places made by hand for the way back", () => {
    const t = table(FLOW);
    const auto = layoutBoard(t.board());
    t.script("place F3 600 40", "human").script("placing auto", "human");
    expect(t.board().byHand).toBeUndefined();
    expect(layoutBoard(t.board())).toEqual(auto);
    t.script("placing hand", "human");
    expect(where(layoutBoard(t.board()), "F3")).toEqual({ x: 600, y: 40 });
  });

  test("a card added while the board is auto takes, by hand, the place the links gave it", () => {
    const t = table(FLOW).script("place F3 600 40", "human").script("placing auto", "human");
    t.script('add step "Relancer" --from F3');
    const auto = layoutBoard(t.board());
    t.script("placing hand", "human");
    expect(where(layoutBoard(t.board()), "F4")).toEqual(where(auto, "F4"));
  });

  test("a card added by hand goes under the card it comes from, at the first free place (D4)", () => {
    const t = table(FLOW).script("place F3 600 40", "human");
    t.script('add step "Relancer" --from D1');
    const scene = layoutBoard(t.board());
    const d1 = card(scene, "D1");
    const f4 = card(scene, "F4");
    expect(f4.y).toBeGreaterThan(d1.y + d1.h);
    for (const other of scene.cards) if (other.id !== "F4") expect(overlaps(f4, other)).toBe(false);
    expect(t.board().elements.find((e) => e.id === "F4")?.at).toEqual({ x: f4.x, y: f4.y });
  });

  test("one undo takes the placing back whole: the board is auto again, with no place kept", () => {
    const t = table(FLOW);
    const auto = layoutBoard(t.board());
    t.script("place F3 600 40", "human").script("undo", "human");
    expect(t.board().byHand).toBeUndefined();
    expect(t.board().elements.every((e) => e.at === undefined)).toBe(true);
    expect(layoutBoard(t.board())).toEqual(auto);
  });

  test("a board of rows and columns places its cards itself", () => {
    expect(() => table(KANBAN).script("place K1 10 10")).toThrow("place");
  });

  test("a place off the board is refused", () => {
    expect(() => table(FLOW).script("place F3 -5 40")).toThrow();
  });

  test("Claude reading a Snap diagram is told so, and where each card stands; not once it is back to its links", () => {
    const t = table(FLOW).script("place F3 600 40", "human");
    expect(describeBoard(t.board()).split("\n")[0]).toContain("(flow, Snap, seq");
    expect(describeBoard(t.board())).toContain('F3 step "Commander au fournisseur" at 600,40');
    expect(describeCard(t.board(), "F3")).toContain("at 600,40");
    t.script("placing auto", "human");
    expect(describeBoard(t.board())).not.toContain("Snap");
    expect(describeBoard(t.board())).not.toContain("at 600,40");
  });

  test("Claude reads the card placed and the board gone by hand, not every card that kept its place", () => {
    const t = table(FLOW);
    const mark = t.seq;
    t.script("place F3 600 40", "human");
    expect(describeChanges(t.events, mark).text).toBe(
      'board livraison "Livraison"\n  ~ cards placed by hand\n  → F3 placed at 600,40',
    );
    const later = t.seq;
    t.script("place F3 640 40\nplacing auto", "human");
    expect(describeChanges(t.events, later).text).toBe(
      'board livraison "Livraison"\n  → F3 placed at 640,40\n  ~ cards placed by their links',
    );
  });

  test("the Snap switch of the page says how wide the board is too: a folded flow stays folded", () => {
    const steps = Array.from({ length: 11 }, (_, i) => `add step "Étape ${i + 2}" --from F${i + 1}`);
    const t = table(
      ['board new "Chaîne" --format flow --id chaine', 'add step "Étape 1"', ...steps].join("\n"),
    );
    const folded = layoutBoard(t.board(), "en", 1400);
    t.do({ kind: "placing", board: "chaine", byHand: true, span: 1400 }, "human");
    const scene = layoutBoard(t.board());
    for (const c of folded.cards) expect(where(scene, c.id)).toEqual(where(folded, c.id));
  });

  test("the page says how wide the board is: the cards keep the place a folded flow gave them", () => {
    const steps = Array.from({ length: 11 }, (_, i) => `add step "Étape ${i + 2}" --from F${i + 1}`);
    const t = table(
      ['board new "Chaîne" --format flow --id chaine', 'add step "Étape 1"', ...steps].join("\n"),
    );
    const folded = layoutBoard(t.board(), "en", 1400);
    const whole = layoutBoard(t.board());
    // Folded, some card stands elsewhere than in the one column drawn without a width.
    expect(folded.cards.some((c) => c.x !== card(whole, c.id).x)).toBe(true);
    t.do({ kind: "place", board: "chaine", cards: [{ id: "F1", x: 40, y: 40 }], span: 1400 }, "human");
    const scene = layoutBoard(t.board());
    for (const c of folded.cards) if (c.id !== "F1") expect(where(scene, c.id)).toEqual(where(folded, c.id));
  });
});
