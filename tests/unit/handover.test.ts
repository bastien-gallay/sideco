/**
 * A hand-over goes to one session: by default the last one to write on the
 * board, named beside the button; only that one is woken, and only it is told
 * the turn is its own.
 */
import { describe, expect, test } from "bun:test";
import { parseBatch } from "../../src/cli/argv.ts";
import { type Command, parseCommand } from "../../src/domain/commands.ts";
import { addressee } from "../../src/domain/sessions.ts";
import { findBoard } from "../../src/domain/workspace.ts";
import { Hub } from "../../src/server/hub.ts";
import { memoryJournal } from "../../src/server/journal.ts";
import { describeEvent, sessionName } from "../../src/web/event-words.ts";
import { ORDERING, T0 } from "../support.ts";

const batch = (script: string, board = "commande"): Command[] => parseBatch(script, board).map(parseCommand);

/** Two sessions that both wrote on "commande": `first`, then `second`. */
function setup() {
  const hub = new Hub(memoryJournal(), () => new Date(T0));
  const as = (session: string | undefined, script: string, actor: "agent" | "human" = "agent") =>
    hub.dispatch(batch(script), { actor, session });
  for (const session of ["first", "second"])
    hub.dispatch([parseCommand({ kind: "session-start", cwd: `/dev/${session}` })], {
      actor: "agent",
      session,
    });
  as("first", ORDERING);
  as("second", 'rename E1 "Validée"');
  return { hub, as };
}

describe("whom a hand-over is for", () => {
  test("by default, the last session to write on the board", () => {
    const { hub, as } = setup();
    expect(addressee(hub.workspace, "commande")?.id).toBe("second");
    as("first", 'add event "Payée" --col 3');
    expect(addressee(hub.workspace, "commande")?.id).toBe("first");
  });

  test("a session that ended is passed over for the latest one the board is for", () => {
    const { hub } = setup();
    hub.dispatch([parseCommand({ kind: "session-end" })], { actor: "agent", session: "second" });
    expect(addressee(hub.workspace, "commande")?.id).toBe("first");
  });

  test("the human's own edits and the agent's reads do not change it", () => {
    const { hub, as } = setup();
    as(undefined, 'rename E2 "Expédiée"', "human");
    hub.dispatch([parseCommand({ kind: "follow", boards: ["commande"] })], {
      actor: "agent",
      session: "first",
    });
    expect(addressee(hub.workspace, "commande")?.id).toBe("second");
  });

  test("the hand-over records it, and the turn keeps it", () => {
    const { hub, as } = setup();
    as(undefined, 'pass "à toi" --to agent', "human");
    expect(hub.events.at(-1)).toMatchObject({ event: "TurnPassed", to: "agent", target: "second" });
    expect(findBoard(hub.workspace, "commande")?.turn).toMatchObject({ to: "agent", target: "second" });
  });

  test("another session can be named; one that does not exist is refused", () => {
    const { hub, as } = setup();
    as(undefined, "pass --to agent --for first", "human");
    expect(findBoard(hub.workspace, "commande")?.turn?.target).toBe("first");
    expect(() => as(undefined, "pass --to agent --for nobody", "human")).toThrow('no session "nobody"');
  });

  test("a hand-over to the human names nobody", () => {
    const { hub, as } = setup();
    as("second", 'pass "à toi"');
    expect(findBoard(hub.workspace, "commande")?.turn?.target).toBeUndefined();
  });
});

describe("only that session is woken", () => {
  test("of two sessions waiting on the board, the addressee alone", async () => {
    const { hub, as } = setup();
    const first = hub.waitForTurn("first", 60_000);
    const second = hub.waitForTurn("second", 60_000);
    as(undefined, "pass --to agent", "human");
    expect(await second).toBe("passed");
    expect(hub.listening).toBe(1);
    expect(hub.hasPendingTurn("first")).toBe(false);
    hub.abandon("first");
    expect(await first).toBe("released");
  });

  test("a session that comes to wait after the hand-over finds it, if it is its own", async () => {
    const { hub, as } = setup();
    as(undefined, "pass --to agent --for first", "human");
    expect(hub.hasPendingTurn("first")).toBe(true);
    expect(hub.hasPendingTurn("second")).toBe(false);
    expect(await hub.waitForTurn("first", 60_000)).toBe("passed");
  });
});

describe("the page names it", () => {
  test("a session by its folder and the start of its id", () => {
    const { hub } = setup();
    const second = hub.workspace.sessions.find((s) => s.id === "second");
    if (!second) throw new Error("no session");
    expect(sessionName(second)).toBe("second · second");
    expect(sessionName({ ...second, id: "0f3a9c21-77", cwd: undefined })).toBe("0f3a9c");
  });

  test("a named session by its name alone, as the picker in the header says it", () => {
    const { hub } = setup();
    const second = hub.workspace.sessions.find((s) => s.id === "second");
    if (!second) throw new Error("no session");
    expect(sessionName({ ...second, name: "sideco-gq" })).toBe("sideco-gq");
  });

  test("the history says whom the turn went to", () => {
    const { hub, as } = setup();
    as(undefined, 'pass "à toi" --to agent', "human");
    const passed = hub.events.at(-1) as never;
    expect(describeEvent(passed, "en", hub.workspace)).toBe("You send to Claude (second · second): à toi");
    expect(describeEvent(passed, "fr", hub.workspace)).toBe("Tu envoies à Claude (second · second) : à toi");
  });
});
