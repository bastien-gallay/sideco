/**
 * A column taller than the window scrolls alone (S306). The page gives the
 * layout the height a column has on screen and how far each was scrolled; the
 * layout lays the cards that fit. The wheel over a column scrolls it, card by
 * card, and the board no longer scrolls for it. A card chosen out of view,
 * or put in the focus by Claude, brings its column to it, once: the reader
 * may then scroll away from it.
 * How far a column is scrolled is the reader's own, kept while the page lives.
 */
import { findFormat } from "../domain/formats.ts";
import { skipToSee } from "../domain/layout/columns.ts";
import { MARGIN, type View } from "../domain/layout/scene.ts";
import type { Board } from "../domain/workspace.ts";
import { changed, currentBoard, state } from "./store.ts";

/** A window too short to scroll columns in: under this, the board scrolls whole, as before. */
const MIN_TALL = 320;
/** How far the wheel turns for one card. */
const STEP = 50;

/** Per board, how many lines of each lane the reader scrolled past. */
const skips = new Map<string, Map<string, number>>();
/** The card last brought into view, with its board: it is brought once, not at every painting. */
let brought: string | undefined;
/** The card Claude last pointed at, brought into view the same way. */
let shownTo: string | undefined;
/** The height last given to the layout, and how many times in a row it was found stale. */
let given: number | undefined;
let stale = 0;
let pending = 0;

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

/** What the page gives the layout of a board whose lanes are columns: their window, and how far each is scrolled. */
export function windowed(board: Board, view: View, held: readonly (string | null | undefined)[]): View {
  const format = findFormat(board.format);
  if (!format?.ownLanes || format.grid) return view;
  given = tallNow();
  if (given === undefined) return view;
  const skip = skips.get(board.id) ?? new Map<string, number>();
  skips.set(board.id, skip);
  const seen: View = { ...view, tall: given, skip };
  const bring = (card: string | null | undefined): void => {
    const to = card ? skipToSee(board, format, card, seen) : undefined;
    if (to) skip.set(to.lane, to.skip);
  };
  // What Claude points at first, then the card the reader holds: the reader's own is the last word.
  const pointed = board.focus?.ids[0];
  const pointedKey = pointed ? `${board.id}|${pointed}` : undefined;
  if (pointedKey !== shownTo) bring(pointed);
  shownTo = pointedKey;
  const card = held.find((id) => typeof id === "string" && id !== "");
  const key = card ? `${board.id}|${card}` : undefined;
  if (key !== brought) bring(card);
  brought = key;
  return seen;
}

/** Scrolls a lane of the board shown by so many cards, from where the drawing says it is. */
export function scrollLane(lane: string, from: number, by: number): void {
  const board = currentBoard();
  if (!board) return;
  const skip = skips.get(board.id) ?? new Map<string, number>();
  skips.set(board.id, skip);
  skip.set(lane, Math.max(0, from + by));
  changed();
}

/** The column under the pointer, as drawn: its lane, and what it says is out of view. */
function columnAt(scroll: HTMLElement, x: number, y: number): SVGRectElement | undefined {
  return [...scroll.querySelectorAll<SVGRectElement>("rect.lane-bg[data-lane-box]")].find((rect) => {
    const box = rect.getBoundingClientRect();
    return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
  });
}

function onWheel(event: WheelEvent): void {
  const scroll = scroller();
  if (!scroll || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  const column = columnAt(scroll, event.clientX, event.clientY);
  const more = Number(column?.dataset[event.deltaY > 0 ? "below" : "above"] ?? 0);
  if (!column || more <= 0) {
    pending = 0;
    return;
  }
  // The column has cards that way: the wheel is for it, not for the board.
  event.preventDefault();
  pending += event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY;
  const steps = Math.trunc(pending / STEP);
  if (steps === 0) return;
  pending -= steps * STEP;
  scrollLane(column.dataset.laneBox ?? "", Number(column.dataset.skip ?? 0), steps);
}

const cardNode = (id: string): SVGGElement | null =>
  document.querySelector<SVGGElement>(`g.card[data-id="${CSS.escape(id)}"]`);

/**
 * The arrow that goes on from the last card in view, up or down its column: the next card of the lane is not drawn,
 * so no arrow would reach it. It is chosen, its column comes to it, and it takes the keyboard once drawn.
 */
function onArrow(event: KeyboardEvent): void {
  const by = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  const from =
    event.target instanceof Element ? event.target.closest<SVGGElement>("g.card")?.dataset.id : undefined;
  const board = currentBoard();
  if (by === 0 || !from || !board || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
  const lane = board.elements.find((e) => e.id === from)?.lane;
  const stack = board.elements.filter((e) => lane !== undefined && e.lane === lane);
  const next = stack[stack.findIndex((e) => e.id === from) + by]?.id;
  // Drawn, the next card is the arrow's own business, as on any board.
  if (!next || cardNode(next) || !scrollsAlone(lane)) return;
  event.preventDefault();
  event.stopPropagation();
  state.selected = next;
  changed();
  requestAnimationFrame(() => requestAnimationFrame(() => cardNode(next)?.focus()));
}

/** Whether the lane is drawn as a column that scrolls alone. */
function scrollsAlone(lane: string | undefined): boolean {
  return [...document.querySelectorAll<SVGRectElement>("rect.lane-bg[data-lane-box]")].some(
    (rect) => rect.dataset.laneBox === lane,
  );
}

document.addEventListener("keydown", onArrow, true);

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
