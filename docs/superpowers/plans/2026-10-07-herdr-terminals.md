# Terminal Spaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild VaultOS's terminal workspace in herdr's style, for both the dock and the pop-out window plus a phone view:
- a sidebar of spaces (each Board task, otherwise each folder) and of agents, sorted by priority;
- a split tree with zoom inside each space;
- a Go-to picker, a Ctrl+Space prefix keymap with a `?` sheet, and toasts.

**Architecture:**
- Five new front-end modules sit around a rewritten `termui.js` core. Each is an IIFE exposing one global, loaded by both `index.html` and `terminal.html`. Pure layout and model logic lives in `termtree.js` (UMD, unit-tested).
- The sidebar is a view over `/api/term/list` merged with what this page holds, plus BroadcastChannel presence.
- The server gains task title, status and auto-link, and the git branch, through a new `lib/term-meta.js`. The frontend degrades gracefully without them.

**Tech Stack:**
- Vanilla JS, no build step. xterm.js 6 (WebGL, fit, unicode11, web-links).
- Express 5, node-pty, ws.
- `node:test` for unit tests. puppeteer 25 and host Chrome 152 for e2e.

**Spec:** `docs/superpowers/specs/2026-10-07-herdr-terminals-design.md`. Read it first; this plan argues from it.

## Global Constraints

- **Where you work:**
  - Repo: worktree `/opt/vault/board-herdr`, branch `herdr-terminals`.
  - Preview: container `herdr-term-preview` at `http://127.0.0.1:7690` only.
  - **Never run e2e against `:7684`.** It would steal Ben's live sessions.
  - **Never restart, rebuild or exec into `vault-board`.** Only Task 13 touches it, and only with Ben's OK.
- **Module rules:**
  - Each new module is an IIFE that exposes exactly one global: `TermTree`, `createTermSide`, `createTermPicker`, `installTermKeys`, `TermToast`.
  - No new top-level `const`/`let`/`function` names except those globals. `app.js:136` already has `esc`, and a clash is a SyntaxError that silently kills later scripts.
  - Nothing in `term*.js` may reference `app.js` or `workbench.js` globals.
  - Keep `TW_AGENT_TEXT`, `TW_STATE_TEXT`, `twNewId`, `twGet`, `twSet` and `twEsc` as globals in `termui.js`.
- **Load order** in `public/index.html` and `public/terminal.html`:
  1. vendor xterm
  2. `term.js`
  3. `termtree.js`
  4. `termside.js`
  5. `termpick.js`
  6. `termkeys.js`
  7. `termtoast.js`
  8. `termui.js`
  9. then `app.js` … `workbench.js` (index.html only)
- **CSS:**
  - Tokens only, never a hex value.
  - Agent marks:
    - blocked: `--review`, glyph `×`
    - working: `--in-progress`, glyph `◐`
    - done: `--done`, glyph `✓`
    - idle: `--muted-2`, glyph `○`
    - none: `--muted-2`, glyph `·`
  - Focused pane border: `--accent`.
  - Active space: a `--panel-2` row background with bold `--text`. Never gold for state.
  - `--brand` / `--on-brand` is for the PREFIX pill only.
  - No animations on marks.
- **Escape:**
  - Never intercepted while focus is in xterm and the prefix isn't armed.
  - Overlays take Escape on their own element with `stopPropagation()`. `app.js:1053-1059` closes the drawer on any document Escape.
- **Handoff stays backward compatible:** `window.twAdopt(metas)`, `{returned: metas}` and `localStorage['vaultboard.term.returning']` all stay arrays of `{id,n,title,cwd,task}`.
- **Unchanged:** `termCopy`/`tidySelection`/OSC 52, the xterm options and theme, the key row and compose box, and touch scroll.
- **Storage:** read and write through `twGet`/`twSet` (JSON). New keys:
  - `${store}.tree`
  - `${store}.side`
  - `vaultboard.term.spaceNames`
  - `vaultboard.term.sound`
- **Unit test command** (run in the worktree):
  ```
  docker run --rm -v "$PWD":/app -w /app node:22-bookworm-slim node --test test/termtree.test.js test/term-meta.test.js
  ```
- **E2E command:** `node scripts/term-e2e.js S<n> …`. It prints PASS/FAIL per check and exits 1 on any FAIL. Screenshots go to `/tmp/term-shots/`; look at every one you produce.
- **Server deploy:** `server.js` is a single-file bind mount, so edit it in place (Edit tool, not a rewrite that changes the inode). The preview picks it up with `docker restart herdr-term-preview`. `public/` is live with no restart.
- **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Task titles with HTML or long text** (`<b>Ops & "DNS" …` with more than 80 characters) must render as literal text and truncate with an ellipsis everywhere: sidebar, rail tooltip, top bar, picker and toast. Test in Task 7, check S2-escape.
2. **Two VaultOS tabs in one browser.** Reloading either tab must not steal sessions from the other, and there must be no code-4000 ping-pong. Test in Task 5, check S4-twotabs.
3. **The server restarting while pages are open.** Panes reconnect to fresh shells under the same ids. Spaces and trees survive, and no duplicate rows appear. Test in Task 5, check S11.
4. **A task folder moved into `_done/` while its terminal is open.** The row follows: the space rekeys, and the pane, its layout and its custom space name are kept. Tests: Task 2 unit `taskInfo relinks from _done`, and Task 5 check S2-moved.
5. **Opening a 13th terminal.** No blank pane appears, the existing panes are untouched, and a toast explains why. Tests: Task 1 unit `canOpen`, Task 5 check S12-cap (no pane), Task 10 check S12-toast.

---

### Task 0: Preview, sandbox, fake agent and e2e skeleton

**Files:**
- Create: `/opt/vault/herdr-term-preview/compose.yml` (mode 0600), `config.json`, `lockout.json`, `workspace-visibility.json`, `mint-cookie.js`, `reset.sh`, `home/`, `vault/`. These are outside the repo and never committed.
- Create: `scripts/term-sandbox.js`, `scripts/term-fake-agent.js`, `scripts/term-e2e.js`

**Interfaces:**
- Produces:
  - `node scripts/term-sandbox.js <outDir>` writes the synthetic vault (layout below).
  - `/opt/vault/herdr-term-preview/mint-cookie.js` prints one line: `board_sess=…; board_sess.sig=…`.
  - `reset.sh` wipes `vault/` and `home/`, reruns the sandbox, `chown -R 1000:1000`s both, and runs `docker restart herdr-term-preview`.
  - `node /app/scripts/term-fake-agent.js <working|blocked|done|idle>`, run inside a preview terminal, reports a state for that terminal. It stays in the foreground and prints `.` every 2s. Keys `w`/`b`/`d`/`i` switch the state; `q` exits.
  - `scripts/term-e2e.js` exports nothing. It has internal helpers that later tasks reuse, listed below.

  | Helper | Does |
  |---|---|
  | `launch()` | Browser plus a cookie-set context |
  | `page(path, {phone, theme})` | Opens a page |
  | `dock(p)` | Seeds `vaultboard.term.where="dock"` and opens the dock |
  | `win(p)` | Opens `/terminal.html` |
  | `typeIn(p, id, text)` | Calls `TW.session(id).handle.type(text)` |
  | `screen(p, id)` | Visible buffer text, via `TW.session(id).handle.term.buffer.active` |
  | `waitFor(p, fn, ms)` | Waits until `fn` is true |
  | `fake(p, id, state)` | Types `node /app/scripts/term-fake-agent.js <state>\r` |
  | `list()` | `GET /api/term/list` with the cookie |
  | `shot(p, name)` | Saves a screenshot |
  | `check(name, cond, detail)` | Prints PASS/FAIL |
  | `reset()` | Runs `reset.sh` |

  Scenarios register as `SCEN.S0 = async () => {…}`.

- [ ] **Step 1: Remove the scratch containers.** Run `docker rm -f herdr-preview vos-term-preview`. Expected: both names echoed. Never touch `vault-board`.
- [ ] **Step 2: Write `scripts/term-sandbox.js`.** Follow the style of `scripts/sheet-sandbox.js`. It writes these, with `task.md` frontmatter `title`, `status`, `priority: med`, `updated: 2026-10-07`:
  - `Personal/_tasks/Board.md`: the kanban skeleton (5 `##` columns).
  - `Personal/1. apps/01-api-refactor/task.md`: "API refactor", in-progress. Also create an empty `data/` dir.
  - `Personal/1. apps/02-web-login/task.md`: "Web login flow", in-progress.
  - `Personal/1. apps/_done/`: empty.
  - `Personal/2. platform/03-ops-dns/task.md`: title `<b>Ops & "DNS" — rebuild the internal resolver pair, move every zone and retire the old boxes</b>`, backlog.
  - `Code/DevOps/demo-repo/.git/HEAD`: `ref: refs/heads/feature-x\n`.
  - `Code/DevOps/demo-wt/.git`: a file containing `gitdir: ../demo-repo/.git/worktrees/wt\n`.
  - `Code/DevOps/demo-repo/.git/worktrees/wt/HEAD`: `ref: refs/heads/wt-branch\n`.
- [ ] **Step 3: Write the preview files.**
  - `compose.yml`:
    - project `herdr-term-preview`, `image: vault-board:latest`, container `herdr-term-preview`, `user: "1000:1000"`, `init: true`
    - `ports: ["127.0.0.1:7690:8080"]`
    - env: `VAULT_DIR=/vault PORT=8080 SECURE_COOKIE=0 TERMINAL=1 HOME=/home/coder SHELL=/bin/bash`
    - volumes: `./vault:/vault`, `./config.json:/app/config.json:ro`, `./lockout.json:/app/lockout.json`, `./workspace-visibility.json:/app/workspace-visibility.json:ro`, `./home:/home/coder`, and `/opt/vault/board-herdr/{public,server.js,lib,scripts}` read-only over `/app/…`
  - `config.json`: built the way `set-password.js` does it, but inline with `node -e` in that folder (never run `set-password.js`, which writes the live config):
    - `salt` = 16 random bytes hex
    - `passwordHash` = scrypt(random throwaway password, salt, 64) hex
    - `sessionSecret` = 32 random bytes hex
  - `lockout.json` = `{"attempts":0,"lockedUntil":0,"lockLevel":0}`.
  - `workspace-visibility.json` = `{"personal":true}`.
  - `home/.bashrc` is copied from the image by `reset.sh`: `docker run --rm --entrypoint cat vault-board:latest /etc/skel/.bashrc > home/.bashrc`. Its xterm case sets the OSC title to `\u@\h: \w`, as the live coder home does. Without it the preview shells send no titles.
  - Ownership: uid 1000, and modes 0600 for the secret files.
- [ ] **Step 4: Write `mint-cookie.js`.**
  - value = `Buffer.from('{"authed":true}').toString('base64')`
  - signature = HMAC-SHA1(sessionSecret, `board_sess=<value>`) in base64, with `/`→`_`, `+`→`-` and `=` stripped
  - It prints the header and never writes it to disk.
- [ ] **Step 5: Write `scripts/term-fake-agent.js`.** It posts `{id: VAULTOS_TERM_ID, token: VAULTOS_TERM_TOKEN, hook_event_name, session_id: 'fake'}` to `VAULTOS_HOOK_URL`. Event map:

  | Argument | Events posted |
  |---|---|
  | `working` | `SessionStart`, then `UserPromptSubmit` |
  | `blocked` | `SessionStart`, then `PermissionRequest` |
  | `done` | `SessionStart`, then `UserPromptSubmit`, then `Stop` |
  | `idle` | `SessionStart` |

  Raw stdin, keys as described in Interfaces.
- [ ] **Step 6: Write the `scripts/term-e2e.js` skeleton and scenario S0.**
  - Copy the structure of `scripts/sheet-e2e.js`: the PUPPETEER/CHROME constants and dynamic import, plus the helpers above.
  - The base defaults to `http://127.0.0.1:7690`. Exit 2 if the base contains `:7684`.
  - S0:
    1. Open the dock.
    2. Type `echo e2e-ok\r`; check `screen` contains `e2e-ok`.
    3. Run `fake(blocked)`; check `list()` has that id with `agent.state === 'blocked'` within 5s.
- [ ] **Step 7: Start and run.**
  ```
  cd /opt/vault/herdr-term-preview && ./reset.sh && docker compose up -d
  node scripts/term-e2e.js S0
  ```
  Expected: all PASS, exit 0. Also `curl -s 127.0.0.1:7690/termui.js | diff - public/termui.js` prints nothing.
- [ ] **Step 8: Commit** `scripts/term-sandbox.js`, `scripts/term-fake-agent.js` and `scripts/term-e2e.js` with message `Terminal spaces: preview sandbox, fake agent, e2e skeleton`.

---

### Task 1: `termtree.js`, the pure layout and model

**Files:**
- Create: `public/termtree.js`. UMD as in `public/sheet-core.js:9-10`; the browser global is `TermTree`.
- Create: `test/termtree.test.js`
- Modify: `public/index.html` and `public/terminal.html`, adding `<script src="termtree.js"></script>` right after `term.js`.

**Interfaces:**
- Produces (every function is pure and never mutates its inputs):

  **Types**
  ```
  Node  = {id: string} | {dir: 'row'|'col', r: number, a: Node, b: Node}
          // row = side by side (split right); col = stacked (split down)
  Store = {v: 1, active: string|null, spaces: {[key]: {root: Node, focus: string|null, zoom: string|null}}}
  ```

  **Split tree**

  | Signature | Notes |
  |---|---|
  | `leaves(node) → string[]` | |
  | `insert(root\|null, newId, {target, dir}) → Node` | |
  | `insertLargest(root\|null, newId, {w, h, focus}) → Node` | |
  | `remove(root, id) → Node\|null` | |
  | `layout(root) → {rects: {[id]: [x,y,w,h]}, splits: [{path, dir, x, y, w, h, r}]}` | `path` is a string of `a`/`b` steps from the root; the root split is `''`. |
  | `setRatio(root, path, r) → Node` | Clamps to [0.12, 0.88]. |
  | `neighbour(rects, id, 'left'\|'right'\|'up'\|'down') → string\|null` | |
  | `reconcile(root\|null, heldIds, {w, h, focus}) → Node\|null` | |
  | `tooSmall(rects, wPx, hPx, minW = 140, minH = 70) → boolean` | |
  | `parseStore(raw: string\|null) → Store` | |
  | `rekey(store, id, fromKey, toKey, {w, h}) → {store, renamed: boolean}` | |

  **Model**

  | Signature | Notes |
  |---|---|
  | `spaceKey({task, cwd}, knownTasks: Set<string>) → string` | |
  | `rows(list\|null, held, presence) → Row[]` | `held` is a `Map<id, {meta: {id,n,title,cwd,task}, osc, agent}>`; `presence` is a `Map<id, 'window'\|'dock'\|'tab'>`. |
  | `spaces(rows, names) → Space[]` | `names` is `{[key]: string}`. |
  | `rollup(states) → 'blocked'\|'done'\|'working'\|'idle'\|''` | |
  | `agentOrder(rows) → Row[]` | |
  | `paneTitle({title, osc, cmd}) → string` | |
  | `observe(memo: Map, id, agent\|null) → {id, state, since}\|null` | |
  | `nextNeedingYou(rows, currentId) → string\|null` | |
  | `canOpen(list, max = 12) → boolean` | |
  | `STATUS_WORD` | `{backlog:'backlog', 'in-progress':'in progress', blocked:'blocked', 'needs-decision':'needs decision', review:'review', scheduled:'scheduled', done:'done'}` |

  ```
  Row   = {id, n, key, title, osc, cmd, cwd, task, agent, where, idleSince, taskTitle, taskStatus, taskMissing, branch}
          // where: 'here'|'window'|'dock'|'tab'|'elsewhere'|'detached'
  Space = {key, num, name, detail, rollup, ids: string[], heldIds: string[], dim: boolean}
  ```

- [ ] **Step 1: Write the failing tests** in `test/termtree.test.js`, using `node:test` and `assert/strict`. Shared fixture: `T = {dir:'row', r:0.5, a:{id:'a'}, b:{dir:'col', r:0.25, a:{id:'b'}, b:{id:'c'}}}`.
  - **`insert splits right and down`**
    - `insert(null,'a',{})` deepEqual `{id:'a'}`
    - `insert({id:'a'},'b',{target:'a',dir:'row'})` deepEqual `{dir:'row',r:0.5,a:{id:'a'},b:{id:'b'}}`
    - inserting `'d'` with `dir:'col'` at target `'c'` inside `T` → `leaves` gives `['a','b','c','d']`, and the node holding c and d has `dir === 'col'`
  - **`layout gives fractions and split paths`**
    - `layout(T).rects` deepEqual `{a:[0,0,0.5,1], b:[0.5,0,0.5,0.25], c:[0.5,0.25,0.5,0.75]}`
    - `splits[0]` deepEqual `{path:'',dir:'row',x:0,y:0,w:1,h:1,r:0.5}`
    - `splits[1].path === 'b'`
  - **`insertLargest splits the biggest pane along its longer side`**
    - wide case: in a 1600×400 area, `insertLargest(null,'a')`, then `'b'` → root `dir === 'row'`
    - tie-break: then `'c'` with `focus:'b'` → c sits in b's half
    - tall case: in a 400×900 area, the first split is `'col'`
  - **`remove promotes the sibling`**
    - `remove(T,'b')` deepEqual `{dir:'row',r:0.5,a:{id:'a'},b:{id:'c'}}`
    - `remove({id:'a'},'a') === null`
    - `T` itself is unchanged afterwards (deepEqual a fresh copy)
  - **`setRatio clamps and is pure`**
    - `setRatio(T,'',0.95).r === 0.88`
    - `setRatio(T,'b',0.01).b.r === 0.12`
    - `T.r === 0.5` still
  - **`neighbour picks the largest shared edge`**, with `R = layout(T).rects`:
    - `neighbour(R,'a','right') === 'c'` (overlap 0.75 beats 0.25)
    - `neighbour(R,'c','up') === 'b'`
    - `neighbour(R,'b','left') === 'a'`
    - `neighbour(R,'a','left') === null`
  - **`reconcile drops unheld and adds held`**
    - `new Set(leaves(reconcile(T,['a','c','d'],{w:1600,h:400,focus:'a'})))` deepEqual `new Set(['a','c','d'])`
    - `reconcile(T,[],{}) === null`
  - **`tooSmall`**
    - `tooSmall({a:[0,0,0.05,1]},1600,400) === true`
    - `tooSmall({a:[0,0,0.5,1]},1600,400) === false`
  - **`parseStore rejects junk`**
    - `parseStore('nope')` and `parseStore(null)` both deepEqual `{v:1,active:null,spaces:{}}`
    - a store whose space root is `{dir:'row',r:0.5,a:{id:'a'}}` (no `b`) → that space is dropped
    - a valid one with `r: 2` → `r` clamped to 0.88
    - `active` that names a missing space → `null`
  - **`rekey moves a leaf or renames the whole space`**
    - store `{v:1,active:'d:P/x',spaces:{'d:P/x':{root:{id:'1'},focus:'1',zoom:null}}}`, `rekey(...,'1','d:P/x','t:P/x/task.md',{w:800,h:400})`:
      - result spaces keys deepEqual `['t:P/x/task.md']`
      - `active === 't:P/x/task.md'`
      - `renamed === true`
    - with `{dir:'row',r:0.5,a:{id:'1'},b:{id:'2'}}` and only `'1'` moving: both keys exist, `renamed === false`
  - **`spaceKey: task first, then cwd, with the join rule`**
    - `spaceKey({task:'P/1/x/task.md',cwd:'P/1/x'}, new Set()) === 't:P/1/x/task.md'`
    - `spaceKey({task:'',cwd:'P/1/x'}, new Set(['P/1/x/task.md'])) === 't:P/1/x/task.md'`
    - `spaceKey({task:'',cwd:'P/1/x/data'}, new Set(['P/1/x/task.md'])) === 'd:P/1/x/data'` (the join rule needs equal folders)
    - `spaceKey({cwd:''}, new Set()) === 'd:'`
  - **`rows: where each session is`**
    - `list = [{id:'1',attached:true},{id:'2',attached:true},{id:'3',attached:false},{id:'4',attached:true}]`, `held` has `'1'` and `'9'`, `presence = new Map([['2','window'],['3','dock']])`
    - `where` by id: 1 `here`, 2 `window`, 3 `detached` (presence ignored when not attached), 4 `elsewhere`, 9 `here`
    - output order: `['1','2','3','4','9']` (the server list first, then held-only)
    - `rows(null, held, presence)` returns the held rows only
  - **`spaces: grouping, order, naming, detail, rollup, dim`**, using rows built from the sandbox paths:
    - `taskTitle: 'API refactor'`, status `in-progress` → `{num:1, name:'API refactor', detail:'in progress'}`
    - the same task with no `taskTitle` → name `'01-api-refactor'`
    - `taskMissing: true` → detail `'task moved'`
    - cwd `Code/DevOps/demo-repo` with `branch: 'feature-x'` → name `'demo-repo'`, detail `'feature-x'`
    - cwd `Code/DevOps/x` with no branch → detail `'Code/DevOps'`
    - two rows with cwd `''` → name `'vault'`, detail `'2 terminals'`
    - `names['t:…'] = 'Auth'` → name `'Auth'`
    - a space whose only row is detached → `dim === true`, detail ends with `' · 1 detached'`
    - rollup of a space with a working agent and a blocked agent → `'blocked'`
  - **`rollup`**
    - `rollup(['idle','working','done']) === 'done'`
    - `rollup(['working','blocked']) === 'blocked'`
    - `rollup([]) === ''`
  - **`agentOrder`**
    - order is blocked, done, working, idle
    - within the same state, newer `since` comes first
    - rows with `agent: null` are excluded
  - **`paneTitle`**

    | Input | Output |
    |---|---|
    | `{title:'logs'}` | `'logs'` |
    | `{osc:'coder@vault-workbench: /vault/Personal/1. apps/01-api-refactor', cmd:''}` | `'shell · 01-api-refactor'` |
    | the same with `cmd:'npm'` | `'npm · 01-api-refactor'` |
    | `{osc:'✳ Fix the login bug'}` | `'Fix the login bug'` |
    | `{osc:'⠂ Claude Code'}` | `'Claude Code'` |
    | `{cmd:'claude'}` | `'claude'` |
    | `{}` | `'shell'` |

  - **`observe fires once per new blocked or done`**, with `m = new Map()`:
    1. `(m,'1',{state:'blocked',since:10})` → `null` (baseline)
    2. `{state:'working',since:20}` → `null`
    3. `{state:'blocked',since:30}` → deepEqual `{id:'1',state:'blocked',since:30}`
    4. the same again → `null`
    5. `{state:'done',since:25}` → `null` (older)
    6. `(m,'2',null)` → `null`
  - **`nextNeedingYou cycles blocked oldest first, then done`**
    - rows: a (blocked, since 5), b (blocked, since 3), c (done, since 1), d (working)
    - `(rows,null) === 'b'`, `(rows,'b') === 'a'`, `(rows,'a') === 'c'`, `(rows,'c') === 'b'`
    - with no blocked or done rows → `null`
  - **`canOpen`**
    - 11 attached → `true`
    - 12 attached with `cmd:'bash'` busy → `false`
    - 12 where one has `attached:false, cmd:''` → `true`
    - 12 where the detached one has `cmd:'claude'` → `false`
- [ ] **Step 2: Run the tests to verify they fail.** Run the unit test command with only `test/termtree.test.js`. Expected: FAIL with `Cannot find module '../public/termtree'`.
- [ ] **Step 3: Implement `public/termtree.js`.**
  - `insertLargest`: compute `layout` and pick the leaf with the largest `w·W × h·H`; ties go to `focus`, then the first leaf. Split it as `'row'` when `w·W ≥ h·H`, else `'col'`. The new leaf goes in `b`.
  - `neighbour`: candidates touch the edge within 1e-6 and overlap on the other axis by more than 0. Pick the largest overlap; ties go to `leaves` order.
  - `paneTitle`:
    - strip leading characters matching `/^[^\p{L}\p{N}]+\s*/u`;
    - a bash title matching `/^[^@\s]+@[^:\s]+:\s*(.+)$/` becomes `<cmd||'shell'> · <basename of the path>`.
  - `spaces`:
    - order by first appearance in `rows`;
    - detail for a task space: `STATUS_WORD[taskStatus]`;
    - detail for a dir space: `branch`, else the parent path, else `N terminal(s)`;
    - then add ` · N detached` and/or ` · N elsewhere` for rows where `where !== 'here'`.
- [ ] **Step 4: Run the tests to verify they pass.** Expected: every `termtree` test passes.
- [ ] **Step 5: Add the script tag** to both HTML files, after `term.js`. Check: `curl -s 127.0.0.1:7690/ | grep -c termtree.js` → `1`, and the page console shows no errors (`node scripts/term-e2e.js S0` still passes).
- [ ] **Step 6: Commit** with message `Terminal spaces: termtree split tree + space model with tests`.

---

### Task 2: Server: task title, status, auto-link and branch

**Files:**
- Create: `lib/term-meta.js`, `test/term-meta.test.js`
- Modify: `server.js`
  - upgrade handler `:2246-2262`: auto-link
  - `/api/term/list` `:2271-2282`: new fields
  - the message at `:2189`: "terminal bar" becomes "terminal sidebar"

**Interfaces:**
- Produces (`lib/term-meta.js`, CommonJS):
  - `findJobTask(cwdFull, {vaultDir, wsDirs: string[], skipDirs: Set<string>}) → Promise<string>`. Returns a vault-relative `…/task.md` or `''`.
  - `createTaskInfo({vaultDir, parseFrontmatter, statuses}) → (taskRel) → Promise<{task, title, status, missing}>`. Caches by mtime.
  - `createGitBranch({vaultDir, ttlMs = 10000}) → (cwdFull) → Promise<string>`.
  - `/api/term/list` sessions gain `taskTitle`, `taskStatus`, `taskMissing` (booleans and strings, empty when n/a) and `branch`.

- [ ] **Step 1: Write the failing tests.** Fixtures are built in `fs.mkdtempSync`, mirroring the sandbox (`Personal/1. apps/01-api-refactor/{task.md,data/}`, `Code/DevOps/demo-repo/.git/HEAD`, the worktree `.git` file).

  **`findJobTask`**

  | Test | Input | Expected |
  |---|---|---|
  | finds the task from the job folder | `Personal/1. apps/01-api-refactor` | `'Personal/1. apps/01-api-refactor/task.md'` |
  | finds it from a skipped subfolder | `…/01-api-refactor/data` | the same |
  | stays inside a workspace | `Personal`, or `Personal/1. apps` | `''` |
  | ignores non-workspaces | `Code/DevOps/demo-repo` | `''` |
  | ignores dot folders | `…/01-api-refactor/.cache` | the same task (it walks past `.cache`) |

  **`taskInfo`**

  | Test | Setup | Expected |
  |---|---|---|
  | reads title and status | the API refactor task | `{task:<same>, title:'API refactor', status:'in-progress', missing:false}` |
  | rejects unknown status | `status: wibble` | `status === ''` |
  | relinks from `_done` | move the folder to `Personal/1. apps/_done/01-api-refactor/` | `task === 'Personal/1. apps/_done/01-api-refactor/task.md'`, `missing === false` |
  | missing | delete it | `{missing:true, task:<original>}` |
  | mtime cache | edit the title, bump mtime | the new title is returned |

  **`gitBranch`**

  | Test | Input | Expected |
  |---|---|---|
  | branch from HEAD | `Code/DevOps/demo-repo` and a subfolder | `'feature-x'` |
  | worktree `gitdir` file | `Code/DevOps/demo-wt` | `'wt-branch'` |
  | detached HEAD | HEAD = 40-hex sha | its first 7 characters |
  | no repo | `Personal` | `''` |

- [ ] **Step 2: Run the tests to verify they fail.** Expected: FAIL, `Cannot find module '../lib/term-meta'`.
- [ ] **Step 3: Implement `lib/term-meta.js`.** Use `fs.promises`.
  - `findJobTask`: the candidate dir must be strictly inside one of `wsDirs`. Skip a candidate whose vault-relative path has a segment in `skipDirs` or starting with `.`. Return the first dir whose `task.md` is a file.
  - `taskInfo`: on ENOENT, try `<grandparent>/_done/<job>/task.md`, then `<grandparent>/_cancelled/<job>/task.md`.
  - `gitBranch`: stop at `vaultDir`.
- [ ] **Step 4: Run the tests to verify they pass.**
- [ ] **Step 5: Wire it into `server.js`.**
  - Require the module beside the other `./lib` requires (`:1712`). Build `taskInfo` with the server's `parseFrontmatter` and `STATUSES`, and `gitBranch` with `VAULT_DIR`.
  - `wsDirs = Object.values(WORKSPACES).map((w) => path.join(VAULT_DIR, w.dir))`.
  - Upgrade handler: after `task` is resolved, add `if (!task && !TERMS.has(id)) { try { task = await findJobTask(cwd, {vaultDir: VAULT_DIR, wsDirs, skipDirs: SKIP_DIRS}); } catch {} }`.
  - `/api/term/list`: make the handler async. Per session, wrap each field in its own try/catch:
    - `const info = t.task ? await taskInfo(t.task) : null`
    - if `info && info.task !== t.task`, set `t.task = info.task`
    - add `taskTitle: info?.title || ''`, `taskStatus: info?.status || ''`, `taskMissing: !!info?.missing`, `branch: await gitBranch(t.cwd)`
- [ ] **Step 6: Verify on the preview.**
  1. Run `docker restart herdr-term-preview`.
  2. Add e2e S0b: open a dock terminal with `TW.create({cwd:'Personal/1. apps/01-api-refactor/data'})`. Check that `list()` reports, for that id, `task === 'Personal/1. apps/01-api-refactor/task.md'`, `taskTitle === 'API refactor'` and `taskStatus === 'in-progress'`.
  3. Open one at `Code/DevOps/demo-repo` and check `branch === 'feature-x'`.

  Run `node scripts/term-e2e.js S0 S0b`. Expected: PASS.
- [ ] **Step 7: Commit** with message `Terminal spaces: server reports task title/status/branch and links terminals opened in a job folder`.

---

### Task 3: `term.js`: title, Ctrl+Space guard, real-size resize

**Files:** Modify `public/term.js`: `connect()` at `:428-436`, the key handler at `:324-352`, the returned handle at `:510-523`, plus an `onTitleChange` hook next to `term.onResize` (`:492`).

**Interfaces:**
- Produces:
  - `createTerminal(container, {…, onTitle(title: string)})`
  - `handle.title() → string`: the last OSC title, `''` until one arrives.

- [ ] **Step 1: Write the failing e2e S3a.**
  1. Open the dock with one terminal.
  2. Type `while :; do tput cols > /tmp/cols-$VAULTOS_TERM_ID; sleep 1; done\r`.
  3. Wait 2s and record `C = docker exec herdr-term-preview cat /tmp/cols-<id>`. Check that `C` is the xterm's `term.cols` and is not `80`.
  4. Hide the dock (`#term-min`), reload the page, and wait 4s with the dock still hidden.
  5. Check `docker exec … cat /tmp/cols-<id>` still equals `C`.
  6. Also check `TW.session(id).handle.title()` contains `/vault` after `cd /vault\r`. The preview's `home/.bashrc` sets the xterm title to `\u@\h: \w`; see Task 0.

  Run `node scripts/term-e2e.js S3a`. Expected: FAIL (`80` after the reload, and `title is not a function`).
- [ ] **Step 2: Implement.**
  - `connect()`: build the query with `cols`/`rows` only when `container.offsetWidth && container.offsetHeight`.
  - Key handler: first line after the `keydown` check is `if (e.ctrlKey && e.code === 'Space') return false;`. Update the comment above it to say Ctrl+Space belongs to the page.
  - `term.onTitleChange((t) => { lastTitle = t; opts.onTitle && opts.onTitle(t); })`.
  - Add `title: () => lastTitle` to the handle.
- [ ] **Step 3: Run S0 and S3a.** Expected: PASS.
- [ ] **Step 4: Commit** with message `Terminal spaces: term.js reports OSC titles, leaves Ctrl+Space to the page, never resizes from a hidden pane`.

---

### Task 4: `termui.js` core: spaces, split tree, zoom, top bar, pane strips

**Files:**
- Modify (rewrite the layout half of): `public/termui.js`
  - remove `:57-58` (layout/ratios), `:142-177` (detached button), `:289-429` (dwindle, tabs, Tile)
  - keep `:441-505` (key row and compose box) and the agent/seen logic at `:115-134`
- Modify: `public/styles.css`. Add a new `/* Terminal spaces */` section for `.tw-main`, `.tw-bar`, `.tw-pane`, `.tw-pane-strip`, `.tw-split`, `.tw-menu`, `.tw-off`. Leave the old rules for Task 11.

**Interfaces:**
- Consumes:
  - `TermTree.*` (Task 1)
  - `handle.title()` and `opts.onTitle` (Task 3)
- Produces: `createTermWorkspace(root, opts)`.
  - New opts:
    - `host: 'dock'|'window'` (default `'dock'`)
    - `sideDefault: 'rail'|'side'`
    - `goElsewhere(id) → boolean`
  - DOM: `root` > `.tw-side` (empty until Task 7) + `.tw-main` > `.tw-bar`, `.tw-panes`, `.tw-modebar[hidden]`, `.tw-compose`, `.tw-keys`.
  - Bar contents: `.tw-space-name`, `.tw-space-detail`, `.spacer`, then buttons `[data-act="split-right"]`, `[data-act="split-down"]` and `[data-act="zoom"]` (`aria-pressed`), then the existing `.tw-zoom` font segment, then `extraButtons`.
  - Each pane `.tw-pane[data-id]` holds `.tw-pane-strip`, `.term-host` and `.term-note`. The strip contains `.tw-mark[data-agent]`, `.tw-pane-name` and `button.tw-pane-more` (⋯).
  - Menu `.tw-menu` items, `data-m` = `rename|split-right|split-down|zoom|close`.
  - Internal state: `W.sessions` (held, each `{id,n,title,cwd,task,key,osc,handle,pane,state,agent}`), and `W.store` (a `Store` saved under `${store}.tree`).
  - API: everything existing, plus:
    - `create(o)` accepts `{split:'right'|'down', target}`
    - `focus(id)` activates the space
    - `activeSpace() → key`
    - `split(dir)`
    - `toggleZoom()`
    - `focusDir(dir)`
    - `spaceKeys() → string[]`, in sidebar order: held spaces in first-seen order until Task 5 adds list order
    - `showSpace(key)`

- [ ] **Step 1: Write the failing e2e S1** (dock, desktop 1600×1000, dark):
  1. Create a terminal; click `[data-act="split-right"]`, then `[data-act="split-down"]`. Check:
     - 3 visible `.tw-pane`s in the active space;
     - the rects from `getBoundingClientRect` form one left pane and two stacked right panes;
     - `.tw-pane.focused` has a computed border colour equal to `--accent`.
  2. Drag the vertical `.tw-split` from 50% to 70%. Check the left pane's width ratio is between 0.68 and 0.72.
  3. Hand-time a double-click (two clicks under 400ms apart) on the same divider. Check it's back to 0.5 ± 0.02.
  4. Click `[data-act="zoom"]`. Check exactly 1 pane is visible, filling `.tw-panes`. Click again: 3.
  5. Open the ⋯ menu, then Close (accept the confirm). Check 2 panes.
  6. Reload. Check 2 panes in the same arrangement, and `sessionStorage['vaultboard.term.tree']` parses.
  7. Run `TW.create({cwd:'Personal/1. apps/02-web-login'})`. Check the active space changed: only 1 pane is visible, with no `.tw-pane-strip` shown and no border. Run `TW.showSpace(previousKey)`: 2 panes, and the hidden pane's `.term-host` `offsetWidth > 0` (visibility, not display).
  8. Screenshots `s1-split-dark`, then switch `data-theme=light` and take `s1-split-sepia`.

  Run `node scripts/term-e2e.js S1`. Expected: FAIL.
- [ ] **Step 2: Implement the tree store and `layout()`.**
  - `layout()` computes `TermTree.layout` for **every** space and positions each held pane at its own rect.
  - Panes outside the active space get `.tw-off`, which is `visibility:hidden; pointer-events:none`.
  - The zoomed pane gets `[0,0,1,1]`; its siblings get `.tw-off`.
  - `.tw-panes[data-single]` is set when the active space shows one pane.
  - Splits are rendered for the active, unzoomed space only. Keep the window-listener drag and the hand-timed 400ms double-click from today's `termui.js:314-362`, now driven by `path` and `TermTree.setRatio`.
- [ ] **Step 3: Implement `add`/`create`/`remove`/`focus`.**
  - `add()` places the leaf (`insert` with `{target: focus, dir}` when `split` is given, else `insertLargest` using `.tw-panes` px) **before** `createTerminal`.
  - If `TermTree.tooSmall(rects, w, h)`, set the space's `zoom` to the new id.
  - Key: `TermTree.spaceKey(meta, knownTasks)`, where `knownTasks` is the set of held `task`s.
  - `remove()` calls `TermTree.remove`. An emptied space is deleted. If the active space empties, activate the first remaining key.
  - Save the store to sessionStorage **and** localStorage under `${store}.tree` on every change. Read sessionStorage first, then fall back to localStorage.
- [ ] **Step 4: Implement the bar, strips, menu and rename.**
  - The bar's name and detail come from a local `TermTree.spaces(TermTree.rows(null, held, new Map()), names)` until Task 5.
  - The strip name is `TermTree.paneTitle({title, osc, cmd: ''})`, updated from `onTitle` only when the text changes.
  - Rename uses `prompt('Name this pane', …)` and stores to `s.title`.
  - Close confirms as today: `End "<name>"? Anything running in it is stopped.`
  - Menu Escape: `stopPropagation`, close, refocus the terminal.
  - Strip right-click: `preventDefault` and open the same menu. Right-click inside `.term-host` is left alone, so paste keeps working.
  - Alt+1…9: change the existing handler (`termui.js:512-519`) to `showSpace(spaceKeys()[n-1])`.
- [ ] **Step 5: Add the CSS** with tokens only:
  - `.tw-pane` gets a 1px `--line` border; `.focused` gets `--accent`.
  - `.tw-pane-strip` has the title drawn into the top border: `--mono-font`, 11.5px, `--muted`, `--text` when focused.
  - `[data-single]` panes have no border and no strip.
  - Gap 4px.
  - Remove the unfocused dimming for these new classes.
- [ ] **Step 6: Run S0 and S1.** Expected: PASS. Look at both screenshots.
- [ ] **Step 7: Commit** with message `Terminal spaces: split tree per space with zoom, pane strips and menu`.

---

### Task 5: `termui.js`: server merge, presence, restore, rekey, migration

**Files:** Modify `public/termui.js`.

**Interfaces:**
- Consumes: Task 1's `rows`, `spaces`, `rekey`, `parseStore`, `observe` and `canOpen`, and Task 2's list fields.
- Produces (`TW` API):

  | Member | Behaviour |
  |---|---|
  | `list()` | Returns the last `/api/term/list` sessions, or `null`. |
  | `refreshList()` | Returns a promise. |
  | `onList(cb)` | `cb(list, rows)` after each poll. |
  | `rows()` | |
  | `spaces()` | |
  | `where(id)` | Returns `Row.where`. |
  | `goTo(id)` | held: `focus`. Otherwise `opts.goElsewhere?.(id)` and, if that returns true, stop. Otherwise `bring({id, cwd, task, title})`. |
  | `bring(meta)` | Calls `add` with the same id, which steals it (code 4000 to the other holder). |
  | `adopt(metas)` | |
  | `popSpace(key)` | Returns metas, removed with `kill:false`. |
  | `restore(saved, returning)` | Returns a promise. |
  | `onEvent(cb)` | `cb({kind:'agent', id, state, since}\|{kind:'moved', id, name}\|{kind:'cap'})`. |
  | `renameSpace(key, name)` | Writes `vaultboard.term.spaceNames[key]`; an empty name deletes it. Re-renders. |

  - Presence: `BroadcastChannel('vaultos-workbench')` messages `{presence:{from, host, ids}}` and `{who:true}`.

- [ ] **Step 1: Write the failing e2e checks.**
  - **S2:**
    1. Create terminals at `Personal/1. apps/01-api-refactor/data`, at `Code/DevOps/demo-repo` and at the root.
    2. After a poll, `TW.spaces().map(s=>s.name)` deepEqual `['API refactor','demo-repo','vault']`.
    3. The demo-repo space's detail is `'feature-x'`.
    4. The bar shows `API refactor` / `in progress` when that space is active.
    5. A space rename via `TW.renameSpace(key,'Auth')` persists across a reload, in `vaultboard.term.spaceNames`.
  - **S2-moved:**
    1. `docker exec herdr-term-preview mv '/vault/Personal/1. apps/01-api-refactor' '/vault/Personal/1. apps/_done/'`
    2. Within 6s, the held pane is still present, its space name is still `Auth`, and the key ends with `_done/01-api-refactor/task.md`.
  - **S4:**
    1. Context B (a second `browser.createBrowserContext()` with the same cookie) opens the window page and calls `TW.bring({id})` for a session held by A's dock.
    2. Within 5s, A no longer has the pane, and A's `TW.where(id) === 'elsewhere'`.
    3. A calls `TW.goTo(id)` and gets it back; B loses it.
  - **S4-twotabs:**
    1. Two pages in one context, both docks, each with one terminal.
    2. Reload page 1.
    3. After 4s, each page still holds exactly its own id, with no `moved` events recorded by `onEvent`.
  - **S8:**
    1. Seed `vaultboard.term.layout="tabs"`, `vaultboard.term.ratios=[0.6]` and a saved session set of 3 root terminals, then reload.
    2. The old keys are gone, and the root space has `zoom` set to the focused id: 1 pane visible.
  - **S11:**
    1. With 2 held terminals in 2 spaces, run `docker restart herdr-term-preview` and wait for reconnect.
    2. Both panes show a fresh prompt, `TW.spaces().length === 2`, and no row ids are duplicated.
  - **S12-cap:**
    1. Create terminals until `list().length === 12`, all busy (`sleep 600`).
    2. `TW.create()` adds no pane, and the pane count is unchanged.

  Run them. Expected: FAIL.
- [ ] **Step 2: Implement the list poll.**
  - Every 3s while `document.visibilityState === 'visible'`, plus 300ms after each `add`.
  - A 401 means `list = null`: held rows only.
  - On each poll:
    1. compute `rows` and `spaces`;
    2. **rekey** any held session whose `spaceKey` (now with known tasks from the list) differs from `s.key`. Move the custom name if `renamed`;
    3. `observe` each row's agent and emit `{kind:'agent'}` events;
    4. call the `onList` callbacks;
    5. re-render the bar.
  - Remove `termui.js`'s own `/api/term/list` fetch for detached sessions.
- [ ] **Step 3: Implement presence.**
  - Post `{presence:{from: PAGE_ID, host: opts.host, ids}}` on every held-set change and in reply to `{who:true}`. Post `{who:true}` on load.
  - On `pagehide`, post `{presence:{from, host, ids:[]}}`.
  - The receiver maps `host==='window'` to `'window'`. Otherwise it is `'tab'` when the receiver's own host is `'dock'`, else `'dock'`.
- [ ] **Step 4: Implement steal handling.**
  - When `onState` gets `'moved'` (code 4000): call `remove(id, {kill:false})`, drop the id from the saved set, and emit `{kind:'moved', id, name}`. No "Bring it back here" note any more.
- [ ] **Step 5: Implement `restore(saved, returning)`.**
  1. `await refreshList()`.
  2. Add every `returning` meta.
  3. Add each saved meta whose id is missing from the list, or present with `attached:false`.
  4. For saved metas listed as attached: wait 2000ms, refresh, add the ones now detached, and drop the rest from the saved set.
  5. Restore the focus and active space from the store, then `reconcile` every space's tree against the held ids.
  - Saved sessions use sessionStorage first, then the localStorage mirror (`${store}.sessions`).
- [ ] **Step 6: Implement migration and the cap.**
  - Migration: on construction, read `${store}.layout`. If it is present, remember `wasTabs = (value === 'tabs')`, then delete `${store}.layout` and `${store}.ratios`. After the first `restore`/`reconcile`, if `wasTabs`, set every space's `zoom` to its `focus`.
  - Cap: `create()` first checks `TermTree.canOpen(list)`. On false, emit `{kind:'cap'}` and return `null`.
- [ ] **Step 7: Run S0, S1, S2, S2-moved, S4, S4-twotabs, S8, S11 and S12-cap.** Expected: PASS.
- [ ] **Step 8: Commit** with message `Terminal spaces: sidebar model from the server list, presence across windows, restore without stealing, rekey and migration`.

---

### Task 6: Host wiring: dock, window, settings

**Files:**
- Modify `public/workbench.js`:
  - `TW` options `:969-980`
  - `pollAgents` `:1065-1093`
  - `goToAgent` `:1029-1040`
  - Pop out `:1115-1122`
  - `adoptReturned` `:1126-1135`
  - BroadcastChannel `:1169-1175`
  - `restoreTerminals` `:1181-1197`
  - the sound setting near `segTermWhere` `:1006-1013`
- Modify `public/terminal.html`: remove `.term-pop-head`; add `host:'window', sideDefault:'side'`; keep `twAdopt`; add the `storage` listener.
- Modify `public/index.html`: add an "Agent sound" segment `#segTermSound` (Off | On) in Appearance, next to `#segTermWhere`.

**Interfaces:**
- Consumes: Task 5's `TW` API.
- Produces:
  - `goToAgent(id)` keeps its name and is used by `app.js` cards and the drawer.
  - `window.twAdopt(metas)` is unchanged in shape.

- [ ] **Step 1: Write the failing e2e checks.**
  - **S3:**
    1. With the main page set to `where="window"`, click a card's agent pill. The popup page opens and holds that id.
    2. In the dock, create 2 terminals in one space and split them. Click `#term-pop`. The popup now holds both ids, in one space with 2 panes.
    3. Close the popup page. Within 3s the dock holds both again.
    4. With the popup open and holding id X, call `TW.goTo(X)` on the main page. The popup is the target: `twAdopt` is called and the main page doesn't take X.
  - **S3-theme:** change `localStorage['vaultboard.theme']` from the main page. The popup's `documentElement.dataset.theme` follows within 1s.

  Run them. Expected: FAIL.
- [ ] **Step 2: Wire `workbench.js`.**
  - `createTermWorkspace` with `host:'dock'`, `sideDefault:'rail'`, and `goElsewhere: (id) => TW.where(id) === 'window' && (() => { const w = openTermWindow(); if (w) handToWindow(w, [{id}]); return !!w; })()`.
  - `pollAgents` becomes `TW.onList((list) => {…same TASK_AGENTS/alert logic…})`. Delete the `setInterval` and `visibilitychange` lines.
  - `goToAgent(id)`:
    - held: `showTerminals(); TW.focus(id)`;
    - `TW.where(id) === 'window'`, or `termWhere() === 'window'`: open the window and hand the session over;
    - otherwise: `showTerminals(); TW.bring({id, …})`.
  - Pop out: `handToWindow(w, TW.popSpace(TW.activeSpace()))`.
  - `adoptReturned`: `TW.adopt(metas)`.
  - `restoreTerminals`: keep the legacy-id migration and the `/api/me` gate, then `TW.restore(saved, returning).then(…show dock if open…)`.
  - Sound: `segSet('segTermSound', lsGet('vaultboard.term.sound', false) ? 'on' : 'off')`, with click handlers that `lsSet` a boolean.
- [ ] **Step 3: Wire `terminal.html`.**
  - Delete the header. Pass the new options.
  - Add a `storage` listener: on `vaultboard.theme`, set `document.documentElement.dataset.theme`. The xterm retheme follows through `termui`'s MutationObserver.
  - `pagehide` hands back `TW.metas()` as today.
- [ ] **Step 4: Run S0–S3, S3-theme and S4.** Expected: PASS.
- [ ] **Step 5: Commit** with message `Terminal spaces: dock and window wiring, pop out a whole space, theme follows into the window`.

---

### Task 7: `termside.js`: sidebar and rail

**Files:**
- Create: `public/termside.js`
- Modify: `public/termui.js` (mount and render calls), `public/styles.css` (sidebar section), both HTML files (script tag after `termtree.js`)

**Interfaces:**
- Produces: `createTermSide(el, ctx) → {render(model), setMode(mode)}`.
  - `model = {mode: 'side'|'rail', brand: boolean, spaces: Space[], agents: Row[], activeKey, focusedId}`.
  - `ctx = {onSpace(key), onAgent(id), onNew(), onMenu(anchorEl), onRenameSpace(key), onToggle()}`.
- Consumes: `TW.spaces()` and `TermTree.agentOrder(TW.rows())`. `termui` calls `side.render` after every layout, poll, agent or title change, and implements the callbacks with `showSpace`, `goTo`, `create`, the menu, a `prompt` rename, and `setSide`.
- Footer "menu" opens a `.tw-menu` with:
  - `Go to…` (`Ctrl+Space g`)
  - `Shortcuts` (`Ctrl+Space ?`)
  - `Sound: Off|On`, which toggles `vaultboard.term.sound`

  Until Tasks 8 and 9 exist, the first two items are present but disabled.

- [ ] **Step 1: Write the failing e2e checks.**
  - **S2-side** (window page, sidebar expanded):
    - `.tw-side .tw-sp-row` count equals the number of spaces.
    - The active row has computed `font-weight` ≥ 600 and a background equal to `--panel-2`.
    - Each row's mark text is one of `× ◐ ✓ ○ ·`.
    - `fake(blocked)` in the web-login space makes that space's mark `×`, coloured `--review`. The agents list's first row reads `claude · blocked`, or `node · blocked` (the fake runs as node; accept either), with the space name under it.
    - Clicking an agent row in another space activates that space.
    - Detached and elsewhere rows have `.dim`, and a tooltip containing `detached` or `elsewhere`.
    - Screenshots: `s2-side-dark` and `s2-side-sepia`.
  - **S2-rail** (dock page):
    - `.tw-side[data-mode="rail"]` width ≤ 48px.
    - Rows read `1 ◐` and so on, with numbers matching the `Alt+N` order.
    - Clicking `»` expands to `side`, and the state persists in `vaultboard.term.side` across a reload.
    - Screenshot: `s2-rail-dark`.
  - **S2-escape** (Review Focus 1): with the `03-ops-dns` space present:
    - the row's `textContent` contains the literal `<b>Ops & "DNS"`;
    - there is no `b` element inside `.tw-side`;
    - the row's `scrollWidth > clientWidth`, and computed `text-overflow === 'ellipsis'`.

  Run them. Expected: FAIL.
- [ ] **Step 2: Implement `termside.js`.**
  - All text goes through `twEsc` or `textContent`.
  - Rows are `button`s for keyboard focus.
  - Right-click on a space row calls `onRenameSpace`.
  - The rail shows `num` plus the mark, with the name in `title`.
  - The section headers `spaces` and `agents` are lowercase, `--muted`, weight 600.
  - Agent row text is `${row.cmd || 'agent'} · ${state word}`, with the state word coloured by its mark token.
- [ ] **Step 3: Add the CSS.**
  - `.tw-side`: 232px wide, `--bg`, a right border of 1px `--line`, `--mono-font` at 12px.
  - Rail: 44px.
  - Expanded/rail toggle `«`/`»` at the bottom.
  - Brand (`model.brand`, window only) at the top, as `Vault<span class="brand-os">OS</span>`, reusing the `.brand` rules.
- [ ] **Step 4: Run S2-side, S2-rail, S2-escape and S1–S4.** Expected: PASS. Look at all the screenshots.
- [ ] **Step 5: Commit** with message `Terminal spaces: sidebar of spaces and agents, numbered rail`.

---

### Task 8: `termpick.js`: Go-to picker and phone switcher

**Files:**
- Create: `public/termpick.js`
- Modify: `public/termui.js` (phone mode and summary), `public/styles.css`, both HTML files

**Interfaces:**
- Produces: `createTermPicker(ctx) → {open({present: 'modal'|'sheet'}), close(), isOpen()}`.
  - `ctx = {spaces(), rows(), goTo(id), onNew(), refocus()}`.
  - It appends its overlay `.tw-pick` to `document.body`.
- `termui` adds `TW.openPicker()`. In phone mode (`matchMedia('(max-width: 700px)')` with a change listener), `root.dataset.phone = '1'`. The bar then shows `button.tw-summary` (mark, then `space · pane title`) and `button.tw-switch` (`≡ N` plus the rollup mark of all rows), and both open the sheet.

- [ ] **Step 1: Write the failing e2e checks.**
  - **S7** (phone 390×844, `isMobile`, `hasTouch`, dock):
    - Neither `.tw-side` nor `.tw-split` is visible.
    - `.tw-summary` shows the active space name.
    - Tapping `.tw-switch` opens `.tw-pick[data-present="sheet"]`, full-viewport.
    - Tapping another space's row closes the sheet, and that row's pane is the only visible one.
    - The key row's `Esc` still types `\x1b`; check via `cat -v` printing `^[`.
    - The compose box still sends.
    - Screenshots: `s7-phone-dark` and `s7-phone-sepia`.
  - **S7-desktop:**
    - `TW.openPicker()` opens `.tw-pick[data-present="modal"]`.
    - Typing `web` filters to the web-login rows.
    - ArrowDown, then Enter, focuses that pane.
    - Escape closes it, and an open task drawer stays open: open a card first, and check `#drawer` is not hidden after the Escape.

  Run them. Expected: FAIL.
- [ ] **Step 2: Implement the picker.**
  - Rows are grouped under space headers, with the branch or status on the right.
  - Each row: mark, pane title, `cmd`, state word.
  - The filter is a case-insensitive substring over the space name, pane title, cmd, cwd and state.
  - The input owns ↑/↓/Enter/Escape. Escape: `stopPropagation`, then close and `ctx.refocus()`.
  - The sheet variant has 44px rows and a `New terminal` button calling `onNew`.
- [ ] **Step 3: Implement phone mode** in `termui` and the CSS:
  - only the focused pane is visible;
  - the tree is kept;
  - no splits or sidebar are rendered;
  - the summary and switch buttons replace the bar's split and zoom buttons.
- [ ] **Step 4: Run S7, S7-desktop and S1–S4.** Expected: PASS. Look at the screenshots.
- [ ] **Step 5: Commit** with message `Terminal spaces: Go-to picker, phone summary and switch sheet`.

---

### Task 9: `termkeys.js`: Ctrl+Space prefix, mode bar, `?` sheet

**Files:**
- Create: `public/termkeys.js`
- Modify:
  - `public/termui.js`: install it; move the Alt+1…9 and Ctrl+Shift+` handler (`termui.js:510-519`) into it
  - `public/styles.css`: `.tw-modebar`, `.tw-sheet`
  - both HTML files

**Interfaces:**
- Produces: `installTermKeys(root, ctx) → {armed(), disarm(), openSheet()}`.
  - `ctx = {host, isActive(), sendNul(), split(dir), toggleZoom(), closeFocused(), focusDir(dir), openPicker(), nextNeedingYou(), toggleSide(), showSpaceN(n), newPane()}`.
  - `BINDINGS`, an array of `{keys: string, label: string, match(e), run()}`, is internal and drives the handler, the mode bar and the sheet.
  - The interception code is exactly the snippet in the spec, section `termkeys.js`.

  | Keys | Label |
  |---|---|
  | `\` | Split right |
  | `-` | Split down |
  | `z` | Zoom pane |
  | `x` | Close pane |
  | `← ↑ ↓ →` / `h j k l` | Move focus |
  | `g` | Go to… |
  | `n` | Next agent that needs you |
  | `b` | Sidebar ⇄ rail |
  | `?` | All shortcuts |

- [ ] **Step 1: Write the failing e2e S6** (dock, desktop):
  1. In terminal 1, run `cat -v\r`. Press Ctrl+Space twice. `screen` contains `^@`.
  2. Press Escape alone. `^[` is printed. Open a task drawer first, then focus the terminal and press Escape: `#drawer` is still open.
  3. Press Ctrl+Space, then Escape. Nothing new is printed, and `.tw-modebar` is hidden afterwards.
  4. Press Ctrl+Space. `.tw-modebar` is visible, containing `PREFIX` and `split right`. Press `\`: the pane count is +1.
  5. Press Ctrl+Space, then `z`: zoomed. Press Ctrl+Space, then `ArrowLeft`: focus moves to the left pane.
  6. Focus the Board search input and press Ctrl+Space. The mode bar stays hidden, and the input value is unchanged.
  7. Press Alt+2. The second space in the `TW.spaceKeys()` order becomes active.
  8. Press Ctrl+Space, then `?`. `.tw-sheet` is open. Type `zoom` in its filter: exactly 1 row. Escape closes the sheet and the drawer stays open.
  9. With a fake blocked agent in space 2, press Ctrl+Space, then `n`. That pane is focused.

  Run it. Expected: FAIL.
- [ ] **Step 2: Implement.**
  - The mode bar is absolute at the bottom of `.tw-panes`: a `PREFIX` pill (`--brand` background, `--on-brand` text), then the first 6 bindings as `key label` hints.
  - Disarm on `blur`, any `pointerdown`, or when `isActive()` turns false.
  - `sendNul` calls the focused `handle.type('\x00')`.
  - The sheet's filter input owns Escape, with `stopPropagation`.
  - On the phone: `installTermKeys` returns without listening.
- [ ] **Step 3: Enable the footer menu items** "Go to…" and "Shortcuts" from Task 7.
- [ ] **Step 4: Run S6 and S1–S4.** Expected: PASS.
- [ ] **Step 5: Commit** with message `Terminal spaces: Ctrl+Space prefix keys, mode bar, shortcuts sheet`.

---

### Task 10: `termtoast.js`: toasts and sound

**Files:**
- Create: `public/termtoast.js`
- Modify: `public/termui.js` (subscribe to `onEvent`), `public/styles.css` (`.tw-toasts`), both HTML files

**Interfaces:**
- Produces:
  - `TermToast.create(ctx) → {push(t), clear()}`
    - `t = {id, kind: 'blocked'|'done'|'info', title, sub}`
    - `ctx = {onClick(id)}`
  - `TermToast.tone(kind)`
- Wiring in `termui`, on `onEvent`:

  | Event | Toast |
  |---|---|
  | `{kind:'agent'}` | Only if `document.hasFocus()`, and the id is not (held here and in the active space and unzoomed-visible). Title: `TW_AGENT_TEXT[state]` ("Claude needs you" / "Claude finished"). Sub: `space name · pane N`. |
  | `{kind:'moved'}` | `info`, title `<name> opened elsewhere` |
  | `{kind:'cap'}` | `info`, title `12 terminals open`, sub `Close one to open another` |

  - Click → `TW.goTo(id)`; on the dock host that goes through `goElsewhere`.
  - Sound plays when `twGet('vaultboard.term.sound', false)` is true and the kind is `blocked` or `done`.
  - Lifetime: 8000ms blocked, 5000ms done, 4000ms info. At most 4 shown; the oldest is dropped.

- [ ] **Step 1: Write the failing e2e checks.**
  - **S5:**
    1. Two spaces; the active one is A. In space B, run `fake(working)`, then press `b` in it via `typeIn` (B is held but not visible).
    2. Within 5s, `.tw-toasts .tw-toast` contains `Claude needs you` and B's space name.
    3. Click it. B is the active space, and the toast is gone.
    4. Press `d`, then switch to A, then back to B. The agent state goes `done` → `idle` (seen).
    5. With the page unfocused (open a second page and `bringToFront` it), a new blocked agent shows no toast on the first page.
    6. `localStorage['vaultboard.term.sound']` is absent by default. Toggling `#segTermSound` sets it to `true`, and the window page's footer menu reads `Sound: On`.
    7. Screenshot: `s5-toast-dark`.
  - **S12-toast:** at the cap, `TW.create()` shows a toast containing `12 terminals open`.

  Run them. Expected: FAIL.
- [ ] **Step 2: Implement.**
  - The card is a `button`: `--panel` background, 1px `--line` border, `--shadow-3`, `--mono-font` title bold, `--muted` sub line.
  - Position: bottom-right `16px`. With `[data-phone]`, top `calc(env(safe-area-inset-top,0px) + 8px)`.
  - Toasts never take focus.
  - `tone`: a WebAudio `OscillatorNode` at 0.05 gain, 120ms: 660Hz for blocked, 880Hz for done. Resume the `AudioContext` on the first `pointerdown`/`keydown`.
- [ ] **Step 3: Run S5, S12-toast and S1–S4.** Expected: PASS. Look at the screenshot.
- [ ] **Step 4: Commit** with message `Terminal spaces: toasts when a background agent needs you or finishes, optional sound`.

---

### Task 11: CSS sweep, reduced motion, both themes and phone

**Files:** Modify `public/styles.css`. Optionally `public/index.html`, only if a removed class is referenced there.

- [ ] **Step 1: Write the failing e2e S10.**
  - `emulateMediaFeatures([{name:'prefers-reduced-motion', value:'reduce'}])` on the main page with a working agent.
  - Computed `animation-name` of `.agent-dot[data-agent="working"]`, `#termbtn[data-alert]::after` (via `getComputedStyle(el,'::after')`) and `.tw-mark` is `none` for all three.
  - Run it. Expected: FAIL on `.agent-dot`.
- [ ] **Step 2: Delete these rules:**
  - `.term-head`, `.term-state*`, `.term-cta`, `.d-agent-state`
  - `.tw-tabs`, `.tw-tab*`, `.tw-empty-tabs`, `.tw-layout*`, `.tw-detached*`, `.tw-add`
  - every `.term-area[data-layout="tile"]` rule, `.tw-pane-head`, the old phone tile rules
  - the `.tw-layout` half of `.tw-layout, #term-pop`
  - unfocused-pane dimming
  - `.term-pop-head`, `.term-title`, `.term-pop-hint`

  Then add to the reduced-motion block (`styles.css:~317`):
  ```css
  .agent-dot[data-agent="working"], #termbtn[data-alert]::after, #mnav-term[data-alert]::after { animation: none !important; }
  ```
- [ ] **Step 3: Check for leftovers.**
  - `grep -nE 'tw-tab|tw-layout|tw-detached|tw-add|term-pop-head|term-cta|term-state|d-agent-state|tw-pane-head' public/*.js public/*.html public/styles.css` prints nothing.
  - `grep -nE '#[0-9a-fA-F]{3,8}\b' public/styles.css` shows no new matches inside the Terminal spaces sections. Compare against `git diff master -- public/styles.css`.
- [ ] **Step 4: Run the whole suite** (`S0 S0b S1 S2 S2-moved S2-side S2-rail S2-escape S3 S3-theme S3a S4 S4-twotabs S5 S6 S7 S7-desktop S8 S10 S11 S12-cap S12-toast`) and screenshot the matrix:
  - desktop dark/sepia: dock rail, window sidebar, split, picker, sheet, toast
  - phone dark/sepia: summary, sheet

  Look at each one. Fix contrast or overflow issues, and rerun. Expected: all PASS.
- [ ] **Step 5: Run the unit tests.** Expected: PASS.
- [ ] **Step 6: Commit** with message `Terminal spaces: remove the tab-era CSS, static marks under reduced motion, theme and phone polish`.

---

### Task 12: Docs

**Files:**
- Modify `CLAUDE.md`. Rewrite the terminal bullets at about `:269-370` (Workbench/terminals), `:686-735` (Mobile terminal parts) and `:795-846` (Agent badges + Start agent), and add a section `## Terminal spaces (added 2026-10-07, after herdr)`. It covers:
  - the modules and load order;
  - the space key rule and the join rule;
  - the store and keys, with migration;
  - presence and the cross-host click table;
  - the restore rule;
  - the Ctrl+Space prefix, with Escape rules and why not Ctrl+B;
  - the hidden-pane resize fix;
  - the preview recipe (`/opt/vault/herdr-term-preview`, `reset.sh`, `mint-cookie.js`, `term-e2e.js`, never `:7684`);
  - the release order (frontend first, server restart with Ben's OK).
- Modify the spec's header status to "built; see Decisions made during implementation", and add that section if anything changed.
- Modify the memory file `/root/.claude/projects/-opt-vault-vault/memory/vaultos-herdr-terminals.md` with the status. This is outside the repo.

- [ ] **Step 1: Check for stale doc references.** `grep -nE 'Tabs \| Tile|Tabs/Tile|N detached|tw-tab' CLAUDE.md` matches only lines marked historical.
- [ ] **Step 2: Commit** with message `Terminal spaces: docs`.

---

### Task 13: Release (Ben-gated)

- [ ] **Step 1: Run the full e2e and the unit tests one last time on the preview.** Expected: all PASS.
- [ ] **Step 2: Fast-forward master** with `cd /opt/vault/board && git merge --ff-only herdr-terminals`. The frontend is now live on :7684. The server part isn't yet, so the sidebar runs in degraded mode: names fall back to folders.
- [ ] **Step 3: Verify the frontend is live.**
  - `diff <(curl -s http://localhost:7684/termui.js) public/termui.js` prints nothing. Do the same for `termtree.js`, `termside.js`, `termpick.js`, `termkeys.js` and `termtoast.js`.
  - Ask Ben to reload his pages. An already-open old pop-out keeps working until it's closed (handoff arrays are unchanged).
- [ ] **Step 4: Ask Ben before the server restart.**
  - Run `docker exec vault-board ps -eo pid,etime,args | grep -iE 'claude|node .*fake' | grep -v grep` and report the live sessions.
  - Restart only after he says go: `docker restart vault-board`.
  - Then run `curl -s -o /dev/null -w '%{http_code}' localhost:7684/healthz`; expected `200`.
  - Ben confirms task names and branches appear.
- [ ] **Step 5: Live check with Ben** (claude-in-chrome if it's connected):
  - real Claude OSC titles in the pane strips;
  - hook states in the sidebar;
  - Ctrl+Space works on his machine. If an OS input switcher takes it, note that in the task and use the menus and picker meanwhile.
- [ ] **Step 6: Tear down.**
  - `cd /opt/vault/herdr-term-preview && docker compose down`, then remove the folder.
  - `git -C /opt/vault/board worktree remove /opt/vault/board-herdr`, then `git branch -d herdr-terminals`.
- [ ] **Step 7: Update the vault task** `Personal/1. apps/55-vaultos-herdr-terminals/task.md`: tick the plan, add a progress log line, set `status: review`. Ben runs `/done` once he's happy. `chown 1000:1000` the file afterwards.
