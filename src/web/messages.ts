/**
 * Everything the page says, in each language. No DOM here: the wording is data,
 * tested like any other rule. A text that takes a value is a function of it.
 */
import type { Actor } from "../domain/events.ts";
import type { ExportFormat } from "../domain/export/index.ts";
import { asLocale, DEFAULT_LOCALE, type Locale } from "../domain/i18n.ts";

export interface Messages {
  /** The language's own name, as its speakers write it. */
  languageName: string;
  language: string;

  // The agent, in the status pill and the session panel.
  noSession: string;
  idle: string;
  thinking: string;
  running: (what: string | undefined) => string;
  waitingInTerminal: (why: string) => string;
  listening: string;
  disconnected: string;
  /** A save still waiting for the companion's answer. */
  saving: string;
  /** A save the companion did not answer in time, or could not be reached for. */
  noAnswer: string;
  unreachable: string;

  // When the agent will read the human's changes.
  hintListening: string;
  hintNoSession: string;
  hintWorking: string;
  hintIdle: string;
  handedOverNoSession: string;
  handedOverWorking: string;
  handedOverIdle: string;

  // The header.
  boardShown: string;
  newBoardButton: string;
  zoomOut: string;
  zoomIn: string;
  /** The tooltip of Undo and of Redo; `keys` is the shortcut as the reader's keyboard writes it. */
  undo: (keys: string) => string;
  redo: (keys: string) => string;
  /** The words on the two buttons; the first also offers to take a board removal back. */
  undoAction: string;
  redoAction: string;
  export: string;
  exportAs: Record<ExportFormat, string>;
  copyMermaid: string;
  publishAll: string;
  mermaidCopied: string;
  clipboardRefused: string;

  // The palette.
  palette: string;
  add: (type: string) => string;
  /** The "+" on the edge between two steps of a timeline. */
  insertColumn: string;
  addLane: string;
  removeLane: (name: string) => string;
  laneRemoved: (name: string) => string;
  removeStep: (col: number) => string;
  stepRemoved: (col: number) => string;
  howTimeline: string;
  howColumns: string;
  howGraph: string;
  howGraphFrom: (id: string) => string;
  /** The placeholder of a new card: its type, then what that type is for. */
  newCard: (type: string, hint: string) => string;

  // Notes and focus.
  notes: string;
  openNotes: (count: number) => string;
  wholeBoard: string;
  cardGone: (id: string) => string;
  author: Record<Actor, string>;
  waits: Record<"you" | "claude", string>;
  replyTo: (id: string) => string;
  showCard: (id: string) => string;
  replyPlaceholder: string;
  reply: string;
  notePlaceholder: string;
  newNote: string;
  addNote: string;
  resolve: string;
  replyAndResolve: string;
  focus: (ids: string) => string;
  clearFocus: string;

  // The first screen and the new-board dialog.
  emptyTitle: string;
  emptyHint: string;
  newBoard: string;
  title: string;
  boardTitle: string;
  titleExample: string;
  workshop: string;
  cancel: string;
  create: string;

  // Removing the board on screen.
  removeBoard: (title: string) => string;
  removeBoardQuestion: (title: string) => string;
  /** What leaves and what stays, said before the board is removed. */
  removeBoardConsequence: (elements: number) => string;

  // The session panel.
  sessionPanel: string;
  session: string;
  turnInProgress: string;
  earlierSteps: (count: number) => string;
  sessionHint: string;

  // The hand-over.
  messageForClaude: string;
  messagePlaceholder: string;
  upToDate: string;
  pending: (count: number) => string;
  /** On a card or a discussion that carries a change Claude has not read. */
  unread: string;
  theirTurn: string;
  claudeWaits: string;
  claudeWaitsOn: (title: string) => string;
  claudeBlocked: string;
  claudeBlockedOn: (title: string) => string;
  handOver: string;

  // The history.
  history: string;
  previousEvent: string;
  nextEvent: string;
  historyScope: string;
  thisBoard: string;
  everything: string;
  live: (events: number) => string;
  beforeFirst: string;
  past: string;
  backToLive: string;

  // A card's actions.
  cardLabel: string;
  laneName: string;
  wordsOrphaned: (id: string, words: string) => string;
  rename: string;
  detail: string;
  link: string;
  /** On a card's toolbar: marks what it stands for as done, and takes the mark off. */
  done: string;
  notDone: string;
  noteForClaude: string;
  remove: string;
  detailPlaceholder: string;
  noteOnPlaceholder: (id: string) => string;
  linkBetween: (src: string, dst: string) => string;
  removeLink: string;

  // News the agent made while the human looked elsewhere.
  agentRemovedBoard: (title: string) => string;
  agentCreatedBoard: (title: string) => string;
  agentRestoredBoard: (title: string) => string;
  /** Said to the reader who just removed a board, beside the offer to undo. */
  boardRemoved: (title: string) => string;

  /** Said in a tab left open across an update of Sideco, when reloading it would lose words; and the offer. */
  updated: string;
  reload: string;

  /** Between a label and what follows it: French puts a space before the colon. */
  colon: string;

  // Reading and writing a card from the keyboard.
  /** The name of the editor, by what it edits. */
  detailOf: (id: string) => string;
  noteOn: (id: string) => string;
  /** How a text of several lines is saved, and left. */
  saveLines: string;
  /** An action with the key that does it too. */
  withKey: (action: string, key: string) => string;
  cardRemoved: (id: string) => string;
  /** The board, as a screen reader names it. */
  boardCards: (title: string) => string;
  /** Where a card is on a timeline, and what is said once it moved somewhere. */
  step: (n: number) => string;
  /** A card's links, read to who cannot see the arrows: each end as `id label`, a branch name in brackets. */
  leadsTo: (ends: string) => string;
  comesFrom: (ends: string) => string;
  /** A gesture taken back, or done again, said to who does not see the board change. */
  undone: (what: string) => string;
  redone: string;
  moved: (id: string, place: string) => string;
  skipToBoard: string;

  // Finding one's way on a large board.
  find: string;
  findPlaceholder: string;
  findCount: (at: number, of: number) => string;
  findNone: string;
  fit: string;
  fitHint: string;
  resolvedNotes: (count: number) => string;
  shortcuts: string;
  /** Each shortcut of the page: the keys, then what they do. */
  shortcutList: [keys: string, does: string][];
  close: string;
}

const plural = (count: number): string => (count > 1 ? "s" : "");

const en: Messages = {
  languageName: "English",
  language: "Language",

  noSession: "No Claude Code session linked",
  idle: "Claude is idle",
  thinking: "Claude is thinking",
  running: (what) => `Claude is running ${what ?? "a tool"}`,
  waitingInTerminal: (why) => `Claude is waiting for you in the terminal: ${why}`.trim(),
  listening: "Claude is waiting for you to hand over",
  disconnected: "Companion disconnected, reconnecting…",
  saving: "Saving…",
  noAnswer: "The companion did not answer: nothing was saved.",
  unreachable: "The companion is out of reach: nothing was saved.",

  hintListening: "Claude resumes as soon as you hand over.",
  hintNoSession: "No session linked: Claude will read your changes when a session starts here.",
  hintWorking: "Claude is working: it will read your changes after its current action.",
  hintIdle: "Claude is idle: it will read your changes at your next message in the terminal.",
  handedOverNoSession: "Handed over. No session linked: Claude will read this when a session starts here.",
  handedOverWorking: "Handed over. Claude is working: it will read this after its current action.",
  handedOverIdle:
    "Handed over. Claude is not listening: it will read this at your next message in the terminal.",

  boardShown: "Board shown",
  newBoardButton: "+ Board",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  undo: (keys) => `Undo your last change (${keys})`,
  redo: (keys) => `Redo (${keys})`,
  undoAction: "Undo",
  redoAction: "Redo",
  export: "Export",
  exportAs: {
    md: "Markdown (design note)",
    html: "Standalone HTML page",
    svg: "SVG image",
    mermaid: "Mermaid diagram",
    json: "JSON model (can be imported back)",
  },
  copyMermaid: "Copy the Mermaid",
  publishAll: "Publish everything at once: sideco publish",
  mermaidCopied: "Mermaid copied to the clipboard.",
  clipboardRefused: "The browser refused access to the clipboard; use the Mermaid export.",

  palette: "Elements to add",
  add: (type) => `Add: ${type}`,
  insertColumn: "Insert a column here",
  addLane: "Add a lane here",
  removeLane: (name) => `Remove the lane ${name}`,
  laneRemoved: (name) => `Lane ${name} removed.`,
  removeStep: (col) => `Remove step ${col}`,
  stepRemoved: (col) => `Step ${col} removed.`,
  howTimeline:
    "Point at a cell and click its +, or click a type to add it at the end. Point between two step numbers to insert a column; an empty step offers a × to remove it.",
  howColumns: "Point at a column and click a +, or click a type. Drag to move.",
  howGraph: "Select an element so that the next one is linked to it.",
  howGraphFrom: (id) => `The new element will be linked to ${id}.`,
  newCard: (type, hint) => `${type}: ${hint.toLowerCase()}`,

  notes: "Notes",
  openNotes: (count) => `Open notes (${count})`,
  wholeBoard: "Whole board",
  cardGone: (id) => `${id} (removed)`,
  author: { human: "You", agent: "Claude", system: "Sideco" },
  waits: { you: "Awaits your answer", claude: "Awaits Claude" },
  replyTo: (id) => `Reply to ${id}`,
  showCard: (id) => `Show ${id} on the board`,
  replyPlaceholder: "Reply…",
  reply: "Reply",
  notePlaceholder: "A question, a remark…",
  newNote: "New note",
  addNote: "Add note",
  resolve: "Resolve",
  replyAndResolve: "Reply and resolve",
  focus: (ids) => `Focus: ${ids}`,
  clearFocus: "Clear the focus",

  emptyTitle: "What do you want to model?",
  emptyHint: "Pick a workshop, or ask Claude in the terminal: it will write here while it works.",
  newBoard: "New board",
  title: "Title",
  boardTitle: "Board title",
  titleExample: "Order checkout",
  workshop: "Workshop",
  cancel: "Cancel",
  create: "Create",

  removeBoard: (title) => `Remove the board “${title}”`,
  removeBoardQuestion: (title) => `Remove the board “${title}”?`,
  removeBoardConsequence: (elements) =>
    `${elements === 0 ? "It is empty." : `It holds ${elements} element${plural(elements)}.`} It leaves the page, for you and for Claude. Undo brings it back.`,

  sessionPanel: "Claude Code session",
  session: "Session",
  turnInProgress: "(turn in progress)",
  earlierSteps: (count) => `… ${count} earlier step${plural(count)}`,
  sessionHint: "Claude's steps will appear here as soon as a Claude Code session runs in this project.",

  messageForClaude: "Message for Claude",
  messagePlaceholder: "A word for Claude (optional)",
  upToDate: "Claude is up to date",
  pending: (count) => `${count} change${plural(count)} Claude has not read`,
  unread: "Not read by Claude yet",
  theirTurn: "Claude hands over to you",
  claudeWaits: "Claude waits for you",
  claudeWaitsOn: (title) => `Claude waits · ${title}`,
  claudeBlocked: "Claude is blocked on you",
  claudeBlockedOn: (title) => `Claude is blocked · ${title}`,
  handOver: "Hand over to Claude",

  history: "Board history",
  previousEvent: "Previous event",
  nextEvent: "Next event",
  historyScope: "The history steps through",
  thisBoard: "This board",
  everything: "Everything",
  live: (events) => `Live · ${events} event${plural(events)}`,
  beforeFirst: "Before the first event",
  past: "You are looking at the past: the board is read-only.",
  backToLive: "Back to live",

  cardLabel: "Label",
  laneName: "Column name",
  wordsOrphaned: (id, words) => `${id} was removed while you were typing. Your words: “${words}”`,
  rename: "Rename",
  detail: "Detail",
  link: "Link",
  done: "Mark done",
  notDone: "Not done",
  noteForClaude: "Note for Claude",
  remove: "Remove",
  detailPlaceholder: "Detail: rule, example, source…",
  noteOnPlaceholder: (id) => `Note for Claude on ${id}…`,
  linkBetween: (src, dst) => `Link ${src} → ${dst}`,
  removeLink: "Remove the link",

  agentRemovedBoard: (title) => `Claude removed the board “${title}”.`,
  agentRestoredBoard: (title) => `Claude restored the board “${title}”.`,
  boardRemoved: (title) => `Board “${title}” removed.`,
  agentCreatedBoard: (title) => `Claude created the board “${title}”: it is in the board list, at the top.`,

  updated: "Sideco was updated.",
  reload: "Reload",

  colon: ":",

  detailOf: (id) => `Detail of ${id}`,
  noteOn: (id) => `Note for Claude on ${id}`,
  saveLines: "Enter saves, Shift+Enter starts a new line, Esc cancels",
  withKey: (action, key) => `${action} (${key})`,
  cardRemoved: (id) => `${id} removed.`,
  boardCards: (title) => `Cards of “${title}”`,
  step: (n) => `step ${n}`,
  leadsTo: (ends) => `leads to ${ends}`,
  comesFrom: (ends) => `comes from ${ends}`,
  undone: (what) => `Undone: ${what}`,
  redone: "Done again",
  moved: (id, place) => `${id} moved to ${place}.`,
  skipToBoard: "Skip to the board",

  find: "Find a card",
  findPlaceholder: "An id or words…",
  findCount: (at, of) => `${at} / ${of}`,
  findNone: "No card",
  fit: "Fit",
  fitHint: "Fit the whole board in the window, or back to 100 %",
  resolvedNotes: (count) => `Resolved (${count})`,
  shortcuts: "Keyboard shortcuts",
  shortcutList: [
    ["Tab", "Into the board, then out of it"],
    ["← → ↑ ↓", "From a card to the next one"],
    ["Shift + ← → ↑ ↓", "Move the card: column or lane, then its place"],
    ["Alt + ← → ↑ ↓", "Add a card of its kind beside it, there"],
    ["Enter or F2", "Rename the card"],
    ["Space", "Select the card and show its actions"],
    ["D", "Mark the card done, or not done"],
    ["L", "Link from the card: then Space on the other one"],
    ["N", "Note for Claude on the card"],
    ["Delete", "Remove the card (Undo brings it back)"],
    ["/", "Find a card by its id or its words"],
    ["⌘Z / Ctrl+Z", "Undo your last change"],
    ["Esc", "Close, cancel, deselect"],
    ["?", "These shortcuts"],
  ],
  close: "Close",
};

const fr: Messages = {
  languageName: "Français",
  language: "Langue",

  noSession: "Aucune session Claude Code reliée",
  idle: "Claude est au repos",
  thinking: "Claude réfléchit",
  running: (what) => `Claude exécute ${what ?? "un outil"}`,
  waitingInTerminal: (why) => `Claude t'attend dans le terminal : ${why}`.trim(),
  listening: "Claude attend que tu lui passes la main",
  disconnected: "Compagnon déconnecté, reconnexion…",
  saving: "Enregistrement…",
  noAnswer: "Le compagnon n'a pas répondu : rien n'est enregistré.",
  unreachable: "Le compagnon est injoignable : rien n'est enregistré.",

  hintListening: "Claude reprend dès que tu lui passes la main.",
  hintNoSession: "Aucune session reliée : Claude lira tes changements quand une session démarrera ici.",
  hintWorking: "Claude travaille : il lira tes changements après son action en cours.",
  hintIdle: "Claude est au repos : il lira tes changements à ton prochain message dans le terminal.",
  handedOverNoSession: "Main passée. Aucune session reliée : Claude la lira quand une session démarrera ici.",
  handedOverWorking: "Main passée. Claude travaille : il la lira après son action en cours.",
  handedOverIdle: "Main passée. Claude n'écoute pas : il la lira à ton prochain message dans le terminal.",

  boardShown: "Tableau affiché",
  newBoardButton: "+ Tableau",
  zoomOut: "Dézoomer",
  zoomIn: "Zoomer",
  undo: (keys) => `Annuler ton dernier changement (${keys})`,
  redo: (keys) => `Rétablir (${keys})`,
  undoAction: "Annuler",
  redoAction: "Rétablir",
  export: "Exporter",
  exportAs: {
    md: "Markdown (note de conception)",
    html: "Page HTML autonome",
    svg: "Image SVG",
    mermaid: "Diagramme Mermaid",
    json: "Modèle JSON (réimportable)",
  },
  copyMermaid: "Copier le Mermaid",
  publishAll: "Tout publier d'un coup : sideco publish",
  mermaidCopied: "Mermaid copié dans le presse-papiers.",
  clipboardRefused: "Le navigateur a refusé l'accès au presse-papiers ; utilise l'export Mermaid.",

  palette: "Éléments à ajouter",
  add: (type) => `Ajouter : ${type}`,
  insertColumn: "Insérer une colonne ici",
  addLane: "Ajouter une colonne ici",
  removeLane: (name) => `Supprimer la colonne ${name}`,
  laneRemoved: (name) => `Colonne ${name} supprimée.`,
  removeStep: (col) => `Supprimer l'étape ${col}`,
  stepRemoved: (col) => `Étape ${col} supprimée.`,
  howTimeline:
    "Survole une case et clique son +, ou clique un type pour l'ajouter à la suite. Survole entre deux numéros d'étape pour insérer une colonne ; une étape vide offre un × pour la retirer.",
  howColumns: "Survole une colonne et clique un +, ou clique un type. Glisse pour déplacer.",
  howGraph: "Sélectionne un élément pour que le suivant lui soit relié.",
  howGraphFrom: (id) => `Le nouvel élément sera relié à ${id}.`,
  newCard: (type, hint) => `${type} : ${hint.toLowerCase()}`,

  notes: "Notes",
  openNotes: (count) => `Notes ouvertes (${count})`,
  wholeBoard: "Tout le tableau",
  cardGone: (id) => `${id} (supprimé)`,
  author: { human: "Toi", agent: "Claude", system: "Sideco" },
  waits: { you: "Attend ta réponse", claude: "Attend Claude" },
  replyTo: (id) => `Répondre à ${id}`,
  showCard: (id) => `Montrer ${id} sur le tableau`,
  replyPlaceholder: "Répondre…",
  reply: "Répondre",
  notePlaceholder: "Une question, une remarque…",
  newNote: "Nouvelle note",
  addNote: "Noter",
  resolve: "Résoudre",
  replyAndResolve: "Répondre et résoudre",
  focus: (ids) => `Focus : ${ids}`,
  clearFocus: "Lever le focus",

  emptyTitle: "Que veux-tu modéliser ?",
  emptyHint:
    "Choisis un atelier, ou demande-le à Claude dans le terminal : il écrira ici pendant qu'il travaille.",
  newBoard: "Nouveau tableau",
  title: "Titre",
  boardTitle: "Titre du tableau",
  titleExample: "Passage de commande",
  workshop: "Atelier",
  cancel: "Annuler",
  create: "Créer",

  removeBoard: (title) => `Supprimer le tableau « ${title} »`,
  removeBoardQuestion: (title) => `Supprimer le tableau « ${title} » ?`,
  removeBoardConsequence: (elements) =>
    `${elements === 0 ? "Il est vide." : `Il contient ${elements} élément${plural(elements)}.`} Il quitte la page, pour toi comme pour Claude. Annuler le fait revenir.`,

  sessionPanel: "Session Claude Code",
  session: "Session",
  turnInProgress: "(tour en cours)",
  earlierSteps: (count) => `… ${count} étape${plural(count)} avant`,
  sessionHint:
    "Les étapes de Claude apparaîtront ici dès qu'une session Claude Code tournera dans ce projet.",

  messageForClaude: "Message pour Claude",
  messagePlaceholder: "Un mot pour Claude (facultatif)",
  upToDate: "Claude est à jour",
  pending: (count) => `${count} changement${plural(count)} que Claude n'a pas lu${plural(count)}`,
  unread: "Pas encore lu par Claude",
  theirTurn: "Claude te passe la main",
  claudeWaits: "Claude t'attend",
  claudeWaitsOn: (title) => `Claude attend · ${title}`,
  claudeBlocked: "Claude est bloqué sur toi",
  claudeBlockedOn: (title) => `Claude est bloqué · ${title}`,
  handOver: "Passer la main à Claude",

  history: "Historique du tableau",
  previousEvent: "Événement précédent",
  nextEvent: "Événement suivant",
  historyScope: "L'historique parcourt",
  thisBoard: "Ce tableau",
  everything: "Tout",
  live: (events) => `En direct · ${events} événement${plural(events)}`,
  beforeFirst: "Avant le premier événement",
  past: "Tu regardes le passé : le tableau est en lecture seule.",
  backToLive: "Revenir au direct",

  cardLabel: "Libellé",
  laneName: "Nom de la colonne",
  wordsOrphaned: (id, words) => `${id} a été supprimée pendant ta saisie. Ton texte : « ${words} »`,
  rename: "Renommer",
  detail: "Détail",
  link: "Relier",
  done: "Marquer fait",
  notDone: "Pas fait",
  noteForClaude: "Note pour Claude",
  remove: "Supprimer",
  detailPlaceholder: "Détail : règle, exemple, source…",
  noteOnPlaceholder: (id) => `Note pour Claude sur ${id}…`,
  linkBetween: (src, dst) => `Lien ${src} → ${dst}`,
  removeLink: "Supprimer le lien",

  agentRemovedBoard: (title) => `Claude a supprimé le tableau « ${title} ».`,
  agentRestoredBoard: (title) => `Claude a restauré le tableau « ${title} ».`,
  boardRemoved: (title) => `Tableau « ${title} » supprimé.`,
  agentCreatedBoard: (title) =>
    `Claude a créé le tableau « ${title} » : il est dans la liste des tableaux, en haut.`,

  updated: "Sideco a été mis à jour.",
  reload: "Recharger",

  colon: " :",

  detailOf: (id) => `Détail de ${id}`,
  noteOn: (id) => `Note pour Claude sur ${id}`,
  saveLines: "Entrée enregistre, Maj+Entrée va à la ligne, Échap annule",
  withKey: (action, key) => `${action} (${key})`,
  cardRemoved: (id) => `${id} supprimée.`,
  boardCards: (title) => `Cartes de « ${title} »`,
  step: (n) => `étape ${n}`,
  leadsTo: (ends) => `mène à ${ends}`,
  comesFrom: (ends) => `vient de ${ends}`,
  undone: (what) => `Annulé : ${what}`,
  redone: "Refait",
  moved: (id, place) => `${id} déplacée en ${place}.`,
  skipToBoard: "Aller au tableau",

  find: "Trouver une carte",
  findPlaceholder: "Un id ou des mots…",
  findCount: (at, of) => `${at} / ${of}`,
  findNone: "Aucune carte",
  fit: "Ajuster",
  fitHint: "Faire tenir tout le tableau dans la fenêtre, ou revenir à 100 %",
  resolvedNotes: (count) => `Résolues (${count})`,
  shortcuts: "Raccourcis clavier",
  shortcutList: [
    ["Tab", "Entrer dans le tableau, puis en sortir"],
    ["← → ↑ ↓", "D'une carte à la suivante"],
    ["Maj + ← → ↑ ↓", "Déplacer la carte : colonne ou couloir, puis sa place"],
    ["Alt + ← → ↑ ↓", "Ajouter une carte du même type à côté, de ce côté"],
    ["Entrée ou F2", "Renommer la carte"],
    ["Espace", "Sélectionner la carte et montrer ses actions"],
    ["D", "Marquer la carte faite, ou non faite"],
    ["L", "Relier depuis la carte : puis Espace sur l'autre"],
    ["N", "Note pour Claude sur la carte"],
    ["Suppr", "Supprimer la carte (Annuler la ramène)"],
    ["/", "Trouver une carte par son id ou ses mots"],
    ["⌘Z / Ctrl+Z", "Annuler ton dernier changement"],
    ["Échap", "Fermer, annuler, désélectionner"],
    ["?", "Ces raccourcis"],
  ],
  close: "Fermer",
};

export const MESSAGES: Record<Locale, Messages> = { en, fr };

/**
 * The page's language: what the reader chose here, else what the companion
 * serves the page in, else English.
 */
export function pickLocale(chosen: string | null | undefined, served: string | null | undefined): Locale {
  return asLocale(chosen) ?? asLocale(served) ?? DEFAULT_LOCALE;
}
