import { DARK, type Format, t } from "./types.ts";

/**
 * The 2 × 2 of impact against effort, unfolded into its four quadrants: lanes
 * exist, a plane where a card sits at its own impact and effort does not yet.
 * Left to right is the order to take them in.
 */
export const IMPACT_EFFORT: Format = {
  id: "impact-effort",
  name: t("Impact / Effort", "Impact / Effort"),
  purpose: t(
    "What do we do first, for what it brings and what it costs?",
    "Que fait-on d'abord, pour ce que ça rapporte et ce que ça coûte ?",
  ),
  layout: "columns",
  // High impact on top, low effort on the left: the lanes below are read row after row.
  grid: {
    perRow: 2,
    abreast: 2,
    x: t("Effort", "Effort"),
    y: t("Impact", "Impact"),
    low: t("low", "faible"),
    high: t("high", "fort"),
  },
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
