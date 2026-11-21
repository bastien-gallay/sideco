/**
 * A page opens on the workspace as it stands and the recent events only; the
 * older ones come when it needs its past. They go before the recent ones, each
 * event once, in journal order.
 */
import { expect, test } from "bun:test";
import type { Recorded } from "../../src/domain/events.ts";
import { needsPast, withPast } from "../../src/web/past.ts";

const at = (seq: number): Recorded =>
  ({ seq, ts: "", actor: "human", event: "BoardRemoved", board: "b", title: "" }) as unknown as Recorded;
const seqs = (events: readonly Recorded[]): number[] => events.map((e) => e.seq);

test("the past goes before the recent events, in journal order", () => {
  expect(seqs(withPast([at(4), at(5)], [at(1), at(2), at(3)]))).toEqual([1, 2, 3, 4, 5]);
});

test("an event already held is not held twice, whatever the answer overlaps", () => {
  expect(seqs(withPast([at(3), at(4)], [at(2), at(3)]))).toEqual([2, 3, 4]);
});

test("the past is needed for what happened since a moment the page opened after", () => {
  // Opened on the events after 100: what happened since 50 is partly missing.
  expect(needsPast(100, 50)).toBe(true);
  expect(needsPast(100, 99)).toBe(true);
  // Since 100 or later, every event is here.
  expect(needsPast(100, 100)).toBe(false);
  expect(needsPast(100, 140)).toBe(false);
  // A page that opened on the whole journal never needs it, not even to travel back to the start.
  expect(needsPast(0, 0)).toBe(false);
});
