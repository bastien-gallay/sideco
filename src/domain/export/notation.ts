/**
 * What a notation asks of a diagram that leaves the page: C4 wants every diagram
 * titled by what it is and whose, and a key of its kinds. A workshop that asks
 * for neither leaves under its board's title, without a key.
 */
import { findFormat } from "../formats.ts";
import { DEFAULT_LOCALE, type Locale, WORDS } from "../i18n.ts";
import type { Frame, KeyEntry } from "../render/frame.ts";
import type { Board } from "../workspace.ts";

/** "System context: Shop" where the notation names its diagrams, the board's title elsewhere. */
export function diagramTitle(board: Board, locale: Locale = DEFAULT_LOCALE): string {
  const framed = findFormat(board.format)?.framed;
  return framed ? `${framed[locale]}${WORDS[locale].colon} ${board.title}` : board.title;
}

/** Each kind of the workshop, as its cards are drawn; undefined where the notation asks for no key. */
export function diagramKey(board: Board, locale: Locale = DEFAULT_LOCALE): KeyEntry[] | undefined {
  const format = findFormat(board.format);
  if (!format?.framed) return undefined;
  return format.types.map((type) => ({
    label: type.label[locale],
    fill: type.fill,
    shape: type.shape,
    ...(format.look ? { tone: { light: type.fill, dark: type.dark ?? type.fill } } : {}),
  }));
}

/** The frame of the drawing alone; a document that already carries the title asks for the key only. */
export function diagramFrame(board: Board, locale: Locale | undefined, headed: boolean): Frame | undefined {
  const key = diagramKey(board, locale);
  if (!key) return undefined;
  return headed ? { heading: diagramTitle(board, locale), key } : { key };
}
