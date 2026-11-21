# To investigate

Oddities seen once, harmless so far, not yet understood. Each entry keeps what
was seen and what was ruled out, so whoever meets it again starts from there
rather than from zero.

An entry leaves this page when it is understood: as a bug card on the backlog
board if it needs a fix, or deleted if it was nothing.

| Field | What goes in it |
| --- | --- |
| Seen | Date, where, by whom, and the exact message |
| Ruled out | What was checked, and how |
| Hypothesis | Unverified, with what would verify it |
| If it comes back | What to note at that moment |

## I1 · Safari refuses a link to `file:///` from the page

**Seen**: 2026-11-21, by the user, in Safari, on the `types-de-boards` board
(`http://127.0.0.1:4747/#/b/types-de-boards`), around the time a note thread
was resolved. The message, in French:

```text
Erreur de sécurité : le contenu situé à http://127.0.0.1:4747/#/b/types-de-boards
ne peut pas charger de données ou établir un lien vers file:///.
```

Safari prints this when a page served over `http://` tries to load or open a
`file:` URL. Nothing visible broke.

**Ruled out**, the same day:

| Where | How | Result |
| --- | --- | --- |
| The board's content | `sideco show types-de-boards` and its notes in the journal, searched for `file:` and Markdown links | none |
| The page as served | the HTML (230 kB, scripts inline, no source map) searched for `file:` | none |
| The page's code | `src/web/*.ts` searched for `location.href`, `location.assign`, `window.open`, `new URL(` and native drag and drop (`drop`, `dragover`, `dataTransfer`) | none |
| Links in details | `src/web/markdown.ts` renders a link only for `http(s)://` and `mailto:` | cannot produce `file:` |

**Hypothesis** (unverified): a native drag. Text, an image or a file dragged
from elsewhere and dropped on the page makes Safari try to open what was
dropped, and the page does not catch native drops. To verify: drop something
on the page with the console open (⌥⌘C). If it is that, the fix is small:
`preventDefault` on `dragover` and `drop` for the whole page.

**If it comes back**: note the gesture just before (drop, click on a link,
reload, resolving a note), whether the console was open, and whether anything
failed.
