import { DARK, type Format, t } from "./types.ts";

export const RETRO: Format = {
  id: "retro",
  name: t("Retrospective", "Rétrospective"),
  purpose: t(
    "What do we keep, what do we stop, what do we try?",
    "Que garde-t-on, qu'arrête-t-on, qu'essaie-t-on ?",
  ),
  layout: "columns",
  ownLanes: true,
  lanes: [
    { id: "went-well", label: t("Went well", "Ce qui a marché") },
    { id: "went-badly", label: t("Didn't go well", "Ce qui a coincé") },
    { id: "keep", label: t("Keep", "On garde") },
    { id: "drop", label: t("Stop", "On arrête") },
    { id: "try", label: t("Try", "On essaie") },
  ],
  types: [
    {
      id: "point",
      label: t("Observation", "Constat"),
      prefix: "P",
      formerPrefix: "K",
      leadsTo: { type: "action", label: t("Make an action of it", "En faire une action") },
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
      home: "try",
    },
  ],
};
