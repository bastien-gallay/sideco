/**
 * The name the human gave a Claude Code session (`/rename`, or the terminal
 * that launched it), read from its transcript, so the page can tell sessions
 * apart without the agent naming its own (T195).
 *
 * Not a documented format: in Claude Code 2.1.330 the transcript is JSON lines,
 * and `{"type":"custom-title","customTitle":"…"}` is written again every few
 * turns. A transcript runs to tens of megabytes: only its end is read.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Enough for several turns between two title lines; a title further back is missed until written again. */
export const TAIL_BYTES = 512 * 1024;

/** The last title in `text`, a run of JSON lines; a broken line, cut by the read or the writer, is skipped. */
export function lastTitle(text: string): string | undefined {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (!line.includes('"custom-title"')) continue;
    try {
      const entry = JSON.parse(line) as { type?: unknown; customTitle?: unknown };
      if (entry.type === "custom-title" && typeof entry.customTitle === "string" && entry.customTitle.trim())
        return entry.customTitle.trim();
    } catch {}
  }
  return undefined;
}

/** The session's title from the end of the transcript at `path`; none when there is no such file. */
export function sessionTitle(path: string | undefined): string | undefined {
  if (!path) return undefined;
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined;
  }
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return lastTitle(buffer.toString("utf8"));
  } finally {
    closeSync(fd);
  }
}
