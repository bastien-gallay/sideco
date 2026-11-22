/**
 * One line of history per event, in the reader's language: who did what, on
 * which lane, to which session a turn went. Pure, so the wording is tested like
 * any other rule.
 */
import type { Recorded } from "../domain/events.ts";
import { findFormat, laneName } from "../domain/formats.ts";
import { DEFAULT_LOCALE, type Locale } from "../domain/i18n.ts";
import { findSession, type Session, type Workspace } from "../domain/workspace.ts";

const MAX_LINE = 90;

/**
 * One line of history, in the reader's language. With the workspace, a
 * hand-over says the session it went to.
 */
export function describeEvent(e: Recorded, locale: Locale = DEFAULT_LOCALE, ws?: Workspace): string {
  const session = e.event === "TurnPassed" && e.target && ws ? findSession(ws, e.target) : undefined;
  return clip(
    WORDING[locale](e, session ? ` (${sessionName(session)})` : "", laneCalled(e, locale, ws)) +
      answered(e, locale),
  );
}

/**
 * How a line names a lane: by the name the reader sees, quoted, when the board
 * is at hand, else by its id. `workshop` asks for the name its workshop gives,
 * the one a renaming starts from.
 */
type LaneCalled = (lane: string, workshop?: boolean) => string;

function laneCalled(e: Recorded, locale: Locale, ws?: Workspace): LaneCalled {
  const board = ws && "board" in e ? ws.boards.find((b) => b.id === e.board) : undefined;
  if (!board) return (lane) => lane;
  const format = findFormat(board.format);
  const [open, close] = locale === "fr" ? ["« ", " »"] : ["“", "”"];
  return (lane, workshop = false) => {
    const name = laneName(format, workshop ? { lanes: {} } : board, lane, locale);
    return name === lane ? lane : `${open}${name}${close}`;
  };
}

/** A session as the page names it: its name once given, else its folder and the start of its id. */
export function sessionName(session: Session): string {
  if (session.name) return session.name;
  const id = session.id.slice(0, 6);
  const folder = session.cwd?.split("/").filter(Boolean).at(-1);
  return folder ? `${folder} · ${id}` : id;
}

/** `to` is said after Claude in a hand-over: the session it went to, or nothing. */
const WORDING: Record<Locale, (e: Recorded, to: string, lane: LaneCalled) => string> = {
  en: english,
  fr: french,
};

const ANSWERS: Record<Locale, { undo: string; redo: string }> = {
  en: { undo: " (undo)", redo: " (redo)" },
  fr: { undo: " (annulation)", redo: " (rétablissement)" },
};

/** Says that the line takes an earlier gesture back, or puts it back. */
function answered(e: Recorded, locale: Locale): string {
  if (!("board" in e)) return "";
  if (e.undoes !== undefined) return ANSWERS[locale].undo;
  return e.redoes !== undefined ? ANSWERS[locale].redo : "";
}

function english(e: Recorded, to: string, lane: LaneCalled): string {
  const you = e.actor === "human";
  const who = { human: "You", agent: "Claude", system: "Sideco" }[e.actor];
  /** `You add`, `Claude adds`. */
  const does = (verb: string, third = `${verb}s`): string => `${who} ${you ? verb : third}`;
  switch (e.event) {
    case "BoardCreated":
      return `${does("create")} the board “${e.title}”`;
    case "BoardRetitled":
      return `${does("rename")} the board to “${e.title}”`;
    case "BoardPurposed":
      return e.purpose
        ? `${does("ask")} the board “${e.purpose}”`
        : `${does("give")} the board its workshop's question back`;
    case "LaneNamed":
      return e.label
        ? `${does("name")} the lane ${lane(e.lane, true)} “${e.label}”`
        : `${does("give")} the lane ${lane(e.lane)} its workshop's name back`;
    case "LaneHinted":
      return e.hint
        ? `${does("say")} what the lane ${lane(e.lane)} stands for: “${e.hint}”`
        : `${does("give")} the lane ${lane(e.lane)} its workshop's hint back`;
    case "AxisNamed":
      return e.label
        ? `${does("name")} the axis ${e.axis} “${e.label}”${e.low || e.high ? `, from “${e.low ?? "…"}” to “${e.high ?? "…"}”` : ""}`
        : `${does("give")} the axis ${e.axis} its workshop's name back`;
    case "LaneAdded":
      return e.label
        ? `${does("add")} the lane “${e.label}”`
        : `${does("put")} the lane ${lane(e.lane)} back`;
    case "LaneRemoved":
      return `${does("remove")} the lane ${lane(e.lane)}`;
    case "LaneMoved":
      return `${does("move")} the lane ${lane(e.lane)}`;
    case "SliceAdded":
      return `${does("add")} the slice “${e.label}”`;
    case "SliceRemoved":
      return `${does("remove")} the slice ${e.slice}`;
    case "BoardRemoved":
      return `${does("remove")} the board “${e.title}”`;
    case "BoardRestored":
      return `${does("restore")} the board “${e.title}”`;
    case "ElementAdded":
      return `${does("add")} ${e.id} “${e.label}”`;
    case "ElementRenamed":
      return `${does("rename")} ${e.id} to “${e.label}”`;
    case "ElementAnnotated":
      return `${does("detail")} ${e.id}`;
    case "ElementMarked":
      return `${does("mark")} ${e.id} ${e.done ? "done" : "not done"}`;
    case "ElementLabeled":
      return `${does("label")} ${e.id} “${e.label}”`;
    case "ElementUnlabeled":
      return `${does("take")} the label “${e.label}” off ${e.id}`;
    case "ElementMoved":
      return `${does("move")} ${e.id}`;
    case "ElementRemoved":
      return `${does("remove")} ${e.id}`;
    case "ElementRestored":
      return `${does("restore")} ${e.id} “${e.label}”`;
    case "ColumnInserted":
      return `${does("insert")} a column at ${e.at}`;
    case "ColumnRemoved":
      return `${does("remove")} column ${e.at}`;
    case "ColumnMoved":
      return `${does("move")} column ${e.from} to ${e.to}`;
    case "EdgeAdded":
      return `${does("link")} ${e.src} → ${e.dst}${e.label ? ` “${e.label}”` : ""}`;
    case "EdgeRemoved":
      return `${does("remove")} the link ${e.src} → ${e.dst}`;
    case "FocusSet":
      return `${does("put")} the focus on ${e.ids.join(", ")}${e.reason ? `: ${e.reason}` : ""}`;
    case "FocusCleared":
      return `${does("clear")} the focus`;
    case "NoteAdded": {
      const on = e.target ? ` on ${e.target}` : "";
      if (e.thread) return `${does("reply", "replies")} to ${e.thread}${on}: ${e.text}`;
      return `${does("note")}${on}: ${e.text}`;
    }
    case "NoteResolved":
      return `${does("resolve")} the note ${e.id}`;
    case "TurnPassed": {
      const message = e.message ? `: ${e.message}` : "";
      if (e.to === "agent") return `${does("send")} to Claude${to}${message}`;
      return you ? `You keep the turn${message}` : `Claude passes you the turn${message}`;
    }
    case "UndoRefused": {
      const by = { human: "you", agent: "Claude", system: "Sideco" }[e.by];
      return `${you ? "Your" : "Claude's"} ${e.way} is refused: changed since by ${by}`;
    }
    case "SessionStarted":
      return "Session started";
    case "SessionNamed":
      return `Claude names its session “${e.name}”`;
    case "BoardsFollowed":
      return `Claude follows ${e.boards.join(", ")}`;
    case "BoardsLeft":
      return `Claude no longer follows ${e.boards.join(", ")}`;
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
    case "SessionEnded":
      return "Session ended";
    case "ChangesDelivered":
      return "Claude read your changes";
  }
}

function french(e: Recorded, to: string, lane: LaneCalled): string {
  const you = e.actor === "human";
  const who = { human: "Tu", agent: "Claude", system: "Sideco" }[e.actor];
  /** `Tu ajoutes`, `Claude ajoute`. */
  const verb = (second: string, third: string): string => `${who} ${you ? second : third}`;
  switch (e.event) {
    case "BoardCreated":
      return `${verb("crées", "crée")} le tableau « ${e.title} »`;
    case "BoardRetitled":
      return `${verb("renommes", "renomme")} le tableau en « ${e.title} »`;
    case "BoardPurposed":
      return e.purpose
        ? `${verb("poses", "pose")} au tableau la question « ${e.purpose} »`
        : `${verb("rends", "rend")} au tableau la question de son atelier`;
    case "LaneNamed":
      return e.label
        ? `${verb("nommes", "nomme")} la colonne ${lane(e.lane, true)} « ${e.label} »`
        : `${verb("rends", "rend")} à la colonne ${lane(e.lane)} le nom de son atelier`;
    case "LaneHinted":
      return e.hint
        ? `${verb("dis", "dit")} ce que la colonne ${lane(e.lane)} représente : « ${e.hint} »`
        : `${verb("rends", "rend")} à la colonne ${lane(e.lane)} le sous-titre de son atelier`;
    case "AxisNamed":
      return e.label
        ? `${verb("nommes", "nomme")} l'axe ${e.axis} « ${e.label} »${e.low || e.high ? `, de « ${e.low ?? "…"} » à « ${e.high ?? "…"} »` : ""}`
        : `${verb("rends", "rend")} à l'axe ${e.axis} le nom de son atelier`;
    case "LaneAdded":
      return e.label
        ? `${verb("ajoutes", "ajoute")} la colonne « ${e.label} »`
        : `${verb("remets", "remet")} la colonne ${lane(e.lane)}`;
    case "LaneRemoved":
      return `${verb("supprimes", "supprime")} la colonne ${lane(e.lane)}`;
    case "LaneMoved":
      return `${verb("déplaces", "déplace")} la colonne ${lane(e.lane)}`;
    case "SliceAdded":
      return `${verb("ajoutes", "ajoute")} la tranche « ${e.label} »`;
    case "SliceRemoved":
      return `${verb("supprimes", "supprime")} la tranche ${e.slice}`;
    case "BoardRemoved":
      return `${verb("supprimes", "supprime")} le tableau « ${e.title} »`;
    case "BoardRestored":
      return `${verb("restaures", "restaure")} le tableau « ${e.title} »`;
    case "ElementAdded":
      return `${verb("ajoutes", "ajoute")} ${e.id} « ${e.label} »`;
    case "ElementRenamed":
      return `${verb("renommes", "renomme")} ${e.id} en « ${e.label} »`;
    case "ElementAnnotated":
      return `${verb("détailles", "détaille")} ${e.id}`;
    case "ElementMarked":
      return `${verb("marques", "marque")} ${e.id} comme ${e.done ? "fait" : "non fait"}`;
    case "ElementLabeled":
      return `${verb("étiquettes", "étiquette")} ${e.id} « ${e.label} »`;
    case "ElementUnlabeled":
      return `${verb("retires", "retire")} à ${e.id} le label « ${e.label} »`;
    case "ElementMoved":
      return `${verb("déplaces", "déplace")} ${e.id}`;
    case "ElementRemoved":
      return `${verb("supprimes", "supprime")} ${e.id}`;
    case "ElementRestored":
      return `${verb("restaures", "restaure")} ${e.id} « ${e.label} »`;
    case "ColumnInserted":
      return `${verb("insères", "insère")} une colonne en ${e.at}`;
    case "ColumnRemoved":
      return `${verb("supprimes", "supprime")} la colonne ${e.at}`;
    case "ColumnMoved":
      return `${verb("déplaces", "déplace")} la colonne ${e.from} en ${e.to}`;
    case "EdgeAdded":
      return `${verb("relies", "relie")} ${e.src} → ${e.dst}${e.label ? ` « ${e.label} »` : ""}`;
    case "EdgeRemoved":
      return `${verb("retires", "retire")} le lien ${e.src} → ${e.dst}`;
    case "FocusSet":
      return `${verb("mets", "met")} le focus sur ${e.ids.join(", ")}${e.reason ? ` : ${e.reason}` : ""}`;
    case "FocusCleared":
      return `${verb("retires", "retire")} le focus`;
    case "NoteAdded": {
      const on = e.target ? ` sur ${e.target}` : "";
      if (e.thread) return `${verb("réponds", "répond")} à ${e.thread}${on} : ${e.text}`;
      return `${verb("notes", "note")}${on} : ${e.text}`;
    }
    case "NoteResolved":
      return `${verb("résous", "résout")} la note ${e.id}`;
    case "TurnPassed": {
      const message = e.message ? ` : ${e.message}` : "";
      if (e.to === "agent") return `${verb("envoies", "envoie")} à Claude${to}${message}`;
      return you ? `Tu gardes la main${message}` : `Claude te rend la main${message}`;
    }
    case "UndoRefused": {
      const by = { human: "toi", agent: "Claude", system: "Sideco" }[e.by];
      const what =
        e.way === "undo"
          ? ["Ton annulation", "L'annulation", "refusée"]
          : ["Ton rétablissement", "Le rétablissement", "refusé"];
      return `${you ? what[0] : `${what[1]} de Claude`} est ${what[2]} : changé depuis par ${by}`;
    }
    case "SessionStarted":
      return "Session démarrée";
    case "SessionNamed":
      return `Claude nomme sa session « ${e.name} »`;
    case "BoardsFollowed":
      return `Claude suit ${e.boards.join(", ")}`;
    case "BoardsLeft":
      return `Claude ne suit plus ${e.boards.join(", ")}`;
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
    case "SessionEnded":
      return "Session terminée";
    case "ChangesDelivered":
      return "Claude a lu tes changements";
  }
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;
}
