/**
 * Diagrams the agent wrote in its reply, lifted onto a board.
 *
 * Reads the Mermaid flowcharts in a Markdown text and turns each into the
 * commands that build an editable Flux board. Only the common subset is read:
 * nodes with their shape, arrows with their label. A line it does not
 * understand is skipped, never guessed.
 */
import { type Command, LIMITS } from "./commands.ts";

export interface CapturedNode {
  key: string;
  label: string;
  type: "step" | "decision" | "outcome";
}

export interface CapturedDiagram {
  /** Stable for a given source text, so the same diagram is captured once. */
  hash: string;
  nodes: CapturedNode[];
  edges: { src: string; dst: string; label?: string }[];
}

const MAX_NODES = 60;
const FENCE = /```mermaid[^\n]*\n([\s\S]*?)```/g;
const SKIPPED = /^(subgraph|end|classDef|class|style|linkStyle|direction|click)\b/;

const SHAPES: readonly [open: string, close: string, type: CapturedNode["type"]][] = [
  ["([", "])", "outcome"],
  ["[[", "]]", "step"],
  ["((", "))", "outcome"],
  ["{{", "}}", "decision"],
  ["[", "]", "step"],
  ["(", ")", "step"],
  ["{", "}", "decision"],
  [">", "]", "step"],
];

/** `-- text -->`, `-. text .->`, `== text ==>` */
const EDGE_WITH_TEXT = /^\s*(?:--|==|-\.)\s+"?([^"|>-][^"|]*?)"?\s+(?:-{2,}|={2,}|\.+-)[>ox]?/;
/** `-->`, `---`, `==>`, `-.->`, `--o`, each with an optional `|text|` */
const EDGE = /^\s*[<ox]?(?:-{2,}|={2,}|-\.+-)[>ox]?\s*(?:\|\s*"?([^|"]*?)"?\s*\|)?/;

export function captureDiagrams(markdown: string): CapturedDiagram[] {
  const found: CapturedDiagram[] = [];
  for (const match of markdown.matchAll(FENCE)) {
    const source = match[1] ?? "";
    const diagram = parseFlowchart(source);
    if (diagram) found.push(diagram);
  }
  return found;
}

export function parseFlowchart(source: string): CapturedDiagram | undefined {
  const lines = source.split("\n").map((line) => line.replace(/%%.*$/, "").trim());
  const header = lines.findIndex((line) => line !== "");
  if (header === -1 || !/^(flowchart|graph)\b/.test(lines[header] ?? "")) return undefined;

  const nodes = new Map<string, CapturedNode>();
  const edges: CapturedDiagram["edges"] = [];
  const see = (node: CapturedNode, explicit: boolean): void => {
    const known = nodes.get(node.key);
    if (!known || explicit) nodes.set(node.key, node);
  };

  for (const line of lines.slice(header + 1)) {
    for (const statement of line.split(";")) {
      const text = statement.trim();
      if (text === "" || SKIPPED.test(text)) continue;
      let at = readNode(text, 0);
      if (!at) continue;
      see(at.node, at.explicit);
      let from = at.node.key;
      for (;;) {
        const edge = readEdge(text, at.next);
        if (!edge) break;
        const to = readNode(text, edge.next);
        if (!to) break;
        see(to.node, to.explicit);
        edges.push({ src: from, dst: to.node.key, label: edge.label });
        from = to.node.key;
        at = to;
      }
    }
  }
  if (nodes.size === 0 || nodes.size > MAX_NODES) return undefined;
  return { hash: fnv1a(source.trim()), nodes: [...nodes.values()], edges };
}

function readNode(
  text: string,
  start: number,
): { node: CapturedNode; explicit: boolean; next: number } | undefined {
  const id = /^\s*([A-Za-z0-9_]+)/.exec(text.slice(start));
  if (!id?.[1]) return undefined;
  const key = id[1];
  const after = start + id[0].length;
  for (const [open, close, type] of SHAPES) {
    if (!text.startsWith(open, after)) continue;
    const from = after + open.length;
    const quoted = text[from] === '"';
    const end = quoted ? text.indexOf(`"${close}`, from + 1) : text.indexOf(close, from);
    if (end === -1) return undefined;
    const raw = quoted ? text.slice(from + 1, end) : text.slice(from, end);
    const label = clean(raw) || key;
    return { node: { key, label, type }, explicit: true, next: end + close.length + (quoted ? 1 : 0) };
  }
  return { node: { key, label: key, type: "step" }, explicit: false, next: after };
}

function readEdge(text: string, start: number): { label?: string; next: number } | undefined {
  const rest = text.slice(start);
  const match = EDGE_WITH_TEXT.exec(rest) ?? EDGE.exec(rest);
  if (!match) return undefined;
  const label = clean(match[1] ?? "");
  return { label: label || undefined, next: start + match[0].length };
}

function clean(label: string): string {
  return label
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/#quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.label);
}

/** The commands that build a captured diagram as a new Flux board. */
export function captureCommands(diagram: CapturedDiagram, title: string): Command[] {
  const board = `capture-${diagram.hash}`;
  const prefix = { step: "S", decision: "D", outcome: "O" } as const;
  const count = { step: 0, decision: 0, outcome: 0 };
  const ids = new Map<string, string>();
  const commands: Command[] = [{ kind: "create-board", board, title, format: "flow" }];
  for (const node of diagram.nodes) {
    count[node.type] += 1;
    const id = `${prefix[node.type]}${count[node.type]}`;
    ids.set(node.key, id);
    commands.push({ kind: "add", board, type: node.type, label: node.label, id });
  }
  for (const edge of diagram.edges) {
    const src = ids.get(edge.src);
    const dst = ids.get(edge.dst);
    if (src && dst && src !== dst) commands.push({ kind: "link", board, src, dst, label: edge.label });
  }
  return commands;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
