/**
 * Several cards chosen at once (S333, its first slice): Shift and a click, or X
 * on the card the keyboard is on, adds a card to the one chosen, or takes it
 * out. A bar over the board says how many are chosen and what can be done
 * with them all: marked done, removed. What is done to them is one gesture:
 * one Undo takes it back. Choosing a card alone, or leaving it, lets the
 * others go.
 */
import type { Command } from "../domain/commands.ts";
import { isDone } from "../domain/formats.ts";
import type { Locale } from "../domain/i18n.ts";
import type { Board } from "../domain/workspace.ts";
import { h, region } from "./dom.ts";
import { locale } from "./locale.ts";
import { changed, currentBoard, isLive, sendTogether, state } from "./store.ts";

const WORDS: Record<
  Locale,
  {
    chosen: (cards: number) => string;
    done: string;
    undone: string;
    remove: string;
    leave: string;
    added: (id: string, cards: number) => string;
    out: (id: string, cards: number) => string;
  }
> = {
  en: {
    chosen: (cards) => `${cards} cards chosen`,
    done: "Mark done (D)",
    undone: "Mark not done (D)",
    remove: "Remove (Delete)",
    leave: "Keep one",
    added: (id, cards) => `${id} chosen too: ${cards} cards chosen`,
    out: (id, cards) => `${id} no longer chosen: ${cards} cards chosen`,
  },
  fr: {
    chosen: (cards) => `${cards} cartes choisies`,
    done: "Marquer faites (D)",
    undone: "Marquer non faites (D)",
    remove: "Supprimer (Suppr)",
    leave: "N'en garder qu'une",
    added: (id, cards) => `${id} choisie aussi : ${cards} cartes choisies`,
    out: (id, cards) => `${id} n'est plus choisie : ${cards} cartes choisies`,
  },
};
const w = WORDS[locale];

export const chosenBar = h("div", { class: "chosen-bar", hidden: true });

/** The cards chosen beside `state.selected`, and the card they were chosen with: another one chosen lets them go. */
const also = new Set<string>();
let anchor: string | null = null;
let speak: (words: string) => void = () => {};

/** Every card chosen on the board shown, the first one chosen first; one card alone is no choice of several. */
function chosen(board: Board | undefined): string[] {
  if (!board || !state.selected || state.selected !== anchor) also.clear();
  for (const id of also) if (!board?.elements.some((e) => e.id === id)) also.delete(id);
  return state.selected && also.size > 0 ? [state.selected, ...also] : [];
}

/** Adds the card to those chosen, or takes it out. False when there is no card chosen to add it to. */
function toggle(id: string): boolean {
  const board = currentBoard();
  if (!board || !isLive() || !state.selected || id === state.selected) return false;
  chosen(board);
  anchor = state.selected;
  const was = also.delete(id);
  if (!was) also.add(id);
  speak((was ? w.out : w.added)(id, also.size + 1));
  changed();
  return true;
}

type Act = "done" | "remove";

/** Does it to every card chosen, as one gesture. False when fewer than two are chosen. */
function act(what: Act): boolean {
  const board = currentBoard();
  const ids = chosen(board);
  if (!board || ids.length === 0 || !isLive()) return false;
  const all = ids.every((id) => {
    const element = board.elements.find((e) => e.id === id);
    return element !== undefined && isDone(board, element);
  });
  const commands = ids.map(
    (id): Command =>
      what === "remove"
        ? { kind: "remove", board: board.id, id }
        : { kind: "mark", board: board.id, id, done: !all },
  );
  if (what === "remove") also.clear();
  void sendTogether(commands);
  return true;
}

const cardOf = (target: EventTarget | null): string | undefined =>
  (target as Element | null)?.closest?.<SVGGElement>("g.card")?.dataset.id;

// Before the board takes the press for a card to carry: Shift and a click choose one more.
document.addEventListener(
  "pointerdown",
  (event) => {
    const pressed = event.button === 0 ? cardOf(event.target) : undefined;
    // A card pressed alone is chosen alone, even the one the others were chosen with.
    if (pressed && !event.shiftKey && also.size > 0) {
      also.clear();
      changed();
    }
    const id = event.shiftKey ? pressed : undefined;
    if (!id || !toggle(id)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  },
  true,
);

const KEYS: Record<string, Act> = { d: "done", D: "done", Delete: "remove", Backspace: "remove" };

// Before the card takes the key for itself alone: with several chosen, D and Delete are for them all.
document.addEventListener(
  "keydown",
  (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const on = cardOf(event.target);
    if (!on && event.target !== document.body) return;
    const what = KEYS[event.key];
    const more = event.key === "x" || event.key === "X";
    const taken = more ? on !== undefined && toggle(on) : what !== undefined && act(what);
    if (!taken) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  },
  true,
);

const paintBar = region(chosenBar, (m: { ids: string[]; allDone: boolean; live: boolean }) => {
  const button = (words: string, onclick: () => void): HTMLElement =>
    h("button", { type: "button", class: "quiet", onclick }, words);
  const leave = (): void => {
    also.clear();
    changed();
  };
  return [
    h("span", {}, h("strong", {}, w.chosen(m.ids.length)), ` — ${m.ids.join(", ")}`),
    h(
      "span",
      { class: "focus-acts" },
      m.live && button(m.allDone ? w.undone : w.done, () => void act("done")),
      m.live && button(w.remove, () => void act("remove")),
      button(w.leave, leave),
    ),
  ];
});

/** Marks the cards chosen beside the first, and shows the bar while several are; call it once the board is painted. */
export function paintChosen(canvas: Element, say: (words: string) => void): void {
  speak = say;
  const board = currentBoard();
  const ids = chosen(board);
  for (const g of canvas.querySelectorAll<SVGGElement>("g.card"))
    g.classList.toggle("is-also", also.has(g.dataset.id ?? ""));
  chosenBar.hidden = ids.length === 0;
  if (!board || ids.length === 0) return;
  const allDone = ids.every((id) => {
    const element = board.elements.find((e) => e.id === id);
    return element !== undefined && isDone(board, element);
  });
  paintBar({ ids, allDone, live: isLive() });
}
