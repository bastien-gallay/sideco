/**
 * Undo on a gesture Claude changed since (B8): no surprise. The page says what
 * the gesture did and what Claude did after, then asks. Keeping Claude's change
 * has the focus; undoing anyway is offered only while what it writes is there.
 * Its words live here, in each language, as messages.ts is at its ceiling.
 */
import type { Locale } from "../domain/i18n.ts";
import { type Gesture, goneFrom } from "../domain/undo.ts";
import { findBoard } from "../domain/workspace.ts";
import { h } from "./dom.ts";
import { locale } from "./locale.ts";
import { send, state } from "./store.ts";
import { describeEvent } from "./view.ts";

interface Words {
  question: string;
  consequence: string;
  gone: string;
  keep: string;
  anyway: string;
}

const WORDS: Record<Locale, Words> = {
  en: {
    question: "Claude changed it since. Undo anyway?",
    consequence:
      "Undoing anyway overwrites Claude's change. Keeping it takes your gesture off the Undo list.",
    gone: "Claude removed what your gesture changed: it can no longer be undone, and leaves the Undo list.",
    keep: "Keep Claude's change",
    anyway: "Undo anyway",
  },
  fr: {
    question: "Claude l'a changé depuis. Annuler quand même ?",
    consequence:
      "Annuler quand même efface le changement de Claude. Le garder retire ton geste de la liste d'annulation.",
    gone: "Claude a retiré ce que ton geste avait changé : il ne peut plus être annulé et quitte la liste d'annulation.",
    keep: "Garder le changement de Claude",
    anyway: "Annuler quand même",
  },
};

/** The human's latest gesture on `board`, kept or removed: what the next Undo takes back. */
export function lastGesture(board: string): Gesture | undefined {
  return [...state.live.boards, ...state.live.removed].find((b) => b.id === board)?.trails.human?.undo.at(-1);
}

/** The question's own dialog, laid out as the one that asks before removing a board. */
const undoAsk = h("dialog", { class: "sheet undo-ask" });

/** Fills `undoAsk` with the question on `gesture`, opens it, and puts the focus on keeping. */
export function askBeforeUndo(board: string, gesture: Gesture, overwrite: () => void): void {
  if (!undoAsk.isConnected) document.body.append(undoAsk);
  const w = WORDS[locale];
  const said = (seq: number, name: string): string => {
    const event = state.events.find((e) => e.seq === seq);
    return event ? describeEvent(event, locale, state.live) : name;
  };
  const live = findBoard(state.live, board);
  const possible = live !== undefined && goneFrom(live, gesture) === undefined;
  const answer = (then: () => void) => (): void => {
    undoAsk.close();
    then();
  };
  const keep = h(
    "button",
    {
      type: "button",
      class: "quiet",
      onclick: answer(() => void send({ kind: "undo", board, ifChanged: "keep" })),
    },
    w.keep,
  );
  const theirs = gesture.blocked ? said(gesture.blocked.seq, gesture.blocked.name) : "";
  undoAsk.replaceChildren(
    h("h2", {}, possible ? w.question : w.keep),
    h("ul", {}, h("li", {}, said(gesture.seq, gesture.name)), h("li", {}, theirs)),
    h("p", {}, possible ? w.consequence : w.gone),
    h(
      "div",
      { class: "actions" },
      keep,
      possible
        ? h("button", { type: "button", class: "danger", onclick: answer(overwrite) }, w.anyway)
        : null,
    ),
  );
  undoAsk.showModal();
  keep.focus();
}
