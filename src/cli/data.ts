/** `sideco data`: the projects whose boards live under the home of Sideco, so none is lost there. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homeDir, journalBytes, workspaces } from "../server/start.ts";

export function dataText(home = homeDir()): string {
  const rows = Object.entries(workspaces(home)).map(([root, id]) => {
    const kb = Math.ceil(journalBytes(join(home, id)) / 1024);
    return `  ${id.padEnd(24)} ${`${kb} KB`.padStart(8)}  ${root}${existsSync(root) ? "" : "  (folder gone)"}`;
  });
  return rows.length === 0 ? `no project keeps its boards in ${home}` : `${home}\n${rows.join("\n")}`;
}
