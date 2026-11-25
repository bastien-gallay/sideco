/**
 * A column taller than the window scrolls alone (S306). The page gives the
 * layout the height a column has on screen and how far each was scrolled; the
 * layout lays the cards that show. The wheel over a column scrolls it as it
 * scrolls a page, by the distance it turned (S354), and the board no longer
 * scrolls for it. A card chosen out of view, or put in the focus by Claude,
 * brings its column to it, once: the reader may then scroll away from it.
 * While a column scrolls, its cards do not glide; under the wheel, they answer
 * no pointer either: what passes under the pointer is not pointed at.
 * How far a column is scrolled is the reader's own, kept while the page lives.
 */
import { findFormat } from "../domain/formats.ts";
import { type LaneSeen, laneWindows, skipToSee } from "../domain/layout/columns.ts";
import { MARGIN, type View } from "../domain/layout/scene.ts";
import type { Board } from "../domain/workspace.ts";
import { changed, currentBoard, state } from "./store.ts";

/** A window too short to scroll columns in: under this, the board scrolls whole, as before. */
const MIN_TALL = 320;
/** How long after its last move a column is still scrolling: its cards stay quiet meanwhile. */
const QUIET_MS = 160;
/** How long the wheel that scrolled a column to its end is kept from the board: the turn goes on after the hand left it. */
const HELD_MS = 300;

/** Per board, how far the reader scrolled each lane. */
const skips = new Map<string, Map<string, number>>();
/** The card last brought into view, with its board: it is brought once, not at every painting. */
let brought: string | undefined;
/** The card Claude last pointed at, brought into view the same way. */
let shownTo: string | undefined;
/** The height last given to the layout, and how many times in a row it was found stale. */
let given: number | undefined;
let stale = 0;
/** A card to bring into view at the next painting, whoever holds the keyboard. */
let wanted: string | undefined;
/** What the layout was last given, and what each column that scrolls alone shows of it: worked out when asked. */
let last: { board: Board; view: View } | undefined;
let windows: Map<string, LaneSeen> | undefined;
/** The column the wheel last scrolled, and when. */
let turned: { lane: string; at: number } | undefined;
let quiet: ReturnType<typeof setTimeout> | undefined;

const scroller = (): HTMLElement | null => document.querySelector<HTMLElement>(".canvas-scroll");

/** The height a column may have, in the board's own units: the window, less the margins, whatever the zoom. */
function tallNow(): number | undefined {
  const scroll = scroller();
  const svg = scroll?.querySelector<SVGSVGElement>("svg");
  if (!scroll || !svg || scroll.clientHeight === 0) return undefined;
  const drawn = svg.viewBox.baseVal?.width ?? 0;
  const zoom = drawn > 0 ? Number(svg.getAttribute("width")) / drawn || 1 : 1;
  return Math.max(MIN_TALL, Math.floor(scroll.clientHeight / zoom) - 2 * MARGIN - 4);
}

/**
 * A column moved: its cards go where they are, without gliding. Moved by the wheel, nothing is pointed at until
 * it rests, or until the pointer presses: a click is never lost to a column that scrolls.
 */
function scrolling(byWheel = false): void {
  windows = undefined;
  const host = scroller()?.parentElement;
  host?.classList.add("is-scrolling");
  if (byWheel) host?.classList.add("is-wheeling");
  clearTimeout(quiet);
  quiet = setTimeout(rest, QUIET_MS);
}

function rest(): void {
  clearTimeout(quiet);
  scroller()?.parentElement?.classList.remove("is-scrolling", "is-wheeling");
}

/** What the column of this lane shows, where it scrolls alone on the board painted. */
export function laneSeen(lane: string): LaneSeen | undefined {
  const format = last && findFormat(last.board.format);
  if (!last || !format) return undefined;
  windows ??= laneWindows(last.board, format, last.view);
  return windows.get(lane);
}

/** What the page gives the layout of a board whose lanes are columns: their window, and how far each is scrolled. */
export function windowed(board: Board, view: View, held: readonly (string | null | undefined)[]): View {
  const format = findFormat(board.format);
  if (!format?.ownLanes || format.grid) {
    // No column scrolls alone here: no window was given, so none is found stale and painted again for.
    last = undefined;
    given = undefined;
    return view;
  }
  given = tallNow();
  if (given === undefined) {
    last = undefined;
    return view;
  }
  const skip = skips.get(board.id) ?? new Map<string, number>();
  skips.set(board.id, skip);
  const seen: View = { ...view, tall: given, skip };
  last = { board, view: seen };
  windows = undefined;
  const bring = (card: string | null | undefined): void => {
    const to = card ? skipToSee(board, format, card, seen) : undefined;
    if (!to || Math.abs(to.skip - (skip.get(to.lane) ?? 0)) < 0.5) return;
    skip.set(to.lane, to.skip);
    scrolling();
    // Asked while a pointer moves, not while painting: the board is drawn again where its column now is.
    changed();
  };
  // Where a card is, with its name: moved in its lane or to another, it is brought again.
  const placed = (card: string | null | undefined): string | undefined => {
    const at = card ? board.elements.findIndex((e) => e.id === card) : -1;
    return at < 0 ? undefined : `${board.id}|${card}|${board.elements[at]?.lane}|${at}`;
  };
  // Words being written on a card stay under the reader's hand: nothing scrolls its column meanwhile.
  // Nor while a card is in the hand: it is dropped where the columns were when it was taken.
  if (writing() || scroller()?.querySelector("g.card.is-dragging")) return seen;
  // What Claude points at first, then the card the reader holds, then the one asked for: the reader has the last word.
  const pointed = board.focus?.ids[0];
  if (placed(pointed) !== shownTo) bring(pointed);
  shownTo = placed(pointed);
  const card = held.find((id) => typeof id === "string" && id !== "");
  if (placed(card) !== brought) bring(card);
  brought = placed(card);
  bring(wanted);
  wanted = undefined;
  return seen;
}

/** Whether words are being written on a card of the board. */
const writing = (): boolean => document.activeElement?.matches("textarea.card-editor") === true;

/** Brings the column of a card to it at the next painting, chosen or not: a card found, or reached by an arrow. */
export function bringCard(id: string): void {
  wanted = id;
  changed();
}

/**
 * Whether the card is scrolled out of the window of its column: not drawn, or cut by an edge, in a column that is
 * open. A card put away in a folded column is another matter: the fold is the reader's, and opens when the card
 * is chosen.
 */
export function isScrolledOut(id: string): boolean {
  const lane = currentBoard()?.elements.find((e) => e.id === id)?.lane;
  const column = document.querySelector<SVGRectElement>(
    `rect.lane-bg[data-lane-box="${CSS.escape(lane ?? "")}"]`,
  );
  return !isWhole(id) && column !== null && column.dataset.fold === undefined;
}

/** Scrolls a lane of the board shown by this far, in the board's own units, within what it has to scroll. */
export function scrollLane(lane: string, by: number, byWheel = false): void {
  const board = currentBoard();
  const shows = laneSeen(lane);
  if (!board || !shows || writing()) return;
  const to = Math.min(shows.most, Math.max(0, shows.skip + by));
  if (to === shows.skip) return;
  skips.get(board.id)?.set(lane, to);
  scrolling(byWheel);
  changed();
}

/** The column under the pointer, as drawn: its lane, and what it says is out of view. */
function columnAt(scroll: HTMLElement, x: number, y: number): SVGRectElement | undefined {
  return [...scroll.querySelectorAll<SVGRectElement>("rect.lane-bg[data-lane-box]")].find((rect) => {
    const box = rect.getBoundingClientRect();
    return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
  });
}

/** At its end, a column keeps the turn that brought it there: the board scrolls for a new one. */
function stillTurning(lane: string, event: WheelEvent): boolean {
  if (turned?.lane !== lane || event.timeStamp - turned.at > HELD_MS) return false;
  turned.at = event.timeStamp;
  return true;
}

function onWheel(event: WheelEvent): void {
  const scroll = scroller();
  if (!scroll || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  // A card in the hand is drawn where it was taken: its column stays under it.
  if (scroll.querySelector("g.card.is-dragging")) return;
  const column = columnAt(scroll, event.clientX, event.clientY);
  const lane = column?.dataset.laneBox ?? "";
  const shows = column ? laneSeen(lane) : undefined;
  if (!column || !shows) return;
  const down = event.deltaY > 0;
  if (down ? shows.skip > shows.most - 0.5 : shows.skip < 0.5) {
    if (stillTurning(lane, event)) event.preventDefault();
    return;
  }
  // The column has cards that way: the wheel is for it, not for the board.
  event.preventDefault();
  turned = { lane, at: event.timeStamp };
  const box = column.getBoundingClientRect();
  const zoom = box.height / (Number(column.getAttribute("height")) || box.height) || 1;
  scrollLane(lane, (event.deltaMode === 0 ? event.deltaY : event.deltaY * 40) / zoom, true);
}

const cardNode = (id: string): SVGGElement | null =>
  document.querySelector<SVGGElement>(`g.card[data-id="${CSS.escape(id)}"]`);

/** Whether the card is drawn whole: not cut by an edge of its column's window. */
const isWhole = (id: string): boolean => {
  const node = cardNode(id);
  return node !== null && node.dataset.cut === undefined;
};

/** The keys that go along a column: an arrow to the next card, a page further, or to an end (T284). */
const ALONG: Record<string, (at: number, page: number, last: number) => number> = {
  ArrowDown: (at) => at + 1,
  ArrowUp: (at) => at - 1,
  PageDown: (at, page, last) => Math.min(last, at + page),
  PageUp: (at, page) => Math.max(0, at - page),
  Home: () => 0,
  End: (_at, _page, last) => last,
};

/** The card of its lane a key goes to from `from`: undefined where the key is not the column's. */
function along(event: KeyboardEvent, board: Board, from: string): string | undefined {
  const go = Object.hasOwn(ALONG, event.key) ? ALONG[event.key] : undefined;
  const format = findFormat(board.format);
  if (!go || !format?.ownLanes || format.grid) return undefined;
  const lane = board.elements.find((e) => e.id === from)?.lane;
  const stack = board.elements.filter((e) => lane !== undefined && e.lane === lane);
  // A page is the cards that show whole, less one: the last one read stays in view.
  const page = Math.max(1, stack.filter((e) => isWhole(e.id)).length - 1);
  const at = stack.findIndex((e) => e.id === from);
  return stack[go(at, page, stack.length - 1)]?.id;
}

/**
 * A key that goes along a column, from a card: the arrow that goes on from the last card in view, a page or an
 * end. The card it goes to may not be drawn, or cut by the window: its column comes to it, and it takes the
 * keyboard once drawn. A card drawn whole next to this one is the arrow's own business, as on any board.
 */
function onKey(event: KeyboardEvent): void {
  const from =
    event.target instanceof Element ? event.target.closest<SVGGElement>("g.card")?.dataset.id : undefined;
  const board = currentBoard();
  if (!from || !board || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
  const next = along(event, board, from);
  if (!next || (event.key.startsWith("Arrow") && isWhole(next))) return;
  event.preventDefault();
  event.stopPropagation();
  if (next === from) return;
  // As any arrow does: the choice follows the keyboard when there is one, and no link is being drawn.
  if (state.selected && !state.linking) state.selected = next;
  bringCard(next);
  requestAnimationFrame(() => requestAnimationFrame(() => cardNode(next)?.focus()));
}

document.addEventListener("keydown", onKey, true);
// The keyboard on a card cut by its window, by Tab or an arrow across the columns: its column comes to it.
document.addEventListener("focusin", (event) => {
  const card = event.target instanceof Element ? event.target.closest<SVGGElement>("g.card[data-cut]") : null;
  if (card?.dataset.id && !card.classList.contains("is-dragging")) bringCard(card.dataset.id);
});
// A press ends the quiet of a column that scrolled: the card under the pointer answers it.
document.addEventListener("pointerdown", rest, true);

let listening: HTMLElement | undefined;

/**
 * Call it once the board is painted: it listens to the wheel, and paints again when the window the layout was given
 * is no longer the window there is (resized, zoomed, a scrollbar come or gone).
 */
export function settleWindow(): void {
  const scroll = scroller();
  if (scroll && listening !== scroll) {
    listening = scroll;
    scroll.addEventListener("wheel", onWheel, { passive: false });
  }
  const now = tallNow();
  if (given === undefined || now === undefined || Math.abs(now - given) <= 4) {
    stale = 0;
    return;
  }
  // A scrollbar that comes and goes with the height given would paint for ever: three times, then it is left.
  if (stale++ < 3) changed();
}
