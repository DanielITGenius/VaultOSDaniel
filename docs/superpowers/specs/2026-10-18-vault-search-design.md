# Vault search and recall — design

2026-10-18. Round 1 of bringing the "second brain" retrieval ideas (BM25, recency weighting,
retrieve-before-answer, searchable summaries, keep every session) into VaultOS.

## Why

VaultOS stores knowledge well (task.md working records, curated article.md write-ups) but
finds it poorly:

- The KB search box (`/api/kb?q=`) is a case-insensitive substring match on the whole query.
  Multi-word queries miss unless the exact phrase appears, and results are not ranked.
- Agents only get the current `task.md` injected (`inject-plan.sh`). Nothing looks up the rest
  of the vault before they answer unless the agent decides to grep.
- `created:`/`updated:` dates exist but nothing uses them, so an old answer and a new one look
  the same.
- Claude Code deletes sessions after 30 days (`cleanupPeriodDays` unset). The oldest session on
  this box is already 30 days old.

## Goals

1. One ranked search over the vault: BM25 with field weights plus a recency boost.
2. The KB search box uses it.
3. Any agent (Claude, Cursor CLI, others) can call it from a terminal.
4. Claude agents get the top matching articles added to each prompt automatically, and nothing
   when nothing matches well.
5. Sessions are kept indefinitely.
6. New articles carry the phrases someone would search for.

## Non-goals (cards on the Board)

- Indexing past Claude sessions (F).
- Connectors: Gmail read-only, Plaud, git history (G).
- Backfilling `search:` on the existing ~98 articles with a cheap model.
- Content search in Files mode, embeddings, a persisted on-disk index.

## Components

### `lib/search.js`

Pure module, no new dependencies. Exports `createIndex(vaultDir)` returning
`{ search(query, opts) }`, plus `tokenize` for tests.

**Corpus.** Every `.md` under the vault. Skipped: names starting with `.`, `node_modules`,
`_Templates/`, and any `Board.md`. Kind: `article` (basename `article.md`), `task` (`task.md`
or legacy `info.md`), else `note`. `board` = first path segment.

**Tokenising.** Lowercase, split on anything outside `[a-z0-9]`, drop tokens of one character
and a short English stopword list, strip a trailing `s` from tokens longer than 3 characters
(cheap plural folding). Numbers are kept (ticket numbers, ports).

**Fields and weights** (term frequency is weighted per field, then summed — BM25F-lite):

| Field | Source | Weight |
|---|---|---|
| title | frontmatter `title`, else first `# ` heading, else folder name | 3 |
| search | frontmatter `search:` (list or string) | 3 |
| stack + tickets | frontmatter | 2 |
| tldr | the `> **TL;DR**` blockquote in the body | 2 |
| body | the rest of the body | 1 |

**Scoring.** BM25 with k1 = 1.2, b = 0.75 over weighted lengths. Then multipliers:

- recency: `1 + 0.3 * 0.5 ^ (ageDays / 180)`, age from `updated:`, else `created:`, else
  mtime. Fresh documents get up to +30%; it never overrides a much stronger match.
- kind: `article` × 1.15.
- board: × 1.2 when `opts.board` matches the document's board.

Each result also reports `coverage`: the share of distinct query terms the document contains.

**Options.** `kind` (one kind or array), `board`, `limit` (default 10), `minCoverage`
(default 0).

**Result.** `{ path, kind, board, title, date, score, coverage, snippet }`. Snippet: the TL;DR
for articles; otherwise the first line containing a query term, trimmed to 240 characters.

**Cache.** The index keeps parsed documents keyed by path with their mtime and size. Each
`search` re-walks the tree (stat only) and re-reads files whose mtime or size changed, drops
deleted ones, then recomputes document frequencies. Target: under 500 ms cold, well under
100 ms warm, for ~1,100 files.

### `/api/kb?q=` (server.js)

When `q` is set, rank the workspace's articles with the index (`kind: 'article'`, scoped to the
workspace folder) and return them in score order, articles with no matching term dropped. The
response shape is unchanged. The frontend keeps server order for search results (it currently
re-sorts by `updated`; that sort stays for the unsearched dashboard only).

### `bin/vault-search.js` → `vault-search` on PATH

```
vault-search <query…> [--kind article|task|note] [--board <name>] [--limit N] [--json]
```

Reads `VAULT_DIR` (default `/vault`), builds the index, prints one block per hit:

```
1. adminSDHolder and SDProp: why OU delegation skips your Domain Admins   [article · 2026-09-23]
   Lancashire/10. learnings/adminsdholder-sdprop/article.md
   AD keeps a template ACL on one object…
```

`--json` prints the result array. Exit 0 with "No matches." when empty; exit 2 on usage error.
The Dockerfile copies `bin/` and symlinks `/usr/local/bin/vault-search`.

Agents are told to use it: a "Search the vault before you answer" section in
`starter-kit/root/AGENTS.md`, and the same few lines added by hand to the six live area
`CLAUDE.md` files.

### `hooks/vault-recall.js` (Claude `UserPromptSubmit`)

Reads the hook JSON from stdin (`prompt`, `cwd`). Does nothing when the prompt starts with `/`,
or has fewer than 3 meaningful tokens. Otherwise searches articles (board taken from `cwd`
relative to the vault) with `limit: 3`, `minCoverage: 0.5`. With hits, prints:

```
## Possibly relevant from the Knowledge Base (auto-recalled)
- **<title>** — `<path>` (updated <date>): <TL;DR, ≤ 300 chars>
_Open a file if it bears on the request; ignore these if not._
```

Any error → print nothing, exit 0. Registered with `timeout: 5`. It runs in place from the app's
`hooks/` folder (`node /app/hooks/vault-recall.js` in the image), so it requires
`../lib/search.js` relatively and is never copied into `~/.claude`.

**Workspace isolation.** Development happens in a git worktree (`/opt/vault/board-search`,
branch `vault-search`), because the live container bind-mounts `server.js`, `lib/` and
`public/` from `/opt/vault/board`.

### Installer (`lib/agents.js`)

`installClaudeHook` already copies `vaultos-state.js` into `~/.claude/hooks` and registers it.
It is extended to also:

- register `node <ROOT>/hooks/vault-recall.js` on `UserPromptSubmit` once (matched by the
  `vault-recall.js` substring, so re-runs never duplicate);
- set `cleanupPeriodDays: 36500` only when the key is absent (a user's own value wins).

It still returns whether anything changed. The host's `/root/.claude/settings.json` gets
`cleanupPeriodDays` by hand.

### "Search for this" in articles

- Template (`starter-kit/board/_tasks/_Templates/article.md` and the six live copies): a
  `search: []` frontmatter line, commented: the questions and terms someone would type to
  find this.
- `/done` (starter kit `.claude/commands`, `.cursor/commands`, `.vaultos/guides`, and the live
  vault's `.claude/commands/done.md`): fill `search:` with 3–6 entries — at least two natural
  questions plus the exact error strings, commands or identifiers a searcher would paste.

## Error handling

- Unreadable or unparsable files are skipped, never fatal.
- The hook can never block or fail a prompt.
- `/api/kb` falls back to the current substring filter if the index throws, and logs it.

## Testing

`node --test`, new files `test/search.test.js`, `test/vault-recall.test.js`, plus additions to
`agents.test.js` and the server KB tests:

- tokenize: case, punctuation, stopwords, plural folding, numbers kept.
- ranking: title beats body; `search:` beats body; more matched terms beat fewer; recency breaks
  a near tie but not a large gap; article boost; board boost; kind filter; minCoverage.
- cache: edited file re-read, deleted file dropped, unchanged file not re-read.
- hook: silent for slash commands, short prompts, no-match prompts and bad JSON; prints the
  block for a good match; exit code always 0.
- installer: adds the recall hook and `cleanupPeriodDays` once; leaves an existing
  `cleanupPeriodDays` alone; second run reports no change.
- `/api/kb?q=` returns score order and finds a multi-word query whose words are not adjacent.

## Deployment

1. Tag the running image `vault-board:pre-search`.
2. `docker compose up -d --build board` (Dockerfile and `bin/` changed).
3. In the container: `vault-search` on a known topic; pipe a sample prompt into the hook; check
   `~/.claude/settings.json`.
4. Browser check of the KB search box.
