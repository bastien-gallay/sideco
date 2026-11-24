/**
 * The links of the card chosen, in its Detail tab (S310): each one it leads by
 * or comes by, with the card at its other end, Name, Reverse and Remove. The board
 * offers a link to the pointer only; here the keyboard reaches it. Name opens a
 * field in the row: Enter keeps the words, emptied they come off, Escape leaves
 * the name as it was, and the keyboard goes back to Name.
 */
import { h } from "./dom.ts";
import { reverseButton } from "./link-reverse.ts";
import type { LinkRow } from "./link-rows.ts";
import { t } from "./locale.ts";
import { currentBoard, send } from "./store.ts";

const keyOf = (r: { src: string; dst: string }): string => `${r.src}\u0000${r.dst}`;

/** The link being named, and the one whose Name takes the keyboard back. */
let naming: LinkRow | undefined;
let back: string | undefined;
/** The link just turned round: its Reverse keeps the keyboard, on the row redrawn the other way. */
let turned: string | undefined;
/**
 * The list on screen: the panel repaints only when the card changes, so the
 * list redraws itself as a name is begun or left.
 */
let shown: { list: HTMLElement; rows: readonly LinkRow[]; live: boolean } | undefined;

function redraw(): void {
  if (shown)
    shown.list.replaceChildren(
      ...shown.rows.map((r, i) => linkItem(r, `card-link-${i}`, shown?.live ?? false)),
    );
}

/** Made once: the words being typed keep their place through every repaint. */
const field = h("input", { type: "text", name: "link-name", class: "link-name-field", autocomplete: "off" });
field.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    stopNaming();
  } else if (event.key === "Enter") {
    event.preventDefault();
    const board = currentBoard();
    const label = field.value.trim();
    if (board && naming)
      void send({
        kind: "link",
        board: board.id,
        src: naming.src,
        dst: naming.dst,
        ...(label ? { label } : {}),
      });
    stopNaming();
  }
});

function stopNaming(): void {
  back = naming && keyOf(naming);
  naming = undefined;
  redraw();
}

function startNaming(r: LinkRow): void {
  naming = r;
  field.value = r.label ?? "";
  field.setAttribute("aria-label", t.linkNameOf(r.src, r.dst));
  redraw();
}

/** The card's links, under a heading; none, nothing. */
export function linkSection(rows: readonly LinkRow[], live: boolean, heading: string): HTMLElement | false {
  if (naming && !rows.some((r) => keyOf(r) === keyOf(naming as LinkRow))) naming = undefined;
  if (rows.length === 0) return false;
  shown = { list: h("ul", { class: "link-rows" }), rows, live };
  redraw();
  return h("section", { class: "card-panel-links", "aria-label": heading }, h("h3", {}, heading), shown.list);
}

/** Reverse, in a row: the row comes back the other way round, and the keyboard stays on its Reverse. */
function reverseOf(r: LinkRow, id: string): HTMLButtonElement {
  const button = reverseButton(r, { class: "quiet", "aria-describedby": id }, () => {
    turned = keyOf({ src: r.dst, dst: r.src });
  });
  if (turned === keyOf(r)) {
    turned = undefined;
    queueMicrotask(() => button.focus());
  }
  return button;
}

/** One link: an arrow that says which way it goes, the card at its other end, its name, then what can be done. */
function linkItem(r: LinkRow, id: string, live: boolean): HTMLElement {
  const words = h(
    "span",
    { id, class: "link-end" },
    `${r.out ? "→" : "←"} ${r.other}`,
    r.label !== undefined && h("span", { class: "hint" }, ` (${r.label})`),
  );
  if (live && naming && keyOf(naming) === keyOf(r)) {
    queueMicrotask(() => field.focus());
    return h("li", {}, words, field);
  }
  const name = h(
    "button",
    { type: "button", class: "quiet", "aria-describedby": id, onclick: () => startNaming(r) },
    t.nameLink,
  );
  if (back === keyOf(r)) {
    back = undefined;
    queueMicrotask(() => name.focus());
  }
  const remove = (): void => {
    const board = currentBoard();
    if (board) void send({ kind: "unlink", board: board.id, src: r.src, dst: r.dst });
  };
  return h(
    "li",
    {},
    words,
    live && name,
    live && reverseOf(r, id),
    live &&
      h(
        "button",
        { type: "button", class: "quiet danger", "aria-describedby": id, onclick: remove },
        t.removeLink,
      ),
  );
}
