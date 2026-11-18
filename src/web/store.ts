/**
 * The page's state: the journal as received, the workspace folded from it, and
 * what the human is looking at. The page folds events with the same `apply` the
 * server uses, so both always agree on what a board is.
 */
import type { Command } from "../domain/commands.ts";
import type { Recorded } from "../domain/events.ts";
import {
  apply,
  type Board,
  emptyWorkspace,
  findBoard,
  latestSession,
  replay,
  type Session,
  type Workspace,
} from "../domain/workspace.ts";

export interface State {
  events: Recorded[];
  live: Workspace;
  /** A journal position when looking at the past; null when live. */
  cursor: number | null;
  past: Workspace | null;
  boardId: string | null;
  selected: string | null;
  /** The element a link is being drawn from. */
  linking: string | null;
  /** Agent sessions blocked on `vico wait` right now. */
  listening: number;
  connected: boolean;
  /** Elements that changed moments ago, to draw the eye. */
  fresh: Set<string>;
  error: string | null;
  /** Something worth a line to the human, said once. */
  notice: string | null;
}

export const state: State = {
  events: [],
  live: emptyWorkspace(),
  cursor: null,
  past: null,
  boardId: null,
  selected: null,
  linking: null,
  listening: 0,
  // Assumed until the stream says otherwise, so the first paint does not cry wolf.
  connected: true,
  fresh: new Set(),
  error: null,
  notice: null,
};

/**
 * False while the stream replays the journal. The server closes that replay
 * with its first presence frame; only what comes after is news.
 */
let caughtUp = false;

/** The run of the companion this state was folded from. */
let run: string | null = null;

const FRESH_MS = 2600;
let scheduled = false;
let onChange: () => void = () => {};

export function start(render: () => void): void {
  onChange = render;
  follow();
  window.addEventListener("hashchange", () => {
    state.boardId = boardFromHash();
    state.selected = null;
    state.linking = null;
    changed();
  });
  state.boardId = boardFromHash();
}

/** Follows the journal: its replay first, then each event as it is recorded. */
function follow(): void {
  const source = new EventSource("/api/events");
  source.onopen = () => {
    state.connected = true;
    changed();
  };
  source.onerror = () => {
    state.connected = false;
    changed();
  };
  source.onmessage = (message) => receive(JSON.parse(message.data) as Recorded);
  source.addEventListener("presence", (message) => {
    const presence = JSON.parse((message as MessageEvent<string>).data) as { listening: number; run: string };
    if (run !== null && presence.run !== run) {
      // Another run of the companion answered: its journal may not be the one folded here.
      source.close();
      forget();
      follow();
      return;
    }
    run = presence.run;
    state.listening = presence.listening;
    if (!caughtUp) leaveMissingBoard();
    caughtUp = true;
    changed();
  });
}

/** Drops everything folded so far; the next replay rebuilds it. */
function forget(): void {
  run = null;
  caughtUp = false;
  state.events = [];
  state.live = emptyWorkspace();
  state.cursor = null;
  state.past = null;
  state.selected = null;
  state.linking = null;
  state.fresh.clear();
}

/** When the board in the address is not there (removed, or never was), shows one that is. */
function leaveMissingBoard(): void {
  if (state.boardId === null || findBoard(state.live, state.boardId)) return;
  const next = state.live.boards.at(-1);
  if (next) openBoard(next.id);
  else closeBoard();
}

function receive(event: Recorded): void {
  if (event.seq <= state.live.seq) return;
  state.events.push(event);
  apply(state.live, event);
  if (caughtUp) announce(event);
  changed();
}

/** News, as opposed to history: draw the eye to it, and never move the human off their board. */
function announce(event: Recorded): void {
  if ("board" in event && "id" in event && event.event !== "ElementRemoved")
    markFresh(`${event.board}/${event.id}`);
  if (event.event === "BoardRemoved") {
    if (event.actor === "agent") state.notice = `Claude a supprimé le tableau « ${event.title} ».`;
    leaveMissingBoard();
    return;
  }
  if (event.event !== "BoardCreated") return;
  if (state.boardId === null) openBoard(event.board);
  else if (event.actor === "agent" && event.board !== state.boardId)
    state.notice = `Claude a créé le tableau « ${event.title} » : il est dans la liste des tableaux, en haut.`;
}

function markFresh(key: string): void {
  state.fresh.add(key);
  setTimeout(() => {
    state.fresh.delete(key);
    changed();
  }, FRESH_MS);
}

/** Coalesces bursts of events into one paint. */
export function changed(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    onChange();
  });
}

function boardFromHash(): string | null {
  const match = /^#\/b\/([a-z0-9-]+)$/.exec(location.hash);
  return match?.[1] ?? null;
}

export function openBoard(id: string): void {
  location.hash = `#/b/${id}`;
}

/** Back to the first screen: no board in the address. */
function closeBoard(): void {
  history.replaceState(null, "", location.pathname + location.search);
  state.boardId = null;
  state.selected = null;
  state.linking = null;
}

/** The workspace on screen: the past when scrubbing, otherwise live. */
export function shown(): Workspace {
  return state.past ?? state.live;
}

export function currentBoard(): Board | undefined {
  const ws = shown();
  return (state.boardId ? findBoard(ws, state.boardId) : undefined) ?? ws.boards.at(-1);
}

export function currentSession(): Session | undefined {
  return latestSession(shown());
}

export function isLive(): boolean {
  return state.cursor === null;
}

export function travelTo(seq: number | null): void {
  const last = state.live.seq;
  state.cursor = seq === null || seq >= last ? null : seq;
  state.past =
    state.cursor === null ? null : replay(state.events.filter((e) => e.seq <= (state.cursor ?? 0)));
  state.selected = null;
  state.linking = null;
  changed();
}

/** Sends the human's commands. The board updates when the events come back on the stream. */
export async function send(...commands: Command[]): Promise<(string | null)[] | undefined> {
  if (!isLive()) return undefined;
  try {
    const response = await fetch("/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "human", commands }),
    });
    const body = (await response.json()) as { error?: string; minted?: (string | null)[] };
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    state.error = null;
    return body.minted;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    changed();
    return undefined;
  }
}
