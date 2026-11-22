/**
 * Labels: free words on a card, shared by every board of the project. They
 * stand in for what a plain board does not have: who it is for (`@name`), what
 * kind of work it is (`type:bug`), a release, an environment.
 */
import { describe, expect, test } from "bun:test";
import { boardAction } from "../../src/cli/argv.ts";
import { describeBoard, describeChanges } from "../../src/domain/digest.ts";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { describeLabels } from "../../src/domain/project-digest.ts";
import { describeEvent } from "../../src/web/event-words.ts";
import { FLOW, KANBAN, table } from "../support.ts";

const labelsOf = (t: ReturnType<typeof table>, id: string, board?: string) =>
  t.board(board).elements.find((e) => e.id === id)?.labels;

describe("labelling a card", () => {
  test("`label ID …` puts one or more; `@name` is said `assignee:name`; one already there is not put twice", () => {
    const t = table(KANBAN).script("label T1 type:bug @bastien");
    expect(labelsOf(t, "T1")).toEqual(["type:bug", "assignee:bastien"]);
    expect(t.events.at(-1)).toMatchObject({
      event: "ElementLabeled",
      id: "T1",
      label: "assignee:bastien",
      joined: true,
    });
    const seq = t.seq;
    t.script("label T1 Type:Bug");
    expect(t.seq).toBe(seq);
    t.script('label T1 "  release   0.4 "');
    expect(labelsOf(t, "T1")).toEqual(["type:bug", "assignee:bastien", "release 0.4"]);
  });

  test("`unlabel ID …` takes them off, whatever their case; a label the card does not have is refused", () => {
    const t = table(KANBAN).script("label T1 type:bug @bastien\nunlabel T1 TYPE:BUG");
    expect(labelsOf(t, "T1")).toEqual(["assignee:bastien"]);
    expect(() => t.script("unlabel T1 env:prod")).toThrow("T1 has no label env:prod");
    expect(() => t.script("label T9 x")).toThrow("T9");
  });

  test("any card of any workshop takes labels", () => {
    const t = table(FLOW).script("label D1 type:question");
    expect(labelsOf(t, "D1")).toEqual(["type:question"]);
  });

  test("undo takes them off again, and a removed card comes back with its labels", () => {
    const t = table(KANBAN).script("label T1 type:bug @bastien", "human");
    t.do({ kind: "undo", board: "sprint" }, "human");
    expect(labelsOf(t, "T1") ?? []).toEqual([]);
    t.script("label T1 type:bug\nrm T1", "human");
    t.do({ kind: "undo", board: "sprint" }, "human");
    expect(labelsOf(t, "T1")).toEqual(["type:bug"]);
  });

  test("the command line takes the labels after the id", () => {
    expect(boardAction(["label", "T1", "a", "b"], "sprint").command).toEqual({
      kind: "label",
      board: "sprint",
      id: "T1",
      labels: ["a", "b"],
    });
    expect(() => boardAction(["label", "T1"], "sprint")).toThrow("needs a label");
  });
});

describe("what the agent and the history read", () => {
  test("a card's line ends with its labels; the changes say what was put and taken, net", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    t.script("label T1 type:bug @bastien\nlabel T2 env:prod\nunlabel T2 env:prod", "human");
    expect(describeBoard(t.board())).toContain('T1 task "Écrire le PRD" [type:bug, assignee:bastien]');
    const said = describeChanges(t.events, mark).text;
    expect(said).toContain("~ T1 labeled type:bug");
    expect(said).toContain("~ T1 labeled assignee:bastien");
    expect(said).not.toContain("T2");
  });

  test("the history words it", () => {
    const t = table(KANBAN).script("label T1 type:bug\nunlabel T1 type:bug", "human");
    const [put, taken] = t.events.slice(-2);
    expect(describeEvent(put as never)).toBe("You label T1 “type:bug”");
    expect(describeEvent(taken as never, "fr")).toBe("Tu retires à T1 le label « type:bug »");
  });
});

describe("`sideco labels`", () => {
  test("lists every label of the project with its cards, across boards; a key or a label narrows it", () => {
    const t = table(KANBAN).script("label T1 type:bug @bastien\nlabel T2 type:story");
    t.script(FLOW);
    t.script("label F1 type:bug", "agent", "livraison");
    expect(describeLabels(t.ws)).toBe(
      [
        "assignee:bastien  1  sprint T1",
        "type:bug  2  sprint T1 · livraison F1",
        "type:story  1  sprint T2",
      ].join("\n"),
    );
    expect(describeLabels(t.ws, "type")).toBe(
      ["type:bug  2  sprint T1 · livraison F1", "type:story  1  sprint T2"].join("\n"),
    );
    expect(describeLabels(t.ws, "type:")).toBe(describeLabels(t.ws, "type"));
    expect(describeLabels(t.ws, "@bastien")).toBe("assignee:bastien  1  sprint T1");
    expect(describeLabels(t.ws, "env")).toBe("no label env");
  });
});

describe("export", () => {
  test("a model read back keeps the labels", () => {
    const t = table(KANBAN).script("label T1 type:bug @bastien");
    const back = table();
    for (const command of fromModel(JSON.parse(JSON.stringify(toModel(t.board()))), "copy")) back.do(command);
    expect(labelsOf(back, "T1")).toEqual(["type:bug", "assignee:bastien"]);
  });
});
