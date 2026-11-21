/**
 * A page opens on the workspace as it stands and the recent events only (see
 * `domain/opening.ts`); the older ones are fetched when the page needs them.
 */
import type { Recorded } from "../domain/events.ts";

/** Whether what happened after `since` reaches back before the events held, which start after `from`. */
export function needsPast(from: number, since: number): boolean {
  return since < from;
}

/** The older events before the ones held, each once, in journal order. */
export function withPast(held: readonly Recorded[], older: readonly Recorded[]): Recorded[] {
  const first = held[0]?.seq ?? Number.POSITIVE_INFINITY;
  return [...older.filter((e) => e.seq < first), ...held];
}
