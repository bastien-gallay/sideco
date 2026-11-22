/**
 * A kanban: stories, tasks and blockers in lanes, from to do to done.
 */
import { DARK, type Format, LIGHT, t } from "./types.ts";

export const KANBAN: Format = {
  id: "kanban",
  name: t("Kanban", "Kanban"),
  purpose: t(
    "Where does the work stand, and what is blocking it?",
    "Où en est le travail, et qu'est-ce qui le bloque ?",
  ),
  layout: "columns",
  ownLanes: true,
  doneLast: true,
  lanes: [
    { id: "todo", label: t("To do", "À faire") },
    { id: "doing", label: t("Doing", "En cours") },
    { id: "done", label: t("Done", "Fait") },
  ],
  types: [
    {
      id: "story",
      label: t("Story", "Story"),
      prefix: "S",
      leadsTo: { type: "task", label: t("Split into a task", "Découper en tâche") },
      fill: "#FCEFA1",
      ink: DARK,
      shape: "sticky",
      hint: t("A need, told from the user's side", "Un besoin, dit du côté de l'utilisateur"),
    },
    {
      id: "task",
      label: t("Task", "Tâche"),
      prefix: "T",
      fill: "#6FCF97",
      ink: DARK,
      shape: "sticky",
      hint: t(
        "A piece of work, alone or splitting a story",
        "Un lot de travail, seul ou découpant une story",
      ),
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
