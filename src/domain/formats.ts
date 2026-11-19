/**
 * Workshop formats. A format is data: the kinds of sticky a board accepts, how the
 * board is laid out, and what to tell the agent about it. Adding a workshop means
 * adding an entry here, not writing a renderer.
 */
import type { Locale, Text } from "./i18n.ts";

/** How semantic positions become geometry. */
export type LayoutKind =
  /** Rows are element types, columns are steps in time (`col`). */
  | "timeline"
  /** Columns are named lanes; elements stack in each. */
  | "columns"
  /** Positions follow the edges: a layered, top-down graph. */
  | "graph";

/** `sticky` is a paper note, `sharp` a square-cornered alarm, `box` a process step. */
export type Shape = "sticky" | "sharp" | "box" | "pill" | "diamond";

export interface ElementType {
  id: string;
  label: Text;
  /** Ids are minted as `<prefix><n>`: E1, C2. One letter, unique within the format, never `N`. */
  prefix: string;
  fill: string;
  ink: string;
  shape: Shape;
  /** One line for the palette tooltip and the agent's guidance. */
  hint: Text;
}

export interface Lane {
  id: string;
  label: Text;
  /** What the lane stands for, under its name, when the name alone does not say it. */
  hint?: Text;
}

/**
 * Lanes laid as the cells of a plan, row after row: `perRow` lanes side by
 * side, `abreast` cards side by side in a cell, and a name for each axis.
 */
export interface Grid {
  perRow: number;
  abreast: number;
  /** What grows from left to right. */
  x: Text;
  /** What grows from bottom to top. */
  y: Text;
}

export interface Format {
  id: string;
  name: Text;
  /** The question this workshop answers, shown when choosing a format. */
  purpose: Text;
  layout: LayoutKind;
  types: readonly ElementType[];
  /** Only for `columns` layouts. */
  lanes: readonly Lane[];
  /** Only for `columns` layouts: the lanes are the cells of a plan. */
  grid?: Grid;
  /**
   * Only for `columns` layouts: each board adds, moves and removes its own lanes,
   * starting from these; a card in the last one is done, and wears no other mark.
   */
  ownLanes?: true;
}

const t = (en: string, fr: string): Text => ({ en, fr });

const DARK = "#1F2328";
const LIGHT = "#FFFFFF";

/** Lanes, colours and id prefixes follow faceto, so its model files load unchanged. */
const EVENT_STORMING: Format = {
  id: "event-storming",
  name: t("Event Storming", "Event Storming"),
  purpose: t(
    "What happens in the domain, in what order, and what triggers it?",
    "Que se passe-t-il dans le domaine, dans quel ordre, et qui le déclenche ?",
  ),
  layout: "timeline",
  lanes: [],
  types: [
    {
      id: "actor",
      label: t("Actor", "Acteur"),
      prefix: "X",
      fill: "#FCEFA1",
      ink: DARK,
      shape: "sticky",
      hint: t("Who acts", "Qui agit"),
    },
    {
      id: "command",
      label: t("Command", "Commande"),
      prefix: "C",
      fill: "#1A6FAE",
      ink: LIGHT,
      shape: "sticky",
      hint: t("An intent, in the imperative", "Une intention, à l'impératif"),
    },
    {
      id: "aggregate",
      label: t("Aggregate", "Agrégat"),
      prefix: "A",
      fill: "#FFD23F",
      ink: DARK,
      shape: "sticky",
      hint: t("What decides and keeps things consistent", "Ce qui décide et garde la cohérence"),
    },
    {
      id: "event",
      label: t("Event", "Événement"),
      prefix: "E",
      fill: "#FF9F1C",
      ink: DARK,
      shape: "sticky",
      hint: t("A business fact, in the past tense", "Un fait métier, au passé"),
    },
    {
      id: "policy",
      label: t("Policy", "Règle"),
      prefix: "P",
      fill: "#C39BD3",
      ink: DARK,
      shape: "sticky",
      hint: t("When this happens, then that", "Quand ceci arrive, alors cela"),
    },
    {
      id: "readmodel",
      label: t("Read model", "Vue"),
      prefix: "R",
      fill: "#6FCF97",
      ink: DARK,
      shape: "sticky",
      hint: t("What is read to decide", "Ce qu'on lit pour décider"),
    },
    {
      id: "system",
      label: t("External system", "Système externe"),
      prefix: "G",
      fill: "#F2A0C9",
      ink: DARK,
      shape: "sticky",
      hint: t("Outside our control", "Hors de notre contrôle"),
    },
    {
      id: "hotspot",
      label: t("Hotspot", "Point chaud"),
      prefix: "H",
      fill: "#C0392B",
      ink: LIGHT,
      shape: "sharp",
      hint: t("A question, a risk or a disagreement", "Question, risque ou désaccord"),
    },
  ],
};

const FLOW: Format = {
  id: "flow",
  name: t("Flow", "Flux"),
  purpose: t(
    "Which way does it go, and where does the path split?",
    "Par où passe-t-on, et où le chemin se sépare-t-il ?",
  ),
  layout: "graph",
  lanes: [],
  types: [
    {
      id: "step",
      label: t("Step", "Étape"),
      prefix: "S",
      fill: "#E8EEF4",
      ink: DARK,
      shape: "box",
      hint: t("An action", "Une action"),
    },
    {
      id: "decision",
      label: t("Decision", "Décision"),
      prefix: "D",
      fill: "#FFD23F",
      ink: DARK,
      shape: "diamond",
      hint: t("A question the rest depends on", "Une question dont dépend la suite"),
    },
    {
      id: "outcome",
      label: t("Outcome", "Issue"),
      prefix: "O",
      fill: "#6FCF97",
      ink: DARK,
      shape: "pill",
      hint: t("Where the path ends", "Là où le chemin s'arrête"),
    },
  ],
};

const KANBAN: Format = {
  id: "kanban",
  name: t("Kanban", "Kanban"),
  purpose: t(
    "Where does the work stand, and what is blocking it?",
    "Où en est le travail, et qu'est-ce qui le bloque ?",
  ),
  layout: "columns",
  ownLanes: true,
  lanes: [
    { id: "todo", label: t("To do", "À faire") },
    { id: "doing", label: t("Doing", "En cours") },
    { id: "done", label: t("Done", "Fait") },
  ],
  types: [
    {
      id: "task",
      label: t("Task", "Tâche"),
      prefix: "T",
      fill: "#FCEFA1",
      ink: DARK,
      shape: "sticky",
      hint: t("A piece of work", "Un lot de travail"),
    },
    {
      id: "blocker",
      label: t("Blocker", "Blocage"),
      prefix: "B",
      fill: "#C0392B",
      ink: LIGHT,
      shape: "sharp",
      hint: t("What stops progress", "Ce qui empêche d'avancer"),
    },
  ],
};

const STORY_MAP: Format = {
  id: "story-map",
  name: t("Story Mapping", "Story Mapping"),
  purpose: t(
    "What journey does the user follow, and what ships first?",
    "Quel parcours l'utilisateur suit-il, et que livre-t-on d'abord ?",
  ),
  layout: "timeline",
  lanes: [],
  types: [
    {
      id: "activity",
      label: t("Activity", "Activité"),
      prefix: "A",
      fill: "#1A6FAE",
      ink: LIGHT,
      shape: "sticky",
      hint: t("A broad user goal", "Un grand but de l'utilisateur"),
    },
    {
      id: "task",
      label: t("Task", "Tâche"),
      prefix: "T",
      fill: "#6FCF97",
      ink: DARK,
      shape: "sticky",
      hint: t("A step of the journey", "Une étape du parcours"),
    },
    {
      id: "story",
      label: t("Story", "Story"),
      prefix: "S",
      fill: "#FCEFA1",
      ink: DARK,
      shape: "sticky",
      hint: t("A shippable slice", "Une tranche livrable"),
    },
  ],
};

const RETRO: Format = {
  id: "retro",
  name: t("Retrospective", "Rétrospective"),
  purpose: t(
    "What do we keep, what do we stop, what do we try?",
    "Que garde-t-on, qu'arrête-t-on, qu'essaie-t-on ?",
  ),
  layout: "columns",
  lanes: [
    { id: "keep", label: t("Keep", "On garde") },
    { id: "drop", label: t("Stop", "On arrête") },
    { id: "try", label: t("Try", "On essaie") },
  ],
  types: [
    {
      id: "point",
      label: t("Observation", "Constat"),
      prefix: "K",
      fill: "#FCEFA1",
      ink: DARK,
      shape: "sticky",
      hint: t("Something observed", "Un fait observé"),
    },
    {
      id: "action",
      label: t("Action", "Action"),
      prefix: "A",
      fill: "#6FCF97",
      ink: DARK,
      shape: "sticky",
      hint: t("What we will do, and who", "Ce qu'on fera, par qui"),
    },
  ],
};

/**
 * The 2 × 2 of impact against effort, unfolded into its four quadrants: lanes
 * exist, a plane where a card sits at its own impact and effort does not yet.
 * Left to right is the order to take them in.
 */
const IMPACT_EFFORT: Format = {
  id: "impact-effort",
  name: t("Impact / Effort", "Impact / Effort"),
  purpose: t(
    "What do we do first, for what it brings and what it costs?",
    "Que fait-on d'abord, pour ce que ça rapporte et ce que ça coûte ?",
  ),
  layout: "columns",
  // High impact on top, low effort on the left: the lanes below are read row after row.
  grid: { perRow: 2, abreast: 2, x: t("Effort", "Effort"), y: t("Impact", "Impact") },
  lanes: [
    {
      id: "quick",
      label: t("Quick wins", "Gains rapides"),
      hint: t("High impact · low effort", "Impact fort · effort faible"),
    },
    {
      id: "bet",
      label: t("Big bets", "Gros paris"),
      hint: t("High impact · high effort", "Impact fort · effort fort"),
    },
    {
      id: "fill",
      label: t("Fill-ins", "Remplissage"),
      hint: t("Low impact · low effort", "Impact faible · effort faible"),
    },
    {
      id: "avoid",
      label: t("Avoid", "À éviter"),
      hint: t("Low impact · high effort", "Impact faible · effort fort"),
    },
  ],
  types: [
    {
      id: "item",
      label: t("Item", "Sujet"),
      prefix: "I",
      fill: "#FCEFA1",
      ink: DARK,
      shape: "sticky",
      hint: t("Something we could do", "Une chose qu'on pourrait faire"),
    },
  ],
};

export const FORMATS: readonly Format[] = [EVENT_STORMING, FLOW, KANBAN, STORY_MAP, RETRO, IMPACT_EFFORT];

/** The prefix reserved for notes, on every board. */
export const NOTE_PREFIX = "N";

export function findFormat(id: string): Format | undefined {
  return FORMATS.find((f) => f.id === id);
}

/** A lane's name on a board: the one the board gave it, else its workshop's in the reader's language. */
export function laneName(
  format: Format | undefined,
  board: { lanes: Record<string, string> },
  lane: string,
  locale: Locale,
): string {
  return board.lanes[lane] ?? format?.lanes.find((l) => l.id === lane)?.label[locale] ?? lane;
}

/** The key of `minted` that counts the lanes a board added: they are lane-1, lane-2… */
export const LANE_PREFIX = "lane-";

/** The lanes of a board, in order: its own when it changed them, else its workshop's. */
export function lanesOf(board: { format: string; laneOrder?: readonly string[] }): string[] {
  return board.laneOrder ? [...board.laneOrder] : (findFormat(board.format)?.lanes.map((l) => l.id) ?? []);
}

/** Whether what a card stands for is done: on a kanban, it sits in the last lane; elsewhere, it was marked so. */
export function isDone(
  board: { format: string; laneOrder?: readonly string[] },
  el: { lane: string; done?: boolean },
): boolean {
  if (findFormat(board.format)?.ownLanes) return el.lane === lanesOf(board).at(-1);
  return el.done === true;
}

/** Whether a card wears the tick and the strike: where done is a mark, not a lane. */
export function wearsDone(board: { format: string }, el: { done?: boolean }): boolean {
  return !findFormat(board.format)?.ownLanes && el.done === true;
}

export function findType(format: Format, typeId: string): ElementType | undefined {
  return format.types.find((t) => t.id === typeId);
}

export function typeOfId(format: Format, elementId: string): ElementType | undefined {
  return format.types.find((t) => t.prefix === elementId.charAt(0));
}
