/**
 * A workspace under test: commands go through the real `parseCommand` and
 * `decide`, events through the real `apply`. No server, no clock.
 */
import { parseBatch } from "../src/cli/argv.ts";
import { type Aliases, bindAlias, resolveAliases } from "../src/domain/aliases.ts";
import { CommandError, parseCommand } from "../src/domain/commands.ts";
import { decide } from "../src/domain/decide.ts";
import type { Actor, Recorded } from "../src/domain/events.ts";
import { apply, type Board, emptyWorkspace, findBoard, type Workspace } from "../src/domain/workspace.ts";

export const T0 = "2026-11-17T10:00:00.000Z";

export class Table {
  readonly ws: Workspace = emptyWorkspace();
  readonly events: Recorded[] = [];

  /** The `@names` given so far: one script is one batch, and so are the commands done since the last. */
  private aliases: Aliases = new Map();

  /** Runs one command; returns the id it minted, if any. */
  do(command: Record<string, unknown>, actor: Actor = "agent", session?: string): string | undefined {
    const parsed = resolveAliases(parseCommand(command), this.aliases);
    const decision = decide(this.ws, parsed, { actor, session });
    for (const event of decision.events) {
      const recorded = {
        seq: this.ws.seq + 1,
        ts: T0,
        actor,
        ...(session ? { session } : {}),
        ...event,
      } as Recorded;
      this.events.push(recorded);
      apply(this.ws, recorded);
    }
    if (decision.refused) throw new CommandError(decision.refused);
    this.aliases = bindAlias(this.aliases, parsed, decision.minted);
    return decision.minted;
  }

  /** Runs a batch written in the CLI grammar, one command per line. */
  script(text: string, actor: Actor = "agent", board?: string): this {
    this.aliases = new Map();
    for (const command of parseBatch(text, board ?? this.ws.boards.at(-1)?.id)) this.do(command, actor);
    return this;
  }

  board(id?: string): Board {
    const board = id ? findBoard(this.ws, id) : this.ws.boards.at(-1);
    if (!board) throw new Error(`no board ${id ?? "(any)"} on the table`);
    return board;
  }

  get seq(): number {
    return this.ws.seq;
  }
}

export function table(script = "", actor: Actor = "agent"): Table {
  return new Table().script(script, actor);
}

/** A small order-to-payment event storming, written by the agent. */
export const ORDERING = `
board new "Passage de commande" --id commande
add actor "Client" --col 1
add command "Passer commande" --col 1
add event "Commande passée" --col 1
add policy "Quand commande passée, réserver le stock" --col 2
add command "Réserver le stock" --col 2
add event "Stock réservé" --col 2
add hotspot "Et si le stock manque ?" --col 2
link C1 E1
link E1 R1
`;

export const KANBAN = `
board new "Sprint 12" --format kanban --id sprint
add task "Écrire le PRD" --lane done
add task "Brancher les hooks" --lane doing
add task "Tester de bout en bout"
add task "Publier"
add blocker "Port bloqué en bac à sable" --lane doing
`;

export const IMPACT_EFFORT = `
board new "Priorités" --format impact-effort --id priorites
add item "Insérer une colonne" --lane quick
add item "Canevas libre" --lane bet
add item "Icône du type" --lane fill
`;

export const FLOW = `
board new "Livraison" --format flow --id livraison
add step "Recevoir la commande"
add decision "En stock ?" --from F1
add step "Expédier" --from D1 --edge oui
add step "Commander au fournisseur" --from D1 --edge non
add outcome "Livrée" --from F2
link F3 D1 "à réception"
`;
