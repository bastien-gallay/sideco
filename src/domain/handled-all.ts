/**
 * The end of a switch over a union. It takes only `never`, so a kind added to
 * the union and left out of the switch breaks the build where it is switched on.
 * At run time it does nothing: a reader ignores what it does not know.
 */
export function handledAll(_unhandled: never): void {}
