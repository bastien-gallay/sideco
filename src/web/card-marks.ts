/**
 * What the page draws on a card beyond what svg.ts draws for every export:
 * the ring of a card focused or chosen, and the marks of what Claude changed.
 */
import { esc } from "../domain/render/svg.ts";
import { t } from "./locale.ts";

/** How far outside its card the ring of a focused or selected card is drawn: off the sticky's colour, always. */
const RING = 5;

/** The ring of a focused or selected card, drawn around it rather than on it: it reads on every sticky. */
export const ringMarkup = (card: { w: number; h: number }): string =>
  `<rect class="card-ring" x="${-RING}" y="${-RING}" width="${card.w + 2 * RING}" height="${card.h + 2 * RING}" rx="${RING + 2}"/>`;

/**
 * The mark of a card that carries a change Claude has not read: a dot on the
 * corner the note count leaves free, with its words for a pointer resting on it.
 */
export const unreadMark = (): string =>
  `<g class="card-unread"><title>${esc(t.unread)}</title><circle cx="2" cy="2" r="5"/></g>`;

/**
 * The mark of a card Claude changed while the reader was away: a triangle on
 * the bottom corner nothing else takes, a shape of its own beside the dot.
 */
export const changedMark = (height: number): string =>
  `<g class="card-changed" transform="translate(0 ${height})"><title>${esc(t.changedSinceVisit)}</title><path d="M0 -8 L8 5 L-8 5 Z"/></g>`;
