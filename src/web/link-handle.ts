/**
 * The handle that draws a link (S326), after faceto's connect handle: a dot on
 * the right edge of the frame of the card chosen, and of no other. Pulled, it lays a dashed
 * wire that follows the pointer; released anywhere on another card, it links
 * the two, or cuts the link when the card chosen already points at that one.
 * The middle of a card is left to moving it. How a dot is pulled is said in
 * wire-pull.ts.
 */
import { RING } from "./card-marks.ts";
import { t } from "./locale.ts";
import { type Grip, mountPull, type Point } from "./wire-pull.ts";

export interface HandleHooks {
  /** The card that wears the handle, in the board's frame; none while the board cannot be written. */
  chosen(): { id: string; x: number; y: number; w: number; h: number } | undefined;
  toScene(event: { clientX: number; clientY: number }): Point;
  linked(src: string, dst: string): boolean;
  /** Links the two cards, or cuts the link between them; answers whether it was saved. */
  pulled(src: string, dst: string, cut: boolean): Promise<boolean>;
  /** Says to a screen reader what releasing the wire did. */
  say(words: string): void;
}

/** The one dot of the card chosen: it links, or cuts the link already there. */
function gripOf(hooks: HandleHooks): Grip[] {
  const card = hooks.chosen();
  if (!card) return [];
  const at = { x: card.x + card.w + RING, y: card.y + card.h / 2 };
  const cut = (target: string): boolean => hooks.linked(card.id, target);
  return [
    {
      at,
      from: at,
      held: card.id,
      title: t.withKey(t.link, "L"),
      would: (target) => (cut(target) ? "cut" : "link"),
      pulled: (target) => hooks.pulled(card.id, target, cut(target)),
      said: (target) =>
        target ? t.wired(t.linkBetween(card.id, target), cut(target)) : t.wired(undefined, false),
    },
  ];
}

/** Draws the handle on the board and follows its pulls; gives back what repaints it. */
export function linkHandle(root: SVGSVGElement, hooks: HandleHooks): () => void {
  return mountPull(root, "link-handle", {
    grips: () => gripOf(hooks),
    toScene: hooks.toScene,
    say: hooks.say,
  });
}
