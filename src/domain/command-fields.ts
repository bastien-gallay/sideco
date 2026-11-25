/**
 * How `parseCommand` reads each field of a command off the wire: a string, an
 * id, a lane, a column, a point of the scene. Every reader refuses a malformed
 * field with a message that says which one. Out of commands.ts, which keeps
 * the set of commands and what each one carries.
 */
import type { Spot } from "./commands.ts";
import type { Todo } from "./events.ts";
import { type BoardId, type ElementId, isBoardId, isElementId } from "./ids.ts";

export const LIMITS = {
  title: 120,
  label: 200,
  detail: 2000,
  note: 1000,
  prompt: 2000,
  summary: 200,
  sessionName: 60,
} as const;

export class CommandError extends Error {
  override name = "CommandError";
}

const ALIAS = /^[a-z][a-z0-9-]{0,39}$/;

export type Fields = Record<string, unknown>;

/** The name `@name` refers to; undefined for anything else, an id included. */
export function referredName(value: string): string | undefined {
  return value.startsWith("@") && ALIAS.test(value.slice(1)) ? value.slice(1) : undefined;
}

export function text(f: Fields, key: string, max: number, allowEmpty = false): string {
  const value = f[key];
  if (typeof value !== "string") throw new CommandError(`\`${key}\` must be a string`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed === "") throw new CommandError(`\`${key}\` must not be empty`);
  if (trimmed.length > max) throw new CommandError(`\`${key}\` is longer than ${max} characters`);
  return trimmed;
}

export function boardId(f: Fields): BoardId {
  const value = f.board;
  if (typeof value !== "string" || !isBoardId(value)) {
    throw new CommandError("`board` must be a board id: lowercase letters, digits and dashes");
  }
  return value;
}

export function elementId(f: Fields, key: string): ElementId {
  const value = f[key];
  if (typeof value !== "string" || !isElementId(value)) {
    throw new CommandError(`\`${key}\` must be an id like E1 or C12`);
  }
  return value;
}

/** The id of something that exists, or `@name` for what an earlier command of the batch named. */
export function idOrName(f: Fields, key: string, shown = key): string {
  const value = f[key];
  if (typeof value !== "string" || !(isElementId(value) || referredName(value) !== undefined)) {
    throw new CommandError(
      `\`${shown}\` must be an id like E1 or C12, or the @name an earlier command of the batch gave`,
    );
  }
  return value;
}

/** A lane's id, like todo or lane-3: lowercase letters, digits and dashes, a letter first. */
export function laneId(f: Fields, key: string): string {
  const value = f[key];
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(value)) {
    throw new CommandError(`\`${key}\` must be a column id like todo or lane-3`);
  }
  return value;
}

export function alias(f: Fields, key: string): string {
  const value = f[key];
  if (typeof value !== "string" || !ALIAS.test(value)) {
    throw new CommandError(
      `\`${key}\` must be a name like placed or step-2: lowercase letters, digits and dashes, a letter first`,
    );
  }
  return value;
}

/** Columns are numbered from 1, on the page and on the wire alike. */
export function column(f: Fields, key: string): number {
  return whole(f, key, 1, 10_000);
}

export function whole(f: Fields, key: string, min: number, max: number): number {
  const value = f[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new CommandError(`\`${key}\` must be a whole number from ${min} to ${max}`);
  }
  return value;
}

export function flag(f: Fields, key: string): boolean {
  const value = f[key];
  if (typeof value !== "boolean") throw new CommandError(`\`${key}\` must be true or false`);
  return value;
}

export function list(f: Fields, key: string): unknown[] {
  const value = f[key];
  if (!Array.isArray(value)) throw new CommandError(`\`${key}\` must be a list`);
  if (value.length > 500) throw new CommandError(`\`${key}\` has more than 500 entries`);
  return value;
}

export function oneOf<T extends string>(f: Fields, key: string, allowed: readonly T[]): T {
  const value = f[key];
  const found = allowed.find((a) => a === value);
  if (found === undefined) throw new CommandError(`\`${key}\` must be one of: ${allowed.join(", ")}`);
  return found;
}

export function optional<T>(f: Fields, key: string, read: (f: Fields, key: string) => T): T | undefined {
  return f[key] === undefined || f[key] === null ? undefined : read(f, key);
}

/** Where on the scene a card goes: whole units, from the top left corner. */
export function spot(input: unknown, index: number): Spot {
  if (typeof input !== "object" || input === null)
    throw new CommandError(`\`cards[${index}]\` must be an object`);
  const f = input as Fields;
  return { id: idOrName(f, "id", `cards[${index}].id`), x: scene(f, "x"), y: scene(f, "y") };
}

/** A length on the scene, in whole units. */
export const scene = (f: Fields, key: string): number => whole(f, key, 0, 100_000);

export function todo(input: unknown, index: number): Todo {
  if (typeof input !== "object" || input === null)
    throw new CommandError(`\`todos[${index}]\` must be an object`);
  const f = input as Fields;
  return {
    text: text(f, "text", LIMITS.label),
    status: oneOf(f, "status", ["pending", "in_progress", "completed"] as const),
  };
}
