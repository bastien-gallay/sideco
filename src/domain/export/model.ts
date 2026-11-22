/**
 * The interchange file: one JSON object per board, which `sideco import` turns
 * back into a board. It says its `version`. Version 2, written here, counts `col`
 * from 1 as the board does, and edges are `{src, dst, label}`. A file with no
 * version is version 1 and still loads: `col` from 0, edges also as `[src, dst]`
 * pairs, and `external` read as `system`. Unknown fields are ignored on the way in.
 */
import { type Command, CommandError } from "../commands.ts";
import { type Format, findFormat, findType, wearsDone } from "../formats.ts";
import { isElementId } from "../ids.ts";
import { type Board, idNumber } from "../workspace.ts";

export interface ModelElement {
  id?: string;
  type: string;
  label: string;
  col?: number;
  lane?: string;
  detail?: string;
  labels?: string[];
  done?: boolean;
}

/** The version of the file `toModel` writes. */
export const MODEL_VERSION = 2;

export interface Model {
  version: number;
  title: string;
  format: string;
  /** The lanes the board calls its own way, by lane id. */
  lanes?: Record<string, string>;
  /** The board's lanes in order, when it added, moved or removed some of its workshop's. */
  laneOrder?: string[];
  /** The question the board asks, where it asks its own. */
  purpose?: string;
  /** What the board says its lanes stand for, by lane id, where it says it its own way. */
  hints?: Record<string, string>;
  /** The axes of a plan the board names its own way. */
  axes?: Partial<Record<"x" | "y", { label: string; low?: string; high?: string }>>;
  /** A story map's slices, top to bottom. */
  slices?: { id: string; label: string }[];
  elements: ModelElement[];
  edges: { src: string; dst: string; label?: string }[];
}

/** Version 1 files may say `external` for `system`. */
const V1_TYPE_ALIASES: Record<string, string> = { external: "system" };

export function toModel(board: Board): Model {
  const layout = findFormat(board.format)?.layout;
  return {
    version: MODEL_VERSION,
    title: board.title,
    format: board.format,
    ...(Object.keys(board.lanes).length > 0 ? { lanes: { ...board.lanes } } : {}),
    ...(board.laneOrder ? { laneOrder: [...board.laneOrder] } : {}),
    ...(board.purpose ? { purpose: board.purpose } : {}),
    ...(board.hints && Object.keys(board.hints).length > 0 ? { hints: { ...board.hints } } : {}),
    ...(board.axes && Object.keys(board.axes).length > 0 ? { axes: structuredClone(board.axes) } : {}),
    ...(board.slices?.length ? { slices: board.slices.map((s) => ({ id: s.id, label: s.label })) } : {}),
    elements: board.elements.map((e) => ({
      id: e.id,
      type: e.type,
      label: e.label,
      ...(layout === "timeline" ? { col: e.col } : {}),
      ...(layout === "columns" ? { lane: e.lane } : {}),
      ...(e.detail ? { detail: e.detail } : {}),
      ...(wearsDone(board, e) ? { done: true } : {}),
      ...(e.labels?.length ? { labels: [...e.labels] } : {}),
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
  const v1 = readVersion(model.version) === 1;
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
  if (typeof model.purpose === "string" && model.purpose)
    commands.push({ kind: "purpose", board, purpose: model.purpose });
  const lanes = order ?? [...given];
  const hints = (typeof model.hints === "object" && model.hints !== null ? model.hints : {}) as Record<
    string,
    unknown
  >;
  for (const [lane, hint] of Object.entries(hints))
    if (typeof hint === "string" && hint && lanes.includes(lane))
      commands.push({ kind: "hint-lane", board, lane, hint });
  const axes = (typeof model.axes === "object" && model.axes !== null ? model.axes : {}) as Record<
    string,
    unknown
  >;
  if (format?.grid)
    for (const axis of ["x", "y"]) {
      const said = (typeof axes[axis] === "object" && axes[axis] !== null ? axes[axis] : {}) as Record<
        string,
        unknown
      >;
      const word = (key: string) =>
        typeof said[key] === "string" && said[key] ? { [key]: said[key] as string } : {};
      if (typeof said.label === "string" && said.label)
        commands.push({ kind: "name-axis", board, axis, label: said.label, ...word("low"), ...word("high") });
    }

  if (format?.sliced && Array.isArray(model.slices))
    for (const raw of model.slices) {
      const slice = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      if (typeof slice.label !== "string") continue;
      commands.push({
        kind: "add-slice",
        board,
        label: slice.label,
        ...(typeof slice.id === "string" ? { slice: slice.id } : {}),
      });
    }

  const elements = Array.isArray(model.elements) ? model.elements.map((e, i) => readElement(e, i, v1)) : [];
  const idFor = idGiver(format, elements);
  for (const e of elements) {
    const id = e.id ?? idFor(e.type);
    commands.push({
      kind: "add",
      board,
      type: e.type,
      label: e.label,
      id,
      col: layout === "timeline" && e.col !== undefined ? e.col + (v1 ? 1 : 0) : undefined,
      lane: layout === "columns" ? e.lane : undefined,
      detail: e.detail,
    });
    // On a kanban, done is the lane the card is in: a mark would move it.
    if (e.done && id && !format?.doneLast) commands.push({ kind: "mark", board, id, done: true });
    if (e.labels?.length && id) commands.push({ kind: "label", board, id, labels: e.labels });
  }
  for (const edge of Array.isArray(model.edges) ? model.edges : []) {
    const [src, dst, label] = readEdge(edge, v1);
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

/** A file with no version is version 1, from before files said theirs. */
function readVersion(input: unknown): number {
  if (input === undefined) return 1;
  if (typeof input !== "number" || !Number.isInteger(input))
    throw new CommandError("`version` is a whole number");
  if (input < 1 || input > MODEL_VERSION) {
    throw new CommandError(
      `this model file is version ${input}; this Sideco reads versions 1 and ${MODEL_VERSION}`,
    );
  }
  return input;
}

function readElement(input: unknown, index: number, v1: boolean): ModelElement {
  const e = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (typeof e.type !== "string" || typeof e.label !== "string") {
    throw new CommandError(`elements[${index}] needs a \`type\` and a \`label\``);
  }
  return {
    id: typeof e.id === "string" && isElementId(e.id) ? e.id : undefined,
    type: (v1 ? V1_TYPE_ALIASES[e.type] : undefined) ?? e.type,
    label: e.label,
    col: readCol(e.col, v1),
    lane: typeof e.lane === "string" ? e.lane : undefined,
    detail: typeof e.detail === "string" && e.detail ? e.detail : undefined,
    done: e.done === true ? true : undefined,
    labels: Array.isArray(e.labels)
      ? e.labels.filter((label): label is string => typeof label === "string" && label.trim() !== "")
      : undefined,
  };
}

/** A step: from 0 in a version 1 file, from 1 since. */
function readCol(input: unknown, v1: boolean): number | undefined {
  return typeof input === "number" && Number.isInteger(input) && input >= (v1 ? 0 : 1) ? input : undefined;
}

function readEdge(input: unknown, v1: boolean): [string, string, string | undefined] {
  if (v1 && Array.isArray(input) && typeof input[0] === "string" && typeof input[1] === "string") {
    return [input[0], input[1], undefined];
  }
  const edge = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (typeof edge.src !== "string" || typeof edge.dst !== "string") {
    throw new CommandError(
      v1 ? "an edge is [src, dst] or {src, dst, label}" : "an edge is {src, dst, label}",
    );
  }
  return [edge.src, edge.dst, typeof edge.label === "string" && edge.label ? edge.label : undefined];
}
