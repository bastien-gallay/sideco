/**
 * The page's state: the journal as received, the workspace folded from it, and
 * what the human is looking at. The page folds events with the same `apply` the
 * server uses, so both always agree on what a board is.
 */
import type { Command } from "../domain/commands.ts";
import type { Recorded } from "../domain/events.ts";
import { handledAll } from "../domain/handled-all.ts";
import { asBoardId, asElementId } from "../domain/ids.ts";
import { boardLink, cardLink, readLink } from "../domain/links.ts";
import type { Opening } from "../domain/opening.ts";
import type { Presence } from "../domain/presence.ts";
import {
  apply,
  type Board,
  emptyWorkspace,
  findBoard,
  replay,
  type Session,
  shownSession,
  type Workspace,
} from "../domain/workspace.ts";
import { t } from "./locale.ts";
import { needsPast, withPast } from "./past.ts";
import { postCommands } from "./post.ts";
import type { Frame } from "./relay.ts";
import { connect } from "./stream.ts";

export interface State {
  /** The events held: the recent ones the page opened with, and the past once fetched. */
  events: Recorded[];
  /** The events held start after this one: the past up to it is fetched when needed. */
  from: number;
  live: Workspace;
  /** A journal position when looking at the past; null when live. */
  cursor: number | null;
  past: Workspace | null;
  boardId: string | null;
  /** The session the reader chose to watch; null lets the board in view decide (see `shownSession`). */
  sessionId: string | null;
  selected: string | null;
  /** The element a link is being drawn from. */
  linking: string | null;
  /** Agent sessions blocked on `sideco wait` right now. */
  listening: number;
  connected: boolean;
  /** A save has waited long enough for the companion's answer to be worth saying. */
  saving: boolean;
  /** The build of the page the companion serves now; null until it has said. */
  served: string | null;
  /** Elements that changed moments ago, to draw the eye. */
  fresh: Set<string>;
  error: string | null;
  /** Something worth a line to the human, said once. */
  notice: string | null;
}

export const state: State = {
  events: [],
  from: 0,
  live: emptyWorkspace(),
  cursor: null,
  past: null,
  boardId: null,
  sessionId: null,
  selected: null,
  linking: null,
  listening: 0,
  // Assumed until the stream says otherwise, so the first paint does not cry wolf.
  connected: true,
  saving: false,
  served: null,
  fresh: new Set(),
  error: null,
  notice: null,
};

/**
 * False while the stream replays the journal. The server closes that replay
 * with its first presence frame; only what comes after is news.
 */
let caughtUp = false;

/** Whether the journal is all here: what was missed is measured on it whole, never on a replay half done. */
export function caughtUpYet(): boolean {
  return caughtUp;
}

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
  const build = document.querySelector<HTMLMetaElement>('meta[name="sideco-build"]')?.content;
  connect(build, hear);
}

function hear(frame: Frame): void {
  switch (frame.kind) {
    case "open":
    case "error":
      state.connected = frame.kind === "open";
      // An opened stream is followed by its replay: drawing now would show it half folded.
      if (frame.kind === "error" || caughtUp) changed();
      return;
    case "snapshot": {
      // Folded by the companion: the recent events come to be read, not folded again.
      const opening = JSON.parse(frame.data) as Opening;
      state.live = opening.workspace;
      state.events = opening.events;
      state.from = opening.from;
      return;
    }
    case "event":
      receive(JSON.parse(frame.data) as Recorded);
      return;
    case "reset":
      // Another run of the companion answered: its journal may not be the one folded here.
      forget();
      changed();
      return;
    case "presence": {
      const presence = JSON.parse(frame.data) as Presence;
      state.listening = presence.listening;
      state.served = presence.build;
      if (!caughtUp) {
        leaveMissingBoard();
        holdShownBoard();
      }
      caughtUp = true;
      changed();
      return;
    }
    default:
      handledAll(frame);
  }
}

/** Drops everything folded so far; the next replay rebuilds it. */
function forget(): void {
  caughtUp = false;
  state.events = [];
  state.from = 0;
  pastAsked = null;
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

/**
 * A tab opened on no board in particular shows the latest one, and names it in
 * its address: from then on it is that tab's board, whatever is created after,
 * and Undo acts on it.
 */
function holdShownBoard(): void {
  const shown = state.live.boards.at(-1);
  if (state.boardId !== null || !shown) return;
  history.replaceState(null, "", `${location.pathname}${location.search}#/b/${shown.id}`);
  state.boardId = shown.id;
}

function receive(event: Recorded): void {
  if (event.seq <= state.live.seq) return;
  state.events.push(event);
  apply(state.live, event);
  // A replay is drawn once, whole, when its presence frame closes it: never half folded.
  if (!caughtUp) return;
  announce(event);
  changed();
}

/** News, as opposed to history: draw the eye to it, and never move the human off their board. */
function announce(event: Recorded): void {
  if ("board" in event && "id" in event && event.event !== "ElementRemoved")
    markFresh(`${event.board}/${event.id}`);
  if (event.event === "BoardRemoved") {
    if (event.actor === "agent") state.notice = t.agentRemovedBoard(event.title);
    leaveMissingBoard();
    return;
  }
  if (event.event === "BoardRestored") {
    // The human took their removal back: they return to the board they were on.
    if (event.actor === "human") openBoard(event.board);
    else state.notice = t.agentRestoredBoard(event.title);
    return;
  }
  if (event.event !== "BoardCreated") return;
  if (state.boardId === null) openBoard(event.board);
  else if (event.actor === "agent" && event.board !== state.boardId)
    state.notice = t.agentCreatedBoard(event.title);
}

export function markFresh(key: string): void {
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
  return readLink(location.hash)?.board ?? null;
}

/** The card the address names, with its board: a link to a card opens on it. */
export function linkedCard(): { board: string; id: string } | undefined {
  const link = readLink(location.hash);
  return link?.card ? { board: link.board, id: link.card } : undefined;
}

/** The address says the card chosen, or the board alone: a copied address leads back to it. */
export function showChosen(board: string, id: string | null): void {
  // An address naming another board is a way out not yet taken: it is left to the page to follow.
  const shown = readLink(location.hash)?.board;
  if (shown !== board || !shown) return;
  const card = id ? asElementId(id) : undefined;
  const hash = card ? cardLink(shown, card) : boardLink(shown);
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

/** The board, or the card on it, in the address: the page opens there. */
export function openBoard(id: string, card?: string): void {
  const board = asBoardId(id);
  const element = card ? asElementId(card) : undefined;
  if (board) location.hash = element ? cardLink(board, element) : boardLink(board);
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
  return shownSession(shown(), currentBoard()?.id, state.sessionId ?? undefined);
}

export function isLive(): boolean {
  return state.cursor === null;
}

/**
 * The events held, the past fetched first when what happened after `since`
 * reaches back before them: drawn again once it is here.
 */
export function journal(since = 0): Recorded[] {
  if (needsPast(state.from, since)) void fetchPast();
  return state.events;
}

/**
 * The events a session's digest reads: those after what it was told. One told
 * nothing yet follows no board's past (see `recentFrom`): the events held do.
 */
export function journalFor(session: Session | undefined): Recorded[] {
  return journal(session?.deliveredUpTo || state.from);
}

/** Whether every event after `since` is held; if not, the past is fetched and the page drawn again. */
export function heldSince(since: number): boolean {
  journal(since);
  return !needsPast(state.from, since);
}

let pastAsked: Promise<void> | null = null;

/** The events the page opened without, asked once; a stream that starts over asks again. */
function fetchPast(): Promise<void> {
  if (pastAsked) return pastAsked;
  const upTo = state.from;
  const asked = fetch(`/api/history?upTo=${upTo}`)
    .then((response) => (response.ok ? (response.json() as Promise<{ events: Recorded[] }>) : null))
    .then((answer) => {
      // Another stream started over meanwhile: this answer is for a journal no longer held.
      if (pastAsked !== asked) return;
      if (!answer) {
        pastAsked = null;
        return;
      }
      state.events = withPast(state.events, answer.events);
      state.from = 0;
      changed();
    })
    .catch(() => {
      if (pastAsked === asked) pastAsked = null;
    });
  pastAsked = asked;
  return asked;
}

export function travelTo(seq: number | null): void {
  // The past is folded from the first event: fetched first, then the trip is made.
  if (seq !== null && needsPast(state.from, 0)) {
    void fetchPast().then(() => state.from === 0 && travelTo(seq));
    return;
  }
  const last = state.live.seq;
  state.cursor = seq === null || seq >= last ? null : seq;
  state.past =
    state.cursor === null ? null : replay(state.events.filter((e) => e.seq <= (state.cursor ?? 0)));
  state.selected = null;
  state.linking = null;
  changed();
}

/** How long the companion has to answer a save; past that, the save has failed. */
const SEND_TIMEOUT_MS = 8000;
/** A save answered sooner says nothing: the board changing is answer enough. */
const SLOW_MS = 300;
let inFlight = 0;

/**
 * Sends the human's commands. The board updates when the events come back on
 * the stream. Undefined when nothing was saved: refused, out of reach, or not
 * answered in time — the error says which.
 */
export async function send(...commands: Command[]): Promise<(string | null)[] | undefined> {
  if (!isLive()) return undefined;
  inFlight++;
  const posted = await postCommands(JSON.stringify({ actor: "human", commands }), {
    fetch: (input, init) => fetch(input, init),
    timeoutMs: SEND_TIMEOUT_MS,
    slowMs: SLOW_MS,
    onSlow: () => {
      state.saving = true;
      changed();
    },
  });
  inFlight--;
  if (inFlight === 0) state.saving = false;
  if (posted.ok) {
    state.error = null;
    changed();
    return posted.minted;
  }
  state.error =
    posted.reason === "timeout" ? t.noAnswer : posted.reason === "unreachable" ? t.unreachable : posted.error;
  changed();
  return undefined;
}
