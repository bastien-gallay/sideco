/**
 * A flow: steps, decisions and outcomes, placed from their links.
 */
import { DARK, type Format, t } from "./types.ts";

export const FLOW: Format = {
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
      prefix: "F",
      formerPrefixes: ["S"],
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
