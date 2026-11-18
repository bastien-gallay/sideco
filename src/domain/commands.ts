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
import type { Todo } from "./events.ts";

export type Command =
  | { kind: "create-board"; board: string; title: string; format: string }
  | { kind: "retitle"; board: string; title: string }
  | { kind: "name-lane"; board: string; lane: string; label: string }
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
      /** Also link from this element to the new one. */
      from?: string;
      edgeLabel?: string;
      /** A name for the new element, for the commands after this one in the batch. */
      alias?: string;
    }
  | { kind: "rename"; board: string; id: string; label: string }
  | { kind: "annotate"; board: string; id: string; detail: string }
  /** Says that what the card stands for is done, or no longer is. */
  | { kind: "mark"; board: string; id: string; done: boolean }
  | { kind: "move"; board: string; id: string; col?: number; lane?: string; before?: string }
  | { kind: "remove"; board: string; id: string }
  | { kind: "insert-column"; board: string; at: number }
  /** Moves a whole column of a timeline: it takes the number `to`. */
  | { kind: "move-column"; board: string; from: number; to: number }
  | { kind: "link"; board: string; src: string; dst: string; label?: string }
  | { kind: "unlink"; board: string; src: string; dst: string }
  | { kind: "focus"; board: string; ids: string[]; reason?: string }
  | { kind: "note"; board: string; text: string; target?: string; alias?: string }
  /** Answers a note, in its thread. */
  | { kind: "reply"; board: string; to: string; text: string }
  /** Closes the thread the note belongs to. */
  | { kind: "resolve"; board: string; id: string }
  | { kind: "pass"; board: string; to: "agent" | "human"; message?: string }
  /** Takes back the caller's last gesture on the board; the board may be one they just removed. */
  | { kind: "undo"; board: string }
  /** Puts back what the caller's last undo took. */
  | { kind: "redo"; board: string }
  | { kind: "session-start"; cwd?: string }
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

export type CommandKind = Command["kind"];

export const LIMITS = {
  title: 120,
  label: 200,
  detail: 2000,
  note: 1000,
  prompt: 2000,
  summary: 200,
} as const;

export class CommandError extends Error {
  override name = "CommandError";
}

const BOARD_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const ELEMENT_ID = /^[A-Z][1-9][0-9]{0,5}$/;
const ALIAS = /^[a-z][a-z0-9-]{0,39}$/;

/** A board id from a title: lowercase ASCII words joined by dashes. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "board";
}

export function isElementId(value: string): boolean {
  return ELEMENT_ID.test(value);
}

/** The name `@name` refers to; undefined for anything else, an id included. */
export function referredName(value: string): string | undefined {
  return value.startsWith("@") && ALIAS.test(value.slice(1)) ? value.slice(1) : undefined;
}

type Fields = Record<string, unknown>;

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
    case "retitle":
      return { kind, board: boardId(f), title: text(f, "title", LIMITS.title) };
    case "name-lane":
      return { kind, board: boardId(f), lane: text(f, "lane", 40), label: text(f, "label", LIMITS.title) };
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
        from: optional(f, "from", idOrName),
        edgeLabel: optional(f, "edgeLabel", (x, k) => text(x, k, LIMITS.label)),
        alias: optional(f, "alias", alias),
      };
    case "rename":
      return { kind, board: boardId(f), id: idOrName(f, "id"), label: text(f, "label", LIMITS.label) };
    case "annotate":
      return {
        kind,
        board: boardId(f),
        id: idOrName(f, "id"),
        detail: text(f, "detail", LIMITS.detail, true),
      };
    case "mark":
      return { kind, board: boardId(f), id: idOrName(f, "id"), done: f.done === true };
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
    case "insert-column":
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
      return { kind, board: boardId(f), src: idOrName(f, "src"), dst: idOrName(f, "dst") };
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
      };
    case "undo":
    case "redo":
      return { kind, board: boardId(f) };
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

function text(f: Fields, key: string, max: number, allowEmpty = false): string {
  const value = f[key];
  if (typeof value !== "string") throw new CommandError(`\`${key}\` must be a string`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed === "") throw new CommandError(`\`${key}\` must not be empty`);
  if (trimmed.length > max) throw new CommandError(`\`${key}\` is longer than ${max} characters`);
  return trimmed;
}

function boardId(f: Fields): string {
  const value = f.board;
  if (typeof value !== "string" || !BOARD_ID.test(value)) {
    throw new CommandError("`board` must be a board id: lowercase letters, digits and dashes");
  }
  return value;
}

function elementId(f: Fields, key: string): string {
  const value = f[key];
  if (typeof value !== "string" || !ELEMENT_ID.test(value)) {
    throw new CommandError(`\`${key}\` must be an id like E1 or C12`);
  }
  return value;
}

/** The id of something that exists, or `@name` for what an earlier command of the batch named. */
function idOrName(f: Fields, key: string, shown = key): string {
  const value = f[key];
  if (typeof value !== "string" || !(ELEMENT_ID.test(value) || referredName(value) !== undefined)) {
    throw new CommandError(
      `\`${shown}\` must be an id like E1 or C12, or the @name an earlier command of the batch gave`,
    );
  }
  return value;
}

function alias(f: Fields, key: string): string {
  const value = f[key];
  if (typeof value !== "string" || !ALIAS.test(value)) {
    throw new CommandError(
      `\`${key}\` must be a name like placed or step-2: lowercase letters, digits and dashes, a letter first`,
    );
  }
  return value;
}

/** Columns are numbered from 1, on the page and on the wire alike. */
function column(f: Fields, key: string): number {
  return whole(f, key, 1, 10_000);
}

function whole(f: Fields, key: string, min: number, max: number): number {
  const value = f[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new CommandError(`\`${key}\` must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function flag(f: Fields, key: string): boolean {
  const value = f[key];
  if (typeof value !== "boolean") throw new CommandError(`\`${key}\` must be true or false`);
  return value;
}

function list(f: Fields, key: string): unknown[] {
  const value = f[key];
  if (!Array.isArray(value)) throw new CommandError(`\`${key}\` must be a list`);
  if (value.length > 500) throw new CommandError(`\`${key}\` has more than 500 entries`);
  return value;
}

function oneOf<T extends string>(f: Fields, key: string, allowed: readonly T[]): T {
  const value = f[key];
  const found = allowed.find((a) => a === value);
  if (found === undefined) throw new CommandError(`\`${key}\` must be one of: ${allowed.join(", ")}`);
  return found;
}

function optional<T>(f: Fields, key: string, read: (f: Fields, key: string) => T): T | undefined {
  return f[key] === undefined || f[key] === null ? undefined : read(f, key);
}

function todo(input: unknown, index: number): Todo {
  if (typeof input !== "object" || input === null)
    throw new CommandError(`\`todos[${index}]\` must be an object`);
  const f = input as Fields;
  return {
    text: text(f, "text", LIMITS.label),
    status: oneOf(f, "status", ["pending", "in_progress", "completed"] as const),
  };
}
