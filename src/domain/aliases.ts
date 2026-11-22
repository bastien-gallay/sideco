/**
 * Names for what a batch creates. Ids are given as a batch is applied, so a
 * batch that adds a card cannot know its id when it goes on to link it: it
 * names the card (`alias`) and writes `@name` in the commands after it.
 *
 * A name lives for one batch. `resolveAliases` puts the id back before a
 * command is decided, so events carry ids and the journal never sees a name.
 */
import { type Command, CommandError, referredName } from "./commands.ts";

/** The names given so far in a batch, each with what it stands for: an id, on the board that gave it. */
export type Aliases = ReadonlyMap<string, { board: string; id: string }>;

/**
 * The command as it is decided: every `@name` replaced by its id. Refuses a
 * name that no earlier command gave, and a new name that is already taken.
 */
export function resolveAliases(command: Command, aliases: Aliases): Command {
  const giving = nameGiven(command);
  const taken = giving === undefined ? undefined : aliases.get(giving);
  if (taken !== undefined) {
    throw new CommandError(`@${giving} already names ${taken.id} in this batch; choose another name`);
  }
  const board = "board" in command ? command.board : undefined;
  const id = (given: string): string => {
    const name = referredName(given);
    if (name === undefined) return given;
    const found = aliases.get(name);
    if (found === undefined) {
      const known = [...aliases.keys()].join(", ") || "none";
      throw new CommandError(`nothing is named @${name} earlier in this batch (names so far: ${known})`);
    }
    // Ids repeat from board to board: the same E1 elsewhere is another card.
    if (found.board !== board) {
      throw new CommandError(`@${name} names ${found.id} on "${found.board}", not a card of "${board}"`);
    }
    return found.id;
  };
  const optional = (given: string | undefined): string | undefined =>
    given === undefined ? undefined : id(given);

  switch (command.kind) {
    case "add":
      return { ...command, from: optional(command.from), before: optional(command.before) };
    case "rename":
    case "annotate":
    case "mark":
    case "remove":
    case "renumber":
    case "resolve":
      return { ...command, id: id(command.id) };
    case "move":
      return { ...command, id: id(command.id), before: optional(command.before) };
    case "link":
    case "unlink":
      return { ...command, src: id(command.src), dst: id(command.dst) };
    case "focus":
      return { ...command, ids: command.ids.map(id) };
    case "note":
      return { ...command, target: optional(command.target) };
    case "reply":
      return { ...command, to: id(command.to) };
    default:
      return command;
  }
}

/** The names once `command` has created `minted`: one more if the command named it. */
export function bindAlias(aliases: Aliases, command: Command, minted: string | undefined): Aliases {
  const name = nameGiven(command);
  if (name === undefined || minted === undefined || !("board" in command)) return aliases;
  return new Map(aliases).set(name, { board: command.board, id: minted });
}

function nameGiven(command: Command): string | undefined {
  return "alias" in command ? command.alias : undefined;
}
