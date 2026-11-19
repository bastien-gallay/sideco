/**
 * How a tab follows the journal: through the worker every tab shares, so that
 * any number of tabs hold one connection; alone, where the browser has no
 * shared worker. The frames are the same either way.
 */
import { eventSource, type Frame, Relay, type Request } from "./relay.ts";

export function connect(build: string | undefined, hear: (frame: Frame) => void): void {
  if (typeof SharedWorker === "undefined") {
    new Relay(eventSource("/api/events")).join({ post: hear });
    return;
  }
  // One worker per build: a tab of another build must not share this one's stream.
  const worker = new SharedWorker(`/stream-worker.js?build=${build ?? ""}`, { name: "sideco-stream" });
  worker.port.onmessage = (message: MessageEvent<Frame>) => hear(message.data);
  worker.port.start();
  const say = (request: Request): void => worker.port.postMessage(request);
  window.addEventListener("pagehide", () => say({ kind: "leave" }));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) say({ kind: "join" });
  });
}
