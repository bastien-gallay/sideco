import { describe, expect, test } from "bun:test";
import { CommandError } from "../../src/domain/commands.ts";
import { threads } from "../../src/domain/workspace.ts";
import { FLOW, KANBAN, ORDERING, table } from "../support.ts";

describe("boards", () => {
  test("a board is created once; a second creation with the same id is refused", () => {
    const t = table('board new "Commande" --id commande');
    expect(t.board().format).toBe("event-storming");
    expect(() => t.script('board new "Autre" --id commande')).toThrow('board "commande" already exists');
  });

  test("a removed board is gone with everything on it, and its id is free again", () => {
    const t = table(ORDERING).script("board rm commande");
    expect(t.ws.boards).toEqual([]);
    expect(t.events.at(-1)).toMatchObject({
      event: "BoardRemoved",
      board: "commande",
      title: "Passage de commande",
    });
    t.script('board new "Commande, reprise" --id commande');
    expect(t.board("commande")).toMatchObject({ title: "Commande, reprise", elements: [], edges: [] });
  });

  test("removing a board that does not exist names the boards that do", () => {
    expect(() => table(ORDERING).script("board rm nope")).toThrow('no board "nope" (boards: commande)');
  });

  test("an unknown format is refused", () => {
    expect(() => table('board new "X" --format mind-map')).toThrow('unknown format "mind-map"');
  });

  test("writing to a missing board names the boards that exist", () => {
    const t = table(ORDERING);
    expect(() => t.do({ kind: "retitle", board: "nope", title: "x" })).toThrow(
      'no board "nope" (boards: commande)',
    );
  });
});

describe("adding elements", () => {
  test("ids are minted per type prefix, in order", () => {
    const t = table(ORDERING);
    expect(t.board().elements.map((e) => e.id)).toEqual(["X1", "C1", "E1", "P1", "C2", "E2", "H1"]);
  });

  test("an id is never reused, even after its element is removed", () => {
    const t = table(ORDERING).script("rm E2");
    expect(t.do({ kind: "add", board: "commande", type: "event", label: "Payée" })).toBe("E3");
  });

  test("a chosen id must carry the type's prefix and never have been used", () => {
    const t = table(ORDERING);
    expect(() => t.script('add event "x" --id C9')).toThrow("a event id starts with E, got C9");
    expect(() => t.script('add event "x" --id E2')).toThrow("E2 was already used");
    expect(t.do({ kind: "add", board: "commande", type: "event", label: "Payée", id: "E7" })).toBe("E7");
    expect(t.do({ kind: "add", board: "commande", type: "event", label: "Livrée" })).toBe("E8");
  });

  test("a chosen id may fill a gap, but never take the id of a removed element", () => {
    const t = table(ORDERING).script('add event "Payée" --id E7').script("rm E2");
    expect(t.do({ kind: "add", board: "commande", type: "event", label: "Facturée", id: "E4" })).toBe("E4");
    expect(() => t.script('add event "x" --id E2')).toThrow(
      'E2 was already used on "commande"; ids are never reused (next: E8)',
    );
  });

  test("an unknown type names the types the workshop has", () => {
    expect(() => table(KANBAN).script('add event "x"')).toThrow(
      'Kanban has no "event" (types: task, blocker)',
    );
  });

  test("on a timeline, an element without a column opens the next one", () => {
    const t = table('board new "T" --id t\nadd event "A"\nadd event "B"\nadd event "C" --col 1');
    expect(t.board().elements.map((e) => e.col)).toEqual([1, 2, 1]);
  });

  test("in columns, an element without a lane goes to the first lane", () => {
    const board = table(KANBAN).board();
    expect(board.elements.map((e) => `${e.id}:${e.lane}`)).toEqual([
      "T1:done",
      "T2:doing",
      "T3:todo",
      "T4:todo",
      "B1:doing",
    ]);
  });

  test("each layout refuses the placement it cannot honour", () => {
    expect(() => table(ORDERING).script('add event "x" --lane todo')).toThrow(
      "Event Storming boards take no `lane`",
    );
    expect(() => table(KANBAN).script('add task "x" --col 2')).toThrow("Kanban boards take no `col`");
    expect(() => table(KANBAN).script('add task "x" --lane later')).toThrow(
      'Kanban has no lane "later" (lanes: todo, doing, done)',
    );
    expect(() => table(FLOW).script('add step "x" --col 2')).toThrow("Flow boards take no `col`");
  });

  test("`--from` adds the element and its incoming link in one command", () => {
    const t = table(FLOW);
    expect(t.board().edges.map((e) => `${e.src}>${e.dst}:${e.label ?? ""}`)).toEqual([
      "S1>D1:",
      "D1>S2:oui",
      "D1>S3:non",
      "S2>O1:",
      "S3>D1:à réception",
    ]);
    expect(() => t.script('add step "x" --from S9')).toThrow('no element S9 on "livraison"');
  });
});

describe("changing elements", () => {
  test("rename, detail and remove need an element that exists", () => {
    const t = table(ORDERING);
    for (const line of ['rename E9 "x"', 'detail E9 "x"', "rm E9"]) {
      expect(() => t.script(line)).toThrow('no element E9 on "commande"');
    }
  });

  test("removing an element removes its links and takes it out of the focus", () => {
    const t = table(ORDERING).script("focus E1 P1 --why revue").script("rm E1");
    expect(t.board().edges).toEqual([]);
    expect(t.board().focus).toEqual({ ids: ["P1"], reason: "revue" });
    expect(t.script("rm P1").board().focus).toBeNull();
  });

  test("a timeline element moves to a column; a lane makes no sense there", () => {
    const t = table(ORDERING).script("move E2 --col 3");
    expect(t.board().elements.find((e) => e.id === "E2")?.col).toBe(3);
    expect(() => t.script("move E2")).toThrow("moving E2 needs a column");
    expect(() => t.script("move E2 --lane todo")).toThrow("take no `lane`");
  });

  test("a card moves to a lane, last by default or before a named card of that lane", () => {
    const t = table(KANBAN).script("move T3 --lane doing").script("move T4 --lane doing --before T2");
    const doing = t
      .board()
      .elements.filter((e) => e.lane === "doing")
      .map((e) => e.id);
    expect(doing).toEqual(["T4", "T2", "B1", "T3"]);
    expect(() => t.script("move T1 --lane doing --before T1")).toThrow("T1 cannot be placed before itself");
    expect(() => t.script("move T2 --lane todo --before T1")).toThrow('T1 is not in lane "todo"');
  });

  test("a graph places its nodes itself", () => {
    expect(() => table(FLOW).script("move S1 --col 2")).toThrow("link or unlink instead");
  });

  test("inserting a column shifts the columns at and after it", () => {
    const t = table(ORDERING).script("insert-col 2");
    expect(t.board().elements.map((e) => e.col)).toEqual([1, 1, 1, 3, 3, 3, 3]);
    expect(() => table(KANBAN).script("insert-col 1")).toThrow("Kanban boards have no columns to insert");
  });
});

describe("links, focus, notes, turn", () => {
  test("a link needs two different elements; linking twice keeps one link with the last label", () => {
    const t = table(ORDERING);
    expect(() => t.script("link E1 E1")).toThrow("E1 cannot link to itself");
    expect(() => t.script("link E1 E9")).toThrow("no element E9");
    t.script('link C1 E1 "produit"');
    expect(t.board().edges.filter((e) => e.src === "C1" && e.dst === "E1")).toEqual([
      { src: "C1", dst: "E1", label: "produit", by: "agent" },
    ]);
  });

  test("unlinking a link that is not there is refused", () => {
    expect(() => table(ORDERING).script("unlink E1 C1")).toThrow("no link E1 → C1");
  });

  test("focus with no id clears the focus", () => {
    const t = table(ORDERING).script('focus H1 --why "à trancher"');
    expect(t.board().focus).toEqual({ ids: ["H1"], reason: "à trancher" });
    expect(t.script("focus").board().focus).toBeNull();
  });

  test("notes get their own ids and resolve once", () => {
    const t = table(ORDERING);
    expect(t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human")).toBe(
      "N1",
    );
    expect(t.do({ kind: "note", board: "commande", text: "Vue d'ensemble" }, "human")).toBe("N2");
    const before = t.seq;
    t.script("resolve N1").script("resolve N1");
    expect(t.seq).toBe(before + 1);
    expect(t.board().notes.map((n) => n.resolved)).toEqual([true, false]);
    expect(() => t.script("resolve N9")).toThrow("no note N9");
    expect(() => t.script('note "x" --on E9')).toThrow("no element E9");
  });

  test("a reply joins the thread of the note it answers, and stays on its card", () => {
    const t = table(ORDERING);
    t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human");
    expect(t.do({ kind: "reply", board: "commande", to: "N1", text: "L'entrepôt" })).toBe("N2");
    expect(t.events.at(-1)).toMatchObject({
      event: "NoteAdded",
      id: "N2",
      thread: "N1",
      target: "P1",
      text: "L'entrepôt",
    });
    // Answering a reply answers its thread: a discussion is one line, not a tree.
    t.script('reply N2 "Toujours ?"', "human");
    t.do({ kind: "note", board: "commande", text: "Vue d'ensemble" }, "human");
    expect(threads(t.board())).toMatchObject([
      {
        id: "N1",
        target: "P1",
        resolved: false,
        notes: [
          { id: "N1", by: "human" },
          { id: "N2", by: "agent" },
          { id: "N3", by: "human", thread: "N1" },
        ],
      },
      { id: "N4", resolved: false, notes: [{ id: "N4" }] },
    ]);
  });

  test("resolving any note of a thread resolves the whole thread, once", () => {
    const t = table(ORDERING);
    t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human");
    t.script('reply N1 "L\'entrepôt"');
    const before = t.seq;
    t.script("resolve N2").script("resolve N1");
    expect(t.seq).toBe(before + 1);
    expect(t.events.at(-1)).toMatchObject({ event: "NoteResolved", id: "N1" });
    expect(t.board().notes.map((n) => n.resolved)).toEqual([true, true]);
    expect(threads(t.board())).toMatchObject([{ id: "N1", resolved: true }]);
  });

  test("a reply needs a note that is still open", () => {
    const t = table(ORDERING);
    t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human");
    expect(() => t.script('reply N9 "x"')).toThrow('no note N9 on "commande"');
    expect(() => t.script('reply E1 "x"')).toThrow('no note E1 on "commande"');
    t.script("resolve N1");
    expect(() => t.script('reply N1 "x"')).toThrow("note N1 is resolved");
  });

  test("passing the turn records who holds it", () => {
    const t = table(ORDERING);
    t.do({ kind: "pass", board: "commande", to: "agent", message: "à toi" }, "human");
    expect(t.board().turn).toEqual({ to: "agent", message: "à toi", seq: t.seq });
  });
});

describe("session commands", () => {
  test("need a session", () => {
    expect(() => table().do({ kind: "prompt", text: "hello" })).toThrow(CommandError);
    expect(() => table().do({ kind: "prompt", text: "hello" })).toThrow("`prompt` needs a session");
  });

  test("tasks created and completed by id fold into the todo list, once each", () => {
    const t = table();
    t.do({ kind: "task-created", id: "1", text: "Écrire les tests" }, "agent", "s1");
    t.do({ kind: "task-created", id: "1", text: "Écrire les tests" }, "agent", "s1");
    t.do({ kind: "task-created", id: "2", text: "Brancher les hooks" }, "agent", "s1");
    t.do({ kind: "task-completed", id: "1" }, "agent", "s1");
    t.do({ kind: "task-completed", id: "1" }, "agent", "s1");
    t.do({ kind: "task-completed", id: "9" }, "agent", "s1");
    expect(t.events.map((e) => e.event)).toEqual(["TodosUpdated", "TodosUpdated", "TodosUpdated"]);
    expect(t.ws.sessions[0]?.todos).toEqual([
      { id: "1", text: "Écrire les tests", status: "completed" },
      { id: "2", text: "Brancher les hooks", status: "pending" },
    ]);
  });
});

test("decide never changes the workspace it reads", () => {
  const t = table(ORDERING);
  const before = JSON.stringify(t.ws);
  expect(() => t.do({ kind: "add", board: "commande", type: "nope", label: "x" })).toThrow();
  expect(JSON.stringify(t.ws)).toBe(before);
});
