/** The few DOM helpers the page needs; no framework. */

type Child = Node | string | false | null | undefined;
export type Props = Record<string, string | number | boolean | EventListener | undefined>;

/** Creates an element. `on*` props are listeners, `class` and the rest are attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** Re-renders a region only when what it shows changed, so focus and scroll survive unrelated updates. */
export function region<T>(host: HTMLElement, render: (model: T) => Child[]): (model: T) => void {
  let last: string | undefined;
  return (model) => {
    const signature = JSON.stringify(model);
    if (signature === last) return;
    last = signature;
    host.replaceChildren(...render(model).filter((c): c is Node | string => Boolean(c)));
  };
}

export function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
