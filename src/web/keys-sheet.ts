/**
 * The keys of the page, and the marks a card wears, on one sheet: asked for
 * with `?`, or from the palette. Moved out of main.ts (T171) to make room.
 */
import { findFormat } from "../domain/formats.ts";
import type { Board } from "../domain/workspace.ts";
import { h } from "./dom.ts";
import { locale, t } from "./locale.ts";
import type { CardMark, SheetKind } from "./messages.ts";
import { withMoreKeys } from "./more-keys.ts";

/** The keys of the page, in one place: asked for with `?`, or from the palette. */
export const keysSheet = h("dialog", { class: "sheet keys" });

// `?` closes the sheet as it opened it (T278); Escape is the dialog's own.
keysSheet.addEventListener("keydown", (event) => {
  if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  // The page's own `?` would open it again, once closed.
  event.stopPropagation();
  keysSheet.close();
});
// A click beside the sheet, on what dims the page, closes it: the click is the dialog's, out of its box.
keysSheet.addEventListener("click", (event) => {
  const box = keysSheet.getBoundingClientRect();
  const inside =
    event.clientX >= box.left &&
    event.clientX <= box.right &&
    event.clientY >= box.top &&
    event.clientY <= box.bottom;
  if (event.target === keysSheet && !inside) keysSheet.close();
});

/** How the board shown is laid out, as far as its keys and gestures go. */
function sheetKind(board: Board | undefined): SheetKind {
  const format = findFormat(board?.format ?? "");
  if (!format || format.layout === "timeline") return "timeline";
  if (format.layout === "graph") return "graph";
  if (format.grid) return "grid";
  return format.ownLanes ? "kanban" : "lanes";
}

/** Each mark drawn as the card draws it, in a box of its own; the words beside it say what it means. */
const MARK_DRAWN: Record<CardMark, string> = {
  detail: '<text class="card-detail" y="4" text-anchor="middle">≡</text>',
  done: '<text class="card-done" y="4" text-anchor="middle">✓</text>',
  notes: '<g class="card-notes"><circle r="8"/><text y="3.5">1</text></g>',
  unread: '<g class="card-unread"><circle r="5"/></g>',
  changed: '<g class="card-changed"><path d="M0 -6 L8 7 L-8 7 Z"/></g>',
};

function markLegend(): HTMLElement {
  return h(
    "dl",
    { class: "key-list mark-list" },
    ...(Object.keys(MARK_DRAWN) as CardMark[]).flatMap((mark) => {
      const drawn = h("dt", {});
      drawn.innerHTML = `<svg viewBox="-11 -11 22 22" width="22" height="22" aria-hidden="true">${MARK_DRAWN[mark]}</svg>`;
      return [drawn, h("dd", {}, t.marks[mark])];
    }),
  );
}

/** The sheet, for the board shown and the names its plan gives its axes. */
export function openKeys(board: Board | undefined, axes: { x: string; y: string } | undefined): void {
  const how = sheetKind(board);
  /** Keys wear the look of keys; a gesture of the mouse is said in words. */
  const list = (rows: [string, string][], keys: boolean) =>
    h(
      "dl",
      { class: "key-list" },
      ...rows.flatMap(([what, does]) => [h("dt", {}, keys ? h("kbd", {}, what) : what), h("dd", {}, does)]),
    );
  keysSheet.replaceChildren(
    // The title takes the keyboard: the sheet is read from its top, not from its last button (T283).
    h("h2", { tabindex: -1 }, t.shortcuts),
    list(
      withMoreKeys(
        t.shortcutList(how, Boolean(findFormat(board?.format ?? "")?.doneLast), axes),
        locale,
        how === "kanban",
      ),
      true,
    ),
    h("h3", {}, t.withTheMouse),
    list(t.mouseList(how), false),
    h("h3", {}, t.onACard),
    markLegend(),
    h(
      "div",
      { class: "actions" },
      h("button", { type: "button", class: "primary", onclick: () => keysSheet.close() }, t.close),
    ),
  );
  keysSheet.showModal();
  keysSheet.querySelector("h2")?.focus();
  keysSheet.scrollTop = 0;
}
