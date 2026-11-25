/**
 * The colour of a label's key, chosen in the panel (S328): the dot of a chip
 * opens the eight colours of its key, under the chips; one pressed colours
 * every label of that key, on every board. Auto leaves the key to chance.
 * Escape puts the colours away, and the keyboard goes back to the dot.
 */
import type { Locale } from "../domain/i18n.ts";
import { byBoard, renameLabel } from "../domain/label-rename.ts";
import { normalLabel } from "../domain/labels.ts";
import {
  type Chosen,
  LABEL_COLOUR_NAMES,
  LABEL_COLOURS,
  type LabelColourName,
  labelColours,
  labelKey,
} from "../domain/render/labels.ts";
import { h } from "./dom.ts";
import { locale } from "./locale.ts";
import { send, sendTogether, shown } from "./store.ts";

const WORDS: Record<
  Locale,
  {
    of: (key: string) => string;
    everywhere: (key: string) => string;
    auto: string;
    autoTitle: string;
    names: readonly string[];
    rename: (label: string) => string;
    renameDo: string;
    renamed: (from: string, to: string, cards: number) => string;
  }
> = {
  en: {
    of: (key) => `Colour of the “${key}” labels`,
    everywhere: (key) => `Colour of the “${key}” labels, on every board`,
    auto: "Auto",
    autoTitle: "The colour chance gives this key",
    names: LABEL_COLOUR_NAMES,
    rename: (label) => `New name of “${label}”, on every card of every board`,
    renameDo: "Rename everywhere",
    renamed: (from, to, cards) =>
      `“${from}” is now “${to}” on ${cards} card${cards > 1 ? "s" : ""}: Undo takes it back, board by board`,
  },
  fr: {
    of: (key) => `Couleur des labels « ${key} »`,
    everywhere: (key) => `Couleur des labels « ${key} », sur tous les tableaux`,
    auto: "Auto",
    autoTitle: "La couleur que le hasard donne à cette clé",
    names: ["bleu", "vert", "violet", "orange", "sarcelle", "rose", "olive", "gris"],
    rename: (label) => `Nouveau nom de « ${label} », sur toutes les cartes de tous les tableaux`,
    renameDo: "Renommer partout",
    renamed: (from, to, cards) =>
      `« ${from} » s'appelle « ${to} » sur ${cards} carte${cards > 1 ? "s" : ""} : Undo le défait, tableau par tableau`,
  },
};
const w = WORDS[locale];

/** How the page speaks to a screen reader: given by the chip as it is drawn. */
let said: (words: string) => void = () => {};

/** The colours of one key, under the chips: there while a dot is open, and kept through the panel's repaints. */
export const colourRow = h("div", { class: "label-colours", role: "group", hidden: true });
let open: string | undefined;

const dotOf = (key: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`.label-colour[data-key="${CSS.escape(key)}"]`);

/** The key whose dot is to have the keyboard back: the panel painted again draws a new dot, the one focused is gone. */
let back: string | undefined;

/** Puts the colours away, and says so on their dot. */
function putAway(): string | undefined {
  const key = open;
  open = undefined;
  colourRow.hidden = true;
  colourRow.replaceChildren();
  if (key !== undefined) dotOf(key)?.setAttribute("aria-expanded", "false");
  return key;
}

/**
 * Called as the panel is painted: the colours of a key stay open only on a card that
 * wears it, and only while the board can be written. The keyboard is not moved.
 */
export function settleColours(labels: readonly string[], live: boolean): void {
  if (open !== undefined && !(live && labels.some((label) => labelKey(label) === open))) putAway();
}

/** Puts the colours away and gives the keyboard back to the dot that opened them, or to the dot of `to`. */
function close(to?: string): void {
  const opened = putAway();
  if (opened === undefined) return;
  const key = to ?? opened;
  dotOf(key)?.focus();
  back = key;
  setTimeout(() => {
    if (back === key) back = undefined;
  }, 1000);
}

/** Called as the panel is painted: the keyboard lost with the dot replaced goes to the new one, unless it went elsewhere. */
export function keepDot(): void {
  if (back === undefined) return;
  const active = document.activeElement;
  if (active && active !== document.body) {
    if (!active.classList.contains("label-colour")) back = undefined;
    return;
  }
  dotOf(back)?.focus();
}

/** The name of one label, under the colours of its key: written anew, it is renamed on every card that wears it (S328). */
function renaming(label: string): HTMLElement {
  const field = h("input", {
    class: "label-rename-to",
    value: label,
    "aria-label": w.rename(label),
    maxlength: 60,
  });
  const rename = (event: Event): void => {
    event.preventDefault();
    const to = normalLabel(field.value);
    const commands = renameLabel(shown(), label, to);
    // Nothing to rename, refused or not sent: the field stays open, to be written again.
    if (commands.length === 0) return;
    void (async () => {
      // A batch a board: each is one gesture there. A board refused stops the rename where it is.
      for (const batch of byBoard(commands)) if ((await sendTogether(batch)) === undefined) return;
      said(w.renamed(label, to, commands.length / 2));
      // The label may have another key now: the keyboard goes to the dot it has.
      close(labelKey(to));
    })();
  };
  return h(
    "form",
    { class: "label-rename", onsubmit: rename },
    field,
    h("button", { type: "submit", class: "quiet" }, w.renameDo),
  );
}

function show(key: string, label: string, colours: Chosen): void {
  open = key;
  const now = Object.hasOwn(colours, key) ? colours[key] : undefined;
  const choose = (colour?: LabelColourName): void => {
    // Refused or not sent, the colours stay open: to be chosen again.
    void send({ kind: "colour-label", key, ...(colour ? { colour } : {}) }).then(
      (done) => done !== undefined && close(),
    );
  };
  colourRow.setAttribute("aria-label", w.everywhere(key));
  colourRow.replaceChildren(
    ...LABEL_COLOUR_NAMES.map((name, at) =>
      h("button", {
        type: "button",
        class: "label-swatch",
        style: `background:${LABEL_COLOURS[at]?.fill};color:${LABEL_COLOURS[at]?.ink}`,
        "aria-label": w.names[at] ?? name,
        title: w.names[at] ?? name,
        "aria-pressed": String(now === name),
        onclick: () => choose(name),
      }),
    ),
    h(
      "button",
      {
        type: "button",
        class: "label-swatch label-swatch-auto",
        title: w.autoTitle,
        "aria-pressed": String(now === undefined),
        onclick: () => choose(),
      },
      w.auto,
    ),
    renaming(label),
  );
  colourRow.hidden = false;
  dotOf(key)?.setAttribute("aria-expanded", "true");
  // A colour this build does not know leaves none pressed: the first has the keyboard then.
  colourRow.querySelector<HTMLButtonElement>('[aria-pressed="true"], button')?.focus();
}

colourRow.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  // The key stops here: the card stays chosen.
  event.preventDefault();
  event.stopPropagation();
  close();
});

/** The dot a chip wears before its words: it opens the colours of its key, or puts them away. */
export function colourDot(
  label: string,
  colours: Chosen,
  say: (words: string) => void = () => {},
): HTMLButtonElement {
  said = say;
  const key = labelKey(label);
  return h("button", {
    type: "button",
    class: "label-colour",
    "data-key": key,
    style: `background-color:${labelColours(label, colours).ink}`,
    "aria-label": w.of(key),
    title: w.of(key),
    "aria-expanded": String(open === key),
    onclick: () => (open === key ? close() : show(key, label, colours)),
  });
}
