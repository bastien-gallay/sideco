/**
 * A link turned round from the page (S349): its source becomes its target, its
 * name kept, in one gesture that one Undo takes back. The same button serves
 * the bar of a link picked on the board and the Links section of the Detail
 * tab. Its words live here, in each language, as messages.ts is at its ceiling.
 */
import type { Locale } from "../domain/i18n.ts";
import { h } from "./dom.ts";
import { locale } from "./locale.ts";
import { currentBoard, send } from "./store.ts";

const WORDS: Record<Locale, { reverse: string; refused: (src: string, dst: string) => string }> = {
  en: { reverse: "Reverse", refused: (src, dst) => `${dst} already links to ${src}` },
  fr: { reverse: "Inverser", refused: (src, dst) => `${dst} pointe déjà vers ${src}` },
};

/** Whether the link can be turned round: not while another one already goes the other way. */
export function reversible(link: { src: string; dst: string }): boolean {
  return !currentBoard()?.edges.some((e) => e.src === link.dst && e.dst === link.src);
}

/**
 * The button that turns `link` round. `done` is told once it is asked, before
 * the board answers. Where a link already goes the other way the button says
 * so and does nothing: two links cannot lie one on the other.
 */
export function reverseButton(
  link: { src: string; dst: string },
  attrs: Record<string, string>,
  done: () => void,
): HTMLButtonElement {
  const can = reversible(link);
  const onclick = (): void => {
    const board = currentBoard();
    if (!board || !can) return;
    done();
    void send({ kind: "reverse", board: board.id, src: link.src, dst: link.dst });
  };
  return h(
    "button",
    {
      type: "button",
      ...attrs,
      ...(can ? {} : { "aria-disabled": "true", title: WORDS[locale].refused(link.src, link.dst) }),
      onclick,
    },
    WORDS[locale].reverse,
  );
}
