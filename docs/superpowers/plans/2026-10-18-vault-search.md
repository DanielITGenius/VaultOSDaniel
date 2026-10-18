# Vault Search and Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ranked BM25 + recency search over the vault, used by the KB search box, a `vault-search` CLI for any agent, and a Claude prompt hook that recalls matching articles.

**Architecture:** One pure module `lib/search.js` (index with mtime cache) is the only search engine. `server.js` `/api/kb`, `bin/vault-search.js` and `hooks/vault-recall.js` are thin callers. `lib/agents.js` `installClaudeHook` registers the recall hook and `cleanupPeriodDays`.

**Tech Stack:** Node 22, CommonJS, `node:test`, Express 5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-vault-search-design.md`

## Global Constraints

- No new npm dependencies.
- Weights: title 3, search 3, stack+tickets 2, tldr 2, body 1. BM25 k1 = 1.2, b = 0.75.
- Recency multiplier `1 + 0.3 * 0.5 ^ (ageDays / 180)`; article × 1.15; same board × 1.2.
- Hook: `limit: 3`, `minCoverage: 0.5`, skip prompts starting `/` or with < 3 meaningful tokens, `timeout: 5`, always exit 0.
- `cleanupPeriodDays: 36500` only when absent.
- Work only in `/opt/vault/board-search` (branch `vault-search`); never edit `/opt/vault/board` until merge.
- Match surrounding style: `'use strict'`, 2-space indent, short comments explaining why.

## Review Focus

1. Frontmatter `search:` given as a plain string, or `stack:` as a string — must still index (test in Task 1).
2. A query of only stopwords/punctuation (`"the a ?"`) — returns `[]`, not a crash or every doc (Task 1).
3. File deleted between walk and read — skipped silently (Task 1 cache test deletes a file).
4. Hook stdin that is empty or not JSON, or `cwd` outside the vault — silent, exit 0 (Task 3).
5. KB search on a workspace whose article has no TL;DR and no frontmatter `title` — still ranked, title falls back to folder name (Task 2).

---

### Task 1: Search engine `lib/search.js`

**Files:**
- Create: `lib/search.js`
- Test: `test/search.test.js`

**Interfaces:**
- Produces:
  - `tokenize(text: string) -> string[]`
  - `createIndex(vaultDir: string) -> { search(query: string, opts?: { kind?: string|string[], board?: string, under?: string, limit?: number, minCoverage?: number }) -> Promise<Result[]> }`
  - `Result = { path, kind: 'article'|'task'|'note', board, title, date: 'YYYY-MM-DD'|'', score: number, coverage: number, snippet: string }`. `path` is vault-relative with `/`. `under` restricts to paths starting with that vault-relative prefix (used for workspaces).
- Frontmatter: reuse a minimal parser inside `lib/search.js` (YAML `key: value`, inline `[a, b]` lists, quoted strings). Do not import from `server.js`.

- [ ] **Step 1: Write failing tests** in `test/search.test.js` using a temp vault (`fs.mkdtempSync`) seeded with small files:
  - `tokenize('The SDProp runs, every 60 minutes!')` deep-equals `['sdprop', 'run', 'every', '60', 'minute']`.
  - `tokenize('the a ?')` → `[]`; and `search('the a ?')` → `[]`.
  - title beats body: doc A title "Safeguard connection", doc B body mentions safeguard connection once → A first.
  - `search:` beats body: doc with `search: [why sdprop resets acl]` outranks doc mentioning both words in body.
  - more matched terms beat fewer.
  - recency breaks a near tie: two identical-body docs, `updated: 2026-10-01` vs `updated: 2024-01-01` → newer first; but an old doc with the term in the title still beats a new doc with it once in the body.
  - kind filter `kind: 'article'` returns only `article.md` files; `Board.md` and `_Templates/article.md` never appear.
  - board boost: same doc in `Personal/` and `Sucden/`, `board: 'Sucden'` → Sucden first.
  - `minCoverage: 0.5` drops a doc matching 1 of 3 query terms.
  - `stack: OpManager` (string) and `search: "single phrase"` (string) both searchable.
  - snippet: article snippet equals its TL;DR text without the `> **TL;DR**` marker; note snippet is the first line containing a query term, ≤ 240 chars.
  - cache: after a first search, edit a file (change text and bump mtime with `fs.utimesSync`) → new text found; delete a file → it disappears; no throw.

- [ ] **Step 2: Run** `node --test test/search.test.js` — expect FAIL (`Cannot find module '../lib/search'`).

- [ ] **Step 3: Implement `lib/search.js`.** Stopwords: a fixed list of ~60 common English words (articles, pronouns, auxiliaries, prepositions, `how what why when where which who`). Plural fold: strip one trailing `s` when length > 3 and not ending `ss`. TL;DR = text of the blockquote line(s) starting `> **TL;DR**`, marker and leading `—`/`:` stripped. Body for weighting excludes the TL;DR. Walk skips names starting `.`, `node_modules`, `_Templates`, files named `Board.md`. Scoring per spec:

```
idf(t) = ln(1 + (N - df + 0.5) / (df + 0.5))
tf'(t,d) = Σ_field weight_f · count_f(t)
len'(d) = Σ_field weight_f · len_f(d);  avg = mean len'
bm25 = Σ_t idf · tf'·(k1+1) / (tf' + k1·(1 − b + b·len'/avg))
score = bm25 · recency · (article ? 1.15 : 1) · (board match ? 1.2 : 1)
```

  Age in days from `updated`, else `created`, else mtime, relative to `Date.now()`; future dates count as age 0. Docs with bm25 = 0 are dropped. Sort score desc, then path.

- [ ] **Step 4: Run** `node --test test/search.test.js` — PASS. Also time a run against the real vault: `node -e "const s=require('./lib/search');const i=s.createIndex('/opt/vault/vault');console.time('cold');i.search('safeguard connection').then(r=>{console.timeEnd('cold');console.time('warm');return i.search('sdprop')}).then(r=>{console.timeEnd('warm');console.log(r[0])})"` — expect cold < 500 ms, warm < 100 ms, a sensible top hit.

- [ ] **Step 5: Commit** `git add lib/search.js test/search.test.js && git commit -m "Search: BM25 + recency index over the vault"`

### Task 2: Ranked `/api/kb?q=`

**Files:**
- Modify: `server.js` (`/api/kb` handler ~line 1553; add one module-level `const searchIndex = createIndex(VAULT_DIR)`)
- Modify: `public/app.js` (KB dashboard sort ~line 1298: apply the `updated` sort only when `STATE.kb.query` is empty)
- Test: add to an existing server test file that seeds a vault (`test/server-boot.test.js` pattern: `setup`, `start`, `login`, `seedVault`), or new `test/server-kb-search.test.js` using the same helpers.

**Interfaces:**
- Consumes: `createIndex(vaultDir).search(q, { kind: 'article', under: <workspace dir relative to vault> + '/' })` from Task 1.

- [ ] **Step 1: Write failing test** `kb search ranks by relevance and matches non-adjacent words`: seed one board with three `article.md` files — A title "Safeguard AD connection test", B body "the connection to safeguard was slow", C unrelated. `GET /api/kb?ws=<key>&q=safeguard test connection` → `articles.map(a => a.path)` starts with A, includes B, excludes C. Second assertion: article with no frontmatter `title` and no TL;DR is found by a body word and its `title` is its folder name.
- [ ] **Step 2: Run** — FAIL (C excluded passes but order/inclusion of B fails under substring match).
- [ ] **Step 3: Implement.** When `q` is set: call the index, map result paths to the scanned `articles` (keep the existing objects so the response shape is unchanged), in score order. On a thrown error, `console.error` and fall back to the existing substring filter.
- [ ] **Step 4: Run** `npm test` — all PASS.
- [ ] **Step 5: Commit** `git commit -am "KB search: ranked by BM25 + recency"`

### Task 3: `vault-search` CLI and recall hook

**Files:**
- Create: `bin/vault-search.js` (executable, `#!/usr/bin/env node`)
- Create: `hooks/vault-recall.js`
- Modify: `Dockerfile` (`COPY bin ./bin` and `RUN ln -s /app/bin/vault-search.js /usr/local/bin/vault-search` before `USER`), `docker-compose.yml` (no change needed; image rebuild)
- Test: `test/vault-recall.test.js` (covers both, via `child_process.spawnSync` with `VAULT_DIR` set to a temp vault)

**Interfaces:**
- Consumes: `createIndex`, `tokenize` from Task 1.
- Produces: `hooks/vault-recall.js` exports `recall({ prompt, cwd }, vaultDir) -> Promise<string>` (empty string = say nothing) and runs as a script when `require.main === module` (read stdin, print, exit 0). The CLI is script-only.

- [ ] **Step 1: Write failing tests:**
  - CLI: `vault-search safeguard connection --kind article --limit 1` prints a block whose first line contains the article's title and `[article · <date>]`, second line its path. `--json` output parses to an array of length ≤ limit with `path`, `score`. No args → exit 2. A no-hit query → stdout `No matches.`, exit 0.
  - Hook `recall`: prompt `/done` → `''`; prompt `fix it` → `''`; prompt with no good match → `''`; prompt `why does safeguard connection test fail` with a matching article → output starts `## Possibly relevant from the Knowledge Base (auto-recalled)`, contains `` `<path>` `` and ends with the `_Open a file…_` line; TL;DR in output ≤ 300 chars.
  - Hook script: stdin `not json` → exit 0, empty stdout; stdin empty → exit 0; `cwd` outside the vault → still works (no board boost).
- [ ] **Step 2: Run** `node --test test/vault-recall.test.js` — FAIL (missing files).
- [ ] **Step 3: Implement both.** Hook: board = first segment of `path.relative(vaultDir, cwd)` when it does not start with `..`. Meaningful tokens = `tokenize(prompt).length`. Search `{ kind: 'article', board, limit: 3, minCoverage: 0.5 }`. Exact output lines per spec. Wrap everything in try/catch → `''`. `VAULT_DIR` default `/vault` in both.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `git add bin hooks/vault-recall.js test/vault-recall.test.js Dockerfile && git commit -m "vault-search CLI and Claude recall hook"`

### Task 4: Installer registers recall hook and session retention

**Files:**
- Modify: `lib/agents.js` (`installClaudeHook`)
- Modify: `server.js` `ensureClaudeHook` (~line 1409): pass `path.join(ROOT, 'hooks', 'vault-recall.js')`
- Test: `test/agents.test.js`

**Interfaces:**
- Produces: `installClaudeHook(home, hookSrc, recallScript?) -> Promise<boolean>`. When `recallScript` is given, ensure one `UserPromptSubmit` group with `{ type: 'command', command: \`node "${recallScript}"\`, timeout: 5 }`, detected by the substring `vault-recall.js`. Always ensure `cleanupPeriodDays` exists (36500 when absent). Existing two-argument callers keep working.

- [ ] **Step 1: Write failing tests:**
  - `installClaudeHook registers the recall hook once`: with `recallScript`, `UserPromptSubmit` has 2 groups (state + recall); a second call returns `false` and the file is byte-identical.
  - `installClaudeHook sets cleanupPeriodDays only when absent`: fresh → `36500`; pre-seeded `cleanupPeriodDays: 90` → stays `90`.
  - Update the existing idempotency test if needed (it should still pass unchanged).
- [ ] **Step 2: Run** `node --test test/agents.test.js` — FAIL.
- [ ] **Step 3: Implement**, then update `ensureClaudeHook`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `git commit -am "Installer: recall hook and keep sessions"`

### Task 5: Starter kit and agent instructions

**Files:**
- Modify: `starter-kit/root/AGENTS.md` (new section "Search the vault before you answer", after "Working on a task")
- Modify: `starter-kit/board/_tasks/_Templates/article.md` (add after `tickets:`: `search: []             # questions and terms someone would type to find this`)
- Modify: `starter-kit/root/.claude/commands/done.md`, `starter-kit/root/.cursor/commands/done.md`, `starter-kit/root/.vaultos/guides/done.md` (frontmatter bullet for `search`)
- Test: `npm test` (`starter-kit.test.js` must still pass)

AGENTS.md section copy (exact):

```markdown
## Search the vault before you answer

Before answering a question or starting a job, search what is already known:

    vault-search <words>                 # ranked: newer and curated first
    vault-search <words> --kind article  # Knowledge Base articles only

Open the top hits that bear on the request. Prefer an article's findings over older task notes, and newer over older when they disagree.
```

`/done` bullet (exact, insert after the `tickets` bullet):

```markdown
  - `search` — 3–6 entries someone would type to find this later: at least two natural questions ("why does OU delegation skip Domain Admins") plus exact error strings, commands or identifiers worth pasting. Search ranks these as highly as the title.
```

- [ ] **Step 1:** Make the edits.
- [ ] **Step 2: Run** `npm test` — PASS; `grep -c "search:" starter-kit/board/_tasks/_Templates/article.md` → 1.
- [ ] **Step 3: Commit** `git commit -am "Starter kit: search before answering, search: field in articles"`

### Task 6: Deploy and live vault

Not code; done by the session after review and merge.

- [ ] **Step 1:** Merge `vault-search` into `main` in `/opt/vault/board`; `docker tag vault-board:latest vault-board:pre-search` (check the actual image name with `docker inspect vault-board --format '{{.Config.Image}}'`).
- [ ] **Step 2:** `cd /opt/vault && docker compose up -d --build board`; wait for healthy.
- [ ] **Step 3:** Verify in container: `docker exec vault-board vault-search sdprop protected accounts --limit 3` (top hit is the adminSDHolder article); `docker exec vault-board sh -c 'echo "{\"prompt\":\"why does delegation skip domain admins\",\"cwd\":\"/vault/Lancashire\"}" | node /app/hooks/vault-recall.js'` prints the block; `~/.claude/settings.json` has one recall entry.
- [ ] **Step 4:** Live vault edits (not in git): add the `search: []` line to the six `<Board>/_tasks/_Templates/article.md`, the `/done` bullet to `/opt/vault/vault/.claude/commands/done.md`, and the AGENTS.md section text to the six area `CLAUDE.md` files.
- [ ] **Step 5:** Browser check of KB search on :7684 (claude-in-chrome): a multi-word query returns ranked results.
- [ ] **Step 6:** Board cards: F (index past sessions), G (connectors), `search:` backfill — via `/new-task`.
