/**
 * `sideco status`: where the workspace, the companion and the page stand, read
 * from the journal and the running server.
 */
import { sharedIdsLine } from "../domain/minting.ts";
import { latestSession, sessionLabel } from "../domain/workspace.ts";
import type { JournalRead } from "../server/start.ts";
import { Blocked, findServer, get, type Server } from "./client.ts";

export /** How many pages follow this companion right now. */
async function watchers(server: Server): Promise<number> {
  return (await get<{ watching?: number }>(server, "/health", 1000)).watching ?? 0;
}

export async function statusText(root: string, journal: JournalRead): Promise<string> {
  const ws = journal.workspace;
  const server = await findServer(root).catch((error: unknown) => {
    if (error instanceof Blocked) return "out of reach from this shell (a sandbox blocks local connections)";
    throw error;
  });
  const session = latestSession(ws);
  const watching = server && typeof server !== "string" ? await watchers(server).catch(() => 0) : 0;
  const page =
    watching > 0
      ? `open in ${watching} window${watching === 1 ? "" : "s"}`
      : "not open (open it with `sideco open`)";
  return [
    `workspace  ${root}`,
    `server     ${typeof server === "string" ? server : server ? server.url : "not running (start it with `sideco open`)"}`,
    `page       ${page}`,
    `journal    seq ${ws.seq}, ${journal.events} events, ${Math.round(journal.bytes / 1024)} kB, read in ${Math.round(journal.ms)} ms, ${ws.boards.length} board${ws.boards.length === 1 ? "" : "s"}, ${ws.sessions.length} session${ws.sessions.length === 1 ? "" : "s"}`,
    ...(session
      ? [`session    ${sessionLabel(session)} is ${session.status} (all: \`sideco sessions\`)`]
      : []),
    ...ws.boards.map((b) => `board      ${b.id}  ${b.format}  ${b.elements.length} elements`),
    ...sharedIdsLine(ws),
  ].join("\n");
}
