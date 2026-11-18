/**
 * What the header and the tab of the browser say while Claude waits: a hand-over
 * the human answers when they wish, or Claude blocked, listening for the answer.
 */
import { describe, expect, test } from "bun:test";
import { tabTitle, waitsNotice } from "../../src/web/view.ts";

const WAITING = { board: "priorites", title: "Priorités", message: "Ton avis ?", others: 0 };

describe("the notice that Claude waits", () => {
  test("a hand-over is said in the header, and in the tab for who looks at another one", () => {
    expect(waitsNotice(WAITING, true, 0)).toEqual({
      text: "Claude waits for you",
      tab: "● Claude waits for you",
      blocked: false,
    });
    expect(waitsNotice(WAITING, false, 0).text).toBe("Claude waits · Priorités");
  });

  test("with a session listening for the answer, Claude is blocked, and both say so", () => {
    expect(waitsNotice(WAITING, true, 1)).toEqual({
      text: "Claude is blocked on you",
      tab: "● Claude is blocked on you",
      blocked: true,
    });
    expect(waitsNotice(WAITING, false, 2).text).toBe("Claude is blocked · Priorités");
  });

  test("the tab names the wait first, then the board", () => {
    expect(tabTitle(waitsNotice(WAITING, false, 0), "Backlog")).toBe(
      "● Claude waits for you · Backlog · Vico",
    );
    expect(tabTitle(undefined, "Backlog")).toBe("Backlog · Vico");
    expect(tabTitle(undefined, undefined)).toBe("Vico");
  });

  test("in French too", () => {
    expect(waitsNotice(WAITING, true, 1, "fr").tab).toBe("● Claude est bloqué sur toi");
    expect(waitsNotice(WAITING, false, 0, "fr").text).toBe("Claude attend · Priorités");
  });
});
