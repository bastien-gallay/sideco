/**
 * A card's detail, read as a small markdown: paragraphs whose lines stay lines,
 * lists, fenced code, and inside a line bold, italic, code and links to the web
 * or a mail. Nothing else: HTML is words, never markup. The page builds the
 * nodes itself, by `textContent`, so no string here ever reaches `innerHTML`.
 */

import { h } from "./dom.ts";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "ol"; start: number; items: Inline[][] }
  | { kind: "pre"; text: string };

const FENCE = /^\s*```/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const LINK = /^\[([^\]\n]+)\]\(([^()\s]+)\)/;
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function parseMarkdown(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  /** The block lines are added to, until an empty line or a block of another kind. */
  let open: Block | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FENCE.test(line)) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? ""); i++) code.push(lines[i] ?? "");
      blocks.push({ kind: "pre", text: code.join("\n") });
      open = undefined;
      continue;
    }
    if (line.trim() === "") {
      open = undefined;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (open?.kind !== "ul") {
        open = { kind: "ul", items: [] };
        blocks.push(open);
      }
      open.items.push(parseInline(bullet[1] ?? ""));
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      if (open?.kind !== "ol") {
        open = { kind: "ol", start: Number(numbered[1]), items: [] };
        blocks.push(open);
      }
      open.items.push(parseInline(numbered[2] ?? ""));
      continue;
    }
    if (open?.kind !== "p") {
      open = { kind: "p", lines: [] };
      blocks.push(open);
    }
    open.lines.push(parseInline(line));
  }
  return blocks;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const words = (s: string): void => {
    const last = out.at(-1);
    if (last?.kind === "text") last.text += s;
    else if (s) out.push({ kind: "text", text: s });
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? "";
    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (c === "*" && text[i + 1] === "*") {
      const end = closing(text, "**", i + 2);
      if (end !== undefined) {
        out.push({ kind: "strong", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if ((c === "*" || c === "_") && opens(text, i)) {
      const end = closing(text, c, i + 1);
      if (end !== undefined) {
        out.push({ kind: "em", children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    } else if (c === "[") {
      const link = LINK.exec(text.slice(i));
      if (link && SAFE_HREF.test(link[2] ?? "")) {
        out.push({ kind: "link", href: link[2] ?? "", children: parseInline(link[1] ?? "") });
        i += link[0].length;
        continue;
      }
    }
    words(c);
    i++;
  }
  return out;
}

const wordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** A single `*` or `_` opens an emphasis when words follow it, and an `_` not from inside a word. */
function opens(text: string, at: number): boolean {
  const next = text[at + 1];
  if (next === undefined || /\s/.test(next)) return false;
  return text[at] !== "_" || !wordChar(text[at - 1]);
}

/** Where `mark` closes what opened before `from`: after words, and an `_` not into a word. */
function closing(text: string, mark: string, from: number): number | undefined {
  for (let at = text.indexOf(mark, from + 1); at !== -1; at = text.indexOf(mark, at + 1)) {
    const before = text[at - 1];
    if (before === undefined || /\s/.test(before)) continue;
    if (mark === "_" && wordChar(text[at + 1])) continue;
    // A single `*` is not the first half of a `**`.
    if (mark === "*" && text[at + 1] === "*") {
      at++;
      continue;
    }
    return at;
  }
  return undefined;
}

/** The detail as the page shows it: nodes made one by one, the words always as text. */
export function markdownNodes(text: string): HTMLElement[] {
  return parseMarkdown(text).map(blockNode);
}

function blockNode(block: Block): HTMLElement {
  switch (block.kind) {
    case "p":
      return h(
        "p",
        {},
        ...block.lines.flatMap((line, n) => [...(n > 0 ? [h("br")] : []), ...line.map(inlineNode)]),
      );
    case "ul":
      return h("ul", {}, ...block.items.map((item) => h("li", {}, ...item.map(inlineNode))));
    case "ol":
      return h(
        "ol",
        block.start === 1 ? {} : { start: block.start },
        ...block.items.map((item) => h("li", {}, ...item.map(inlineNode))),
      );
    case "pre":
      return h("pre", {}, h("code", {}, block.text));
  }
}

function inlineNode(inline: Inline): Node | string {
  switch (inline.kind) {
    case "text":
      return inline.text;
    case "code":
      return h("code", {}, inline.text);
    case "strong":
    case "em":
      return h(inline.kind, {}, ...inline.children.map(inlineNode));
    case "link":
      return h(
        "a",
        { href: inline.href, target: "_blank", rel: "noopener noreferrer" },
        ...inline.children.map(inlineNode),
      );
  }
}
