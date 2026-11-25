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

/**
 * Gives `root` its id, once: the same project keeps it, two projects never
 * share one. A project that keeps its boards in its own `.sideco/` has one
 * too, so the companion can name its address.
 */
export function idOf(root: string, home = homeDir()): string {
  const known = workspaces(home);
  const id = known[root];
  if (id !== undefined) return id;
  const taken = new Set(Object.values(known));
  let minted = mint(root);
  while (taken.has(minted)) minted = mint(root);
  mkdirSync(home, { recursive: true });
  writeFileSync(registry(home), `${JSON.stringify({ ...known, [root]: minted }, null, 2)}\n`);
  return minted;
}

/** The project an id was given to. */
export function rootOf(id: string, home = homeDir()): string | undefined {
  return Object.entries(workspaces(home)).find(([, known]) => known === id)?.[0];
}

/** Gives `root` its id and makes its folder at home, where its boards will be. */
export function register(root: string, home = homeDir()): string {
  const dir = join(home, idOf(root, home));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The name of the project and six hex digits: readable in the home folder, unique in practice. */
function mint(root: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `${basename(root) || "root"}-${Buffer.from(bytes).toString("hex")}`;
}
