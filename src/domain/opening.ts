/**
 * What a page opens on: the workspace as it stands, folded here once rather than
 * replayed in the page from the first event, and the recent events it reads
 * (the history it lists, what Claude has not been told). Older events wait
 * until the page asks for them: travelling back in time, or a visit from long ago.
 */
import type { Recorded } from "./events.ts";
import { isOpen, TURNS_SHOWN } from "./sessions.ts";
import type { Workspace } from "./workspace.ts";

/** The first frame of a page's stream: everything up to `workspace.seq` is in it. */
export interface Opening {
  workspace: Workspace;
  /** The events after `from` and up to `workspace.seq`, to read, not to fold again. */
  from: number;
  events: Recorded[];
}

/** How many of the last events a page gets at once, whatever else asks for fewer. */
export const RECENT_EVENTS = 500;

/**
 * Where a page's recent events start: the last `keep` ones, or earlier where an
 * open session has not been told what the human did since. A session told
 * nothing yet follows no board's past, and a silent one is gone (see `isOpen`).
 */
export function recentFrom(ws: Workspace, now: number, keep = RECENT_EVENTS): number {
  const told = ws.sessions.filter((s) => s.deliveredUpTo > 0 && isOpen(s, now)).map((s) => s.deliveredUpTo);
  return Math.max(0, Math.min(ws.seq - keep, ...told));
}

/**
 * The workspace as a page is shown it: of the tools each session ran, only
 * those of the turns its panel shows, as `forThePage` sends them. The others
 * keep their prompt. The hub's own workspace is left as it is.
 */
export function forPage(ws: Workspace): Workspace {
  return {
    ...ws,
    sessions: ws.sessions.map((s) => ({
      ...s,
      turns: s.turns.map((turn, k) => (k < s.turns.length - TURNS_SHOWN ? { ...turn, tools: [] } : turn)),
    })),
  };
}
