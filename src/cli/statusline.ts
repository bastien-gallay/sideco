/**
 * `sideco statusline`: the companion's address in Claude Code's status line.
 *
 * Claude Code runs the command on each update with the session as JSON on stdin
 * and shows what it prints. The line names this project's companion, written out
 * and clickable (an OSC 8 link, where the terminal supports one); it never starts
 * the companion and never fails: outside a workspace, or on input it cannot read,
 * it prints nothing.
 */
import { findRoot, findServer } from "./client.ts";

/** The address of the companion of a workspace; undefined when none answers. */
export type Locate = (root: string) => Promise<string | undefined>;

/** Quick, for a line drawn on every update. */
const LOCATE_MS = 150;

const locateCompanion: Locate = async (root) => (await findServer(root, LOCATE_MS))?.url;

/** The line for a companion at `url`, or for a workspace whose companion is not running. */
export function statusLine(url: string | undefined): string {
  if (url === undefined) return "sideco · not running";
  const shown = url.replace(/^https?:\/\//, "");
  return `\x1b]8;;${url}\x07sideco · ${shown}\x1b]8;;\x07`;
}

/** The line for the session Claude Code describes in `input`. */
export async function statusLineFor(input: string, locate: Locate = locateCompanion): Promise<string> {
  const dir = directoryOf(input);
  const root = dir === undefined ? undefined : findRoot(dir);
  if (!root) return "";
  try {
    return statusLine(await locate(root));
  } catch {
    return statusLine(undefined);
  }
}

function directoryOf(input: string): string | undefined {
  let session: unknown;
  try {
    session = JSON.parse(input);
  } catch {
    return undefined;
  }
  if (typeof session !== "object" || session === null) return undefined;
  const { workspace, cwd } = session as { workspace?: { current_dir?: unknown }; cwd?: unknown };
  const dir = workspace?.current_dir ?? cwd;
  return typeof dir === "string" && dir !== "" ? dir : undefined;
}

export async function statusline(): Promise<number> {
  const line = await statusLineFor(await Bun.stdin.text());
  if (line !== "") console.log(line);
  return 0;
}
