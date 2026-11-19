/**
 * The interchange file: one JSON object per board. An event-storming board
 * written here loads in faceto and the reverse, so this file follows faceto's
 * conventions: `col` counts from 0, edges are `{src, dst, label}` or `[src, dst]`
 * pairs, and unknown fields are ignored on the way in.
 */
import { type Command, CommandError, isElementId } from "../commands.ts";
import { type Format, findFormat, findType, wearsDone } from "../formats.ts";
import { type Board, idNumber } from "../workspace.ts";

export interface ModelElement {
  id?: string;
  type: string;
  label: string;
  col?: number;
  lane?: string;
  detail?: string;
  done?: boolean;
}

export interface Model {
  title: string;
  format: string;
  /** The lanes the board calls its own way, by lane id. */
  lanes?: Record<string, string>;
  /** The board's lanes in order, when it added, moved or removed some of its workshop's. */
  laneOrder?: string[];
  elements: ModelElement[];
  edges: { src: string; dst: string; label?: string }[];
}

/** faceto reads `external` as `system`; so do we. */
const TYPE_ALIASES: Record<string, string> = { external: "system" };

export function toModel(board: Board): Model {
  const layout = findFormat(board.format)?.layout;
  return {
    title: board.title,
    format: board.format,
    ...(Object.keys(board.lanes).length > 0 ? { lanes: { ...board.lanes } } : {}),
    ...(board.laneOrder ? { laneOrder: [...board.laneOrder] } : {}),
    elements: board.elements.map((e) => ({
      id: e.id,
      type: e.type,
      label: e.label,
      ...(layout === "timeline" ? { col: e.col - 1 } : {}),
      ...(layout === "columns" ? { lane: e.lane } : {}),
      ...(e.detail ? { detail: e.detail } : {}),
      ...(wearsDone(board, e) ? { done: true } : {}),
    })),
    edges: board.edges.map((edge) => ({
      src: edge.src,
      dst: edge.dst,
      ...(edge.label ? { label: edge.label } : {}),
    })),
  };
}

/**
 * The commands that rebuild a model as a new board. Elements keep the order of
 * the file, which is their stacking order, and the ids of the file, which is how
 * people refer to them.
 */
export function fromModel(input: unknown, board: string): Command[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CommandError("a model file is a JSON object");
  }
  const model = input as Record<string, unknown>;
  const formatId = typeof model.format === "string" ? model.format : "event-storming";
  const format = findFormat(formatId);
  const layout = format?.layout;
  const title = typeof model.title === "string" && model.title.trim() ? model.title : board;
  const commands: Command[] = [{ kind: "create-board", board, title, format: formatId }];
  const names = (typeof model.lanes === "object" && model.lanes !== null ? model.lanes : {}) as Record<
    string,
    unknown
  >;
  const said = (lane: string): string => (typeof names[lane] === "string" ? (names[lane] as string) : "");
  const given = new Set(format?.lanes.map((lane) => lane.id));
  const order = Array.isArray(model.laneOrder)
    ? model.laneOrder.filter((lane): lane is string => typeof lane === "string")
    : undefined;
  // The board's own lanes first, under their ids; the workshop's it dropped go; then each takes its place.
  if (order && format?.ownLanes) {
    for (const lane of order)
      if (!given.has(lane)) commands.push({ kind: "add-lane", board, lane, label: said(lane) });
    for (const lane of given) if (!order.includes(lane)) commands.push({ kind: "remove-lane", board, lane });
    for (const lane of order) commands.push({ kind: "move-lane", board, lane });
  }
  for (const lane of Object.keys(names)) {
    if (said(lane) && given.has(lane) && (!order || order.includes(lane)))
      commands.push({ kind: "name-lane", board, lane, label: said(lane) });
  }

  const elements = Array.isArray(model.elements) ? model.elements.map(readElement) : [];
  const idFor = idGiver(format, elements);
  for (const e of elements) {
    const id = e.id ?? idFor(e.type);
    commands.push({
      kind: "add",
      board,
      type: e.type,
      label: e.label,
      id,
      col: layout === "timeline" && e.col !== undefined ? e.col + 1 : undefined,
      lane: layout === "columns" ? e.lane : undefined,
      detail: e.detail,
    });
    // On a kanban, done is the lane the card is in: a mark would move it.
    if (e.done && id && !format?.ownLanes) commands.push({ kind: "mark", board, id, done: true });
  }
  for (const edge of Array.isArray(model.edges) ? model.edges : []) {
    const [src, dst, label] = readEdge(edge);
    commands.push({ kind: "link", board, src, dst, label });
  }
  return commands;
}

/**
 * Ids for the elements that came without one, chosen above every id the file
 * names so that the two never collide whatever their order.
 */
function idGiver(
  format: Format | undefined,
  elements: readonly ModelElement[],
): (type: string) => string | undefined {
  const highest = new Map<string, number>();
  for (const e of elements) {
    if (e.id) highest.set(e.id.charAt(0), Math.max(highest.get(e.id.charAt(0)) ?? 0, idNumber(e.id)));
  }
  return (typeId) => {
    const prefix = format ? findType(format, typeId)?.prefix : undefined;
    if (!prefix) return undefined;
    const n = (highest.get(prefix) ?? 0) + 1;
    highest.set(prefix, n);
    return `${prefix}${n}`;
  };
}

function readElement(input: unknown, index: number): ModelElement {
  const e = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (typeof e.type !== "string" || typeof e.label !== "string") {
    throw new CommandError(`elements[${index}] needs a \`type\` and a \`label\``);
  }
  return {
    id: typeof e.id === "string" && isElementId(e.id) ? e.id : undefined,
    type: TYPE_ALIASES[e.type] ?? e.type,
    label: e.label,
    col: typeof e.col === "number" && Number.isInteger(e.col) && e.col >= 0 ? e.col : undefined,
    lane: typeof e.lane === "string" ? e.lane : undefined,
    detail: typeof e.detail === "string" && e.detail ? e.detail : undefined,
    done: e.done === true ? true : undefined,
  };
}

function readEdge(input: unknown): [string, string, string | undefined] {
  if (Array.isArray(input) && typeof input[0] === "string" && typeof input[1] === "string") {
    return [input[0], input[1], undefined];
  }
  const edge = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (typeof edge.src !== "string" || typeof edge.dst !== "string") {
    throw new CommandError("an edge is [src, dst] or {src, dst, label}");
  }
  return [edge.src, edge.dst, typeof edge.label === "string" && edge.label ? edge.label : undefined];
}
