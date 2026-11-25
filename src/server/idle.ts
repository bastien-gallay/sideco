/**
 * When the companion is no longer of use, so it can stop by itself: no page
 * shows the boards, no session waits for the human, and every session that
 * used it has ended. It stops only once that has lasted a grace period, so a
 * page that reloads or a session that starts right after does not find it gone.
 */
import { isOpen, STALE_SESSION_MS } from "../domain/sessions.ts";
import type { Hub } from "./hub.ts";

export { STALE_SESSION_MS };

/** How long the companion stays once nothing uses it. */
export const IDLE_GRACE_MS = 5 * 60 * 1000;
/** How often the companion looks. */
export const IDLE_CHECK_MS = 30 * 1000;

export interface IdleOptions {
  graceMs: number;
  staleMs: number;
  onIdle: () => void;
}

/** Sessions that have not ended and spoke within `staleMs` of `now`. */
export function openSessions(hub: Hub, now: number, staleMs: number): number {
  return hub.workspace.sessions.filter((session) => isOpen(session, now, staleMs)).length;
}

/** Whether anyone still uses the companion. */
export function inUse(hub: Hub, now: number, staleMs: number): boolean {
  return hub.watching > 0 || hub.listening > 0 || openSessions(hub, now, staleMs) > 0;
}

/** Looks, when asked, whether the companion has been of no use for the whole grace, and says so once. */
export class IdleWatch {
  private idleSince: number | undefined;
  private done = false;

  /** `hubs` are those the companion has open: it is of use while one of them is. */
  constructor(
    private readonly hubs: Hub | (() => Hub[]),
    private readonly options: IdleOptions,
  ) {}

  check(now: number): void {
    if (this.done) return;
    const hubs = typeof this.hubs === "function" ? this.hubs() : [this.hubs];
    if (hubs.some((hub) => inUse(hub, now, this.options.staleMs))) {
      this.idleSince = undefined;
      return;
    }
    this.idleSince ??= now;
    if (now - this.idleSince < this.options.graceMs) return;
    this.done = true;
    this.options.onIdle();
  }
}
