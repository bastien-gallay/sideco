import { expect, test } from "bun:test";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { sharedIds } from "../../src/domain/minting.ts";
import { apply } from "../../src/domain/workspace.ts";
import { T0, table } from "../support.ts";

const TWO_KANBANS = `
board new "A" --format kanban --id a
add task "Un"
add task "Deux"
board new "B" --format kanban --id b
`;

test("an id is given once in the whole project: the next one is above every board's", () => {
  const t = table(TWO_KANBANS);
  expect(t.do({ kind: "add", board: "b", type: "task", label: "Trois" })).toBe("T3");
  expect(t.do({ kind: "add", board: "a", type: "task", label: "Quatre" })).toBe("T4");
});

test("notes count across the project too, lanes stay the board's own", () => {
  const t = table(`${TWO_KANBANS}note "Sur B" --board b`);
  expect(t.do({ kind: "note", board: "a", text: "Sur A" })).toBe("N2");
  expect(t.do({ kind: "add-lane", board: "a", label: "Revue" })).toBe("lane-1");
  expect(t.do({ kind: "add-lane", board: "b", label: "Revue" })).toBe("lane-1");
});

test("a chosen id held by another board is refused, and the refusal names that board", () => {
  const t = table(TWO_KANBANS);
  expect(() => t.script('add task "x" --id T2', "agent", "b")).toThrow(
    'T2 was already used on "a"; ids are never reused (next: T3)',
  );
});

test("an id removed from another board is never given again", () => {
  const t = table(`${TWO_KANBANS}rm T2 --board a`);
  expect(() => t.script('add task "x" --id T2', "agent", "b")).toThrow('T2 was already used on "a"');
});

test("the ids of a removed board still count: undoing the removal brings them back", () => {
  const t = table(`${TWO_KANBANS}board rm a`);
  expect(t.do({ kind: "add", board: "b", type: "task", label: "Trois" })).toBe("T3");
  expect(() => t.script('add task "x" --id T1', "agent", "b")).toThrow('T1 was already used on "a"');
});

test("ids an older journal gave on two boards are listed, with the boards that hold them", () => {
  const t = table(TWO_KANBANS);
  expect(sharedIds(t.ws)).toEqual([]);
  for (const id of ["T2", "T1"]) {
    apply(t.ws, {
      seq: t.ws.seq + 1,
      ts: T0,
      actor: "agent",
      event: "ElementAdded",
      board: "b",
      id,
      type: "task",
      label: "Ancienne",
      col: 0,
      lane: "todo",
    });
  }
  expect(sharedIds(t.ws)).toEqual([
    { id: "T1", boards: ["a", "b"] },
    { id: "T2", boards: ["a", "b"] },
  ]);
});

test("an imported copy keeps the ids the project does not hold, and gives the others anew with their links", () => {
  const t = table(`${TWO_KANBANS}link T1 T2 --board a`);
  const model = JSON.parse(JSON.stringify(toModel(t.board("a"))));
  model.elements.push({ id: "T9", type: "task", label: "Neuve", lane: "todo" });
  for (const command of fromModel(model, "copie", t.ws)) t.do(command);
  expect(t.board("copie").elements.map((e) => e.id)).toEqual(["T10", "T11", "T9"]);
  expect(t.board("copie").edges).toMatchObject([{ src: "T10", dst: "T11" }]);
  expect(sharedIds(t.ws)).toEqual([]);
});
