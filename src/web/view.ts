/**
 * What the page says, as pure functions of the journal: the agent's status, when
 * it will read the human's changes, where the history stops, and one line per
 * event there.
 * No DOM here, so the wording is tested like any other rule.
 */
import type { Command } from "../domain/commands.ts";
import { type Changes, describeChanges } from "../domain/digest.ts";
import type { Actor, Recorded } from "../domain/events.ts";
import { findFormat, findType } from "../domain/formats.ts";
import { DEFAULT_LOCALE, type Locale } from "../domain/i18n.ts";
import { type Band, type Target, vacancy } from "../domain/layout/index.ts";
import {
  type AgentStatus,
  type Board,
  findBoard,
  findElement,
  type Session,
  type SessionTurn,
  threads,
  type Workspace,
} from "../domain/workspace.ts";
import { MESSAGES } from "./messages.ts";

export type Tone = "off" | "idle" | "busy" | "waiting" | "listening";

export function agentStatus(
  session: Session | undefined,
  listening: number,
  locale: Locale = DEFAULT_LOCALE,
): { tone: Tone; text: string } {
  const m = MESSAGES[locale];
  if (listening > 0) return { tone: "listening", text: m.listening };
  if (!session) return { tone: "off", text: m.noSession };
  switch (session.status) {
    case "ended":
      return { tone: "off", text: m.noSession };
    case "idle":
      return { tone: "idle", text: m.idle };
    case "thinking":
      return { tone: "busy", text: m.thinking };
    case "running":
      return { tone: "busy", text: m.running(session.statusDetail) };
    case "waiting":
      return { tone: "waiting", text: m.waitingInTerminal(session.statusDetail ?? "") };
  }
}

/** The honest answer to "when will Claude see what I just did?". */
export function handOverHint(
  status: AgentStatus | undefined,
  listening: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const m = MESSAGES[locale];
  if (listening > 0) return m.hintListening;
  if (status === undefined || status === "ended") return m.hintNoSession;
  if (status === "running" || status === "thinking") return m.hintWorking;
  return m.hintIdle;
}

/** What the agent would be told now: the same digest it will read. Without a session, nothing was read yet. */
export function pendingChanges(events: readonly Recorded[], session: Session | undefined): Changes {
  return describeChanges(events, session?.deliveredUpTo ?? 0);
}

/** What carries a change of the human that Claude has not read yet, on one board. */
export interface Unread {
  cards: string[];
  /** Each discussion by the id of the note that opened it. */
  threads: string[];
}

/**
 * The cards and discussions to mark on a board: those the pending digest has a
 * line about, so the marks and the count cannot tell two stories.
 */
export function unreadOn(pending: Changes, boardId: string): Unread {
  const named = pending.about.find((subjects) => subjects.board === boardId);
  return { cards: named?.elements ?? [], threads: named?.threads ?? [] };
}

export function recentTurns(session: Session | undefined, max: number): SessionTurn[] {
  return session ? session.turns.slice(-max) : [];
}

/**
 * What the page says right after a hand-over that Claude will not read at once:
 * the page cannot wake a terminal at rest, so it says what will.
 */
export function handOverNotice(
  status: AgentStatus | undefined,
  listening: number,
  locale: Locale = DEFAULT_LOCALE,
): string | undefined {
  const m = MESSAGES[locale];
  if (listening > 0) return undefined;
  if (status === undefined || status === "ended") return m.handedOverNoSession;
  if (status === "running" || status === "thinking") return m.handedOverWorking;
  return m.handedOverIdle;
}

const MAX_LINE = 90;

/** One line of history, in the reader's language. */
export function describeEvent(e: Recorded, locale: Locale = DEFAULT_LOCALE): string {
  return clip(WORDING[locale](e) + answered(e, locale));
}

const WORDING: Record<Locale, (e: Recorded) => string> = { en: english, fr: french };

const ANSWERS: Record<Locale, { undo: string; redo: string }> = {
  en: { undo: " (undo)", redo: " (redo)" },
  fr: { undo: " (annulation)", redo: " (rétablissement)" },
};

/** Says that the line takes an earlier gesture back, or puts it back. */
function answered(e: Recorded, locale: Locale): string {
  if (!("board" in e)) return "";
  if (e.undoes !== undefined) return ANSWERS[locale].undo;
  return e.redoes !== undefined ? ANSWERS[locale].redo : "";
}

function english(e: Recorded): string {
  const you = e.actor === "human";
  const who = { human: "You", agent: "Claude", system: "Sideco" }[e.actor];
  /** `You add`, `Claude adds`. */
  const does = (verb: string, third = `${verb}s`): string => `${who} ${you ? verb : third}`;
  switch (e.event) {
    case "BoardCreated":
      return `${does("create")} the board “${e.title}”`;
    case "BoardRetitled":
      return `${does("rename")} the board to “${e.title}”`;
    case "LaneNamed":
      return e.label
        ? `${does("name")} the lane ${e.lane} “${e.label}”`
        : `${does("give")} the lane ${e.lane} its workshop's name back`;
    case "BoardRemoved":
      return `${does("remove")} the board “${e.title}”`;
    case "BoardRestored":
      return `${does("restore")} the board “${e.title}”`;
    case "ElementAdded":
      return `${does("add")} ${e.id} “${e.label}”`;
    case "ElementRenamed":
      return `${does("rename")} ${e.id} to “${e.label}”`;
    case "ElementAnnotated":
      return `${does("detail")} ${e.id}`;
    case "ElementMarked":
      return `${does("mark")} ${e.id} ${e.done ? "done" : "not done"}`;
    case "ElementMoved":
      return `${does("move")} ${e.id}`;
    case "ElementRemoved":
      return `${does("remove")} ${e.id}`;
    case "ElementRestored":
      return `${does("restore")} ${e.id} “${e.label}”`;
    case "ColumnInserted":
      return `${does("insert")} a column at ${e.at}`;
    case "ColumnMoved":
      return `${does("move")} column ${e.from} to ${e.to}`;
    case "EdgeAdded":
      return `${does("link")} ${e.src} → ${e.dst}`;
    case "EdgeRemoved":
      return `${does("remove")} the link ${e.src} → ${e.dst}`;
    case "FocusSet":
      return `${does("put")} the focus on ${e.ids.join(", ")}${e.reason ? `: ${e.reason}` : ""}`;
    case "FocusCleared":
      return `${does("clear")} the focus`;
    case "NoteAdded": {
      const on = e.target ? ` on ${e.target}` : "";
      if (e.thread) return `${does("reply", "replies")} to ${e.thread}${on}: ${e.text}`;
      return `${does("note")}${on}: ${e.text}`;
    }
    case "NoteResolved":
      return `${does("resolve")} the note ${e.id}`;
    case "TurnPassed": {
      const message = e.message ? `: ${e.message}` : "";
      if (e.to === "agent") return `${does("hand")} over to Claude${message}`;
      return you ? `You keep the turn${message}` : `Claude hands over to you${message}`;
    }
    case "SessionStarted":
      return "Session started";
    case "BoardsFollowed":
      return `Claude follows ${e.boards.join(", ")}`;
    case "BoardsLeft":
      return `Claude no longer follows ${e.boards.join(", ")}`;
    case "PromptSubmitted":
      return `Prompt: ${e.text}`;
    case "ToolStarted":
      return `Claude runs ${e.tool} ${e.summary}`.trim();
    case "ToolFinished":
      return e.ok ? "Tool finished" : "Tool failed";
    case "TodosUpdated":
      return "Claude updates its tasks";
    case "AgentNotified":
      return `Claude is waiting for you: ${e.message}`;
    case "TurnEnded":
      return "Claude ended its turn";
    case "SessionEnded":
      return "Session ended";
    case "ChangesDelivered":
      return "Claude read your changes";
  }
}

function french(e: Recorded): string {
  const you = e.actor === "human";
  const who = { human: "Tu", agent: "Claude", system: "Sideco" }[e.actor];
  /** `Tu ajoutes`, `Claude ajoute`. */
  const verb = (second: string, third: string): string => `${who} ${you ? second : third}`;
  switch (e.event) {
    case "BoardCreated":
      return `${verb("crées", "crée")} le tableau « ${e.title} »`;
    case "BoardRetitled":
      return `${verb("renommes", "renomme")} le tableau en « ${e.title} »`;
    case "LaneNamed":
      return e.label
        ? `${verb("nommes", "nomme")} la colonne ${e.lane} « ${e.label} »`
        : `${verb("rends", "rend")} à la colonne ${e.lane} le nom de son atelier`;
    case "BoardRemoved":
      return `${verb("supprimes", "supprime")} le tableau « ${e.title} »`;
    case "BoardRestored":
      return `${verb("restaures", "restaure")} le tableau « ${e.title} »`;
    case "ElementAdded":
      return `${verb("ajoutes", "ajoute")} ${e.id} « ${e.label} »`;
    case "ElementRenamed":
      return `${verb("renommes", "renomme")} ${e.id} en « ${e.label} »`;
    case "ElementAnnotated":
      return `${verb("détailles", "détaille")} ${e.id}`;
    case "ElementMarked":
      return `${verb("marques", "marque")} ${e.id} comme ${e.done ? "fait" : "non fait"}`;
    case "ElementMoved":
      return `${verb("déplaces", "déplace")} ${e.id}`;
    case "ElementRemoved":
      return `${verb("supprimes", "supprime")} ${e.id}`;
    case "ElementRestored":
      return `${verb("restaures", "restaure")} ${e.id} « ${e.label} »`;
    case "ColumnInserted":
      return `${verb("insères", "insère")} une colonne en ${e.at}`;
    case "ColumnMoved":
      return `${verb("déplaces", "déplace")} la colonne ${e.from} en ${e.to}`;
    case "EdgeAdded":
      return `${verb("relies", "relie")} ${e.src} → ${e.dst}`;
    case "EdgeRemoved":
      return `${verb("retires", "retire")} le lien ${e.src} → ${e.dst}`;
    case "FocusSet":
      return `${verb("mets", "met")} le focus sur ${e.ids.join(", ")}${e.reason ? ` : ${e.reason}` : ""}`;
    case "FocusCleared":
      return `${verb("retires", "retire")} le focus`;
    case "NoteAdded": {
      const on = e.target ? ` sur ${e.target}` : "";
      if (e.thread) return `${verb("réponds", "répond")} à ${e.thread}${on} : ${e.text}`;
      return `${verb("notes", "note")}${on} : ${e.text}`;
    }
    case "NoteResolved":
      return `${verb("résous", "résout")} la note ${e.id}`;
    case "TurnPassed": {
      const message = e.message ? ` : ${e.message}` : "";
      if (e.to === "agent") return `${verb("passes", "passe")} la main à Claude${message}`;
      return you ? `Tu gardes la main${message}` : `Claude te passe la main${message}`;
    }
    case "SessionStarted":
      return "Session démarrée";
    case "BoardsFollowed":
      return `Claude suit ${e.boards.join(", ")}`;
    case "BoardsLeft":
      return `Claude ne suit plus ${e.boards.join(", ")}`;
    case "PromptSubmitted":
      return `Prompt : ${e.text}`;
    case "ToolStarted":
      return `Claude lance ${e.tool} ${e.summary}`.trim();
    case "ToolFinished":
      return e.ok ? "Outil terminé" : "Outil en échec";
    case "TodosUpdated":
      return "Claude met à jour ses tâches";
    case "AgentNotified":
      return `Claude t'attend : ${e.message}`;
    case "TurnEnded":
      return "Claude a fini son tour";
    case "SessionEnded":
      return "Session terminée";
    case "ChangesDelivered":
      return "Claude a lu tes changements";
  }
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;
}

const onBoard =
  (board: string) =>
  (e: Recorded): boolean =>
    "board" in e && e.board === board;

/**
 * The board whose events the history steps through: the first of `candidates`
 * the journal knows. The page names the board in the address before the one on
 * screen: at a moment when that board is not there, the past shows another in
 * its place, and the history must not leave for that one.
 */
export function historyBoard(
  events: readonly Recorded[],
  ...candidates: (string | null | undefined)[]
): string | undefined {
  return candidates.find((id): id is string => typeof id === "string" && events.some(onBoard(id)));
}

/**
 * The journal positions the history stops at, oldest first. For one board, its
 * events, from its creation: no earlier moment would show it. For the whole
 * journal, every event, and 0, the moment before the first.
 */
export function historyStops(events: readonly Recorded[], board?: string): number[] {
  if (board === undefined) return [0, ...events.map((e) => e.seq)];
  return events.filter(onBoard(board)).map((e) => e.seq);
}

/** The last stop is the present: being there is being live, which a null position says. */
function arrive(stops: readonly number[], stop: number | undefined): number | null {
  return stop === undefined || stop === stops.at(-1) ? null : stop;
}

/**
 * Where a step from `cursor` lands, a stop or not: on the nearest stop that
 * way, and where it was when nothing is earlier. Live sits on the last stop.
 */
export function historyStep(stops: readonly number[], cursor: number | null, by: -1 | 1): number | null {
  const from = cursor ?? stops.at(-1) ?? 0;
  const next = by > 0 ? stops.find((s) => s > from) : stops.findLast((s) => s < from);
  return next === undefined && by < 0 ? cursor : arrive(stops, next);
}

/** The position the slider asks for: it goes stop by stop, and its far end is live. */
export function historyStopAt(stops: readonly number[], index: number): number | null {
  return arrive(stops, stops[index]);
}

/** Where the history stands, counted in the events of its stops. */
export interface HistoryPlace {
  /** The slider's handle: the stop the board on screen is at. */
  index: number;
  /** How many of the events have happened, out of how many. */
  at: number;
  of: number;
  /** The latest of them: between two stops, the board is as that event left it. */
  seq: number | undefined;
}

export function historyPlace(stops: readonly number[], cursor: number | null): HistoryPlace {
  const reached = cursor === null ? stops : stops.filter((s) => s <= cursor);
  // 0 is a stop of the whole journal, and no event.
  const isEvent = (stop: number): boolean => stop > 0;
  const happened = reached.filter(isEvent);
  return {
    index: Math.max(0, reached.length - 1),
    at: happened.length,
    of: stops.filter(isEvent).length,
    seq: happened.at(-1),
  };
}

/**
 * The board an Undo from the page acts on: the one shown, unless the reader
 * removed a board since their last gesture there. Their latest gesture goes first.
 */
export function undoTarget(
  ws: Workspace,
  shown: string | undefined,
  by: Actor = "human",
): string | undefined {
  const last = (boardId: string | undefined): number =>
    (boardId && findBoard(ws, boardId)?.trails[by]?.undo.at(-1)?.seq) || 0;
  let target = last(shown) > 0 ? shown : undefined;
  let latest = last(shown);
  for (const board of ws.removed) {
    const removal = board.trails[by]?.undo.at(-1);
    if (removal?.inverse[0]?.event !== "BoardRestored" || removal.seq < latest) continue;
    target = board.id;
    latest = removal.seq;
  }
  return target;
}

/** The board a Redo from the page acts on: the one shown, when the reader has something to put back. */
export function redoTarget(
  ws: Workspace,
  shown: string | undefined,
  by: Actor = "human",
): string | undefined {
  const board = shown ? findBoard(ws, shown) : undefined;
  return board?.trails[by]?.redo.length ? board.id : undefined;
}

/** An open discussion, as the page shows it. */
export interface Discussion {
  /** The id of the note that opened it. */
  id: string;
  /** The card it is about; without a label, the card is gone. Undefined: the whole board. */
  on: { id: string; label: string | undefined } | undefined;
  /** Who is waited for: whoever did not speak last. */
  waits: "you" | "claude";
  notes: { id: string; by: Actor; text: string }[];
}

/** The board's open discussions, in the order they were opened. */
export function discussions(board: Board): Discussion[] {
  return threads(board)
    .filter((thread) => !thread.resolved)
    .map(asDiscussion(board));
}

/** The board's resolved discussions, the latest opened first: closed, never out of reach. */
export function resolvedDiscussions(board: Board): Discussion[] {
  return threads(board)
    .filter((thread) => thread.resolved)
    .reverse()
    .map(asDiscussion(board));
}

const asDiscussion =
  (board: Board) =>
  (thread: ReturnType<typeof threads>[number]): Discussion => ({
    id: thread.id,
    on: thread.target ? { id: thread.target, label: findElement(board, thread.target)?.label } : undefined,
    waits: thread.notes.at(-1)?.by === "human" ? "claude" : "you",
    notes: thread.notes.map(({ id, by, text }) => ({ id, by, text })),
  });

/** Words as a search compares them: without case, without accents. */
const folded = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * The cards a search finds, best first: the card of that id, then those whose
 * label holds every word asked, then those whose detail does. Board order within each.
 */
export function findCards(board: Board, query: string): string[] {
  const words = folded(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const holds = (text: string | undefined): boolean => {
    const where = folded(text ?? "");
    return words.every((word) => where.includes(word));
  };
  const byId = board.elements.filter((e) => folded(e.id) === words.join(" "));
  const byLabel = board.elements.filter((e) => holds(e.label));
  const byDetail = board.elements.filter((e) => holds(e.detail));
  return [...new Set([...byId, ...byLabel, ...byDetail].map((e) => e.id))];
}

/** A piece of a message: its own words, or an id it names that the reader can go to. */
export type Mention = string | { id: string };

/** Cuts the ids of `known` out of a message, so the page can make each one a link. */
export function mentions(text: string, known: ReadonlySet<string>): Mention[] {
  const pieces: Mention[] = [];
  let from = 0;
  for (const match of text.matchAll(/\b[A-Z]{1,3}\d+\b/g)) {
    const id = match[0];
    if (!known.has(id)) continue;
    if (match.index > from) pieces.push(text.slice(from, match.index));
    pieces.push({ id });
    from = match.index + id.length;
  }
  if (from < text.length) pieces.push(text.slice(from));
  return pieces;
}

export type Direction = "up" | "down" | "left" | "right";

interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The card an arrow key goes to from `id`: the nearest one that way, a card
 * straight ahead before one off to the side.
 */
export function neighbour(cards: readonly Placed[], id: string, direction: Direction): string | undefined {
  const from = cards.find((c) => c.id === id);
  if (!from) return undefined;
  const centre = (c: Placed): { x: number; y: number } => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 });
  const here = centre(from);
  const sideways = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  let best: { id: string; score: number } | undefined;
  for (const card of cards) {
    if (card.id === id) continue;
    const there = centre(card);
    const ahead = sign * (sideways ? there.x - here.x : there.y - here.y);
    if (ahead < 1) continue;
    const aside = Math.abs(sideways ? there.y - here.y : there.x - here.x);
    // Up and down stay in the column: a card beside it is reached by left or right, never by surprise.
    if (!sideways && aside >= from.w / 2) continue;
    const score = ahead + 2 * aside;
    if (!best || score < best.score) best = { id: card.id, score };
  }
  return best?.id;
}

/**
 * Where a card is, in words: its step on a timeline, the name of its lane as
 * the board shows it otherwise. What a screen reader adds to the card's name.
 */
export function cardPlace(
  board: Board,
  bands: readonly Band[],
  id: string,
  locale: Locale = DEFAULT_LOCALE,
): string | undefined {
  const el = findElement(board, id);
  if (!el) return undefined;
  if (findFormat(board.format)?.layout === "timeline" && el.col !== undefined)
    return MESSAGES[locale].step(el.col);
  return bands.find((band) => band.kind === "lane" && band.id === el.lane)?.label;
}

/** The order Tab takes through the cards: column by column, top to bottom. */
export function readingOrder(cards: readonly Placed[]): string[] {
  return [...cards].sort((a, b) => Math.round(a.x) - Math.round(b.x) || a.y - b.y).map((c) => c.id);
}

/**
 * The move Shift and an arrow ask for on a focused card, by the board's own rules:
 * on a timeline, a column either way or a place in its cell; in lanes, a lane
 * either way or a place in its lane. Undefined where the card cannot go.
 */
export function keyMove(board: Board, id: string, direction: Direction): Command | undefined {
  const format = findFormat(board.format);
  const el = findElement(board, id);
  if (!format || !el || format.layout === "graph") return undefined;
  if (format.grid) return gridMove(board, format.lanes, format.grid.perRow, el, direction);
  const timeline = format.layout === "timeline";
  const siblings = board.elements.filter((other) =>
    timeline ? other.col === el.col && other.type === el.type : other.lane === el.lane,
  );
  const place = timeline ? { col: el.col } : { lane: el.lane };
  const at = siblings.indexOf(el);
  if (direction === "up") {
    const before = siblings[at - 1];
    return before ? { kind: "move", board: board.id, id, ...place, before: before.id } : undefined;
  }
  if (direction === "down") {
    if (at === siblings.length - 1) return undefined;
    const after = siblings[at + 2];
    return { kind: "move", board: board.id, id, ...place, ...(after ? { before: after.id } : {}) };
  }
  const step = direction === "right" ? 1 : -1;
  if (timeline) {
    const col = (el.col ?? 1) + step;
    const last = Math.max(0, ...board.elements.filter((o) => o !== el).map((o) => o.col ?? 0));
    if (col < 1 || col > last + 1) return undefined;
    return { kind: "move", board: board.id, id, col };
  }
  const lanes = format.lanes.map((lane) => lane.id);
  const lane = lanes[lanes.indexOf(el.lane ?? "") + step];
  return lane && lanes.includes(el.lane ?? "") ? { kind: "move", board: board.id, id, lane } : undefined;
}

/**
 * On a plan, the arrows go where they point: left and right to the next cell
 * of the row, up and down to the cell above or below. A card never leaves the
 * plan, and never wraps round to the next row.
 */
function gridMove(
  board: Board,
  lanes: readonly { id: string }[],
  perRow: number,
  el: { id: string; lane?: string },
  direction: Direction,
): Command | undefined {
  const at = lanes.findIndex((lane) => lane.id === el.lane);
  if (at < 0) return undefined;
  const row = Math.floor(at / perRow);
  const col = at % perRow;
  const [r, c] =
    direction === "up"
      ? [row - 1, col]
      : direction === "down"
        ? [row + 1, col]
        : [row, col + (direction === "right" ? 1 : -1)];
  if (c < 0 || c >= perRow || r < 0) return undefined;
  const lane = lanes[r * perRow + c];
  return lane ? { kind: "move", board: board.id, id: el.id, lane: lane.id } : undefined;
}

/** A "+" to click: adds a card of one kind where it is drawn. Scene coordinates. */
export interface Offer {
  /** The kind of card it adds; "column" when it inserts a column instead. */
  type: string;
  /** The number the inserted column takes. */
  column?: number;
  /** What the button does, for a tooltip and a screen reader. */
  label: string;
  /** What it shows: a plus, and the letter of the kind when several are offered. */
  text: string;
  fill: string;
  ink: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const OFFER_H = 22;
const OFFER_GAP = 6;
/** How far under the last card an offer sits, when the room is larger than that. */
const OFFER_REACH = 56;

/**
 * The "+" offered in the free room of the cell or lane at `target`: the kind
 * of its row in a timeline, each kind of the workshop in a lane. On the edge
 * between two steps, the "+" offers a column there.
 */
export function addOffers(board: Board, target: Target, locale: Locale = DEFAULT_LOCALE): Offer[] {
  const format = findFormat(board.format);
  const room = vacancy(board, target);
  if (!format || !room) return [];
  if (target.kind === "boundary") {
    const w = 28;
    return [
      {
        type: "column",
        column: target.col,
        label: MESSAGES[locale].insertColumn,
        text: "+",
        fill: "#FFFFFF",
        ink: "#1F2328",
        x: room.x - w / 2,
        y: (room.h - OFFER_H) / 2,
        w,
        h: OFFER_H,
      },
    ];
  }
  const types = target.kind === "cell" ? [findType(format, target.type)] : format.types;
  const several = types.length > 1;
  const w = several ? 40 : 28;
  const left = room.x + (room.w - types.length * w - (types.length - 1) * OFFER_GAP) / 2;
  const y = room.y + (Math.min(room.h, OFFER_REACH) - OFFER_H) / 2;
  return types.flatMap((type, i) =>
    type
      ? [
          {
            type: type.id,
            label: MESSAGES[locale].add(type.label[locale]),
            text: several ? `+ ${type.prefix}` : "+",
            fill: type.fill,
            ink: type.ink,
            x: left + i * (w + OFFER_GAP),
            y,
            w,
            h: OFFER_H,
          },
        ]
      : [],
  );
}

/** A label as it is kept: on one line, single-spaced. */
export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** A detail or a note as it is kept: its lines, each single-spaced, with no more than one empty line in a row. */
export const keptLines = (text: string): string =>
  text
    .split("\n")
    .map(oneLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Where Claude waits for the human: the board of the latest turn handed to them, and how many others wait too. */
export interface Waiting {
  board: string;
  title: string;
  message?: string;
  others: number;
}

/** What is said while Claude waits: in the header, and in the tab for who looks at another one. */
export interface WaitsNotice {
  text: string;
  /** What the tab of the browser says before its own name. */
  tab: string;
  /** A session listens for the answer: Claude does nothing until it comes. */
  blocked: boolean;
}

/** `here`: the board Claude waits on is the one on screen. */
export function waitsNotice(
  waiting: Waiting,
  here: boolean,
  listening: number,
  locale: Locale = DEFAULT_LOCALE,
): WaitsNotice {
  const m = MESSAGES[locale];
  const blocked = listening > 0;
  const [alone, on] = blocked ? [m.claudeBlocked, m.claudeBlockedOn] : [m.claudeWaits, m.claudeWaitsOn];
  return { text: here ? alone : on(waiting.title), tab: `● ${alone}`, blocked };
}

/** The name of the tab: that Claude waits first, where a narrow tab still shows it; then the board. */
export function tabTitle(notice: WaitsNotice | undefined, board: string | undefined): string {
  return [notice?.tab, board, "Sideco"].filter(Boolean).join(" · ");
}

export function claudeWaits(ws: Workspace): Waiting | undefined {
  // An answer ends every wait before it, wherever it was given: a turn handed back on any board, or words in the terminal.
  const answered = Math.max(
    0,
    ...ws.boards.map((board) => (board.turn?.to === "agent" ? board.turn.seq : 0)),
    ...ws.sessions.map((session) => session.turns.at(-1)?.startedSeq ?? 0),
  );
  const handed = ws.boards
    .filter((board) => board.turn?.to === "human" && board.turn.seq > answered)
    .sort((a, b) => (b.turn?.seq ?? 0) - (a.turn?.seq ?? 0));
  const [latest] = handed;
  if (!latest) return undefined;
  return { board: latest.id, title: latest.title, message: latest.turn?.message, others: handed.length - 1 };
}
