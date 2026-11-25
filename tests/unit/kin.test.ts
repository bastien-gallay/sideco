import { expect, test } from "bun:test";
import { headOf, kinMark, kinOf, kinSaid, toJoin } from "../../src/domain/kin.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { cardMarkup } from "../../src/domain/render/svg.ts";
import { table } from "../support.ts";

/** The ids of a board made by SPLIT, in the order its cards were added. */
const idsOf = (board: { elements: { id: string }[] }) =>
  board.elements.map((e) => e.id) as [string, string, string, string, string];

const SPLIT = `
board new "Sprint" --format kanban --id sprint
add story "Payer en ligne" --alias pay
add task "Brancher la banque" --from @pay --lane done --alias bank
add task "Écran de paiement" --from @pay --lane doing
add task "Relire le contrat"
add story "Suivre un colis"
`;

test("a story knows its tasks and how many are done; a task knows its story (S323)", () => {
  const board = table(SPLIT).board();
  const [pay, bank, screen, alone, track] = idsOf(board);
  expect(kinOf(board, pay)).toMatchObject({ parent: undefined, children: [bank, screen], done: 1 });
  expect(kinOf(board, bank).parent).toBe(pay);
  expect(kinOf(board, screen).parent).toBe(pay);
  // A task on its own and a story not split yet have no kin: nothing is said of them.
  expect(kinOf(board, alone)).toEqual({
    parent: undefined,
    others: 0,
    children: [],
    done: 0,
    gathered: false,
  });
  expect(kinSaid(board, alone ?? "", "en")).toBeUndefined();
  expect(kinSaid(board, track ?? "", "en")).toBeUndefined();
});

test("it is said in words, in each language", () => {
  const board = table(SPLIT).board();
  const [pay, bank] = idsOf(board);
  expect(kinSaid(board, pay ?? "", "en")).toBe("1 of 2 tasks done");
  expect(kinSaid(board, pay ?? "", "fr")).toBe("1 tâche faite sur 2");
  expect(kinSaid(board, bank ?? "", "en")).toBe(`splits ${pay} Payer en ligne`);
  expect(kinSaid(board, bank ?? "", "fr")).toBe(`découpe ${pay} Payer en ligne`);
});

test("a link that is not a split says nothing: a task leading to a task, a story to a blocker", () => {
  const t = table(`${SPLIT}add blocker "Banque fermée" --lane doing`);
  const board = t.board();
  const [pay, bank, screen] = idsOf(board);
  const blocker = board.elements.at(-1)?.id ?? "";
  t.do({ kind: "link", board: "sprint", src: bank, dst: screen });
  t.do({ kind: "link", board: "sprint", src: pay ?? "", dst: blocker });
  expect(kinOf(t.board(), screen).parent).toBe(pay);
  expect(kinOf(t.board(), pay).children).toEqual([bank, screen]);
  expect(kinOf(t.board(), blocker).parent).toBeUndefined();
});

test("the card wears it beside its id, and its tooltip says it", () => {
  const board = table(SPLIT).board();
  const [pay, bank] = idsOf(board);
  const cards = layoutBoard(board).cards;
  const story = cards.find((c) => c.id === pay);
  const task = cards.find((c) => c.id === bank);
  if (!story || !task) throw new Error("the cards are drawn");
  expect(story.kin).toBe("1/2");
  expect(task.kin).toBe(`↳ ${pay}`);
  expect(cardMarkup(story)).toMatch(/<text class="card-kin" x="\d+" y="14" fill="#1F2328">1\/2<\/text>/);
  expect(cardMarkup(task)).toContain(`>↳ ${pay}</text>`);
  expect(story.tip).toEndWith(" · 1 of 2 tasks done");
  expect(task.tip).toEndWith(` · splits ${pay} Payer en ligne`);
  // A card without kin wears nothing more.
  const alone = cards.find((c) => c.label === "Relire le contrat");
  expect(alone?.kin).toBeUndefined();
  expect(alone && cardMarkup(alone)).not.toContain("card-kin");
});

test("only a workshop that says its link is a split shows kin: a retro's action is not a task of its point", () => {
  const board = table(
    'board new "Rétro" --format retro --id retro\nadd point "Lent" --alias p\nadd action "Mesurer" --from @p',
  ).board();
  const [point, action] = board.elements.map((e) => e.id);
  expect(kinOf(board, point ?? "")).toMatchObject({ parent: undefined, others: 0, children: [], done: 0 });
  expect(kinSaid(board, action ?? "", "en")).toBeUndefined();
});

test("a task that splits two stories names the first and says there is another", () => {
  const t = table(SPLIT);
  const [pay, bank, , , track] = idsOf(t.board());
  t.script(`link ${track} ${bank}`);
  const kin = kinOf(t.board(), bank ?? "");
  expect(kin).toMatchObject({ parent: pay, others: 1 });
  expect(kinMark(kin)).toBe(`↳ ${pay} +1`);
  expect(kinSaid(t.board(), bank ?? "", "en")).toBe(`splits ${pay} Payer en ligne, and 1 other`);
  expect(kinSaid(t.board(), bank ?? "", "fr")).toBe(`découpe ${pay} Payer en ligne, et 1 autre`);
});

const SAME = `
board new "Rétro" --format retro --id retro
add point "Trop de réunions" --lane went-badly --alias head
add point "Réunions trop longues" --lane went-badly --alias long
add point "Réunions sans ordre du jour" --lane went-badly --alias agenda
add point "Bonne entraide" --lane went-well
add action "Un ordre du jour partout" --from @agenda
link @head @long
link @head @agenda
`;

test("in a retro, a point linked to a point says the same: one counts them, the others name it (S327)", () => {
  const board = table(SAME).board();
  const [head, long, agenda, alone, action] = idsOf(board);
  expect(kinOf(board, head)).toMatchObject({ parent: undefined, children: [long, agenda], gathered: true });
  expect(kinMark(kinOf(board, head))).toBe("+2");
  expect(kinMark(kinOf(board, long))).toBe(`↳ ${head}`);
  expect(kinSaid(board, head ?? "", "en")).toBe("2 others say the same");
  expect(kinSaid(board, long ?? "", "fr")).toBe(`dit la même chose que ${head} Trop de réunions`);
  // The action made of a point is led to, not gathered: it says nothing here.
  expect(kinMark(kinOf(board, action ?? ""))).toBeUndefined();
  expect(kinMark(kinOf(board, alone ?? ""))).toBeUndefined();
  expect(kinOf(board, agenda).children).toEqual([]);
});

test("the cards chosen have a head when one of them takes all the others; only those not linked yet are joined (S327)", () => {
  const board = table(SAME).board();
  const [head, long, agenda, alone, action] = idsOf(board);
  expect(headOf(board, [long, alone])).toBe(long);
  expect(toJoin(board, [long, alone])).toEqual([alone]);
  // An action is not gathered with observations: no head, nothing offered.
  expect(headOf(board, [long, action])).toBeUndefined();
  // Linked already, either way: nothing left to join.
  expect(toJoin(board, [head, long, agenda])).toEqual([]);
  expect(toJoin(board, [long, head])).toEqual([]);
  const sprint = table(SPLIT).board();
  const [pay, , , lone] = idsOf(sprint);
  expect(headOf(sprint, [lone, pay])).toBe(pay);
  expect(toJoin(sprint, [lone, pay])).toEqual([lone]);
});
