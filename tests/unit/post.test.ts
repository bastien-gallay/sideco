/**
 * The page posts the human's commands and is told what came of them: saved,
 * refused, or no answer in time. A post that hangs must end, so that what was
 * typed goes back to the human instead of vanishing.
 */
import { expect, test } from "bun:test";
import { type Fetch, postCommands } from "../../src/web/post.ts";

const answer =
  (status: number, body: unknown): Fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });

/** A companion that never answers, but lets go when the request is abandoned. */
const silent: Fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

test("a command the companion takes is saved, with the ids it minted", async () => {
  const posted = await postCommands("[]", { fetch: answer(200, { minted: ["E1"] }), timeoutMs: 1000 });
  expect(posted).toEqual({ ok: true, minted: ["E1"] });
});

test("a command the companion refuses says why", async () => {
  const posted = await postCommands("[]", { fetch: answer(400, { error: "no such card" }), timeoutMs: 1000 });
  expect(posted).toEqual({ ok: false, reason: "refused", error: "no such card" });
});

test("a refusal without a reason still says what it was", async () => {
  const refuse: Fetch = async () => new Response("down", { status: 502 });
  const posted = await postCommands("[]", { fetch: refuse, timeoutMs: 1000 });
  expect(posted).toEqual({ ok: false, reason: "refused", error: "HTTP 502" });
});

test("a companion that does not answer in time: the post ends, and says so", async () => {
  const started = performance.now();
  const posted = await postCommands("[]", { fetch: silent, timeoutMs: 40 });
  expect(posted).toEqual({ ok: false, reason: "timeout" });
  expect(performance.now() - started).toBeLessThan(1000);
});

test("a companion out of reach is a failure too, not an exception", async () => {
  const unreachable: Fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const posted = await postCommands("[]", { fetch: unreachable, timeoutMs: 1000 });
  expect(posted).toEqual({ ok: false, reason: "unreachable", error: "Failed to fetch" });
});

test("a slow answer is said once it is late, and not before", async () => {
  let slow = 0;
  const late: Fetch = () =>
    new Promise((resolve) => setTimeout(() => resolve(new Response('{"minted":[]}')), 60));
  await postCommands("[]", { fetch: late, timeoutMs: 1000, slowMs: 20, onSlow: () => slow++ });
  expect(slow).toBe(1);
  await postCommands("[]", {
    fetch: answer(200, { minted: [] }),
    timeoutMs: 1000,
    slowMs: 20,
    onSlow: () => slow++,
  });
  await Bun.sleep(40);
  expect(slow).toBe(1);
});
