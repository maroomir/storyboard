# Public Posts: Mask Personal Data

`maroomir/storyboard` is a public repository. Everything an agent writes to it — issues, PRs,
comments, reviews, releases, commit messages, test fixtures, docs — is public and keeps its edit
history. Personal data never goes there, not even for a moment: an edited post still shows the
original in its history.

## What to mask

| Never post | Write instead |
|---|---|
| Notion page/database id (32 hex, or the dashed UUID form) and any Notion URL that carries one | `https://www.notion.so/<id>`, `'<Notion 페이지 URL>'` |
| Personal links: a `*.notion.site` workspace, Obsidian vault paths, shared-drive or private document links | `<개인 링크>` |
| Local home paths (`/Users/<name>/…`, `/home/<name>/…`, `C:\Users\<name>\…`) | `~/…`, `/path/to/workspace` |
| Tokens and keys (`ntn_…`, `secret_…`, `sk-…`, `ghp_…`) | `<token>` |
| E-mail addresses other than the commit trailer's own | `<email>` |
| The titles or text of the author's own notes, beyond what a repro needs | a one-line paraphrase |

A repro command keeps its shape and loses its values: `storyboard notes absorb '<Notion 페이지 URL>' --yes`.
Real values may stay in the local scratchpad and the git-ignored `.storyboard/cache/`; they are
masked when copied into a post.

## How it is enforced

- `.claude/hooks/checkPublicPost.mjs` runs before every Bash call (`.claude/settings.json`) and
  refuses a `gh issue|pr|api|release|gist` or `git commit` whose text or `--body-file`/`-F` file
  matches the table above. Mask and post again; never work around the hook.
- Before posting from another tool (Cursor, Codex, the web UI), check the body by hand:
  `grep -nE '[0-9a-f]{32}|notion\.(so|site|com)/|/Users/|/home/' body.md` must print nothing but
  placeholders.
- If something leaked anyway, edit the post **and** delete the old revision from its edit history
  (GitHub web: «edited» → the revision → «Delete revision from history»; there is no API for it).
  Tell the user which posts were touched.
