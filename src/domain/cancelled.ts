/**
 * The gestures an actor made in a span of the journal and took back in it: a
 * digest of that span leaves them out, with the undos that took them back.
 */
import type { Actor, Recorded } from "./events.ts";

/** The journal cut into gestures: an event joined to the one before it belongs to the same gesture. */
function gesturesOf(events: readonly Recorded[]): Recorded[][] {
  const gestures: Recorded[][] = [];
  for (const e of events) {
    const last = gestures.at(-1);
    if ("joined" in e && e.joined && last) last.push(e);
    else gestures.push([e]);
  }
  return gestures;
}

/**
 * The seqs of the gestures `by` made in the span and took back in it, with the
 * undos that took them back: together, they are no news. A redo stays: it is the
 * gesture again.
 */
export function cancelledOut(events: readonly Recorded[], after: number, by: Actor): Set<number> {
  const mine = gesturesOf(events).filter((g) => g[0] && g[0].seq > after && g[0].actor === by);
  // A gesture is known by the seq it ends at: that is the seq an undo names.
  const bySeq = new Map(mine.map((g) => [g.at(-1)?.seq, g]));
  const silent = new Set<number>();
  for (const g of mine) {
    const first = g[0];
    const undone =
      first && "undoes" in first && first.undoes !== undefined ? bySeq.get(first.undoes) : undefined;
    if (undone) for (const e of [...undone, ...g]) silent.add(e.seq);
  }
  return silent;
}
