/**
 * Where the boards of a project live when the project holds no `.sideco/`:
 * under the home of Sideco (`$SIDECO_HOME`, else `~/.sideco`), in a folder
 * named by an id that a registry gives each project once.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export function homeDir(env: Record<string, string | undefined> = process.env): string {
  return env.SIDECO_HOME || join(homedir(), ".sideco");
}

const registry = (home: string): string => join(home, "workspaces.json");

/** Each project kept at home, by its real path, with its id. */
export function workspaces(home = homeDir()): Record<string, string> {
  const file = registry(home);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** The folder of a project kept at home, or undefined when it is not. */
export function homeData(root: string, home = homeDir()): string | undefined {
  const id = workspaces(home)[root];
  return id === undefined ? undefined : join(home, id);
}

/** Gives `root` its id, once, and returns its folder: the same project keeps its id, two projects never share one. */
export function register(root: string, home = homeDir()): string {
  const known = workspaces(home);
  let id = known[root];
  if (id === undefined) {
    const taken = new Set(Object.values(known));
    do id = mint(root);
    while (taken.has(id));
    mkdirSync(home, { recursive: true });
    writeFileSync(registry(home), `${JSON.stringify({ ...known, [root]: id }, null, 2)}\n`);
  }
  const dir = join(home, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The name of the project and six hex digits: readable in the home folder, unique in practice. */
function mint(root: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `${basename(root) || "root"}-${Buffer.from(bytes).toString("hex")}`;
}
