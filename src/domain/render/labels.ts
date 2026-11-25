/**
 * How a label looks, on a card and in the page: a small chip whose colour says
 * what the label is about. Every label of one key (`type:`, `env:`, `@`) wears
 * one colour; a label without a key is coloured by its words. The colours are
 * a few light tints, each with a dark ink of its own hue that reads at AA.
 */

export interface LabelColours {
  fill: string;
  ink: string;
}

/** Light tints and their inks: blue, green, purple, orange, teal, pink, olive, grey. */
export const LABEL_COLOURS: readonly LabelColours[] = [
  { fill: "#DCEBFA", ink: "#0B4A85" },
  { fill: "#DDF3E4", ink: "#146C34" },
  { fill: "#ECE3FA", ink: "#5B2B9E" },
  { fill: "#FDE7D3", ink: "#8A3B00" },
  { fill: "#D6F2F0", ink: "#0D5E59" },
  { fill: "#FBE1EC", ink: "#8E1F52" },
  { fill: "#EEF0D2", ink: "#545A0C" },
  { fill: "#E6E8EB", ink: "#3A424B" },
];

/** The eight colours by name, in the order of `LABEL_COLOURS`: what a key is given when its colour is chosen. */
export const LABEL_COLOUR_NAMES = [
  "blue",
  "green",
  "purple",
  "orange",
  "teal",
  "pink",
  "olive",
  "grey",
] as const;
export type LabelColourName = (typeof LABEL_COLOUR_NAMES)[number];
/** Per key, the colour chosen for it, by name. */
export type Chosen = Readonly<Record<string, string>>;

/** What a label is about: its key before ":", else its words; case does not count. */
export function labelKey(label: string): string {
  const at = label.indexOf(":");
  return (at > 0 ? label.slice(0, at) : label).toLowerCase();
}

/**
 * The colours of a label: the one chosen for its key, else always the same for
 * one key, from a small FNV-1a hash of it.
 */
export function labelColours(label: string, chosen?: Chosen): LabelColours {
  const key = labelKey(label);
  const named =
    chosen && Object.hasOwn(chosen, key) ? LABEL_COLOUR_NAMES.indexOf(chosen[key] as LabelColourName) : -1;
  const picked = LABEL_COLOURS[named];
  if (picked) return picked;
  let hash = 0x811c9dc5;
  for (const char of key) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return LABEL_COLOURS[hash % LABEL_COLOURS.length] ?? { fill: "#E6E8EB", ink: "#3A424B" };
}

/** The words a chip shows: an assignee the short way, `@name`; the rest as written. */
export function chipText(label: string): string {
  return label.toLowerCase().startsWith("assignee:") ? `@${label.slice("assignee:".length)}` : label;
}

/**
 * The words a chip shows on a card, where room is short: a keyed label its value alone, since its colour
 * already says the key (`type:bug` reads `bug`); an assignee `@name`. Its tooltip and name say it whole.
 */
export function cardChipText(label: string): string {
  const short = chipText(label);
  if (short !== label) return short;
  const colon = label.indexOf(":");
  return colon > 0 && colon < label.length - 1 ? label.slice(colon + 1) : label;
}
