/**
 * How the sheet writes a key (T305): the keys of the reader's keyboard and not those of another, a plus with a
 * space on each side everywhere, and each key drawn as one key, the words between them left as words. One key
 * drawn around `⇧⌘Z / Ctrl+Shift+Z or Ctrl+Y` was wider than its column.
 */

/** A key to draw as a key, or a word that stands between two keys. */
export type Piece = { key: string } | { word: string };

/** `⌘K / Ctrl+K`: what a Mac writes, then what another keyboard writes, to the end of the row. */
const EITHER = /(\S*⌘\S*) \/ (.+)$/;
/** A plus that joins two keys without a space: `Ctrl+K`. The key `+` itself stands alone. */
const JOINED = /(?<=\S)\+(?=\S)/g;
/** The words between two keys, in both languages; a comma too. */
const BETWEEN = /(, or |, ou | or | ou | and | et |, )/;

/** The keys of a row as the reader's keyboard writes them. */
export function ownKeys(keys: string, mac: boolean): string {
  return keys.replace(EITHER, mac ? "$1" : "$2").replace(JOINED, " + ");
}

/**
 * The keys of a row, one by one, with the words between them. Where a key is held (`Shift + Home, End`), what
 * follows a comma is held with it too: the row stays one key, or `End` would read as End alone.
 */
export function pieces(keys: string): Piece[] {
  const held = keys.includes(" + ") && !/ or | ou /.test(keys);
  if (held) return [{ key: keys }];
  return keys
    .split(BETWEEN)
    .filter((part) => part !== "")
    .map((part, at) => (at % 2 === 1 ? { word: part } : { key: part }));
}
