/**
 * The Claude Code session the page tells about: the one the reader chose, kept
 * in this browser, and the picker that offers the others. Out of main.ts (T171).
 */
import { hasSpoken, isOpen, type Session, sessionLabel } from "../domain/sessions.ts";
import { h, region } from "./dom.ts";
import { t } from "./locale.ts";
import { state } from "./store.ts";

export const sessionPicker = h("div", { class: "session-picker" });

/** The session the reader chose, kept in this browser across reloads. */
const CHOSEN_SESSION = "sideco.session";

function readChosenSession(): string | null {
  try {
    return localStorage.getItem(CHOSEN_SESSION);
  } catch {
    return null;
  }
}

/** What the page does once another session is chosen: set by main.ts, which paints. */
let chosen: () => void = () => {};
export function onSessionChosen(then: () => void): void {
  chosen = then;
}

function chooseSession(id: string): void {
  state.sessionId = id;
  try {
    localStorage.setItem(CHOSEN_SESSION, id);
  } catch {
    // Without storage, the choice lasts as long as the page.
  }
  chosen();
}

state.sessionId = readChosenSession();

interface SessionPickerModel {
  sessions: { id: string; label: string }[];
  current: string | undefined;
}

/** A session worth choosing: open, and spoken to; a claude started and left untouched is not (T195). */
export const choosable = (s: Session, now: number): boolean => isOpen(s, now) && hasSpoken(s);

/** The sessions worth choosing between, and the one shown even once it ended. */
export function sessionChoices(sessions: readonly Session[], shown: Session | undefined): SessionPickerModel {
  const now = Date.now();
  const open = sessions.filter((s) => choosable(s, now) || s.id === shown?.id);
  return { sessions: open.map((s) => ({ id: s.id, label: sessionLabel(s) })), current: shown?.id };
}

// One session alone needs no choosing: the picker shows from two on.
export const paintSessionPicker = region(sessionPicker, (m: SessionPickerModel) => [
  m.sessions.length > 1 &&
    h(
      "select",
      {
        name: "session",
        "aria-label": t.sessionShown,
        title: t.sessionShown,
        onchange: (event: Event) => chooseSession((event.target as HTMLSelectElement).value),
      },
      ...m.sessions.map((s) => h("option", { value: s.id, selected: s.id === m.current }, s.label)),
    ),
]);
