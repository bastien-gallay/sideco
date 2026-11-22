/**
 * A kanban holds stories (S) and tasks (T), one letter per concept in the
 * whole project (T216). A task stands alone or splits a story, linked from it;
 * a card changes kind with `sideco retype`, taking the letter of its new kind.
 */
import { describe, expect, test } from "bun:test";
import { boardAction } from "../../src/cli/argv.ts";
import { describeChanges } from "../../src/domain/digest.ts";
import { findFormat } from "../../src/domain/formats.ts";
import { findElement } from "../../src/domain/workspace.ts";
import { describeEvent } from "../../src/web/event-words.ts";
import { table } from "../support.ts";

const SPRINT = `
board new "Sprint" --format kanban --id sprint
add task "Écrire"
add task "Relire"
link T1 T2
`;

describe("the kinds of a kanban", () => {
  test("a story S, a task T and a blocker B; a story leads to a task that splits it", () => {
    const kanban = findFormat("kanban");
    expect(kanban?.types.map((t) => `${t.id}:${t.prefix}`)).toEqual(["story:S", "task:T", "blocker:B"]);
    expect(kanban?.types.find((t) => t.id === "story")?.leadsTo?.type).toBe("task");
  });

  test("a task splits a story when it is added from it, linked", () => {
    const t = table(`board new "Sprint" --format kanban --id sprint
add story "Payer en ligne"
add task "Brancher la banque" --from S1`);
    expect(t.board().edges).toMatchObject([{ src: "S1", dst: "T1" }]);
    expect(findElement(t.board(), "S1")?.lane).toBe("todo");
  });
});

describe("retype", () => {
  test("a card takes another kind and the next id of its letter; its ties follow", () => {
    const t = table(SPRINT);
    expect(t.do({ kind: "renumber", board: "sprint", id: "T1", type: "story" })).toBe("S1");
    const story = findElement(t.board(), "S1");
    expect(story).toMatchObject({ type: "story", label: "Écrire", formerIds: ["T1"] });
    expect(t.board().edges).toMatchObject([{ src: "S1", dst: "T2" }]);
    expect(t.board().retired).toEqual(["T1"]);
  });

  test("a chosen id takes the letter of the new kind; a kind the format lacks is refused", () => {
    const t = table(SPRINT);
    expect(() => t.do({ kind: "renumber", board: "sprint", id: "T1", type: "story", to: "T9" })).toThrow(
      "a story id starts with S, got T9",
    );
    expect(() => t.do({ kind: "renumber", board: "sprint", id: "T1", type: "event" })).toThrow(
      'Kanban has no "event"',
    );
    expect(t.do({ kind: "renumber", board: "sprint", id: "T1", type: "story", to: "S7" })).toBe("S7");
  });

  test("undo gives back the kind and the id; redo takes them again", () => {
    const t = table(SPRINT);
    t.do({ kind: "renumber", board: "sprint", id: "T1", type: "story" });
    t.do({ kind: "undo", board: "sprint" });
    expect(findElement(t.board(), "T1")).toMatchObject({ type: "task" });
    expect(findElement(t.board(), "T1")?.formerIds).toBeUndefined();
    t.do({ kind: "redo", board: "sprint" });
    expect(findElement(t.board(), "S1")).toMatchObject({ type: "story", formerIds: ["T1"] });
  });

  test("the command line: retype ID TYPE [NEW]", () => {
    expect(boardAction(["retype", "T1", "story"], "sprint").command).toEqual({
      kind: "renumber",
      board: "sprint",
      id: "T1",
      type: "story",
      to: undefined,
    });
    expect(boardAction(["retype", "T1", "story", "S9"], "sprint").command).toMatchObject({ to: "S9" });
  });

  test("the agent is told, and the history line says it in both languages", () => {
    const t = table(SPRINT);
    const after = t.seq;
    t.script("retype T1 story", "human");
    expect(describeChanges(t.events, after).text).toBe(
      'board sprint "Sprint"\n  ~ T1 renumbered as S1, a story',
    );
    const e = t.events.at(-1);
    if (!e) throw new Error("no event");
    expect(describeEvent(e, "en")).toBe("You turn T1 into story S1");
    expect(describeEvent({ ...e, actor: "agent" }, "fr")).toBe("Claude change T1 en story S1");
  });
});
