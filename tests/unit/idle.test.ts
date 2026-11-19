import { expect, test } from "bun:test";
import type { Command } from "../../src/domain/commands.ts";
import { Hub } from "../../src/server/hub.ts";
import { IdleWatch, openSessions } from "../../src/server/idle.ts";
import { memoryJournal } from "../../src/server/journal.ts";

const T0 = Date.parse("2026-11-19T09:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

function setup() {
  let now = T0;
  const hub = new Hub(memoryJournal(), () => new Date(now));
  let stopped = 0;
  const watch = new IdleWatch(hub, { graceMs: 5 * MIN, staleMs: 12 * HOUR, onIdle: () => stopped++ });
  const agent = (session: string, ...commands: Command[]) =>
    hub.dispatch(commands, { actor: "agent", session });
  return {
    hub,
    agent,
    watch,
    stopped: () => stopped,
    /** Moves the clock and lets the watch look. */
    at(ms: number) {
      now = T0 + ms;
      watch.check(now);
    },
  };
}

test("a companion nobody uses stops once the grace is over, not before", () => {
  const s = setup();
  s.at(0);
  s.at(5 * MIN - 1);
  expect(s.stopped()).toBe(0);
  s.at(5 * MIN);
  expect(s.stopped()).toBe(1);
});

test("it stops once, even when looked at again", () => {
  const s = setup();
  s.at(0);
  s.at(5 * MIN);
  s.at(10 * MIN);
  expect(s.stopped()).toBe(1);
});

test("an open session keeps it running; the grace starts when that session ends", () => {
  const s = setup();
  s.agent("s1", { kind: "session-start" });
  s.at(0);
  s.at(60 * MIN);
  expect(s.stopped()).toBe(0);
  s.agent("s1", { kind: "session-end" });
  s.at(61 * MIN);
  s.at(66 * MIN - 1);
  expect(s.stopped()).toBe(0);
  s.at(66 * MIN);
  expect(s.stopped()).toBe(1);
});

test("the last of several sessions to end is the one that counts", () => {
  const s = setup();
  s.agent("s1", { kind: "session-start" });
  s.agent("s2", { kind: "session-start" });
  s.agent("s1", { kind: "session-end" });
  s.at(0);
  s.at(30 * MIN);
  expect(s.stopped()).toBe(0);
  s.agent("s2", { kind: "session-end" });
  s.at(31 * MIN);
  s.at(36 * MIN);
  expect(s.stopped()).toBe(1);
});

test("a page left open keeps it running; closing it starts the grace", () => {
  const s = setup();
  const close = s.hub.subscribe(() => {});
  s.at(0);
  s.at(60 * MIN);
  expect(s.stopped()).toBe(0);
  close();
  s.at(61 * MIN);
  s.at(66 * MIN);
  expect(s.stopped()).toBe(1);
});

test("a use that comes back during the grace starts it over", () => {
  const s = setup();
  s.at(0);
  const close = s.hub.subscribe(() => {});
  s.at(4 * MIN);
  close();
  s.at(5 * MIN);
  s.at(9 * MIN);
  expect(s.stopped()).toBe(0);
  s.at(10 * MIN);
  expect(s.stopped()).toBe(1);
});

test("a session waiting for the human keeps it running", () => {
  const s = setup();
  s.agent("s1", { kind: "session-start" }, { kind: "session-end" });
  void s.hub.waitForTurn("s1", 24 * HOUR);
  s.at(0);
  s.at(60 * MIN);
  expect(s.stopped()).toBe(0);
  s.hub.abandon("s1");
  s.at(61 * MIN);
  s.at(66 * MIN);
  expect(s.stopped()).toBe(1);
});

test("a session silent for longer than the stale delay no longer counts: it was killed, not ended", () => {
  const s = setup();
  s.agent("s1", { kind: "session-start" });
  expect(openSessions(s.hub, T0 + 12 * HOUR - 1, 12 * HOUR)).toBe(1);
  expect(openSessions(s.hub, T0 + 12 * HOUR, 12 * HOUR)).toBe(0);
});

test("any event of a session keeps it fresh", () => {
  const s = setup();
  s.agent("s1", { kind: "session-start" });
  s.at(11 * HOUR);
  s.agent("s1", { kind: "prompt", text: "encore" });
  expect(openSessions(s.hub, T0 + 20 * HOUR, 12 * HOUR)).toBe(1);
});

test("the human's own edits are not a session", () => {
  const s = setup();
  s.hub.dispatch([{ kind: "create-board", board: "b", format: "kanban", title: "T" }], { actor: "human" });
  expect(openSessions(s.hub, T0, 12 * HOUR)).toBe(0);
});
