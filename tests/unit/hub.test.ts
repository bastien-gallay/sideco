import { describe, expect, test } from "bun:test";
import { parseBatch } from "../../src/cli/argv.ts";
import { type Command, parseCommand } from "../../src/domain/commands.ts";
import type { Actor, Recorded } from "../../src/domain/events.ts";
import { BatchError, Hub, type Journal } from "../../src/server/hub.ts";
import { memoryJournal } from "../../src/server/journal.ts";
import { ORDERING, T0 } from "../support.ts";

const batch = (script: string, board?: string): Command[] => parseBatch(script, board).map(parseCommand);

function setup(script = ORDERING): {
  hub: Hub;
  journal: Journal;
  run: (script: string, actor?: Actor, session?: string) => void;
} {
  const journal = memoryJournal();
  const hub = new Hub(journal, () => new Date(T0));
  const run = (text: string, actor: Actor = "agent", session?: string): void => {
    hub.dispatch(batch(text, "commande"), { actor, session });
  };
  if (script) run(script);
  return { hub, journal, run };
}

describe("a batch sent as one gesture (S333)", () => {
  const labels = (hub: Hub): string[] =>
    (hub.workspace.boards.find((b) => b.id === "commande")?.elements ?? []).map((e) => e.id);

  test("one undo takes all of it back, and one redo puts it back", () => {
    const { hub } = setup();
    const before = labels(hub);
    const [first, second] = before;
    const remove = batch(`rm ${first}\nrm ${second}`, "commande");
    hub.dispatch(remove, { actor: "human", together: true });
    expect(labels(hub)).toEqual(before.slice(2));
    hub.dispatch(batch("undo", "commande"), { actor: "human" });
    expect(labels(hub)).toEqual(before);
    hub.dispatch(batch("redo", "commande"), { actor: "human" });
    expect(labels(hub)).toEqual(before.slice(2));
  });

  test("without it, each command of a batch is a gesture of its own", () => {
    const { hub } = setup();
    const before = labels(hub);
    hub.dispatch(batch(`rm ${before[0]}\nrm ${before[1]}`, "commande"), { actor: "human" });
    hub.dispatch(batch("undo", "commande"), { actor: "human" });
    expect(labels(hub)).toHaveLength(before.length - 1);
  });

  test("gestures on two boards stay two: an undo is a board's", () => {
    const { hub } = setup();
    const made = hub.dispatch(batch('board new "B" --id b\nadd event "A"'), { actor: "human" });
    const [first, second] = labels(hub);
    const two = [...batch(`rm ${first}\nrm ${second}`, "commande"), ...batch(`rm ${made.minted[1]}`, "b")];
    const done = hub.dispatch(two, { actor: "human", together: true });
    const starts = done.events.filter((e) => !("joined" in e && e.joined));
    expect(starts.map((e) => "board" in e && e.board)).toEqual(["commande", "b"]);
  });
});

describe("dispatch", () => {
  test("stamps each event with its place, time, author and session", () => {
    const { hub } = setup("");
    const done = hub.dispatch(batch('board new "B" --id b\nadd event "A"'), {
      actor: "agent",
      session: "s1",
    });
    expect(done.events).toEqual([
      {
        seq: 1,
        ts: T0,
        actor: "agent",
        session: "s1",
        event: "BoardCreated",
        board: "b",
        title: "B",
        format: "event-storming",
      },
      {
        seq: 2,
        ts: T0,
        actor: "agent",
        session: "s1",
        event: "ElementAdded",
        board: "b",
        id: "E1",
        type: "event",
        label: "A",
        col: 1,
        lane: "",
        detail: undefined,
      },
    ]);
    expect(done.minted).toEqual([undefined, "E1"]);
  });

  test("a later command of a batch sees what the earlier ones did", () => {
    const { hub } = setup("");
    hub.dispatch(batch('board new "B" --id b\nadd command "Payer"\nadd event "Payé"\nlink C1 E1'), {
      actor: "agent",
    });
    expect(hub.workspace.boards[0]?.edges).toHaveLength(1);
  });

  test("a batch names the cards it adds and refers to them; what is recorded carries ids only", () => {
    const { hub, journal } = setup("");
    const done = hub.dispatch(
      batch(`board new "Checkout" --id checkout
add event "Order placed" --col 1 --alias placed
add policy "Reserve stock" --col 2 --alias reserve
link @placed @reserve
detail @placed "Emitted by the checkout"
note "Is the stock checked first?" --on @reserve
add command "Pay" --col 3 --from @placed`),
      { actor: "agent" },
    );
    expect(done.minted).toEqual([undefined, "E1", "R1", undefined, undefined, "N1", "C1"]);
    expect(done.events.slice(3)).toMatchObject([
      { event: "EdgeAdded", src: "E1", dst: "R1" },
      { event: "ElementAnnotated", id: "E1", detail: "Emitted by the checkout" },
      { event: "NoteAdded", id: "N1", target: "R1" },
      { event: "ElementAdded", id: "C1" },
      { event: "EdgeAdded", src: "E1", dst: "C1" },
    ]);
    expect(JSON.stringify(journal.load())).not.toMatch(/@|alias/);
    expect(new Hub(journal).workspace).toEqual(hub.workspace);
  });

  test("a name given on one board is refused on another: it would point at a stranger's card", () => {
    const { hub, journal } = setup("");
    const script = `board new "One" --id one
add event "Here" --alias here
board new "Two" --id two
add event "There"
rename @here "Renamed by mistake"`;
    expect(() => hub.dispatch(batch(script), { actor: "agent" })).toThrow(
      '@here names E1 on "one", not a card of "two"',
    );
    expect(journal.load()).toHaveLength(0);
  });

  test("a name lives for one batch: the next batch does not know it", () => {
    const { hub, run } = setup();
    run('add event "Payée" --alias paid\nrename @paid "Commande payée"');
    expect(hub.workspace.boards[0]?.elements.at(-1)).toMatchObject({ id: "E3", label: "Commande payée" });
    expect(() => run("rm @paid")).toThrow("nothing is named @paid earlier in this batch");
  });

  test.each([
    [
      "a name no command gave",
      'add event "Gardé ?" --alias kept\nlink @kept @lost\nadd event "Jamais"',
      { index: 1, message: "nothing is named @lost earlier in this batch (names so far: kept)" },
    ],
    [
      "a name given further down",
      'link @later E1\nadd event "Trop tard" --alias later',
      { index: 0, message: "nothing is named @later earlier in this batch (names so far: none)" },
    ],
    [
      "a name given twice",
      'add event "Un" --alias twin\nadd event "Autre"\nadd event "Deux" --alias twin',
      { index: 2, message: "@twin already names E3 in this batch; choose another name" },
    ],
  ])("a batch with %s is refused whole, and says which command", (_what, script, refusal) => {
    const { hub, journal } = setup();
    const before = { state: JSON.stringify(hub.workspace), lines: journal.load().length };
    let error: unknown;
    try {
      hub.dispatch(batch(script, "commande"), { actor: "agent" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BatchError);
    expect(error).toMatchObject(refusal);
    expect(JSON.stringify(hub.workspace)).toBe(before.state);
    expect(journal.load()).toHaveLength(before.lines);
  });

  test("a batch that fails midway leaves no trace, and says which command failed", () => {
    const { hub, journal } = setup();
    const before = {
      seq: hub.workspace.seq,
      state: JSON.stringify(hub.workspace),
      lines: journal.load().length,
    };
    const heard: Recorded[] = [];
    hub.subscribe((e) => heard.push(e));
    let error: unknown;
    try {
      hub.dispatch(batch('add event "Gardé ?"\nrename E99 "x"\nadd event "Jamais"', "commande"), {
        actor: "agent",
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BatchError);
    expect(error).toMatchObject({ index: 1, message: 'no element E99 on "commande"' });
    expect(JSON.stringify(hub.workspace)).toBe(before.state);
    expect(journal.load()).toHaveLength(before.lines);
    expect(heard).toEqual([]);
    expect(hub.events.at(-1)?.seq).toBe(before.seq);
  });

  test("a single failing command leaves no trace either", () => {
    const { hub, journal } = setup();
    const lines = journal.load().length;
    expect(() => hub.dispatch(batch("rm E99", "commande"), { actor: "human" })).toThrow(BatchError);
    expect(journal.load()).toHaveLength(lines);
  });

  test("subscribers hear every event once, in order, until they leave", () => {
    const { hub, run } = setup();
    const heard: number[] = [];
    const leave = hub.subscribe((e) => heard.push(e.seq));
    run('add event "A"\nadd event "B"');
    leave();
    run('add event "C"');
    expect(heard).toEqual([hub.workspace.seq - 2, hub.workspace.seq - 1]);
  });

  test("the journal is all it takes to come back: a new hub has the same workspace", () => {
    const { hub, journal, run } = setup();
    run("move E2 --col 3\nrm H1", "human");
    expect(new Hub(journal).workspace).toEqual(hub.workspace);
  });

  test("eventsAfter gives the events a reader has not seen", () => {
    const { hub } = setup();
    const last = hub.workspace.seq;
    expect(hub.eventsAfter(last)).toEqual([]);
    expect(hub.eventsAfter(last - 2).map((e) => e.seq)).toEqual([last - 1, last]);
    expect(hub.eventsAfter(0)).toHaveLength(last);
  });
});

describe("telling the agent what the human changed", () => {
  test("a session is told once; acknowledging moves its cursor", () => {
    const { hub, run } = setup();
    run('rename E1 "Commande validée"', "human");
    expect(hub.changesFor("s1", false).text).toContain("Commande validée");
    expect(hub.changesFor("s1", true).text).toContain("Commande validée");
    expect(hub.changesFor("s1", true)).toMatchObject({ text: "", count: 0 });
    expect(hub.events.at(-1)).toMatchObject({ event: "ChangesDelivered", actor: "system", session: "s1" });
  });

  test("each session has its own cursor", () => {
    const { hub, run } = setup();
    run('rename E1 "Commande validée"', "human");
    hub.changesFor("s1", true);
    expect(hub.changesFor("s2", false).text).toContain("Commande validée");
  });

  test("nothing to tell records nothing", () => {
    const { hub } = setup();
    const seq = hub.workspace.seq;
    hub.changesFor("s1", true);
    expect(hub.workspace.seq).toBe(seq);
  });

  test("the agent's own writes are not news to it", () => {
    const { hub, run } = setup();
    run('rename E1 "Par l\'agent"', "agent", "s1");
    expect(hub.changesFor("s1", false).text).toBe("");
  });
});

describe("waiting for the human", () => {
  test("resolves when the human passes the turn to the agent", async () => {
    const { hub, run } = setup();
    const waiting = hub.waitForTurn("s1", 5000);
    expect(hub.listening).toBe(1);
    run('rename E1 "Validée"\npass --to agent', "human");
    expect(await waiting).toBe("passed");
    expect(hub.listening).toBe(0);
    expect(hub.hasPendingTurn("s1")).toBe(true);
    expect(hub.changesFor("s1", true).text).toContain("The human passed you the turn.");
    expect(hub.hasPendingTurn("s1")).toBe(false);
  });

  test("resolves at once when the human already passed and the session was not told", async () => {
    const { hub, run } = setup();
    run("pass --to agent", "human");
    expect(await hub.waitForTurn("s1", 5000)).toBe("passed");
  });

  test("is not woken by the agent passing the turn to the human", async () => {
    const { hub, run } = setup();
    const waiting = hub.waitForTurn("s1", 30);
    run('pass "à toi"', "agent", "s1");
    expect(await waiting).toBe("timeout");
  });

  test("a new wait for the same session replaces the old one", async () => {
    const { hub } = setup();
    const first = hub.waitForTurn("s1", 5000);
    const second = hub.waitForTurn("s1", 30);
    expect(await first).toBe("released");
    expect(await second).toBe("timeout");
  });

  test("a new prompt in the session releases its wait: the human spoke in the terminal instead", async () => {
    const { hub } = setup();
    const waiting = hub.waitForTurn("s1", 5000);
    hub.dispatch([{ kind: "prompt", text: "finalement…" }], { actor: "agent", session: "s1" });
    expect(await waiting).toBe("released");
  });

  test("a caller that goes away is forgotten", async () => {
    const { hub } = setup();
    const waiting = hub.waitForTurn("s1", 5000);
    hub.abandon("s1");
    expect(await waiting).toBe("released");
    expect(hub.listening).toBe(0);
  });

  test("the page is told how many sessions are listening", async () => {
    const { hub, run } = setup();
    const seen: number[] = [];
    hub.onPresence((n) => seen.push(n));
    const a = hub.waitForTurn("s1", 5000);
    const b = hub.waitForTurn("s2", 5000);
    run("pass --to agent", "human");
    await Promise.all([a, b]);
    expect(seen).toEqual([1, 2, 1, 0]);
  });
});

test("watching counts the pages following the journal", () => {
  const hub = new Hub(memoryJournal());
  expect(hub.watching).toBe(0);
  const leave = hub.subscribe(() => {});
  hub.subscribe(() => {});
  expect(hub.watching).toBe(2);
  leave();
  expect(hub.watching).toBe(1);
});

test("each hub is one run of the companion: a page can tell a restart from a reconnection", () => {
  const first = new Hub(memoryJournal());
  expect(first.run).toMatch(/^[0-9a-f-]{36}$/);
  expect(new Hub(memoryJournal()).run).not.toBe(first.run);
});

describe("a refused undo", () => {
  const undo: Command = { kind: "undo", board: "commande" };

  test("alone, it is recorded, then refused with the reason", () => {
    const { hub, journal, run } = setup();
    run('rename E1 "À moi"', "human");
    run('rename E1 "À Claude"', "agent");
    const before = journal.load().length;
    expect(() => hub.dispatch([undo], { actor: "human" })).toThrow(BatchError);
    expect(journal.load().length).toBe(before + 1);
    expect(journal.load().at(-1)).toMatchObject({ event: "UndoRefused", actor: "human" });
    expect(() => hub.dispatch([undo], { actor: "human" })).toThrow("nothing to undo");
  });

  test("in a batch, the batch is refused and leaves no trace", () => {
    const { hub, journal, run } = setup();
    run('rename E1 "À moi"', "human");
    run('rename E1 "À Claude"', "agent");
    const before = journal.load().length;
    const both = [undo, ...batch('rename E1 "Encore"', "commande")];
    expect(() => hub.dispatch(both, { actor: "human" })).toThrow("refused");
    expect(journal.load().length).toBe(before);
    // Still refused next time: nothing was left behind.
    expect(() => hub.dispatch([undo], { actor: "human" })).toThrow("refused");
  });
});

describe("what a page opens on", () => {
  test("the workspace as it stands, and the events after where the recent ones start", () => {
    const { hub } = setup();
    const opening = hub.opening(3);
    expect(opening.workspace).toEqual(hub.workspace);
    expect(opening.from).toBe(hub.workspace.seq - 3);
    expect(opening.events.map((e) => e.seq)).toEqual([
      hub.workspace.seq - 2,
      hub.workspace.seq - 1,
      hub.workspace.seq,
    ]);
  });

  test("the older events come later, on demand, up to where the recent ones start", () => {
    const { hub } = setup();
    const { from, events } = hub.opening(3);
    const older = hub.pageEventsUpTo(from);
    expect([...older, ...events].map((e) => e.seq)).toEqual(hub.events.map((e) => e.seq));
  });
});
