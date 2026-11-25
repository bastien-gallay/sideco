/**
 * The closed set of things a human, an agent or a hook may ask for.
 *
 * Reading the journal is tolerant; accepting a command is not. `parseCommand` is
 * the boundary: whatever crosses it is fully typed, and an unknown `kind` or a
 * malformed field is refused with a message that says which one.
 *
 * Where a command takes the id of an element or of a note, it may carry `@name`
 * instead: what an earlier command of the same batch named with `alias`. The
 * hub puts the id back (see `aliases.ts`) before anything is decided.
 */
import {
  alias,
  boardId,
  CommandError,
  column,
  elementId,
  type Fields,
  flag,
  idOrName,
  LIMITS,
  laneId,
  list,
  oneOf,
  optional,
  referredName,
  scene,
  spot,
  text,
  todo,
  whole,
} from "./command-fields.ts";
import type { Todo } from "./events.ts";
import { type BoardId, isBoardId } from "./ids.ts";

import { LABEL_COLOUR_NAMES, type LabelColourName } from "./render/labels.ts";

export { CommandError, LIMITS, referredName };

export type Command =
  | { kind: "create-board"; board: string; title: string; format: string }
  | { kind: "retitle"; board: string; title: string }
  /** An empty purpose gives the workshop's question back. */
  | { kind: "purpose"; board: string; purpose: string }
  | { kind: "name-lane"; board: string; lane: string; label: string }
  /** An empty hint gives the workshop's back. */
  | { kind: "hint-lane"; board: string; lane: string; hint: string }
  /** An end left out stays as it is; an empty label gives the workshop's axis back. */
  | { kind: "name-axis"; board: string; axis: string; label: string; low?: string; high?: string }
  /** A lane of the board's own; `lane` keeps an id given before, when a model is read back. */
  | { kind: "add-lane"; board: string; label: string; before?: string; lane?: string }
  | { kind: "add-slice"; board: string; label: string; before?: string; slice?: string }
  | { kind: "remove-slice"; board: string; slice: string }
  | { kind: "remove-lane"; board: string; lane: string }
  /** Before `before`, else last. */
  | { kind: "move-lane"; board: string; lane: string; before?: string }
  | { kind: "remove-board"; board: string }
  | {
      kind: "add";
      board: string;
      type: string;
      label: string;
      id?: string;
      col?: number;
      lane?: string;
      detail?: string;
      /** Place the new element just before this one of its cell or lane. */
      before?: string;
      /** Also link from this element to the new one. */
      from?: string;
      edgeLabel?: string;
      /** A name for the new element, for the commands after this one in the batch. */
      alias?: string;
    }
  | { kind: "rename"; board: string; id: string; label: string }
  | { kind: "annotate"; board: string; id: string; detail: string }
  | { kind: "label"; board: string; id: string; labels: string[] }
  | { kind: "unlabel"; board: string; id: string; labels: string[] }
  /** Says that what the card stands for is done, or no longer is. */
  | { kind: "mark"; board: string; id: string; done: boolean }
  | { kind: "move"; board: string; id: string; col?: number; lane?: string; before?: string }
  | { kind: "remove"; board: string; id: string }
  /**
   * Puts cards of a diagram where they are said to go, and the whole diagram by hand (S344).
   * `span`: the width the board has on the page, so that the other cards keep the places it shows.
   */
  | { kind: "place"; board: string; cards: Spot[]; span?: number }
  /** A diagram placed by hand (Snap), or by its links again; `span` as for `place`. */
  | { kind: "placing"; board: string; byHand: boolean; span?: number }
  /** The element takes the id `to`, else the next of its letter in the project. */
  /** With `type`, the card takes that kind too, and the letter that goes with it. */
  | { kind: "renumber"; board: string; id: string; to?: string; type?: string }
  | { kind: "insert-column"; board: string; at: number }
  /** Removes an empty column of a timeline; refused while it holds cards. */
  | { kind: "remove-column"; board: string; at: number }
  /** Moves a whole column of a timeline: it takes the number `to`. */
  | { kind: "move-column"; board: string; from: number; to: number }
  | { kind: "link"; board: string; src: string; dst: string; label?: string }
  | { kind: "unlink"; board: string; src: string; dst: string }
  /** Turns the link round: its source becomes its target, its name kept (S349). */
  | { kind: "reverse"; board: string; src: string; dst: string }
  /** One end of the link src → dst goes to another card: its start (`end: "src"`) or its arrow. */
  | { kind: "relink"; board: string; src: string; dst: string; end: "src" | "dst"; to: string }
  | { kind: "focus"; board: string; ids: string[]; reason?: string }
  | { kind: "note"; board: string; text: string; target?: string; alias?: string }
  /** Answers a note, in its thread. */
  | { kind: "reply"; board: string; to: string; text: string }
  /** Closes the thread the note belongs to. */
  | { kind: "resolve"; board: string; id: string }
  | { kind: "pass"; board: string; to: "agent" | "human"; message?: string; target?: string }
  /** Takes back the caller's last gesture on the board; the board may be one they just removed. */
  /** `ifChanged`: what the human chose, asked about a gesture Claude changed since (B8). */
  | { kind: "undo"; board: string; ifChanged?: "overwrite" | "keep" }
  /** Puts back what the caller's last undo took. */
  | { kind: "redo"; board: string }
  /** Every label of this key wears this colour, on every board; without one, the colour chance gave it. */
  | { kind: "colour-label"; key: string; colour?: LabelColourName }
  | { kind: "session-start"; cwd?: string }
  | { kind: "name-session"; name: string }
  /** The session takes these boards, or lets go of them: it is told what the human changes on the boards it follows. */
  | { kind: "follow"; boards: string[] }
  | { kind: "unfollow"; boards: string[] }
  | { kind: "prompt"; text: string }
  | { kind: "tool-start"; call: string; tool: string; summary: string }
  | { kind: "tool-finish"; call: string; ok: boolean }
  | { kind: "todos"; todos: Todo[] }
  | { kind: "task-created"; id: string; text: string }
  | { kind: "task-completed"; id: string }
  | { kind: "notify"; message: string }
  | { kind: "turn-end" }
  | { kind: "session-end" }
  | { kind: "delivered"; upTo: number };

/** A card and the point of the scene it goes to. */
export interface Spot {
  id: string;
  x: number;
  y: number;
}

export type CommandKind = Command["kind"];

/** A board id from a title: lowercase ASCII words joined by dashes. */
export function slugify(title: string): BoardId {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const id = slug || "board";
  if (!isBoardId(id)) throw new Error(`slugify made ${id}, not a board id`);
  return id;
}

export function parseCommand(input: unknown): Command {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CommandError("a command is a JSON object with a `kind`");
  }
  const f = input as Fields;
  const kind = f.kind;
  switch (kind) {
    case "create-board":
      return {
        kind,
        board: boardId(f),
        title: text(f, "title", LIMITS.title),
        format: text(f, "format", 40),
      };
    case "purpose":
      return { kind, board: boardId(f), purpose: text(f, "purpose", LIMITS.title, true) };
    case "retitle":
      return { kind, board: boardId(f), title: text(f, "title", LIMITS.title) };
    case "name-lane":
      return { kind, board: boardId(f), lane: text(f, "lane", 40), label: text(f, "label", LIMITS.title) };
    case "hint-lane":
      return {
        kind,
        board: boardId(f),
        lane: text(f, "lane", 40),
        hint: text(f, "hint", LIMITS.title, true),
      };
    case "name-axis":
      return {
        kind,
        board: boardId(f),
        axis: text(f, "axis", 1),
        label: text(f, "label", LIMITS.title, true),
        // Empty, an end gives back the workshop's word for it.
        low: optional(f, "low", (x, k) => text(x, k, LIMITS.title, true)),
        high: optional(f, "high", (x, k) => text(x, k, LIMITS.title, true)),
      };
    case "add-lane":
      return {
        kind,
        board: boardId(f),
        label: text(f, "label", LIMITS.title),
        before: optional(f, "before", (x, k) => text(x, k, 40)),
        lane: optional(f, "lane", laneId),
      };
    case "remove-lane":
      return { kind, board: boardId(f), lane: text(f, "lane", 40) };
    case "add-slice":
      return {
        kind,
        board: boardId(f),
        label: text(f, "label", LIMITS.title),
        before: optional(f, "before", (x, k) => text(x, k, 40)),
        slice: optional(f, "slice", (x, k) => text(x, k, 40)),
      };
    case "remove-slice":
      return { kind, board: boardId(f), slice: text(f, "slice", 40) };
    case "move-lane":
      return {
        kind,
        board: boardId(f),
        lane: text(f, "lane", 40),
        before: optional(f, "before", (x, k) => text(x, k, 40)),
      };
    case "remove-board":
      return { kind, board: boardId(f) };
    case "add":
      return {
        kind,
        board: boardId(f),
        type: text(f, "type", 40),
        label: text(f, "label", LIMITS.label),
        id: optional(f, "id", elementId),
        col: optional(f, "col", column),
        lane: optional(f, "lane", (x, k) => text(x, k, 40)),
        detail: optional(f, "detail", (x, k) => text(x, k, LIMITS.detail)),
        before: optional(f, "before", idOrName),
        from: optional(f, "from", idOrName),
        edgeLabel: optional(f, "edgeLabel", (x, k) => text(x, k, LIMITS.label)),
        alias: optional(f, "alias", alias),
      };
    case "rename":
      return { kind, board: boardId(f), id: idOrName(f, "id"), label: text(f, "label", LIMITS.label) };
    case "label":
    case "unlabel": {
      const labels = list(f, "labels").map((label) => text({ label }, "label", 60));
      if (labels.length === 0) throw new CommandError("`labels` must name at least one label");
      return { kind, board: boardId(f), id: idOrName(f, "id"), labels };
    }
    case "annotate":
      return {
        kind,
        board: boardId(f),
        id: idOrName(f, "id"),
        detail: text(f, "detail", LIMITS.detail, true),
      };
    case "mark":
      return { kind, board: boardId(f), id: idOrName(f, "id"), done: f.done === true };
    case "place":
      return { kind, board: boardId(f), cards: list(f, "cards").map(spot), span: optional(f, "span", scene) };
    case "placing":
      return { kind, board: boardId(f), byHand: flag(f, "byHand"), span: optional(f, "span", scene) };
    case "move":
      return {
        kind,
        board: boardId(f),
        id: idOrName(f, "id"),
        col: optional(f, "col", column),
        lane: optional(f, "lane", (x, k) => text(x, k, 40)),
        before: optional(f, "before", idOrName),
      };
    case "remove":
      return { kind, board: boardId(f), id: idOrName(f, "id") };
    case "renumber":
      return {
        kind,
        board: boardId(f),
        id: idOrName(f, "id"),
        to: optional(f, "to", elementId),
        type: optional(f, "type", (x, k) => text(x, k, 40)),
      };
    case "insert-column":
    case "remove-column":
      return { kind, board: boardId(f), at: column(f, "at") };
    case "move-column":
      return { kind, board: boardId(f), from: column(f, "from"), to: column(f, "to") };
    case "link":
      return {
        kind,
        board: boardId(f),
        src: idOrName(f, "src"),
        dst: idOrName(f, "dst"),
        label: optional(f, "label", (x, k) => text(x, k, LIMITS.label)),
      };
    case "unlink":
    case "reverse":
      return { kind, board: boardId(f), src: idOrName(f, "src"), dst: idOrName(f, "dst") };
    case "relink":
      return {
        kind,
        board: boardId(f),
        src: idOrName(f, "src"),
        dst: idOrName(f, "dst"),
        end: oneOf(f, "end", ["src", "dst"] as const),
        to: idOrName(f, "to"),
      };
    case "focus":
      return {
        kind,
        board: boardId(f),
        ids: list(f, "ids").map((id, i) => idOrName({ id }, "id", `ids[${i}]`)),
        reason: optional(f, "reason", (x, k) => text(x, k, LIMITS.label)),
      };
    case "note":
      return {
        kind,
        board: boardId(f),
        text: text(f, "text", LIMITS.note),
        target: optional(f, "target", idOrName),
        alias: optional(f, "alias", alias),
      };
    case "reply":
      return { kind, board: boardId(f), to: idOrName(f, "to"), text: text(f, "text", LIMITS.note) };
    case "resolve":
      return { kind, board: boardId(f), id: idOrName(f, "id") };
    case "pass":
      return {
        kind,
        board: boardId(f),
        to: oneOf(f, "to", ["agent", "human"] as const),
        message: optional(f, "message", (x, k) => text(x, k, LIMITS.note)),
        target: optional(f, "target", (x, k) => text(x, k, 200)),
      };
    case "undo":
      return {
        kind,
        board: boardId(f),
        ifChanged: optional(f, "ifChanged", (x, k) => oneOf(x, k, ["overwrite", "keep"] as const)),
      };
    case "redo":
      return { kind, board: boardId(f) };
    case "colour-label":
      return {
        kind,
        key: text(f, "key", LIMITS.label),
        colour: optional(f, "colour", (x, k) => oneOf(x, k, LABEL_COLOUR_NAMES)),
      };
    case "name-session":
      return { kind, name: text(f, "name", LIMITS.sessionName) };
    case "session-start":
      return { kind, cwd: optional(f, "cwd", (x, k) => text(x, k, 1000)) };
    case "follow":
    case "unfollow":
      return { kind, boards: list(f, "boards").map((board) => boardId({ board })) };
    case "prompt":
      return { kind, text: text(f, "text", LIMITS.prompt, true) };
    case "tool-start":
      return {
        kind,
        call: text(f, "call", 200),
        tool: text(f, "tool", 100),
        summary: text(f, "summary", LIMITS.summary, true),
      };
    case "tool-finish":
      return { kind, call: text(f, "call", 200), ok: flag(f, "ok") };
    case "todos":
      return { kind, todos: list(f, "todos").map(todo) };
    case "task-created":
      return { kind, id: text(f, "id", 200), text: text(f, "text", LIMITS.label) };
    case "task-completed":
      return { kind, id: text(f, "id", 200) };
    case "notify":
      return { kind, message: text(f, "message", LIMITS.note) };
    case "turn-end":
    case "session-end":
      return { kind };
    case "delivered":
      return { kind, upTo: whole(f, "upTo", 0, Number.MAX_SAFE_INTEGER) };
    default:
      throw new CommandError(`unknown command kind: ${JSON.stringify(kind)}`);
  }
}
