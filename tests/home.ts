/** Preloaded by `bun test`: boards made by the tests go to a folder of their own, never to ~/.sideco. */
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SIDECO_HOME = realpathSync(mkdtempSync(join(tmpdir(), "sideco-home-")));
