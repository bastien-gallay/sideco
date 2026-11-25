/**
 * The colour of a label's key, chosen in the panel (S328): the dot of a chip
 * opens the eight colours of its key, under the chips; one pressed colours
 * every label of that key, on every board. Auto leaves the key to chance.
 * Escape puts the colours away, and the keyboard goes back to the dot.
 */
import type { Locale } from "../domain/i18n.ts";
import { colouredKey } from "../domain/label-colour.ts";
import {
  type Chosen,
  LABEL_COLOUR_NAMES,
  LABEL_COLOURS,
  type LabelColourName,
  labelColours,
} from "../domain/render/labels.ts";
import { h } from "./dom.ts";
import { locale } from "./locale.ts";
import { send } from "./store.ts";

const WORDS: Record<
  Locale,
  {
    of: (key: string) => string;
    everywhere: (key: string) => string;
    auto: string;
    autoTitle: string;
    names: readonly string[];
  }
> = {
  en: {
    of: (key) => `Colour of the “${key}” labels`,
    everywhere: (key) => `Colour of the “${key}” labels, on every board`,
    auto: "Auto",
    autoTitle: "The colour chance gives this key",
    names: LABEL_COLOUR_NAMES,
  },
  fr: {
    of: (key) => `Couleur des labels « ${key} »`,
    everywhere: (key) => `Couleur des labels « ${key} », sur tous les tableaux`,
    auto: "Auto",
    autoTitle: "La couleur que le hasard donne à cette clé",
    names: ["bleu", "vert", "violet", "orange", "sarcelle", "rose", "olive", "gris"],
  },
};
const w = WORDS[locale];

/** The colours of one key, under the chips: there while a dot is open, and kept through the panel's repaints. */
export const colourRow = h("div", { class: "label-colours", role: "group", hidden: true });
let open: string | undefined;

const dotOf = (key: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`.label-colour[data-key="${CSS.escape(key)}"]`);

/** The key whose dot is to have the keyboard back: the panel painted again draws a new dot, the one focused is gone. */
let back: string | undefined;

function close(): void {
  const key = open;
  open = undefined;
  colourRow.hidden = true;
  colourRow.replaceChildren();
  if (key === undefined) return;
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

function show(key: string, colours: Chosen): void {
  open = key;
  const now = Object.hasOwn(colours, key) ? colours[key] : undefined;
  const choose = (colour?: LabelColourName): void => {
    void send({ kind: "colour-label", key, ...(colour ? { colour } : {}) }).then(close);
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
  );
  colourRow.hidden = false;
  colourRow.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
}

colourRow.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  // The key stops here: the card stays chosen.
  event.preventDefault();
  event.stopPropagation();
  close();
});

/** The dot a chip wears before its words: it opens the colours of its key, or puts them away. */
export function colourDot(label: string, colours: Chosen): HTMLButtonElement {
  const key = colouredKey(label);
  return h("button", {
    type: "button",
    class: "label-colour",
    "data-key": key,
    style: `background-color:${labelColours(label, colours).ink}`,
    "aria-label": w.of(key),
    title: w.of(key),
    "aria-expanded": String(open === key),
    onclick: () => (open === key ? close() : show(key, colours)),
  });
}
