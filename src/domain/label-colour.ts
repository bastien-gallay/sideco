/**
 * The colour of a label's key, chosen (S328): every label of one key (`type:`,
 * `epic:`, `@`) wears one of the eight colours, in every board of the project.
 * It is a fact of the project, not of a board: its event names no board, and
 * is kept with the boards' history. Without a choice the key keeps the colour
 * chance gave it.
 */
import type { Command } from "./commands.ts";
import type { ProjectEvent, Recorded } from "./events.ts";
import { normalLabel } from "./labels.ts";
import { labelKey } from "./render/labels.ts";
import type { Workspace } from "./workspace.ts";

export type ProjectCommand = Extract<Command, { kind: "colour-label" }>;

/**
 * The key as it is kept: the one a label is looked up by. `type:` and `type:bug`
 * both say `type`; a label that begins with its colon is its own key, colon and all.
 */
export function colouredKey(said: string): string {
  const key = normalLabel(said);
  return labelKey(key.endsWith(":") && !key.startsWith(":") ? key.slice(0, -1) : key);
}

/** Asked for the colour the key has, nothing is recorded. */
export function colourLabel(ws: Workspace, cmd: ProjectCommand): ProjectEvent[] {
  const key = colouredKey(cmd.key);
  const has = ws.colours && Object.hasOwn(ws.colours, key) ? ws.colours[key] : undefined;
  if (has === cmd.colour) return [];
  return [{ event: "LabelColoured", key, ...(cmd.colour ? { colour: cmd.colour } : {}) }];
}

export function applyToProject(ws: Workspace, e: Extract<Recorded, ProjectEvent>): void {
  const { [e.key]: _was, ...others } = ws.colours ?? {};
  ws.colours = e.colour ? { ...others, [e.key]: e.colour } : others;
}
