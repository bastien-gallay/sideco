/**
 * Workshop formats. A format is data: the kinds of sticky a board accepts, how the
 * board is laid out, and what to tell the agent about it. Adding a workshop means
 * adding an entry here, not writing a renderer.
 */

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
  label: string;
  /** Ids are minted as `<prefix><n>`: E1, C2. One letter, unique within the format, never `N`. */
  prefix: string;
  fill: string;
  ink: string;
  shape: Shape;
  /** One line for the palette tooltip and the agent's guidance. */
  hint: string;
}

export interface Lane {
  id: string;
  label: string;
}

export interface Format {
  id: string;
  name: string;
  /** The question this workshop answers, shown when choosing a format. */
  purpose: string;
  layout: LayoutKind;
  types: readonly ElementType[];
  /** Only for `columns` layouts. */
  lanes: readonly Lane[];
}

const DARK = "#1F2328";
const LIGHT = "#FFFFFF";

/** Lanes, colours and id prefixes follow faceto, so its model files load unchanged. */
const EVENT_STORMING: Format = {
  id: "event-storming",
  name: "Event Storming",
  purpose: "Que se passe-t-il dans le domaine, dans quel ordre, et qui le déclenche ?",
  layout: "timeline",
  lanes: [],
  types: [
    {
      id: "actor",
      label: "Acteur",
      prefix: "X",
      fill: "#FCEFA1",
      ink: DARK,
      shape: "sticky",
      hint: "Qui agit",
    },
    {
      id: "command",
      label: "Commande",
      prefix: "C",
      fill: "#1A6FAE",
      ink: LIGHT,
      shape: "sticky",
      hint: "Une intention, à l'impératif",
    },
    {
      id: "aggregate",
      label: "Agrégat",
      prefix: "A",
      fill: "#FFD23F",
      ink: DARK,
      shape: "sticky",
      hint: "Ce qui décide et garde la cohérence",
    },
    {
      id: "event",
      label: "Événement",
      prefix: "E",
      fill: "#FF9F1C",
      ink: DARK,
      shape: "sticky",
      hint: "Un fait métier, au passé",
    },
    {
      id: "policy",
      label: "Règle",
      prefix: "P",
      fill: "#C39BD3",
      ink: DARK,
      shape: "sticky",
      hint: "Quand ceci arrive, alors cela",
    },
    {
      id: "readmodel",
      label: "Vue",
      prefix: "R",
      fill: "#6FCF97",
      ink: DARK,
      shape: "sticky",
      hint: "Ce qu'on lit pour décider",
    },
    {
      id: "system",
      label: "Système externe",
      prefix: "G",
      fill: "#F2A0C9",
      ink: DARK,
      shape: "sticky",
      hint: "Hors de notre contrôle",
    },
    {
      id: "hotspot",
      label: "Point chaud",
      prefix: "H",
      fill: "#C0392B",
      ink: LIGHT,
      shape: "sharp",
      hint: "Question, risque ou désaccord",
    },
  ],
};

const FLOW: Format = {
  id: "flow",
  name: "Flux",
  purpose: "Par où passe-t-on, et où le chemin se sépare-t-il ?",
  layout: "graph",
  lanes: [],
  types: [
    { id: "step", label: "Étape", prefix: "S", fill: "#E8EEF4", ink: DARK, shape: "box", hint: "Une action" },
    {
      id: "decision",
      label: "Décision",
      prefix: "D",
      fill: "#FFD23F",
      ink: DARK,
      shape: "diamond",
      hint: "Une question dont dépend la suite",
    },
    {
      id: "outcome",
      label: "Issue",
      prefix: "O",
      fill: "#6FCF97",
      ink: DARK,
      shape: "pill",
      hint: "Là où le chemin s'arrête",
    },
  ],
};

const KANBAN: Format = {
  id: "kanban",
  name: "Kanban",
  purpose: "Où en est le travail, et qu'est-ce qui le bloque ?",
  layout: "columns",
  lanes: [
    { id: "todo", label: "À faire" },
    { id: "doing", label: "En cours" },
    { id: "done", label: "Fait" },
  ],
  types: [
    {
      id: "task",
      label: "Tâche",
      prefix: "T",
      fill: "#FCEFA1",
      ink: DARK,
      shape: "sticky",
      hint: "Un lot de travail",
    },
    {
      id: "blocker",
      label: "Blocage",
      prefix: "B",
      fill: "#C0392B",
      ink: LIGHT,
      shape: "sharp",
      hint: "Ce qui empêche d'avancer",
    },
  ],
};

const STORY_MAP: Format = {
  id: "story-map",
  name: "Story Mapping",
  purpose: "Quel parcours l'utilisateur suit-il, et que livre-t-on d'abord ?",
  layout: "timeline",
  lanes: [],
  types: [
    {
      id: "activity",
      label: "Activité",
      prefix: "A",
      fill: "#1A6FAE",
      ink: LIGHT,
      shape: "sticky",
      hint: "Un grand but de l'utilisateur",
    },
    {
      id: "task",
      label: "Tâche",
      prefix: "T",
      fill: "#6FCF97",
      ink: DARK,
      shape: "sticky",
      hint: "Une étape du parcours",
    },
    {
      id: "story",
      label: "Story",
      prefix: "S",
      fill: "#FCEFA1",
      ink: DARK,
      shape: "sticky",
      hint: "Une tranche livrable",
    },
  ],
};

const RETRO: Format = {
  id: "retro",
  name: "Rétrospective",
  purpose: "Que garde-t-on, qu'arrête-t-on, qu'essaie-t-on ?",
  layout: "columns",
  lanes: [
    { id: "keep", label: "On garde" },
    { id: "drop", label: "On arrête" },
    { id: "try", label: "On essaie" },
  ],
  types: [
    {
      id: "point",
      label: "Constat",
      prefix: "K",
      fill: "#FCEFA1",
      ink: DARK,
      shape: "sticky",
      hint: "Un fait observé",
    },
    {
      id: "action",
      label: "Action",
      prefix: "A",
      fill: "#6FCF97",
      ink: DARK,
      shape: "sticky",
      hint: "Ce qu'on fera, par qui",
    },
  ],
};

export const FORMATS: readonly Format[] = [EVENT_STORMING, FLOW, KANBAN, STORY_MAP, RETRO];

/** The prefix reserved for notes, on every board. */
export const NOTE_PREFIX = "N";

export function findFormat(id: string): Format | undefined {
  return FORMATS.find((f) => f.id === id);
}

export function findType(format: Format, typeId: string): ElementType | undefined {
  return format.types.find((t) => t.id === typeId);
}

export function typeOfId(format: Format, elementId: string): ElementType | undefined {
  return format.types.find((t) => t.prefix === elementId.charAt(0));
}
