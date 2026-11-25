/**
 * The toolbar of the card chosen (out of board-view.ts, T259): its buttons,
 * the list under ⋯, and where it stands beside its card. board-view.ts says
 * when it shows and what each action does.
 */
import { ADD_LINKED } from "./add-linked.ts";
import { h } from "./dom.ts";
import { locale, t } from "./locale.ts";
import { placeTools, type Rect } from "./tools-place.ts";

/** The ⋯ of the toolbar stays open through repaints while its card stays chosen. */
export interface MoreMenu {
  open: boolean;
  card?: string;
}

export interface CardActions {
  rename(): void;
  detail(): void;
  note(): void;
  link(): void;
  /** Adds a card linked from this one. */
  linked(): void;
  /** Marks the card done, or no longer done. */
  done(): void;
  remove(): void;
}

/** What of the card its toolbar shows. */
export interface CardShown {
  id: string;
  hasDetail: boolean;
  done: boolean;
  /** The buttons that make a card this one leads to, between the detail and the note. */
  leads: HTMLElement[];
}

/** Each action says its key too: the shortcuts are learnt where they are used. */
const keyed = (label: string, key: string): { type: string; title: string } => ({
  type: "button",
  title: t.withKey(label, key),
});

/** One drawing per action in view, on the grid and the stroke of the tabs': a pencil, a page, a plus, a speech bubble. */
const ICON = {
  rename:
    '<path d="M2.5 13.5l.75-3L10.5 3.25a1.4 1.4 0 0 1 2 0l.25.25a1.4 1.4 0 0 1 0 2L5.5 12.75z"/><path d="M9.25 4.5l2.25 2.25"/>',
  detail: '<rect x="2.5" y="1.5" width="11" height="13" rx="1.5"/><path d="M5 5.5h6M5 8h6M5 10.5h4"/>',
  lead: '<path d="M8 3v10M3 8h10"/>',
  note: '<path d="M3 3h10a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 12H7l-3 2.5V12H3a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 3 3z"/>',
} as const;

/**
 * What a button of the bar shows (S329): a drawing, so that the bar stays narrower than its card. Its
 * word is still there for a screen reader, and in the tooltip with its key.
 */
function drawn(icon: keyof typeof ICON, word: string): HTMLElement[] {
  const picture = h("span", { class: "tools-icon", "aria-hidden": "true" });
  picture.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[icon]}</svg>`;
  return [picture, h("span", { class: "tools-word" }, word)];
}

/** The button that makes, from a card, one of the kind it leads to: a plus, named by what it makes. */
export function leadButton(label: string, onclick: () => void): HTMLElement {
  return h("button", { type: "button", title: label, onclick }, ...drawn("lead", label));
}

/** The actions taken less often wait under ⋯, their keys still at hand. */
function moreMenu(card: CardShown, menu: MoreMenu, host: HTMLElement, on: CardActions): HTMLElement {
  // An action chosen in the list closes it: the list does not stay over the board it changed.
  const chosen = (act: () => void): void => {
    menu.open = false;
    more.open = false;
    act();
  };
  const doneLabel = card.done ? t.notDone : t.done;
  const linked = ADD_LINKED[locale];
  const more = h(
    "details",
    {
      class: "menu card-more",
      open: menu.open,
      ontoggle: () => {
        menu.open = more.open;
        if (!more.open) return;
        // Low on the board, the list opens upwards rather than under the board's edge.
        const list = more.querySelector<HTMLElement>(".menu-items");
        const bottom = host.getBoundingClientRect().bottom;
        if (list) more.classList.toggle("opens-up", list.getBoundingClientRect().bottom > bottom - 8);
      },
    },
    h("summary", { title: t.moreActions, "aria-label": t.moreActions }, "⋯"),
    h(
      "div",
      { class: "menu-items" },
      h("button", { ...keyed(t.link, "L"), onclick: () => chosen(on.link) }, t.link),
      h("button", { ...keyed(linked, "A"), onclick: () => chosen(on.linked) }, linked),
      h("button", { ...keyed(doneLabel, "D"), onclick: () => chosen(on.done) }, doneLabel),
      h(
        "button",
        { ...keyed(t.remove, "Delete"), class: "danger", onclick: () => chosen(on.remove) },
        t.remove,
      ),
    ),
  );
  return more;
}

/** The buttons of a card's toolbar: the actions taken most in view, the others under ⋯. */
export function cardButtons(
  card: CardShown,
  menu: MoreMenu,
  host: HTMLElement,
  on: CardActions,
): HTMLElement[] {
  if (card.id !== menu.card) menu.open = false;
  menu.card = card.id;
  return [
    h("button", { ...keyed(t.rename, "Enter"), onclick: on.rename }, ...drawn("rename", t.rename)),
    // A card that has a detail says so by its page pressed in: seen here, as the ≡ it wears, not heard.
    h(
      "button",
      { ...keyed(t.detail, "E"), class: card.hasDetail ? "has-detail" : undefined, onclick: on.detail },
      ...drawn("detail", t.detail),
    ),
    ...card.leads,
    h("button", { ...keyed(t.noteForClaude, "N"), onclick: on.note }, ...drawn("note", t.noteForClaude)),
    moreMenu(card, menu, host, on),
  ];
}

/** Puts the toolbar beside its card, clear of the other cards, inside the board's frame. */
export function standBy(
  tools: HTMLElement,
  card: Element,
  others: readonly Element[],
  host: HTMLElement,
): void {
  const frame = host.getBoundingClientRect();
  const inFrame = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left - frame.left,
      top: r.top - frame.top,
      right: r.right - frame.left,
      bottom: r.bottom - frame.top,
    };
  };
  const { left, top } = placeTools(
    inFrame(card),
    others.map(inFrame),
    { w: tools.offsetWidth, h: tools.offsetHeight },
    frame,
  );
  tools.style.left = `${left}px`;
  tools.style.top = `${top}px`;
}

/** The keyboard is in the page's panels or header: the toolbar leaves the board to them. */
export function keyboardAway(host: HTMLElement): boolean {
  const active = document.activeElement;
  return active !== null && active !== document.body && !host.contains(active);
}

/** The toolbar has no place to stand: the keyboard is away from the board, or its card is out of sight. */
export const noPlace = (host: HTMLElement, g: SVGGElement, scroll: HTMLElement): boolean =>
  keyboardAway(host) || outOfSight(g, scroll);

/** A card scrolled out of the board's window: its toolbar would stand alone at the edge, so it goes. */
function outOfSight(g: SVGGElement, scroll: HTMLElement): boolean {
  const card = g.getBoundingClientRect();
  const seen = scroll.getBoundingClientRect();
  return card.right < seen.left || card.left > seen.right || card.bottom < seen.top || card.top > seen.bottom;
}
