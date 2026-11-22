/**
 * One letter per concept in the whole project (T215). A card minted before
 * under another letter, or an id an older journal gave on two boards, takes the
 * next id of its letter: `sideco renumber --all` settles them in one batch.
 */
import { expect, test } from "bun:test";
import { fromModel } from "../../src/domain/export/model.ts";
import { renumbering } from "../../src/domain/letters.ts";
import { sharedIds } from "../../src/domain/minting.ts";
import { apply, findElement } from "../../src/domain/workspace.ts";
import { T0, type Table, table } from "../support.ts";

/** What an older journal left: a card under an id this Sideco would not give. */
function older(t: Table, board: string, id: string, type: string): void {
  apply(t.ws, {
    seq: t.ws.seq + 1,
    ts: T0,
    actor: "agent",
    event: "ElementAdded",
    board,
    id,
    type,
    label: `Ancienne ${id}`,
    col: 1,
    lane: "",
  });
}

test("a card with the letter of its kind and an id of its own stays as it is", () => {
  const t = table(`board new "Flux" --format flow --id flux
add step "Commencer"
add decision "Prêt ?"`);
  expect(findElement(t.board(), "F1")?.type).toBe("step");
  expect(renumbering(t.ws)).toEqual([]);
});

test("a card minted under a former letter takes the next id of its kind's letter", () => {
  const t = table(`board new "Flux" --format flow --id flux
add step "Commencer"`);
  older(t, "flux", "S1", "step");
  older(t, "flux", "S2", "step");
  expect(renumbering(t.ws)).toEqual([
    { board: "flux", id: "S1", to: "F2", why: "letter" },
    { board: "flux", id: "S2", to: "F3", why: "letter" },
  ]);
});

test("an id on two boards stays on the kanban, whose ids the commits cite", () => {
  const t = table(`board new "Carte" --format story-map --id carte
add task "Choisir"
board new "Archive" --format kanban --id archive`);
  older(t, "archive", "T1", "task");
  expect(sharedIds(t.ws)).toEqual([{ id: "T1", boards: ["archive", "carte"] }]);
  expect(renumbering(t.ws)).toEqual([
    { board: "carte", id: "T1", to: "T2", why: "shared", keptBy: "archive" },
  ]);
});

test("between two boards of other kinds, the one made first keeps the id", () => {
  const t = table(`board new "Un" --format flow --id un
add decision "Prêt ?"
board new "Deux" --format flow --id deux`);
  older(t, "deux", "D1", "decision");
  expect(renumbering(t.ws)).toEqual([{ board: "deux", id: "D1", to: "D2", why: "shared", keptBy: "un" }]);
});

test("a card under a former letter leaves the id it shares to the other board", () => {
  const t = table(`board new "Carte" --format story-map --id carte
add story "Lire"
board new "Flux" --format flow --id flux`);
  older(t, "flux", "S1", "step");
  expect(renumbering(t.ws)).toEqual([{ board: "flux", id: "S1", to: "F1", why: "letter" }]);
});

test("renumber --all applies the plan in one batch, links and former ids following", () => {
  const t = table(`board new "Flux" --format flow --id flux
add decision "Prêt ?"`);
  older(t, "flux", "S1", "step");
  t.script("link S1 D1");
  for (const r of renumbering(t.ws)) t.do({ kind: "renumber", board: r.board, id: r.id, to: r.to });
  expect(findElement(t.board(), "F1")?.formerIds).toEqual(["S1"]);
  expect(t.board().edges).toMatchObject([{ src: "F1", dst: "D1" }]);
  expect(renumbering(t.ws)).toEqual([]);
});

test("an id chosen under a former letter is taken, unless another kind of the format holds it now", () => {
  const retro = table(`board new "Rétro" --format retro --id retro
add point "Ancien" --id K4
add point "Plus ancien" --id P5`);
  expect(findElement(retro.board(), "K4")?.type).toBe("point");
  expect(findElement(retro.board(), "P5")?.type).toBe("point");
  const storming = table(`board new "Commande" --id commande`);
  expect(() => storming.script(`add actor "Client" --id X9`)).toThrow("an actor id starts with P");
});

test("a file written under the former letters is read under the new ones, its links following", () => {
  const t = table();
  const file = {
    version: 2,
    title: "Ancien",
    elements: [
      { id: "X1", type: "actor", label: "Client", col: 1 },
      { id: "P1", type: "policy", label: "Quand payé, livrer", col: 2 },
      { id: "E1", type: "event", label: "Payé", col: 2 },
    ],
    edges: [
      { src: "X1", dst: "E1" },
      { src: "E1", dst: "P1" },
    ],
  };
  for (const command of fromModel(file, "ancien", t.ws)) t.do(command);
  const board = t.ws.boards.find((b) => b.id === "ancien");
  expect(board?.elements.map((e) => `${e.id}:${e.type}`)).toEqual(["P1:actor", "R1:policy", "E1:event"]);
  expect(board?.edges).toMatchObject([
    { src: "P1", dst: "E1" },
    { src: "E1", dst: "R1" },
  ]);
});
