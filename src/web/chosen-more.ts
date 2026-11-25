/**
 * Several cards chosen at once (S333, its first slice). X keeps the card
 * chosen as the keyboard moves on to the next, which is chosen in turn; Shift
 * and a click adds a card to the one chosen, or takes it out. A bar over the
 * board says how many are chosen and what can be done with them all: marked
 * done, removed. What is done to them is one gesture: one Undo takes it back.
 * A card pressed alone, or the choice left, lets them all go.
 */
import type { Command } from "../domain/commands.ts";
import { findFormat, isDone, laneName, lanesOf } from "../domain/formats.ts";
import type { Locale } from "../domain/i18n.ts";
import { headOf, kinOf, toJoin } from "../domain/kin.ts";
import { hasLabel, normalLabel } from "../domain/labels.ts";
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
    label: (cards: number) => string;
    labelHint: string;
    labelled: (labels: string, cards: number) => string;
    worn: (labels: string) => string;
    join: (head: string, gathered: boolean) => string;
    joined: (head: string, cards: number, gathered: boolean) => string;
    lane: (cards: number) => string;
    laneHint: string;
    moved: (lane: string, cards: number) => string;
  }
> = {
  en: {
    chosen: (cards) => `${cards} cards chosen`,
    label: (cards) => `Add a label to the ${cards} cards chosen`,
    labelHint: "Label them: type:bug, @name… (Enter)",
    labelled: (labels, cards) =>
      `${labels} added to ${cards} card${cards > 1 ? "s" : ""}: Undo takes it back at once`,
    worn: (labels) => `The cards chosen all wear ${labels} already`,
    join: (head, gathered) => (gathered ? `Gather on ${head}` : `Attach to ${head}`),
    joined: (head, cards, gathered) =>
      `${cards} card${cards > 1 ? "s" : ""} ${gathered ? "gathered on" : "attached to"} ${head}: Undo takes it back at once`,
    lane: (cards) => `Move the ${cards} cards chosen to a column`,
    laneHint: "Move to…",
    moved: (lane, cards) =>
      `${cards} card${cards > 1 ? "s" : ""} moved to ${lane}: Undo takes it back at once`,
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
    label: (cards) => `Ajouter un label aux ${cards} cartes choisies`,
    labelHint: "Les labéliser : type:bug, @nom… (Entrée)",
    labelled: (labels, cards) =>
      `${labels} ajouté à ${cards} carte${cards > 1 ? "s" : ""} : Undo le retire d'un coup`,
    worn: (labels) => `Les cartes choisies portent déjà toutes ${labels}`,
    join: (head, gathered) => (gathered ? `Regrouper sur ${head}` : `Attacher à ${head}`),
    joined: (head, cards, gathered) =>
      `${cards} carte${cards > 1 ? "s" : ""} ${gathered ? "regroupée" : "attachée"}${cards > 1 ? "s" : ""} ${gathered ? "sur" : "à"} ${head} : Undo le défait d'un coup`,
    lane: (cards) => `Déplacer les ${cards} cartes choisies vers une colonne`,
    laneHint: "Déplacer vers…",
    moved: (lane, cards) =>
      `${cards} carte${cards > 1 ? "s" : ""} déplacée${cards > 1 ? "s" : ""} vers ${lane} : Undo ${cards > 1 ? "les" : "la"} ramène d'un coup`,
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

/** What the bar says and its buttons, drawn again as the choice changes; the field beside them is never drawn again. */
const chosenSays = h("div", { class: "chosen-says" });
export const chosenBar = h("div", { class: "chosen-bar", hidden: true }, chosenSays);

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
    // The bar that is not drawn again has no button to give the keyboard to.
    if (answer === undefined || what === "remove") moved = false;
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
    // On a card only: a key pressed with the keyboard nowhere is not for the cards chosen.
    if (!on) return;
    const what = KEYS[event.key];
    const more = event.key === "x" || event.key === "X";
    const taken = more ? on !== undefined && toggle(on) : what !== undefined && act(what);
    if (!taken) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  },
  true,
);

/** What is written here is a label for every card chosen (S333): several by commas, as in the Detail tab. */
const labelField = h("input", {
  class: "chosen-label",
  type: "text",
  name: "labels",
  autocomplete: "off",
  placeholder: w.labelHint,
  maxlength: 200,
});
chosenBar.append(labelField);

/** Escape empties the field, then leaves it for the card chosen: the choice stays. */
function leaveField(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (labelField.value === "" && state.selected)
    document.querySelector<SVGGElement>(`g.card[data-id="${CSS.escape(state.selected)}"]`)?.focus();
  labelField.value = "";
}

labelField.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Escape") return leaveField(event);
  if (event.key !== "Enter") return;
  event.preventDefault();
  const board = currentBoard();
  const labels = labelField.value.split(",").map(normalLabel).filter(Boolean);
  if (!board || labels.length === 0 || !isLive()) return;
  // Only the cards that lack one of them are written to: what is said and what Undo takes back are the same.
  const ids = chosen(board).filter((id) => {
    const element = board.elements.find((e) => e.id === id);
    return element !== undefined && labels.some((label) => !hasLabel(element, label));
  });
  if (ids.length === 0) {
    if (chosen(board).length > 0) speak(w.worn(labels.join(", ")));
    labelField.value = "";
    return;
  }
  const commands = ids.map((id): Command => ({ kind: "label", board: board.id, id, labels }));
  void sendTogether(commands).then((answer) => {
    if (answer === undefined) return;
    labelField.value = "";
    speak(w.labelled(labels.join(", "), ids.length));
  });
});

/**
 * The cards chosen are joined to the one of them that takes the others (S327): observations of a retro gathered as
 * one idea, tasks attached to their story. A link from it to each, as one gesture; unlinking lets a card go.
 */
function join(): void {
  const board = currentBoard();
  if (!board || !isLive()) return;
  const ids = chosen(board);
  const head = headOf(board, ids);
  const others = toJoin(board, ids);
  if (head === undefined || others.length === 0) return;
  // The button pressed goes once they are joined: the keyboard stays in the bar.
  moved = true;
  const commands = others.map((dst): Command => ({ kind: "link", board: board.id, src: head, dst }));
  void sendTogether(commands).then((answer) => {
    if (answer === undefined) moved = false;
    if (answer === undefined) return;
    speak(w.joined(head, others.length, kinOf(board, head).gathered));
    changed();
  });
}

/**
 * The cards chosen go to the column picked here (S333), at its end and in their order, as one gesture. A menu and
 * not a drag: several cards under one pointer is another gesture, and this one is for the keyboard too.
 */
const laneMenu = h("select", { class: "chosen-lane", name: "lane" });
chosenBar.append(laneMenu);
/** The columns the menu lists, as last written: it is written again only when they change. */
let listed = "";

/** Lists the columns of the board in the menu, or hides it where cards are not placed by column. */
function paintLanes(board: Board, cards: number): void {
  const format = findFormat(board.format);
  const lanes = isLive()
    ? lanesOf(board).map((id) => [id, laneName(format, board, id, locale)] as const)
    : [];
  laneMenu.hidden = lanes.length === 0;
  laneMenu.setAttribute("aria-label", w.lane(cards));
  const now = JSON.stringify(lanes);
  if (now === listed) return;
  listed = now;
  laneMenu.replaceChildren(
    h("option", { value: "" }, w.laneHint),
    ...lanes.map(([id, name]) => h("option", { value: id }, name)),
  );
}

// Shut, a menu takes an arrow or a letter as a choice made on some systems: the cards would go at each key. The
// keys open it; what is picked there is the choice. Escape leaves it for the card: the choice of cards stays.
laneMenu.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (state.selected)
      document.querySelector<SVGGElement>(`g.card[data-id="${CSS.escape(state.selected)}"]`)?.focus();
    return;
  }
  if (!event.key.startsWith("Arrow") && event.key.length !== 1) return;
  if (event.key === " " || event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault();
  laneMenu.showPicker?.();
});

laneMenu.addEventListener("change", () => {
  const board = currentBoard();
  const lane = laneMenu.value;
  const name = laneMenu.selectedOptions[0]?.textContent ?? lane;
  laneMenu.value = "";
  if (!board || lane === "" || !isLive()) return;
  // Only the cards that are elsewhere: what is said and what Undo takes back are the same.
  const ids = chosen(board).filter((id) => board.elements.find((e) => e.id === id)?.lane !== lane);
  if (ids.length === 0) return;
  const commands = ids.map((id): Command => ({ kind: "move", board: board.id, id, lane }));
  void sendTogether(commands).then((answer) => {
    if (answer !== undefined) speak(w.moved(name, ids.length));
  });
});

/** A button of the bar was pressed and the bar is to be drawn again: the keyboard follows. */
let moved = false;

interface Bar {
  ids: string[];
  allDone: boolean;
  live: boolean;
  /** The card the others can be joined to, when some are not yet, and whether that gathers them. */
  head?: string;
  gathered?: boolean;
}

const paintBar = region(chosenSays, (m: Bar) => {
  labelField.setAttribute("aria-label", w.label(m.ids.length));
  const button = (words: string, onclick: () => void): HTMLElement =>
    h("button", { type: "button", class: "quiet", onclick }, words);
  const leave = (): void => {
    kept.clear();
    changed();
  };
  // The keyboard follows the button pressed, unless the reader went on to write a label.
  if (moved && document.activeElement !== labelField && document.activeElement !== laneMenu)
    queueMicrotask(() => chosenBar.querySelector("button")?.focus());
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
      m.live && m.head !== undefined && button(w.join(m.head, m.gathered === true), join),
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
  labelField.hidden = !isLive();
  // What was written for a choice let go is not kept for the next one.
  if (ids.length === 0) labelField.value = "";
  if (!board || ids.length === 0) return;
  const allDone = ids.every((id) => {
    const element = board.elements.find((e) => e.id === id);
    return element !== undefined && isDone(board, element);
  });
  paintLanes(board, ids.length);
  const head = toJoin(board, ids).length > 0 ? headOf(board, ids) : undefined;
  paintBar({
    ids,
    allDone,
    live: isLive(),
    head,
    gathered: head !== undefined && kinOf(board, head).gathered,
  });
}
