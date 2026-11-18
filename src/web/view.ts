/**
 * What the page says, as pure functions of the journal: the agent's status, when
 * it will read the human's changes, and one line per event for the history.
 * No DOM here, so the wording is tested like any other rule.
 */
import { describeChanges } from "../domain/digest.ts";
import type { Actor, Recorded } from "../domain/events.ts";
import type { AgentStatus, Session, SessionTurn } from "../domain/workspace.ts";

export type Tone = "off" | "idle" | "busy" | "waiting" | "listening";

export function agentStatus(session: Session | undefined, listening: number): { tone: Tone; text: string } {
  if (listening > 0) return { tone: "listening", text: "Claude attend que tu lui passes la main" };
  if (!session) return { tone: "off", text: "Aucune session Claude Code reliée" };
  switch (session.status) {
    case "idle":
      return { tone: "idle", text: "Claude est au repos" };
    case "thinking":
      return { tone: "busy", text: "Claude réfléchit" };
    case "running":
      return { tone: "busy", text: `Claude exécute ${session.statusDetail ?? "un outil"}` };
    case "waiting":
      return {
        tone: "waiting",
        text: `Claude t'attend dans le terminal : ${session.statusDetail ?? ""}`.trim(),
      };
  }
}

/** The honest answer to "when will Claude see what I just did?". */
export function handOverHint(status: AgentStatus | undefined, listening: number): string {
  if (listening > 0) return "Claude reprend dès que tu lui passes la main.";
  if (status === undefined)
    return "Aucune session reliée : Claude lira tes changements quand une session démarrera ici.";
  if (status === "running" || status === "thinking")
    return "Claude travaille : il lira tes changements après son action en cours.";
  return "Claude est au repos : il lira tes changements à ton prochain message dans le terminal.";
}

/** The number of lines the agent would be told now: the same digest it will read. */
export function pendingCount(events: readonly Recorded[], session: Session | undefined): number {
  return describeChanges(events, session?.deliveredUpTo ?? 0).count;
}

export function recentTurns(session: Session | undefined, max: number): SessionTurn[] {
  return session ? session.turns.slice(-max) : [];
}

const MAX_LINE = 90;

export function describeEvent(e: Recorded): string {
  const who = WHO[e.actor];
  const you = e.actor === "human";
  const verb = (second: string, third: string): string => `${who} ${you ? second : third}`;
  return clip(wording(e, verb, you));
}

const WHO: Record<Actor, string> = { human: "Tu", agent: "Claude", system: "Vico" };

function wording(e: Recorded, verb: (second: string, third: string) => string, you: boolean): string {
  switch (e.event) {
    case "BoardCreated":
      return `${verb("crées", "crée")} le tableau « ${e.title} »`;
    case "BoardRetitled":
      return `${verb("renommes", "renomme")} le tableau en « ${e.title} »`;
    case "BoardRemoved":
      return `${verb("supprimes", "supprime")} le tableau « ${e.title} »`;
    case "ElementAdded":
      return `${verb("ajoutes", "ajoute")} ${e.id} « ${e.label} »`;
    case "ElementRenamed":
      return `${verb("renommes", "renomme")} ${e.id} en « ${e.label} »`;
    case "ElementAnnotated":
      return `${verb("détailles", "détaille")} ${e.id}`;
    case "ElementMoved":
      return `${verb("déplaces", "déplace")} ${e.id}`;
    case "ElementRemoved":
      return `${verb("supprimes", "supprime")} ${e.id}`;
    case "ColumnInserted":
      return `${verb("insères", "insère")} une colonne en ${e.at}`;
    case "EdgeAdded":
      return `${verb("relies", "relie")} ${e.src} → ${e.dst}`;
    case "EdgeRemoved":
      return `${verb("retires", "retire")} le lien ${e.src} → ${e.dst}`;
    case "FocusSet":
      return `${verb("mets", "met")} le focus sur ${e.ids.join(", ")}${e.reason ? ` : ${e.reason}` : ""}`;
    case "FocusCleared":
      return `${verb("retires", "retire")} le focus`;
    case "NoteAdded":
      return `${verb("notes", "note")}${e.target ? ` sur ${e.target}` : ""} : ${e.text}`;
    case "NoteResolved":
      return `${verb("résous", "résout")} la note ${e.id}`;
    case "TurnPassed": {
      const message = e.message ? ` : ${e.message}` : "";
      if (e.to === "agent") return `${verb("passes", "passe")} la main à Claude${message}`;
      return you ? `Tu gardes la main${message}` : `Claude te passe la main${message}`;
    }
    case "SessionStarted":
      return "Session démarrée";
    case "PromptSubmitted":
      return `Prompt : ${e.text}`;
    case "ToolStarted":
      return `Claude lance ${e.tool} ${e.summary}`.trim();
    case "ToolFinished":
      return e.ok ? "Outil terminé" : "Outil en échec";
    case "TodosUpdated":
      return "Claude met à jour ses tâches";
    case "AgentNotified":
      return `Claude t'attend : ${e.message}`;
    case "TurnEnded":
      return "Claude a fini son tour";
    case "ChangesDelivered":
      return "Claude a lu tes changements";
  }
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;
}
