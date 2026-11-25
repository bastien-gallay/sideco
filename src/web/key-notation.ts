/**
 * How the sheet writes a key (T305): the keys of the reader's keyboard and not those of another, a plus with a
 * space on each side everywhere, and each key drawn as one key, the words between them left as words. One key
 * drawn around `⇧⌘Z / Ctrl+Shift+Z or Ctrl+Y` was wider than its column.
 */

/** A key to draw as a key, or a word that stands between two keys. */
export type Piece = { key: string } | { word: string };

/** `⌘K / Ctrl+K`: what a Mac writes, then what another keyboard writes, up to the next `⌘ /` pair or the end. */
const EITHER = /(\S*⌘\S*) \/ (.+?)(?=(?:, or |, ou | or | ou | and | et |, )\S*⌘\S* \/ |$)/g;
/**
 * A plus that joins two keys without a space: `Ctrl+K`. The key `+` itself stands alone. Written without a look
 * behind, which an older Safari cannot read: it would not draw the page at all.
 */
const JOINED = /(\S)\+(?=\S)/g;
/** The words between two keys, in both languages. */
const WORDS = /(, or |, ou | or | ou | and | et )/;

/** The keys of a row as the reader's keyboard writes them. */
export function ownKeys(keys: string, mac: boolean): string {
  return keys.replace(EITHER, mac ? "$1" : "$2").replace(JOINED, "$1 + ");
}

/**
 * Splits a comma list into keys, keeping a key held across commas (`Shift + Home, End`) as one key so `End` does
 * not read as End alone. A full chord after a comma (`Ctrl + Z, Ctrl + Y`) starts its own key.
 */
function splitComma(clause: string): Piece[] {
  const out: Piece[] = [];
  for (const item of clause.split(", ")) {
    const previous = out[out.length - 1];
    if (previous && "key" in previous && previous.key.includes(" + ") && !item.includes(" + ")) {
      previous.key += `, ${item}`;
      continue;
    }
    if (out.length > 0) out.push({ word: ", " });
    out.push({ key: item });
  }
  return out;
}

/** The keys of a row, one by one, with the words between them. */
export function pieces(keys: string): Piece[] {
  const out: Piece[] = [];
  for (const [at, part] of keys.split(WORDS).entries()) {
    if (part === "") continue;
    if (at % 2 === 1) {
      out.push({ word: part });
      continue;
    }
    out.push(...splitComma(part));
  }
  return out;
}
