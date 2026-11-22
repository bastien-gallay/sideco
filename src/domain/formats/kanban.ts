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
