/**
 * The journal on disk: one JSON object per line, appended and never rewritten.
 * It is the only durable state; everything else is rebuilt from it at start-up.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isBoardEvent, isKnownEvent, type Recorded } from "../domain/events.ts";
import type { Journal } from "./hub.ts";

/**
 * Two files, one order. Board events go to `boards.jsonl`, which is meant to be
 * committed: it is the design history. Session events (prompts, commands run) go
 * to `sessions.jsonl`, which stays on this machine. `seq` orders them together.
 */
export function openJournal(dir: string): Journal {
  const boards = join(dir, "boards.jsonl");
  const sessions = join(dir, "sessions.jsonl");
  return {
    load() {
      return [...read(boards), ...read(sessions)].sort((a, b) => a.seq - b.seq);
    },
    append(events) {
      if (events.length === 0) return;
      mkdirSync(dir, { recursive: true });
      write(boards, events.filter(isBoardEvent));
      write(
        sessions,
        events.filter((e) => !isBoardEvent(e)),
      );
    },
  };
}

/** What the journal of `dir` weighs on disk, in bytes: the more it weighs, the longer a start takes. */
export function journalBytes(dir: string): number {
  return [join(dir, "boards.jsonl"), join(dir, "sessions.jsonl")]
    .filter((path) => existsSync(path))
    .reduce((sum, path) => sum + statSync(path).size, 0);
}

function read(path: string): Recorded[] {
  if (!existsSync(path)) return [];
  const events: Recorded[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (line.trim() === "") return;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        throw new Error(`${path}:${index + 1} is not valid JSON; the journal is damaged at that line`);
      }
      const event = upcast(raw);
      if (event) events.push(event);
    });
  return events;
}

function write(path: string, events: readonly Recorded[]): void {
  if (events.length > 0) appendFileSync(path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
}

/** A journal kept in memory, for tests and previews. */
export function memoryJournal(initial: readonly Recorded[] = []): Journal {
  const lines = [...initial];
  return {
    load: () => [...lines],
    append: (events) => {
      lines.push(...events);
    },
  };
}

/**
 * The single place where an old line becomes a current event. An event written
 * by a newer build under a name this one does not know is left out of the
 * projection, and stays in the file.
 */
function upcast(raw: unknown): Recorded | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const line = raw as Record<string, unknown>;
  if (!isKnownEvent(line.event) || typeof line.seq !== "number") return undefined;
  return line as unknown as Recorded;
}
