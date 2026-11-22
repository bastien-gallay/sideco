import { DARK, type Format, LIGHT, t } from "./types.ts";

export const STORY_MAP: Format = {
  id: "story-map",
  name: t("Story Mapping", "Story Mapping"),
  purpose: t(
    "What journey does the user follow, and what ships first?",
    "Quel parcours l'utilisateur suit-il, et que livre-t-on d'abord ?",
  ),
  layout: "timeline",
  lanes: [],
  backbone: ["activity", "task"],
  sliced: "story",
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
