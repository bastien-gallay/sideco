import { describe, expect, test } from "bun:test";
import { boardAction } from "../../src/cli/argv.ts";
import { parseCommand } from "../../src/domain/commands.ts";
import { describeCard, describeChanges } from "../../src/domain/digest.ts";
import { findInWorkspace } from "../../src/domain/find.ts";
import { sharedIds } from "../../src/domain/minting.ts";
import { apply } from "../../src/domain/workspace.ts";
import { describeEvent } from "../../src/web/event-words.ts";
import { T0, table } from "../support.ts";

const SPRINT = `
board new "Sprint" --format kanban --id sprint
add task "Écrire"
add task "Relire"
add task "Publier"
link T1 T2
link T3 T1 "après"
note "À revoir" --on T1
focus T1 T2
`;

const ids = (t: ReturnType<typeof table>): string[] => t.board().elements.map((e) => e.id);

describe("renumber", () => {
  test("without a new id, the card takes the next of its letter in the project", () => {
    const t = table(SPRINT);
    expect(t.do({ kind: "renumber", board: "sprint", id: "T1" })).toBe("T4");
    expect(ids(t)).toEqual(["T4", "T2", "T3"]);
    expect(t.do({ kind: "add", board: "sprint", type: "task", label: "Suite" })).toBe("T5");
  });

  test("its links, the notes on it and the focus follow it", () => {
    const t = table(SPRINT);
    t.do({ kind: "renumber", board: "sprint", id: "T1", to: "T9" });
    const board = t.board();
    expect(board.edges.map((e) => [e.src, e.dst, e.label])).toEqual([
      ["T9", "T2", undefined],
      ["T3", "T9", "après"],
    ]);
    expect(board.notes[0]?.target).toBe("T9");
    expect(board.focus?.ids).toEqual(["T9", "T2"]);
  });

  test("the old id is retired, never given again, and the card remembers it", () => {
    const t = table(SPRINT);
    t.do({ kind: "renumber", board: "sprint", id: "T1", to: "T9" });
    expect(t.board().retired).toContain("T1");
    expect(t.board().elements[0]?.formerIds).toEqual(["T1"]);
    expect(() => t.script('add task "x" --id T1')).toThrow('T1 was already used on "sprint"');
    expect(() => t.script("renumber T2 T9")).toThrow('T9 was already used on "sprint"');
  });

  test("a chosen id takes the letter of the card's type, and the card must be there", () => {
    const t = table(SPRINT);
    expect(() => t.script("renumber T1 B7")).toThrow("a task id starts with T, got B7");
    expect(() => t.script("renumber T8")).toThrow('no element T8 on "sprint"');
    expect(() => t.script("renumber N1")).toThrow('no element N1 on "sprint"');
  });

  test("show says the id it had, and find finds the card by it", () => {
    const t = table(SPRINT);
    t.do({ kind: "renumber", board: "sprint", id: "T1", to: "T9" });
    expect(describeCard(t.board(), "T9").split("\n")[1]).toBe('  T9 (formerly T1) task "Écrire"');
    expect(findInWorkspace(t.ws, "T1").map((hit) => hit.id)).toEqual(["T9"]);
  });

  test("an id an older journal gave on two boards is settled by renumbering one", () => {
    const t = table(`${SPRINT}board new "Autre" --format kanban --id autre`);
    apply(t.ws, {
      seq: t.ws.seq + 1,
      ts: T0,
      actor: "agent",
      event: "ElementAdded",
      board: "autre",
      id: "T1",
      type: "task",
      label: "Ancienne",
      col: 1,
      lane: "todo",
    });
    expect(sharedIds(t.ws).map((s) => s.id)).toEqual(["T1"]);
    expect(t.do({ kind: "renumber", board: "autre", id: "T1" })).toBe("T4");
    expect(sharedIds(t.ws)).toEqual([]);
    expect(ids(t)).toEqual(["T4"]);
  });
});

describe("renumber, taken back", () => {
  test("undo gives the old id back to the card and its ties; redo takes it again", () => {
    const t = table(SPRINT);
    t.do({ kind: "renumber", board: "sprint", id: "T1", to: "T9" });
    t.do({ kind: "undo", board: "sprint" });
    let board = t.board();
    expect(ids(t)).toEqual(["T1", "T2", "T3"]);
    expect(board.elements[0]?.formerIds).toBeUndefined();
    expect(board.retired).toEqual(["T9"]);
    expect(board.edges.map((e) => `${e.src}>${e.dst}`)).toEqual(["T1>T2", "T3>T1"]);
    expect(board.notes[0]?.target).toBe("T1");
    expect(board.focus?.ids).toEqual(["T1", "T2"]);
    t.do({ kind: "redo", board: "sprint" });
    board = t.board();
    expect(ids(t)).toEqual(["T9", "T2", "T3"]);
    expect(board.elements[0]?.formerIds).toEqual(["T1"]);
    expect(board.retired).toEqual(["T1"]);
  });

  test("a gesture made before still undoes, on the card under its new id", () => {
    const t = table(SPRINT);
    t.script('rename T1 "Rédiger"', "human");
    t.do({ kind: "renumber", board: "sprint", id: "T1", to: "T9" });
    t.do({ kind: "undo", board: "sprint" }, "human");
    expect(t.board().elements[0]).toMatchObject({ id: "T9", label: "Écrire" });
  });

  test("a card removed before comes back linked to the card under its new id", () => {
    const t = table(SPRINT);
    t.script("rm T2", "human");
    t.do({ kind: "renumber", board: "sprint", id: "T1", to: "T9" });
    t.do({ kind: "undo", board: "sprint" }, "human");
    expect(t.board().edges.map((e) => `${e.src}>${e.dst}`)).toEqual(["T3>T9", "T9>T2"]);
  });

  test("the agent's own earlier link and move undo after it renumbered", () => {
    const t = table(SPRINT);
    t.script("unlink T1 T2\nmove T1 --lane doing");
    t.do({ kind: "renumber", board: "sprint", id: "T1", to: "T9" });
    t.do({ kind: "undo", board: "sprint" });
    t.do({ kind: "undo", board: "sprint" });
    expect(t.board().elements.find((e) => e.id === "T1")?.lane).toBe("todo");
    t.do({ kind: "undo", board: "sprint" });
    expect(t.board().edges.map((e) => `${e.src}>${e.dst}`)).toContain("T1>T2");
  });

  test("a card renumbered, then removed, comes back with the id it had before", () => {
    const t = table(SPRINT);
    t.do({ kind: "renumber", board: "sprint", id: "T1", to: "T9" });
    t.script("rm T9");
    t.do({ kind: "undo", board: "sprint" });
    expect(t.board().elements.find((e) => e.id === "T9")?.formerIds).toEqual(["T1"]);
  });
});

describe("renumber, said", () => {
  test("the command line and the wire", () => {
    expect(boardAction(["renumber", "T1", "T9"], "sprint").command).toEqual({
      kind: "renumber",
      board: "sprint",
      id: "T1",
      to: "T9",
    });
    expect(boardAction(["renumber", "T1"], "sprint").command).toMatchObject({ kind: "renumber", id: "T1" });
    expect(() => parseCommand({ kind: "renumber", board: "sprint", id: "T1", to: "t9" })).toThrow(
      "`to` must be an id like E1 or C12",
    );
  });

  test("the agent is told, and the history line says it in both languages", () => {
    const t = table(SPRINT);
    const after = t.seq;
    t.script("renumber T1 T9", "human");
    expect(describeChanges(t.events, after).text).toBe('board sprint "Sprint"\n  ~ T1 renumbered as T9');
    const e = t.events.at(-1);
    if (!e) throw new Error("no event");
    expect(describeEvent(e, "en")).toBe("You renumber T1 as T9");
    expect(describeEvent({ ...e, actor: "agent" }, "fr")).toBe("Claude renumérote T1 en T9");
  });
});
