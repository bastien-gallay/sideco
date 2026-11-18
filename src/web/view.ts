/**
 * What the page says, as pure functions of the journal: the agent's status, when
 * it will read the human's changes, and one line per event for the history.
 * No DOM here, so the wording is tested like any other rule.
 */
import { describeChanges } from "../domain/digest.ts";
import type { Recorded } from "../domain/events.ts";
import { DEFAULT_LOCALE, type Locale } from "../domain/i18n.ts";
import type { AgentStatus, Session, SessionTurn } from "../domain/workspace.ts";
import { MESSAGES } from "./messages.ts";

export type Tone = "off" | "idle" | "busy" | "waiting" | "listening";

export function agentStatus(
  session: Session | undefined,
  listening: number,
  locale: Locale = DEFAULT_LOCALE,
): { tone: Tone; text: string } {
  const m = MESSAGES[locale];
  if (listening > 0) return { tone: "listening", text: m.listening };
  if (!session) return { tone: "off", text: m.noSession };
  switch (session.status) {
    case "idle":
      return { tone: "idle", text: m.idle };
    case "thinking":
      return { tone: "busy", text: m.thinking };
    case "running":
      return { tone: "busy", text: m.running(session.statusDetail) };
    case "waiting":
      return { tone: "waiting", text: m.waitingInTerminal(session.statusDetail ?? "") };
  }
}

/** The honest answer to "when will Claude see what I just did?". */
export function handOverHint(
  status: AgentStatus | undefined,
  listening: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const m = MESSAGES[locale];
  if (listening > 0) return m.hintListening;
  if (status === undefined) return m.hintNoSession;
  if (status === "running" || status === "thinking") return m.hintWorking;
  return m.hintIdle;
}

/** The number of lines the agent would be told now: the same digest it will read. */
export function pendingCount(events: readonly Recorded[], session: Session | undefined): number {
  return describeChanges(events, session?.deliveredUpTo ?? 0).count;
}

export function recentTurns(session: Session | undefined, max: number): SessionTurn[] {
  return session ? session.turns.slice(-max) : [];
}

const MAX_LINE = 90;

/** One line of history, in the reader's language. */
export function describeEvent(e: Recorded, locale: Locale = DEFAULT_LOCALE): string {
  return clip(WORDING[locale](e));
}

const WORDING: Record<Locale, (e: Recorded) => string> = { en: english, fr: french };

function english(e: Recorded): string {
  const you = e.actor === "human";
  const who = { human: "You", agent: "Claude", system: "Vico" }[e.actor];
  /** `You add`, `Claude adds`. */
  const does = (verb: string, third = `${verb}s`): string => `${who} ${you ? verb : third}`;
  switch (e.event) {
    case "BoardCreated":
      return `${does("create")} the board “${e.title}”`;
    case "BoardRetitled":
      return `${does("rename")} the board to “${e.title}”`;
    case "BoardRemoved":
      return `${does("remove")} the board “${e.title}”`;
    case "ElementAdded":
      return `${does("add")} ${e.id} “${e.label}”`;
    case "ElementRenamed":
      return `${does("rename")} ${e.id} to “${e.label}”`;
    case "ElementAnnotated":
      return `${does("detail")} ${e.id}`;
    case "ElementMoved":
      return `${does("move")} ${e.id}`;
    case "ElementRemoved":
      return `${does("remove")} ${e.id}`;
    case "ColumnInserted":
      return `${does("insert")} a column at ${e.at}`;
    case "EdgeAdded":
      return `${does("link")} ${e.src} → ${e.dst}`;
    case "EdgeRemoved":
      return `${does("remove")} the link ${e.src} → ${e.dst}`;
    case "FocusSet":
      return `${does("put")} the focus on ${e.ids.join(", ")}${e.reason ? `: ${e.reason}` : ""}`;
    case "FocusCleared":
      return `${does("clear")} the focus`;
    case "NoteAdded":
      return `${does("note")}${e.target ? ` on ${e.target}` : ""}: ${e.text}`;
    case "NoteResolved":
      return `${does("resolve")} the note ${e.id}`;
    case "TurnPassed": {
      const message = e.message ? `: ${e.message}` : "";
      if (e.to === "agent") return `${does("hand")} over to Claude${message}`;
      return you ? `You keep the turn${message}` : `Claude hands over to you${message}`;
    }
    case "SessionStarted":
      return "Session started";
    case "PromptSubmitted":
      return `Prompt: ${e.text}`;
    case "ToolStarted":
      return `Claude runs ${e.tool} ${e.summary}`.trim();
    case "ToolFinished":
      return e.ok ? "Tool finished" : "Tool failed";
    case "TodosUpdated":
      return "Claude updates its tasks";
    case "AgentNotified":
      return `Claude is waiting for you: ${e.message}`;
    case "TurnEnded":
      return "Claude ended its turn";
    case "ChangesDelivered":
      return "Claude read your changes";
  }
}

function french(e: Recorded): string {
  const you = e.actor === "human";
  const who = { human: "Tu", agent: "Claude", system: "Vico" }[e.actor];
  /** `Tu ajoutes`, `Claude ajoute`. */
  const verb = (second: string, third: string): string => `${who} ${you ? second : third}`;
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
