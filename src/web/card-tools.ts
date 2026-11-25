/**
 * The toolbar of the card chosen (out of board-view.ts, T259): its buttons,
 * the list under ⋯, and where it stands beside its card. board-view.ts says
 * when it shows and what each action does.
 */
import { h } from "./dom.ts";
import { t } from "./locale.ts";
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

/** The actions taken less often wait under ⋯, their keys still at hand. */
function moreMenu(card: CardShown, menu: MoreMenu, host: HTMLElement, on: CardActions): HTMLElement {
  // An action chosen in the list closes it: the list does not stay over the board it changed.
  const chosen = (act: () => void): void => {
    menu.open = false;
    more.open = false;
    act();
  };
  const doneLabel = card.done ? t.notDone : t.done;
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
    h("button", { ...keyed(t.rename, "Enter"), onclick: on.rename }, t.rename),
    // The ≡ the card wears when it has a detail: seen here too, not heard.
    h(
      "button",
      { ...keyed(t.detail, "E"), onclick: on.detail },
      t.detail,
      card.hasDetail ? h("span", { "aria-hidden": "true" }, " ≡") : undefined,
    ),
    ...card.leads,
    h("button", { ...keyed(t.noteForClaude, "N"), onclick: on.note }, t.noteForClaude),
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
