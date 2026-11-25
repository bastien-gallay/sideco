/**
 * Several cards chosen at once (S333, its first slice). X keeps the card
 * chosen as the keyboard moves on to the next, which is chosen in turn; Shift
 * and a click adds a card to the one chosen, or takes it out. A bar over the
 * board says how many are chosen and what can be done with them all: marked
 * done, removed. What is done to them is one gesture: one Undo takes it back.
 * A card pressed alone, or the choice left, lets them all go.
 */
import type { Command } from "../domain/commands.ts";
import { isDone } from "../domain/formats.ts";
import type { Locale } from "../domain/i18n.ts";
import type { Board } from "../domain/workspace.ts";
import { h, region } from "./dom.ts";
import { locale } from "./locale.ts";
import { changed, currentBoard, isLive, sendTogether, state } from "./store.ts";

type Act = "done" | "remove";

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
    did: (what: Act, cards: number) => string;
  }
> = {
  en: {
    chosen: (cards) => `${cards} cards chosen`,
    done: "Mark done (D)",
    undone: "Mark not done (D)",
    remove: "Remove (Delete)",
    leave: "Keep one",
    added: (id, cards) => `${id} kept: ${cards} cards chosen`,
    out: (id, cards) => `${id} no longer kept: ${cards} cards chosen`,
    did: (what, cards) =>
      `${cards} cards ${what === "remove" ? "removed" : "marked"}: Undo takes it back at once`,
  },
  fr: {
    chosen: (cards) => `${cards} cartes choisies`,
    done: "Marquer faites (D)",
    undone: "Marquer non faites (D)",
    remove: "Supprimer (Suppr)",
    leave: "N'en garder qu'une",
    added: (id, cards) => `${id} gardée : ${cards} cartes choisies`,
    out: (id, cards) => `${id} n'est plus gardée : ${cards} cartes choisies`,
    did: (what, cards) =>
      `${cards} cartes ${what === "remove" ? "supprimées" : "marquées"} : Undo les ramène d'un coup`,
  },
};
const w = WORDS[locale];

export const chosenBar = h("div", { class: "chosen-bar", hidden: true });

/** The cards kept chosen whatever the keyboard moves to, on the board they were kept on. */
const kept = new Set<string>();
let keptOn: string | undefined;
let speak: (words: string) => void = () => {};

/** Every card chosen on the board shown: those kept, then the one chosen. One card alone is no choice of several. */
function chosen(board: Board | undefined): string[] {
  if (!board || !state.selected || board.id !== keptOn) kept.clear();
  const there = (id: string): boolean => board?.elements.some((e) => e.id === id) ?? false;
  for (const id of kept) if (!there(id)) kept.delete(id);
  const ids = new Set(kept);
  if (state.selected && there(state.selected)) ids.add(state.selected);
  return kept.size > 0 && ids.size > 1 ? [...ids] : [];
}

/** Keeps the card among those chosen, with the one chosen, or lets it go. False when there is no card chosen. */
function toggle(id: string): boolean {
  const board = currentBoard();
  if (!board || !isLive() || !state.selected || state.linking) return false;
  chosen(board);
  keptOn = board.id;
  const was = kept.delete(id);
  // The card chosen first is told first.
  if (!was) kept.add(state.selected).add(id);
  speak((was ? w.out : w.added)(id, new Set([...kept, state.selected]).size));
  changed();
  return true;
}

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
  void sendTogether(commands).then((answer) => {
    if (answer === undefined) return;
    if (what === "remove") kept.clear();
    speak(w.did(what, ids.length));
    changed();
  });
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
    if (pressed && !event.shiftKey && kept.size > 0) {
      kept.clear();
      changed();
    }
    const id = event.shiftKey ? pressed : undefined;
    if (!id || id === state.selected || !toggle(id)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    // The click that follows is not the board's either: it would open what the card wears.
    document.addEventListener("click", (click) => click.stopImmediatePropagation(), {
      capture: true,
      once: true,
    });
  },
  true,
);

const KEYS: Record<string, Act> = { d: "done", D: "done", Delete: "remove", Backspace: "remove" };

// Before the card takes the key for itself alone: with several chosen, D and Delete are for them all.
document.addEventListener(
  "keydown",
  (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    // A question asked in a dialog comes first: the keys are not for the cards behind it.
    if (document.querySelector("dialog[open]")) return;
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

/** A button of the bar was pressed and the bar is to be drawn again: the keyboard follows. */
let moved = false;

const paintBar = region(chosenBar, (m: { ids: string[]; allDone: boolean; live: boolean }) => {
  const button = (words: string, onclick: () => void): HTMLElement =>
    h("button", { type: "button", class: "quiet", onclick }, words);
  const leave = (): void => {
    kept.clear();
    changed();
  };
  if (moved) queueMicrotask(() => chosenBar.querySelector("button")?.focus());
  moved = false;
  const all = (what: Act) => (): void => {
    // The button pressed may be drawn again with another word: the keyboard stays in the bar.
    moved = true;
    act(what);
  };
  return [
    h("span", {}, h("strong", {}, w.chosen(m.ids.length)), ` — ${m.ids.join(", ")}`),
    h(
      "span",
      { class: "focus-acts" },
      m.live && button(m.allDone ? w.undone : w.done, all("done")),
      m.live && button(w.remove, all("remove")),
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
    g.classList.toggle("is-also", ids.includes(g.dataset.id ?? "") && g.dataset.id !== state.selected);
  chosenBar.hidden = ids.length === 0;
  if (!board || ids.length === 0) return;
  const allDone = ids.every((id) => {
    const element = board.elements.find((e) => e.id === id);
    return element !== undefined && isDone(board, element);
  });
  paintBar({ ids, allDone, live: isLive() });
}
