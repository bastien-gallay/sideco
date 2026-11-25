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

/** The key as it is kept: that of a label, `type:` and `type:bug` both `type`, `@` the assignee. */
export function colouredKey(said: string): string {
  const key = said.trim() === "@" ? "assignee" : normalLabel(said);
  return labelKey(key.endsWith(":") ? key.slice(0, -1) : key);
}

/** Asked for the colour the key has, nothing is recorded. */
export function colourLabel(ws: Workspace, cmd: ProjectCommand): ProjectEvent[] {
  const key = colouredKey(cmd.key);
  if (ws.colours?.[key] === cmd.colour) return [];
  return [{ event: "LabelColoured", key, ...(cmd.colour ? { colour: cmd.colour } : {}) }];
}

export function applyToProject(ws: Workspace, e: Extract<Recorded, ProjectEvent>): void {
  const { [e.key]: _was, ...others } = ws.colours ?? {};
  ws.colours = e.colour ? { ...others, [e.key]: e.colour } : others;
}
