/**
 * A column folded by the reader (S307): a narrow band, its name upright with
 * its count, its cards put away. The fold is the reader's own: the page gives
 * it to the layout, the journal knows nothing of it.
 */
import { describe, expect, test } from "bun:test";
import { layoutBoard, locate, vacancy } from "../../src/domain/layout/index.ts";
import { bandMarkup } from "../../src/domain/render/svg.ts";
import { table } from "../support.ts";

const SPRINT = `
board new "Sprint" --format kanban --id sprint
add task "Brancher la banque" --lane todo
add task "Écran de paiement" --lane doing
add task "Relire le contrat" --lane doing
add task "Livrer" --lane done
`;
const board = () => table(SPRINT).board();
const lane = (scene: ReturnType<typeof layoutBoard>, id: string) => {
  const found = scene.bands.find((b) => b.kind === "lane" && b.id === id);
  if (!found) throw new Error(`no lane ${id}`);
  return found;
};

describe("a column folded by the reader (S307)", () => {
  test("is a narrow band that keeps its count and puts its cards away", () => {
    const open = layoutBoard(board(), "en", { span: 700, folded: new Set() });
    const scene = layoutBoard(board(), "en", { span: 700, folded: new Set(["doing"]) });
    expect(lane(scene, "doing")).toMatchObject({ w: 44, count: 2, folded: true });
    expect(lane(scene, "todo").folded).toBe(false);
    expect(scene.cards.map((c) => c.id)).toEqual(["T1", "T4"]);
    // The columns after it come nearer, and the open ones share the room it gave back.
    expect(lane(scene, "done").x).toBeLessThan(lane(open, "done").x);
    expect(lane(scene, "todo").w).toBeGreaterThan(lane(open, "todo").w);
    expect(scene.width).toBeLessThanOrEqual(700);
  });

  test("without a reader, as on paper, no column folds nor offers to", () => {
    const scene = layoutBoard(board(), "en", 1200);
    expect(lane(scene, "doing").folded).toBeUndefined();
    expect(bandMarkup(lane(scene, "doing"))).not.toContain("data-fold");
    expect(layoutBoard(board(), "en", 1200)).toEqual(layoutBoard(board(), "en", { span: 1200 }));
  });

  test("the cells of a plan do not fold", () => {
    const plan = table(
      'board new "Tri" --format impact-effort --id tri\nadd item "Cache" --lane quick',
    ).board();
    const scene = layoutBoard(plan, "en", { span: 1200, folded: new Set(["quick"]) });
    expect(lane(scene, "quick").folded).toBeUndefined();
    expect(scene.cards).toHaveLength(1);
  });

  test("a card dropped on it goes to its end, and nothing is offered to be added in it", () => {
    const seen = { span: 1200, folded: new Set(["doing"]) };
    const band = lane(layoutBoard(board(), "en", seen), "doing");
    const target = locate(board(), band.x + 20, band.y + 120, undefined, seen);
    expect(target).toEqual({ kind: "slot", lane: "doing", before: undefined });
    expect(vacancy(board(), target, seen)).toBeUndefined();
  });

  test("an open column offers to fold, a folded one to open, each by a button that says so", () => {
    const scene = layoutBoard(board(), "en", { span: 1200, folded: new Set(["doing"]) });
    const open = bandMarkup(lane(scene, "todo"));
    expect(open).toContain(
      'class="lane-fold" data-fold="todo" role="button" tabindex="0" aria-expanded="true"',
    );
    expect(open).toContain('aria-label="Fold the column To do"');
    const folded = bandMarkup(lane(scene, "doing"));
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).toContain('aria-label="Open the column Doing, 2 cards"');
    // Its name stands upright, and the whole band opens it.
    expect(folded).toMatch(/<text class="lane-label is-upright"[^>]*transform="rotate\(90 /);
    expect(folded).toMatch(/<rect class="lane-bg" data-fold="doing"/);
    expect(folded).toMatch(/<text class="lane-label is-upright"[^>]*data-fold="doing"/);
    const fr = layoutBoard(board(), "fr", { span: 1200, folded: new Set(["doing"]) });
    expect(bandMarkup(lane(fr, "doing"))).toContain('aria-label="Ouvrir la colonne En cours, 2 cartes"');
  });
});

test("a long name stands upright cut by whole characters, and its button says it whole", () => {
  const t = table(SPRINT).script('lane doing "12345678901234567890😀 en cours de recette"');
  const scene = layoutBoard(t.board(), "en", { span: 1200, folded: new Set(["doing"]) });
  const markup = bandMarkup(lane(scene, "doing"));
  expect(markup).toContain(">12345678901234567890😀…</text>");
  expect(markup.isWellFormed()).toBe(true);
  expect(markup).toContain(
    'aria-label="Open the column 12345678901234567890😀 en cours de recette, 2 cards"',
  );
});
