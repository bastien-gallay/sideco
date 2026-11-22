/**
 * The labels of a card, shared by every board of the project: how one is kept,
 * and when two are the same.
 */

/**
 * A label as it is kept: spaces at the edges dropped, runs of spaces made one;
 * `@name` is the short way to say `assignee:name`.
 */
export function normalLabel(raw: string): string {
  const said = raw.trim().replace(/\s+/g, " ");
  return said.startsWith("@") && said.length > 1 ? `assignee:${said.slice(1)}` : said;
}

/** Two labels are one when they differ only by case. */
export function sameLabel(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function hasLabel(el: { labels?: readonly string[] }, label: string): boolean {
  return (el.labels ?? []).some((own) => sameLabel(own, label));
}
