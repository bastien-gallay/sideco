/**
 * Several terminal sessions in one project: each is told what happens on the
 * boards it follows, and only there. A session follows a board by writing on
 * it or by saying so; a board no running session follows is for all of them.
 */
import { describe, expect, test } from "bun:test";
import { parseBatch } from "../../src/cli/argv.ts";
import { type Command, parseCommand } from "../../src/domain/commands.ts";
import type { Actor } from "../../src/domain/events.ts";
import { readerOf } from "../../src/domain/sessions.ts";
import { Hub } from "../../src/server/hub.ts";
import { memoryJournal } from "../../src/server/journal.ts";
import { pendingChanges, unreadOn } from "../../src/web/view.ts";
import { KANBAN, ORDERING, T0 } from "../support.ts";

const batch = (script: string, board?: string): Command[] => parseBatch(script, board).map(parseCommand);

/** Two sessions: `mine` wrote the board "commande", `other` never touched a board. */
function setup(): { hub: Hub; run: (script: string, actor?: Actor, session?: string) => void } {
  const hub = new Hub(memoryJournal(), () => new Date(T0));
  const run = (text: string, actor: Actor = "agent", session?: string): void => {
    hub.dispatch(batch(text, "commande"), { actor, session });
  };
  for (const session of ["mine", "other"])
    hub.dispatch([parseCommand({ kind: "session-start" })], { actor: "agent", session });
  run(ORDERING, "agent", "mine");
  return { hub, run };
}

const say = (hub: Hub, session: string, kind: "follow" | "unfollow", ...boards: string[]): void => {
  hub.dispatch([parseCommand({ kind, boards })], { actor: "agent", session });
};

describe("which session is told what", () => {
  test("a hand-over on a board reaches the session that wrote on it, not the other", () => {
    const { hub, run } = setup();
    run('rename E1 "Validée"\npass "à toi" --to agent', "human");
    expect(hub.hasPendingTurn("mine")).toBe(true);
    expect(hub.changesFor("mine", false).text).toContain("E1 renamed");
    expect(hub.hasPendingTurn("other")).toBe(false);
    expect(hub.changesFor("other", false).text).toBe("");
  });

  test("a session parked for a hand-over is not woken by one on a board it does not follow", async () => {
    const { hub, run } = setup();
    const other = hub.waitForTurn("other", 60_000);
    const mine = hub.waitForTurn("mine", 60_000);
    run("pass --to agent", "human");
    expect(await mine).toBe("passed");
    expect(hub.listening).toBe(1);
    hub.abandon("other");
    expect(await other).toBe("released");
  });

  test("a board no running session follows is for every session", () => {
    const { hub } = setup();
    hub.dispatch(batch(KANBAN), { actor: "human" });
    hub.dispatch(batch("pass --to agent", "sprint"), { actor: "human" });
    expect(hub.changesFor("mine", false).text).toContain("Sprint 12");
    expect(hub.changesFor("other", false).text).toContain("Sprint 12");
    // The first to write on it takes it.
    hub.dispatch(batch('add task "Relire"', "sprint"), { actor: "agent", session: "other" });
    hub.dispatch(batch('add task "Du nouveau"', "sprint"), { actor: "human" });
    expect(hub.changesFor("other", false).text).toContain("Du nouveau");
    expect(hub.changesFor("mine", false).text).not.toContain("Du nouveau");
  });

  test("the board of a session that ended is for the others again", () => {
    const { hub, run } = setup();
    hub.dispatch([parseCommand({ kind: "session-end" })], { actor: "agent", session: "mine" });
    run('rename E1 "Validée"', "human");
    expect(hub.changesFor("other", false).text).toContain("E1 renamed");
  });

  test("`follow` takes a board without writing on it; `unfollow` lets go of one, even written on", () => {
    const { hub, run } = setup();
    say(hub, "other", "follow", "commande");
    say(hub, "mine", "unfollow", "commande");
    run('rename E1 "Validée"', "human");
    expect(hub.changesFor("other", false).text).toContain("E1 renamed");
    expect(hub.changesFor("mine", false).text).toBe("");
    // Let go by all: it is not for the one who let go, as long as another session runs.
    say(hub, "other", "unfollow", "commande");
    run('rename E1 "Refaite"', "human");
    expect(hub.changesFor("mine", false).text).toBe("");
    // Writing on it again takes it back.
    run('rename E2 "Stock tenu"', "agent", "mine");
    run('rename E1 "Encore"', "human");
    expect(hub.changesFor("mine", false).text).toContain("E1 renamed");
  });

  test("following says nothing twice, and refuses a board that does not exist", () => {
    const { hub } = setup();
    const seq = hub.workspace.seq;
    say(hub, "mine", "follow", "commande");
    expect(hub.workspace.seq).toBe(seq);
    expect(() => say(hub, "other", "follow", "nulle-part")).toThrow('no board "nulle-part"');
  });

  test("what a session is told once it follows a board starts from its last delivery, not from the beginning", () => {
    const { hub, run } = setup();
    run('rename E1 "Avant"', "human");
    hub.dispatch(batch(KANBAN), { actor: "human" });
    hub.changesFor("other", true);
    say(hub, "other", "follow", "commande");
    run('rename E2 "Après"', "human");
    const told = hub.changesFor("other", false).text;
    expect(told).toContain("E2 renamed");
    expect(told).not.toContain("E1 renamed");
  });

  test("a board's unread marks are measured against the session it is for, not the last one to speak", () => {
    const { hub, run } = setup();
    hub.changesFor("other", true);
    run('rename E1 "Validée"', "human");
    hub.changesFor("mine", true);
    // The other session speaks last; it was never told about "commande".
    hub.dispatch([parseCommand({ kind: "prompt", text: "ailleurs" })], { actor: "agent", session: "other" });
    const reader = readerOf(hub.workspace, "commande");
    expect(reader?.id).toBe("mine");
    expect(unreadOn(pendingChanges(hub.events, reader), "commande").cards).toEqual([]);
    run('rename E2 "Après"', "human");
    const again = readerOf(hub.workspace, "commande");
    expect(unreadOn(pendingChanges(hub.events, again), "commande").cards).toEqual(["E2"]);
  });

  test("a board nobody follows is read by the latest session that it is for", () => {
    const { hub } = setup();
    hub.dispatch(batch(KANBAN), { actor: "human" });
    hub.dispatch([parseCommand({ kind: "prompt", text: "là" })], { actor: "agent", session: "other" });
    expect(readerOf(hub.workspace, "sprint")?.id).toBe("other");
    say(hub, "other", "unfollow", "sprint");
    expect(readerOf(hub.workspace, "sprint")?.id).toBe("mine");
  });

  test("a session that starts is not told again what another session was already told (T175)", () => {
    const { hub } = setup();
    hub.dispatch(batch(KANBAN), { actor: "human" });
    hub.dispatch(batch('pass "relis le sprint" --to agent', "sprint"), { actor: "human" });
    expect(hub.changesFor("other", true).passed).toBe(true);
    hub.dispatch([parseCommand({ kind: "session-start" })], { actor: "agent", session: "late" });
    expect(hub.hasPendingTurn("late")).toBe(false);
    expect(hub.changesFor("late", false)).toMatchObject({ text: "", passed: false });
  });

  test("what no session was told yet waits for the next one, even one that starts after it", () => {
    const hub = new Hub(memoryJournal(), () => new Date(T0));
    hub.dispatch(batch(KANBAN), { actor: "human" });
    hub.dispatch(batch('pass "à toi" --to agent', "sprint"), { actor: "human" });
    hub.dispatch([parseCommand({ kind: "session-start" })], { actor: "agent", session: "first" });
    expect(hub.hasPendingTurn("first")).toBe(true);
    expect(hub.changesFor("first", false)).toMatchObject({ passed: true });
    expect(hub.changesFor("first", false).text).toContain("Sprint 12");
  });

  test("a hand-over on a board removed since is no hand-over", () => {
    const hub = new Hub(memoryJournal(), () => new Date(T0));
    hub.dispatch(batch(KANBAN), { actor: "human" });
    hub.dispatch(batch('pass "à toi" --to agent', "sprint"), { actor: "human" });
    hub.dispatch([parseCommand({ kind: "remove-board", board: "sprint" })], { actor: "human" });
    hub.dispatch([parseCommand({ kind: "session-start" })], { actor: "agent", session: "first" });
    expect(hub.hasPendingTurn("first")).toBe(false);
    expect(hub.changesFor("first", false).passed).toBe(false);
  });
});
