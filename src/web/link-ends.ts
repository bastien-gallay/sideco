/**
 * The two ends of the link picked, each a dot to pull (S350): the start or the
 * arrow goes to another card, the other end and the name kept. One gesture,
 * one undo. Nothing is done on the card at the other end, nor where the link
 * would double one already there. How a dot is pulled is said in wire-pull.ts;
 * from the terminal, `sideco relink` does the same.
 */
import type { Locale } from "../domain/i18n.ts";
import { type Link, mayGo, relinked } from "./link-end-rules.ts";
import { locale } from "./locale.ts";
import { type Grip, mountPull, type Point } from "./wire-pull.ts";

export interface EndsHooks {
  /** The link picked; none while the board cannot be written. */
  picked(): Link | undefined;
  toScene(event: { clientX: number; clientY: number }): Point;
  linked(src: string, dst: string): boolean;
  /** Moves one end of the link to another card; answers whether it was saved. */
  moved(link: Link, end: "src" | "dst", to: string): Promise<boolean>;
  say(words: string): void;
}

const WORDS: Record<Locale, { start: string; arrow: string; now: (l: Link) => string; kept: string }> = {
  en: {
    start: "Pull to start this link from another card",
    arrow: "Pull to point this link at another card",
    now: (l) => `The link now goes from ${l.src} to ${l.dst}`,
    kept: "The link stays as it was",
  },
  fr: {
    start: "Tirer pour faire partir ce lien d'une autre carte",
    arrow: "Tirer pour pointer ce lien vers une autre carte",
    now: (l) => `Le lien va maintenant de ${l.src} à ${l.dst}`,
    kept: "Le lien reste comme il était",
  },
};

/** Where the line of a link starts and ends on screen, in the board's frame. */
function endsOf(root: SVGSVGElement, link: Link): { start: Point; tip: Point } | undefined {
  const path = [...root.querySelectorAll<SVGGElement>("g.conn")]
    .find((g) => g.dataset.src === link.src && g.dataset.dst === link.dst)
    ?.querySelector<SVGPathElement>("path:not(.conn-hit)");
  if (!path) return undefined;
  const start = path.getPointAtLength(0);
  const tip = path.getPointAtLength(path.getTotalLength());
  return { start: { x: start.x, y: start.y }, tip: { x: tip.x, y: tip.y } };
}

function gripsOf(root: SVGSVGElement, hooks: EndsHooks): Grip[] {
  const link = hooks.picked();
  const drawn = link && endsOf(root, link);
  if (!link || !drawn) return [];
  const words = WORDS[locale];
  const grip = (end: "src" | "dst"): Grip => ({
    at: end === "src" ? drawn.start : drawn.tip,
    from: end === "src" ? drawn.tip : drawn.start,
    held: end === "src" ? link.dst : link.src,
    title: end === "src" ? words.start : words.arrow,
    arrowHeld: end === "src",
    would: (to) => (mayGo(link, end, to, hooks.linked) ? "link" : undefined),
    pulled: (to) => hooks.moved(link, end, to),
    said: (to) => (to ? words.now(relinked(link, end, to)) : words.kept),
  });
  return [grip("src"), grip("dst")];
}

/** Draws the ends of the link picked and follows their pulls; gives back what repaints them. */
export function linkEnds(root: SVGSVGElement, hooks: EndsHooks): () => void {
  return mountPull(root, "link-handle link-ends", {
    grips: () => gripsOf(root, hooks),
    toScene: hooks.toScene,
    say: hooks.say,
  });
}
