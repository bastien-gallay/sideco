import { type Format, LIGHT, t } from "./types.ts";

/**
 * C4, level 1: the system in its context, with the people who use it and the
 * systems it depends on. Links say what one does with the other ("pays via");
 * a card's detail is its description. Drawn top-down on the graph of a flow:
 * the persons come first, since nothing leads to them.
 */
export const C4_CONTEXT: Format = {
  id: "c4-context",
  name: t("C4 · System context", "C4 · Contexte du système"),
  purpose: t(
    "Who uses the system, and what does it depend on?",
    "Qui utilise le système, et de quoi dépend-il ?",
  ),
  layout: "graph",
  lanes: [],
  describes: true,
  relations: true,
  look: { outline: true, kinds: true, width: 200, blurbLines: 5 },
  types: [
    {
      id: "person",
      label: t("Person", "Personne"),
      prefix: "P",
      fill: "#08427B",
      dark: "#8EC1F5",
      ink: LIGHT,
      shape: "person",
      hint: t("Someone who uses the system", "Quelqu'un qui utilise le système"),
    },
    {
      id: "system",
      label: t("System", "Système"),
      prefix: "Y",
      formerPrefixes: ["S"],
      fill: "#1168BD",
      dark: "#4EA0F2",
      ink: LIGHT,
      shape: "box",
      hint: t("The software system we build", "Le système logiciel qu'on construit"),
    },
    {
      id: "external",
      label: t("External system", "Système externe"),
      prefix: "X",
      fill: "#6B6B6B",
      dark: "#A8A8A8",
      ink: LIGHT,
      shape: "box",
      hint: t("A system outside ours that it relies on", "Un système hors du nôtre, dont il dépend"),
    },
  ],
};
