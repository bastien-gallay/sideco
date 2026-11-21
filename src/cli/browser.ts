/** Shows an address in the user's browser, through the system's opener or `$BROWSER`. */
const OPENER_WAIT_MS = 1500;

/**
 * Asks the system to show `url`; false when it has no opener or the opener
 * refuses, as it does inside a sandbox. `command` (`$BROWSER`) names another
 * opener, which receives the address as its last argument.
 */
export async function openBrowser(url: string, command = process.env.BROWSER): Promise<boolean> {
  const system =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const opener = command?.split(/\s+/).filter(Boolean) ?? [];
  try {
    const child = Bun.spawn([...(opener.length > 0 ? opener : [system]), url], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    // A browser started this way may keep running: only an opener that ends with an error has failed.
    const code = await Promise.race([child.exited, Bun.sleep(OPENER_WAIT_MS).then(() => 0)]);
    child.unref();
    return code === 0;
  } catch {
    return false;
  }
}
