/**
 * The columns the reader folded (S307): a column of a kanban or of a retro
 * folds into a narrow band, its name upright with its count, and a click opens
 * it again. The fold is the reader's own, kept in this browser board by board
 * as the panels' is: the journal and Claude know nothing of it. The layout
 * draws the band and its button (`data-fold`); this module keeps which
 * columns are folded and answers the click, Enter and Space on that button.
 */
import type { View } from "../domain/layout/index.ts";
import { type Board, findElement } from "../domain/workspace.ts";
import { changed, state } from "./store.ts";

const KEY = "sideco.lanes-folded";

/** What is kept where the browser keeps nothing: a private window, storage blocked. It lasts as long as the page. */
let unkept: Record<string, string[]> | undefined;

/** The lanes folded, by board, read anew each time: another tab of this browser may have folded one. */
function read(): Record<string, string[]> {
  if (unkept) return unkept;
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof kept === "object" && kept !== null ? (kept as Record<string, string[]>) : {};
  } catch {
    unkept = {};
    return unkept;
  }
}

function keep(board: string, lanes: string[]): void {
  const all = read();
  if (lanes.length > 0) all[board] = lanes;
  else delete all[board];
  try {
    if (!unkept) localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    unkept = all;
  }
}

const foldedOn = (board: string): string[] => {
  const lanes = read()[board];
  return Array.isArray(lanes) ? lanes.filter((lane) => typeof lane === "string") : [];
};

/**
 * What the page gives the layout of `board`: its width on screen and the lanes
 * folded. A card chosen in a folded column opens it, and so does the card that
 * holds the keyboard, moved there by its keys: what the reader works on is in
 * sight.
 */
export function seen(board: Board | undefined, span: number | undefined): View {
  if (!board) return { span };
  let lanes = foldedOn(board.id);
  const held = document.activeElement?.closest<SVGGElement>("g.card")?.dataset.id;
  const open = [state.selected, held].map((id) => (id ? findElement(board, id)?.lane : undefined));
  if (lanes.some((lane) => open.includes(lane))) {
    lanes = lanes.filter((lane) => !open.includes(lane));
    keep(board.id, lanes);
  }
  return { span, folded: new Set(lanes) };
}

/** Folds the lane, or opens it folded. Folding the column of the card chosen lets the card go: it is put away. */
export function toggleLane(board: Board, lane: string): void {
  const lanes = foldedOn(board.id);
  const folding = !lanes.includes(lane);
  if (folding && state.selected && findElement(board, state.selected)?.lane === lane) state.selected = null;
  keep(board.id, folding ? [...lanes, lane] : lanes.filter((other) => other !== lane));
  changed();
}

/** A press that travels is a carry: of a lane by its heading, or of the board. It folds nothing. */
const TRAVEL = 4;

/**
 * Answers the fold buttons drawn in `root`, for the board on screen: live or in
 * the past, a fold changes what the reader sees, not the board. The button
 * redrawn keeps the keyboard.
 */
export function mountLaneFold(root: SVGSVGElement, board: () => Board | undefined): void {
  let pressed: { x: number; y: number } | undefined;
  const laneOf = (event: Event): string | undefined =>
    (event.target as Element | null)?.closest?.<SVGElement>("[data-fold]")?.dataset.fold;
  const toggle = (event: Event, lane: string, refocus: boolean): void => {
    const on = board();
    if (!on) return;
    // The board's own click would choose nothing, and its keys would rename the lane.
    event.stopPropagation();
    event.preventDefault();
    toggleLane(on, lane);
    if (refocus)
      requestAnimationFrame(() =>
        root.querySelector<SVGElement>(`.lane-fold[data-fold="${CSS.escape(lane)}"]`)?.focus(),
      );
  };
  root.addEventListener("pointerdown", (event) => {
    pressed = { x: event.clientX, y: event.clientY };
  });
  root.addEventListener(
    "click",
    (event) => {
      const lane = laneOf(event);
      // A click with no press of its own, as a reader's tool makes one, has travelled nowhere.
      const from = event.detail === 0 ? undefined : pressed;
      pressed = undefined;
      const travelled = from ? Math.hypot(event.clientX - from.x, event.clientY - from.y) : 0;
      if (lane !== undefined && travelled <= TRAVEL) toggle(event, lane, false);
    },
    true,
  );
  root.addEventListener(
    "keydown",
    (event) => {
      const button = (event.target as Element | null)?.closest?.<SVGElement>(".lane-fold");
      const lane = button?.dataset.fold;
      // ⌘↵ or Ctrl+Enter is the page's: it hands the turn over.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (lane !== undefined && (event.key === "Enter" || event.key === " ")) toggle(event, lane, true);
    },
    true,
  );
}
