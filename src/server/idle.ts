/**
 * When the companion is no longer of use, so it can stop by itself: no page
 * shows the boards, no session waits for the human, and every session that
 * used it has ended. It stops only once that has lasted a grace period, so a
 * page that reloads or a session that starts right after does not find it gone.
 */
import type { Recorded } from "../domain/events.ts";
import type { Hub } from "./hub.ts";

/** How long the companion stays once nothing uses it. */
export const IDLE_GRACE_MS = 5 * 60 * 1000;
/**
 * A session silent for this long was killed rather than ended: it never sent
 * `SessionEnded`. A working day, as long as a session at rest stays reachable.
 */
export const STALE_SESSION_MS = 12 * 60 * 60 * 1000;
/** How often the companion looks. */
export const IDLE_CHECK_MS = 30 * 1000;

export interface IdleOptions {
  graceMs: number;
  staleMs: number;
  onIdle: () => void;
}

/** Sessions that have not ended and spoke within `staleMs` of `now`. */
export function openSessions(hub: Hub, now: number, staleMs: number): number {
  return hub.workspace.sessions.filter((session) => {
    if (session.status === "ended") return false;
    const last = eventAt(hub.events, session.lastSeq);
    return last !== undefined && now - Date.parse(last.ts) < staleMs;
  }).length;
}

/** Whether anyone still uses the companion. */
export function inUse(hub: Hub, now: number, staleMs: number): boolean {
  return hub.watching > 0 || hub.listening > 0 || openSessions(hub, now, staleMs) > 0;
}

/** Looks, when asked, whether the companion has been of no use for the whole grace, and says so once. */
export class IdleWatch {
  private idleSince: number | undefined;
  private done = false;

  constructor(
    private readonly hub: Hub,
    private readonly options: IdleOptions,
  ) {}

  check(now: number): void {
    if (this.done) return;
    if (inUse(this.hub, now, this.options.staleMs)) {
      this.idleSince = undefined;
      return;
    }
    this.idleSince ??= now;
    if (now - this.idleSince < this.options.graceMs) return;
    this.done = true;
    this.options.onIdle();
  }
}

/** The event of sequence `seq`. The journal numbers its events from 1 without gaps; look further if not. */
function eventAt(events: readonly Recorded[], seq: number): Recorded | undefined {
  const guess = events[seq - 1];
  return guess?.seq === seq ? guess : events.find((e) => e.seq === seq);
}
