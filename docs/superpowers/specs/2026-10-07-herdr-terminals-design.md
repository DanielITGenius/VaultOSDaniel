# Terminal spaces: herdr-style terminals in VaultOS

Date: 2026-10-07 · Status: built on branch `herdr-terminals` (Tasks 0–12); see "Decisions made during implementation" at the end. Not released yet (Task 13 awaits Ben's go-ahead). Design approved by Ben 2026-10-07 · Task: `Personal/1. apps/55-vaultos-herdr-terminals`

## Why

Ben wants the VaultOS terminal to look and work like [herdr](https://github.com/herdrdev/herdr), a Rust TUI multiplexer for coding agents.

Herdr v0.9.3 and a throwaway VaultOS preview were run side by side and screenshotted: https://claude.ai/artifact/Q7g1ovjFbaN9Y7f7KhmzFq

Herdr does three things VaultOS doesn't:
- **One overview.** A left sidebar lists every workspace, each with one rolled-up agent state. It also lists every agent across all of them, blocked ones first. One click jumps to any agent, and the sidebar folds to a numbered rail.
- **Splits you control.** Split right or down, zoom a pane, and use a pane menu.
- **Ways to get somewhere fast.** A Go-to picker, toasts when a background agent needs you, a prefix keymap and a `?` sheet.

The chrome is flat, mono and calm.

VaultOS today:
- A flat strip of numbered tabs in two hosts: the dock under the Board, and the "VaultOS Terminals" pop-out window, which is Ben's desktop default.
- The layout is an automatic Tabs/Tile toggle.
- There is no overview, and the two hosts can't see each other's sessions.

VaultOS is ahead on agent state. Claude Code hooks are more accurate than herdr's screen-reading. Start agent from a task, and the Board pills, stay as they are.

**Goal:** herdr's structure and feel in VaultOS's palette (gold, Dark and Sepia, tokens only), across the dock, the window and the phone.

## Decisions

### Ben's (2026-10-07)

1. **Both hosts, one shared component.**
   - The window shows the sidebar expanded.
   - The dock shows a slim numbered rail that expands on click.
   - The phone gets a summary header and a full-screen switch list.
2. **A space is the Board task a terminal is linked to, otherwise the folder it opened in.**
   - A task space shows the title and status from `task.md`.
   - A git branch shows only inside a repo. Only `Code/DevOps/homelab-iac` and `infra-scripts` are repos today.
   - Spaces are named automatically and can be renamed.
3. **Inside a space: a split tree you control.**
   - Split right or down, drag borders, zoom one pane, close.
   - There are no tabs inside a space. The sidebar is the switcher, and the Tabs/Tile toggle goes.
4. **Also this round:**
   - Toasts, with an optional sound that is off by default.
   - A Go-to picker.
   - A **Ctrl+Space** prefix. Ctrl+B is Claude Code's "run in background".
   - A `?` shortcuts sheet.
   - Resume after restart (`claude --resume`) is a later round.

### Defaults in the approved plan

- **Look**
  - Mono chrome, lowercase muted section headers, 1px `--line` borders.
  - The focused pane gets an `--accent` border, with its title in the top edge.
  - Other panes are not dimmed. A space with one pane has no border.
  - The active space is shown as a `--panel-2` row with bold text, never a gold mark. Gold sits next to amber "blocked" and would read as a state (`--review` is 3° of hue from `--brand`).
- **State marks.** Static, coloured symbols only: × blocked, ◐ working, ✓ done, ○ idle, · none. There is no Dots/Symbols setting. Colours stay as today (`--review`, `--in-progress`, `--done`, `--muted-2`), so they match the Board pills.
- **Agents list.** Sorted by priority only: blocked → done → working → idle, newest change first.
- **Keys**
  - Alt+1…9 goes to **space N**, matching the rail numbers.
  - Prefix then Esc cancels and sends nothing, as in tmux.
  - Esc on its own in a terminal is never touched.
  - Right-click inside a terminal still pastes. The pane menu is on the pane's title strip, as a ⋯ button and on right-click.
- **Across hosts**
  - On the Board page, clicking a session held by the window jumps to the window.
  - In the window, clicking a session held by the dock, the phone or nobody brings it here.
  - A pane taken by another device leaves this page, and its sidebar row stays, dimmed.
  - "Pop out" moves the whole active space.
- **Window header.** The pop-out window loses its header strip. The brand moves to the top of the sidebar.

### Fixes folded in

- **Hidden panes squeeze running sessions to 80×24.**
  - Panes are hidden with `display:none` (`styles.css:190`, used by `termui.js:377`).
  - `connect()` then sends xterm's default 80×24 (`term.js:430`), and on reattach the server resizes the live pty to it (`server.js:2217`).
  - A reload with background tabs, or with the dock minimised, therefore squeezes a running Claude session to 80 columns.
  - Fix:
    - send `cols`/`rows` only when the container has a real size;
    - inactive-space panes use `visibility:hidden` at their real size, never `display:none`.
- **Restore steals sessions.**
  - `restoreTerminals` (`workbench.js:1181-1197`) reattaches every saved id, taking sessions away from another tab or the phone.
  - New rule:
    - reattach saved ids the server reports as detached or missing;
    - always adopt the `returning` set;
    - re-check attached ones once after 2s, then drop them.
  - Saved sessions and trees live in sessionStorage first, with a localStorage mirror for a fresh tab.
- **The pop-out reads the theme once** (`terminal.html:13-16`). It now follows `storage` events for theme and sound.
- **Reduced motion.** `agent-pulse` and `agent-ring` strobe under the global reduced-motion rule (`styles.css:174-179`). Static marks plus an explicit override fix it.

## Architecture

Six front-end files. Each is an IIFE that exposes exactly one global.

Classic scripts share one global lexical scope, so a second top-level `const esc` would be a SyntaxError that kills a later script (`app.js:136` already defines one).

Nothing in these files depends on `app.js`, because the pop-out has none. The globals `TW_AGENT_TEXT` and `twNewId` stay, since `app.js:579` and `workbench.js:915,1055` use them.

**Load order** (`index.html:310-321`, `terminal.html:30-36`):
1. vendor xterm
2. `term.js`
3. `termtree.js`
4. `termside.js`
5. `termpick.js`
6. `termkeys.js`
7. `termtoast.js`
8. `termui.js`
9. then `app.js` … `workbench.js` (index.html only)

### `termtree.js`: pure logic

UMD like `sheet-core.js:9-10`, so node tests can `require` it. The browser global is `TermTree`.

**Split tree**

| Function | What it does |
|---|---|
| `leaves(node)` | Returns the ids in order. |
| `insert(root, newId, {target, dir})` | `dir` is `'row'` (split right) or `'col'` (split down). The new leaf goes into `b`. |
| `insertLargest(root, newId, wPx, hPx, focusId)` | Splits the largest rect along its longer side. Ties go to the focused pane. |
| `remove(root, id)` | The sibling takes the parent's place. Returns null when the tree empties. |
| `layout(root)` | Returns `{rects:{id:[x,y,w,h]}, splits:[{path, dir, x,y,w,h, r}]}` in fractions. |
| `setRatio(root, path, r)` | Clamps to 0.12–0.88. |
| `neighbour(rects, id, dir)` | Geometric: the nearest overlapping edge in `left`/`right`/`up`/`down`. |
| `reconcile(root, heldIds, wPx, hPx)` | Drops leaves that aren't held, and `insertLargest`s held ids that are missing. |
| `parseStore(raw)` | Validates; junk becomes an empty store. |

**Model**

| Function | What it does |
|---|---|
| `spaceKey(row, knownTasks)` | Returns `'t:'+task` or `'d:'+cwd`. **Join rule:** an unlinked cwd equal to the folder of any known task gets that task's key. This works before the server's auto-link ships. |
| `rows(list, held, presence)` | Returns `{id, key, title, osc, cmd, cwd, task, agent, where, idleSince, taskTitle, taskStatus, taskMissing, branch}`. `where` is one of `'here' \| 'window' \| 'dock' \| 'tab' \| 'elsewhere' \| 'detached'`. |
| `spaces(rows, names)` | Returns `[{key, num, name, detail, rollup, ids, held, dim}]`, ordered by first appearance in the server list. `TERMS` is an insertion-ordered Map, so that is creation order. |
| `spaceName` | Custom name, else task title, else task folder, else basename(cwd), else `vault`. |
| `detail` | Task status word, else branch, else parent path, plus "· N detached / elsewhere". |
| `rollup(states)` | blocked > done > working > idle. |
| `agentOrder(rows)` | blocked, done, working, idle; newest `since` first. |
| `paneTitle(row)` | Custom name, else OSC title, else cmd, else `shell`. Bash's title `coder@host: /vault/X/Y` (from the container's `.bashrc`) becomes `shell · Y`, or `<cmd> · Y` while something runs. A leading spinner glyph is stripped from Claude's titles. |
| `observe(memo, id, agent)` | Toast events. The first sighting is a baseline, `since` only moves forward, and only `blocked` and `done` fire. Dedupe key: `id\|state\|since`. |
| `nextNeedingYou(rows, currentId)` | Blocked (oldest first), then done. |
| `canOpen(list, max=12)` | True when under the cap, or when an evictable detached idle shell exists. |

### `termui.js`: core composition

`createTermWorkspace(root, opts)`.

**Options.** The existing options are kept: `store, persist, extraButtons, onOpenPath, onChange, beforeNew, isActive, onAgents`. New ones:
- `host`: `'dock'` or `'window'`.
- `sideDefault`: `'rail'` or `'side'`.
- `goElsewhere(id) → bool`: the dock uses it to jump to the window.

**It owns:**
- the held sessions and the per-host tree store;
- rendering the active space from `TermTree.layout`;
- zoom;
- the space top bar;
- pane title strips with the ⋯ and right-click menu;
- the 3s `/api/term/list` poll while the page is visible;
- BroadcastChannel presence;
- `restore()`, migration and rekey;
- the phone compact mode.

It reuses today's absolute-fraction pane positioning, divider drag and hand-timed double-click (`termui.js:314-362`). The drag re-checks that its node still exists on every move.

The poll replaces the "N detached" button (`termui.js:142-177`) and workbench's own poll (`workbench.js:1065-1093`).

The key row and compose box (`termui.js:441-505`) are unchanged.

**API.** Existing members are kept: `add, create, remove, layout, focus, markSeen, focused, session, sessions, metas, savedSessions, savedFocus, label`. `focus` now also activates the session's space.

New members: `goTo(id)`, `bring(meta)`, `adopt(metas)`, `popSpace(key) → metas`, `activeSpace()`, `where(id)`, `onList(cb)`, `list()`, `refreshList()`, `restore(saved, returning)`, `setSide(mode)`.

`create(o)` gains `split: 'right'|'down'` and `target`. Without them, it calls `insertLargest` into the space matching `o`'s key, and that space becomes active.

**Removed:** the tab strip, Tile/dwindle and the detached button (`termui.js:57-58, 142-177, 289-429`).

### `termside.js`: sidebar and rail

`createTermSide(el, ctx)` → `{render(model), setMode('side'|'rail')}`.

**Sidebar** (232px, `--mono-font`, 12px), top to bottom:
1. The brand.
2. "spaces": two-line rows, mark + name (bold when active), then a muted detail line.
3. A footer with "new" on the left and "menu" on the right.
4. A divider.
5. "agents": rows of mark + `cmd · state word`, with the space name below (plus the pane number when the space has more than one).

**Rail** (about 44px): `N mark` rows for spaces, a divider, agents, then `+` and `»` at the bottom.

Rows that are held elsewhere or detached are dimmed (`--muted-2`), and their tooltip says where they are.

`ctx` callbacks: `onSpace, onAgent, onNew, onMenu, onRenameSpace, onToggle`.

### `termpick.js`: Go-to picker

`createTermPicker(doc, ctx)` → `{open({present:'modal'|'sheet'}), close(), isOpen()}`.

- Lists every terminal, grouped by space.
- A substring filter matches space, title, cmd, cwd and state.
- ↑/↓ moves, Enter calls `goTo`.
- Esc closes with `stopPropagation` and refocuses the terminal.
- `'sheet'` is the phone's full-screen switch list: 44px rows and a "New terminal" button.

### `termkeys.js`: prefix keys and the `?` sheet

`installTermKeys(root, ctx)` → `{armed(), disarm(), openSheet()}`.

It uses a window capture-phase keydown, which runs before xterm's helper-textarea listener. That way it can hold back both Ctrl+Space and the key after it, whether focus is in xterm or in the sidebar. `attachCustomKeyEventHandler` alone can't do that.

```js
window.addEventListener('keydown', (e) => {
  if (e.isComposing || e.repeat || !ctx.isActive()) return;
  const ae = document.activeElement;
  const inScope = root.contains(ae) || (ctx.host === 'window' && ae === document.body);
  const typing = ae && ae.matches('input,textarea,select,[contenteditable]') && !ae.classList.contains('xterm-helper-textarea');
  const isPrefix = e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === 'Space';
  if (!armed) { if (isPrefix && inScope && !typing) { eat(e); arm(); } return; }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
  eat(e); disarm();                        // eat = preventDefault + stopPropagation
  if (isPrefix) return ctx.sendNul();      // focused handle.type('\x00')
  const b = BINDINGS.find((x) => x.match(e)); if (b) b.run();   // anything unbound (Esc too) is swallowed
}, true);
```

**When it disarms:** on `blur`, on any `pointerdown`, or when the host is hidden.

**Mode bar:** a `PREFIX` pill (`--brand` on `--on-brand`) plus key hints, as an absolute overlay at the bottom of the pane area so it never refits the terminals.

**One `BINDINGS` table** drives the handler, the mode-bar hints and the `?` sheet, which has a filter box.

**Bindings after Ctrl+Space:**

| Key | Action |
|---|---|
| `\` | split right |
| `-` | split down |
| `z` | zoom |
| `x` | close (same confirm as today) |
| arrows / `hjkl` | `neighbour` |
| `g` | go to |
| `n` | next agent needing you |
| `b` | sidebar ⇄ rail |
| `?` | sheet |

**Direct keys owned here:** Alt+1…9 goes to space N, and Ctrl+Shift+` opens a new pane in the active space. Ctrl+` stays in `workbench.js:1160-1165`.

**Escape:**
- Unarmed, Escape is never touched while focus is in xterm.
- Armed, it cancels and is swallowed.
- In overlays, Escape closes only the top overlay, on that overlay's own element with `stopPropagation`. Otherwise `app.js:1053-1059` would close the task drawer too.

### `termtoast.js`: toasts and sound

`createTermToasts(doc, ctx)` → `{push(ev)}`, plus `termTone(kind)`.

**Event sources:**
- `{t:'agent'}` websocket frames for held sessions;
- list diffs.

Both go through `TermTree.observe`.

**When a toast shows:** only if `document.hasFocus()` (so one page per browser shows it, and the Board page does toast for agents in the window), and only if the session isn't visible in this page's active space.

**The card:**
- Bottom-right, or top on the phone below the safe area.
- `--panel` background, `--line` border, `--shadow-3`.
- Content: a mark, then bold "Claude needs you" or "Claude finished" (`TW_AGENT_TEXT`), then `space · pane#`.
- It stays 8s for blocked and 5s for done.
- Clicking it calls `goTo`; on the main page that goes through `goToAgent`.

**Sound:** WebAudio tones at 0.05 gain, off by default. The `AudioContext` resumes on the first pointerdown or keydown (autoplay policy).

**Limitation:** if no VaultOS page has focus, there's no toast. The window title and the header badge still show it.

### Smaller edits

- **`term.js`**
  - `opts.onTitle` via `term.onTitleChange`, and `handle.title()`.
  - `if (e.ctrlKey && e.code === 'Space') return false;` in `attachCustomKeyEventHandler` (`:324`), as a guard.
  - `connect()` (`:430`) includes `cols`/`rows` only when `container.offsetWidth && container.offsetHeight`. The server already skips the resize when they're absent, and new ptys default to 100×30.
- **`workbench.js`**
  - The dock gets the new options at `:969-980`.
  - `pollAgents` becomes `TW.onList`.
  - `goToAgent` (`:1029`):
    - held: show the dock;
    - window-held, or "terminals open in" set to window: `openTermWindow` + `handToWindow`;
    - otherwise: bring into the dock.
  - Pop out (`:1115`) sends the active space.
  - `adoptReturned` (`:1126`) and `restoreTerminals` (`:1181`) go through `TW.adopt` / `TW.restore`.
  - "Agent sound: Off | On" is wired next to `segTermWhere` (`:1006-1013`).
- **`terminal.html`**
  - The header goes. The sidebar is expanded by default.
  - Theme and sound follow `storage` events.
  - `twAdopt(metas)` stays compatible.
- **`index.html`**: the script tags, plus the sound row in Appearance (`:105-128`).
- **Handoff stays backward compatible.** `public/` goes live the moment it merges, while an open pop-out keeps running the old JS. So `twAdopt(metas)`, `{returned: metas}` and `vaultboard.term.returning` all stay arrays. Extra data goes in additional args or keys that old code ignores.

## Across hosts

From host H's point of view:

| Session is | Row | Click |
|---|---|---|
| held here | normal | activate its space, focus the pane |
| in the window, seen from the dock | dim, tooltip "elsewhere: open in the Terminals window" | `openTermWindow` + `handToWindow` (twAdopt focuses it) |
| in the dock or another tab, seen from the window | dim, tooltip "elsewhere: open in the dock" / "open in another window" | bring here (steals it, code 4000) |
| attached, holder unknown | dim, tooltip "elsewhere: open in another window" | bring here |
| detached | dim, tooltip "detached: running in the background" | bring here |

- **Presence** runs over the existing `BroadcastChannel('vaultos-workbench')`:
  - each page posts `{presence:{from, host, ids}}` whenever its holdings change;
  - each page answers `{who}` on load;
  - each page posts an empty list on `pagehide`.
- Presence counts only while the list also says `attached`, which clears stale entries left by a crashed page. The server is unchanged; it only knows `attached`.
- When a session is stolen from H (code 4000), H removes the pane with `kill:false`, drops it from the saved set, and shows a neutral toast "… opened elsewhere". The row stays.
- **From the window,** a dock-held session can only be brought into the window. Popups can't reliably focus their opener.

## Data

- **Session meta** is unchanged: `{id,n,title,cwd,task}`. `title` is the custom pane name and travels with every handoff.
- **Tree store** `${store}.tree`, i.e. `vaultboard.term.tree` or `vaultboard.termwin.tree`. It lives in sessionStorage first, with a localStorage mirror.
  ```
  { v:1, active:'<key>', spaces:{ '<key>':{ root:Node, focus:'<id>', zoom:'<id>'|null } } }
  Node = { id } | { dir:'row'|'col', r:0.5, a:Node, b:Node }
  ```
- **New keys:**
  - `${store}.side` (dock `rail`, window `side`)
  - `vaultboard.term.spaceNames` (`{key:name}`, shared by both hosts, carried over on rekey)
  - `vaultboard.term.sound` (default false)
- **Migration:**
  - Delete `${store}.layout` and `${store}.ratios` for both stores. Trees build themselves through `reconcile`.
  - If the old layout was `'tabs'`, zoom each space to its focused pane, so five shells don't suddenly tile into a 340px dock.
  - A split that would leave a pane under about 140×70px still inserts the pane, then zooms it.
- **Rekey:** when a held session's key changes (server auto-link, or `/done` moved the task), move its leaf. If every leaf of the old key moves to the same new key, rename the tree and its custom name instead.

## Server

The pure helpers go in a new `lib/term-meta.js`. `lib/` is already a live read-only mount.

**`findJobTask(cwdFull, {vaultDir, wsDirs, skipDirs})`**
- Walks up from the cwd, only inside a `WORKSPACES` folder (`server.js:25-31`), and never up to the workspace root itself.
- Skips candidates containing a `SKIP_DIRS` segment (`server.js:57`) or a dot segment, so `job/data/` still links to `job/task.md`.
- Returns the vault-relative path or `''`.
- Called in the upgrade handler only when `!task && !TERMS.has(id)`.

**`taskInfo(t)`**
- Stats `t.task`, caches by mtime, and reads `parseFrontmatter` (`server.js:135`) into `{title, status}`, with `status` validated against `STATUSES`.
- If `task.md` is missing, tries `<parent>/_done/<name>/task.md` and then `_cancelled/`. Found: relinks `t.task`. Not found: returns `{missing:true}`.

**`gitBranch(cwdFull)`**
- Walks up to `VAULT_DIR` looking for `.git`. A directory: read `HEAD`. A file: follow `gitdir:`.
- `ref: refs/heads/X` gives X, otherwise a 7-character sha.
- 10s TTL cache.

**`/api/term/list`** (`server.js:2271-2282`)
- Becomes async and adds `taskTitle`, `taskStatus`, `taskMissing` and `branch`.
- Each field is wrapped in its own try/catch. Nothing is removed.

There is no new endpoint and no change to the websocket protocol.

**Release order**
1. The frontend ships first and degrades gracefully: names fall back to the task folder or the cwd.
2. The server part ships with one `vault-board` restart.

A restart kills every live pty, including overnight `claude` sessions. Check `docker exec vault-board ps -eo pid,etime,args` first, and restart only with Ben's OK.

## Phone (≤700px)

- There is no sidebar or rail.
- The top bar is a summary: `mark space · pane`, then a `≡ N` button showing the rollup across all terminals.
- Tapping either one opens the picker as a full-screen sheet.
- Only the focused pane shows. The others stay at full size with `visibility:hidden`, so switching never refits.
- The tree is kept but not drawn.
- Unchanged: the key row, the compose box, tap-to-focus, and touch scroll (owned by `term.js`).
- No prefix keys on the phone.

## CSS

- **Tokens only:**
  - Surfaces and text: `--bg --panel --panel-2 --line --text --muted --muted-2`.
  - `--accent` for the focused pane border and for focus.
  - `--brand` and `--on-brand` for the prefix pill only, within the terminal-spaces UI (the rest of the app uses them elsewhere).
  - Marks: `--in-progress`, `--review`, `--done`, `--muted-2`.
  - Also: `--mono-font --radius-* --shadow-3/4 --dur-micro --ease-out`.
- **The task status word stays muted,** which avoids a red/amber clash with the blocked mark.
- **Menus** reuse the `.fx-menu` look through a selector list `.fx-menu, .tw-menu`. `termui.js` can't call `workbench.js`'s menu code.
- **The Tabs/Tile section** (`styles.css:~2070-2250`) is replaced by a spaces, sidebar and panes section.
- **Deleted:**
  - Dead rules: `.term-head`, `.term-state*`, `.term-cta` (`2005-2025`), `.d-agent-state` (`2156-2157`), and their narrow-screen rules (`2066-2067`).
  - Replaced rules: `.tw-tabs`, `.tw-tab*`, `.tw-empty-tabs`, `.tw-layout*`, `.tw-detached*`, `.tw-add`, every `.term-area[data-layout="tile"]` rule, `.tw-pane-head`, the phone tile rules (`2224-2230`), the `.tw-layout` half of `.tw-layout, #term-pop` (`1620`), and the unfocused-pane dimming (`2218`).
  - `.term-pop-head`, `.term-title` and `.term-pop-hint`, once the window header goes.
- **Reduced motion** (`styles.css:317`):
  ```css
  .agent-dot[data-agent="working"], #termbtn[data-alert]::after, #mnav-term[data-alert]::after { animation: none !important; }
  ```

## Verification

- **Unit tests:** `test/termtree.test.js` and `test/term-meta.test.js`. Run with:
  ```
  docker run --rm -v "$PWD":/app -w /app node:22-bookworm-slim node --test test/termtree.test.js test/term-meta.test.js
  ```
- **End-to-end:**
  - `scripts/term-e2e.js` uses puppeteer, the host Chrome and a minted cookie.
  - It runs **against the preview on `127.0.0.1:7690` only, never `:7684`**, because clicking a dimmed row there would steal Ben's live sessions.
  - Fake agents: `scripts/term-fake-agent.js` posts hook events from its `VAULTOS_*` env and stays in the foreground, printing a dot every 2s so `sweepAgents` keeps its state. Keys `w`/`b`/`d` switch state.

| Scenario | What it checks |
|---|---|
| S0 | A shell echoes. The fake agent shows `blocked` in `/api/term/list`. |
| S1 | Split right and down, drag, double-click to even out, zoom, close. A reload keeps the arrangement. |
| S2 | A task space is named from task.md, the branch shows, and a rename persists. |
| S3 | Pop out a split space and close the popup: the sessions come back. A dock click on a window-held row focuses the popup. A Board-pill `goToAgent` works. |
| S4 | A second browser context steals a session. The first host drops the pane and dims the row, and a click brings it back. |
| S5 | A background blocked agent toasts on the focused page only. The click jumps. Done turns to idle once focused. Sound is off by default, and the setting is mirrored to the window. |
| S6 | Ctrl+Space twice gives `^@` in `cat -v`. Esc in xterm prints `^[` and doesn't close an open drawer. Prefix + Esc sends nothing. Ctrl+Space in the Board search box does nothing. Alt+2 goes to space 2. The `?` filter works. |
| S7 | Phone at 390×844 (`isMobile`, `hasTouch`): the summary, the switch sheet, tap to switch, and the key row and compose box still work. |
| S8 | Seeded old `.layout`/`.ratios` keys migrate and are removed. |
| S9 | Degraded mode: puppeteer request interception strips the new list fields. |
| S10 | Reduced motion: computed `animation-name` is `none`. |
| Resize | A reload with the dock minimised keeps a running `tput cols` at its real width. |

- **Screenshots:** desktop and phone, in Dark and Sepia. Every one is looked at (`CLAUDE.md:36-45`).
- **After the merge:** a short check on live, with Ben watching:
  - real Claude OSC titles and hook states render;
  - Ctrl+Space reaches the browser on his machine. Some OS input switchers take it; every command is also in the menus and the picker.

## Risks

| Risk | Handling |
|---|---|
| Ctrl+Space taken by the OS | Checked at the first preview. Every command has a menu or picker route too. |
| 12 WebGL contexts (Chrome's limit is about 16) | Fine for now. If the cap ever rises, use the DOM renderer for inactive spaces. |
| The 12-terminal cap | `canOpen` checks before creating and shows a toast. A server refusal still shows the existing ended-pane note. |
| Task renamed | The name updates on the next poll. |
| Task marked done | The detail line says done. |
| Task moved by `/done` | Relinked and rekeyed. |
| Task moved by hand | `taskMissing`, shown as the folder name plus "task moved". |
| Session handed off mid-split | The sender's sibling pane expands. The receiver uses `insertLargest`. A drag in progress aborts if its node disappears. |
| Corrupt storage | `parseStore` returns an empty store. |
| Signed out, or same-box read | The list returns 401, so the sidebar shows held sessions only. |
| No BroadcastChannel | Rows read "open elsewhere". |
| Claude's spinner title churning | Titles are normalised, and the strip updates only when the text changes. |
| Server restart | Pages reconnect to fresh shells under the same ids (existing behaviour), and those shells now get auto-linked. |

## Not in this round

- Resume after restart (`claude --resume <id>`): `session_id` is already captured in `t.agent.sessionId`.
- A Telegram "needs you" ping.
- A `vaultos` CLI for agent-to-agent control.
- Tabs inside a space.
- Live cwd tracking.
- Ahead/behind counts.
- Theme lists.

## Decisions made during implementation

Written after Tasks 0–11 landed. Where this section and the text above disagree, this section and the code win. Each item was checked against the code.

**Rulings during the build**
- **Add keeps saved leaves (R4).** `add()` keeps a leaf already in the saved tree for that id, with no second insert, so a reload (which re-adds every saved session) keeps the arrangement. Placement happens only for ids missing from the tree.
- **Split direction (R6).** `create({split:'right'})` makes a `row` split and `'down'` a `col` (`TermTree.insert(..., {dir})`). `row` is side by side, `col` is stacked.
- **`heldIds` (R8).** The Space field is `heldIds`, not `held`.
- **Window path cap (R12).** The 12-terminal cap is also checked on the dock-to-window path. `TW.canOpen()` returns false and emits `{kind:'cap'}` (the toast), and `workbench.js` `termOpen` calls it before minting an id for the window, since the window adds without a cap check. Since the final review it calls it only when a new shell would start there: a minted id (cwd or run), or no window open yet (a fresh window starts a shell of its own). With no args and the window open, `termOpen()` just raises it, at the cap too.
- **Restore focus (R13).** One rule, the same whatever the timing (including whether the 2s attached-elsewhere wait ran): a pane the user picked during the restore wins; else the saved focus if it is still held; else the last held returning pane; else the saved active space.
- **Prefix is plain Ctrl+Space (R14).** Ctrl+Shift, Alt and Meta variants do not arm it, in both `termkeys.js` and the guard in `term.js`.
- **No pattern kills (R15).** The preview and e2e rules forbid `pkill`/`killall`, because the host's process table includes vault-board, which holds Ben's live sessions.

**Task-level decisions**
- **Task 5, migration zoom.** The Tabs migration zooms each space lazily, the first time that space's tree is built after load (`place` calls `migrateZoom`), not once after the first restore.
- **Task 6, pop out.** Pop out hands over the whole active space (`TW.popSpace(key)`), not one pane.
- **Task 8, hidden fit.** `term.js` wraps `fit.fit` and drops a row when FitAddon's count would overflow the box at a fractional devicePixelRatio. `.term-host .xterm-viewport` is transparent, which removes the black band at the pane bottom.
- **Task 10, toast visibility.** An agent toast shows unless the pane is actually visible: the workspace is shown (`isActive`), the pane is in the active space, and it is not hidden by zoom. On a phone only the focused pane counts. A same-id, same-kind toast replaces the older one.
- **Task 11, dimmed rows.** Dimmed rows (detached or elsewhere) use `--muted` italic text with the full mark colour, not opacity, for contrast (opacity gave 2.3 to 2.6:1 in Sepia). The unused `.tw-split.v/.h` rules and the leftover `.term-pop-hint` media rule were deleted.
- **Test-only.** The e2e `noGL` page option removes the WebGL renderer, because headless `--disable-gpu` WebGL paints nothing at deviceScaleFactor 2 (it made phone panes look blank). The WebGL path on a real phone is a live check.

**Where the code differs from the design above**
- **API shapes.** `createTermPicker(ctx)` takes one argument, not `(doc, ctx)`. Toasts are `TermToast.create(ctx)` plus `TermToast.tone(kind)`, not `createTermToasts`. `TermToast` exposes `{create, tone}`.
- **Sidebar.** The "new" button is a `+` in the "spaces" header (rail: a `+` row), not in the footer. The footer holds `menu` (rail: `⋯`) and a collapse toggle. The footer menu has Go to…, Shortcuts and a Sound toggle.
- **Window sound.** `terminal.html` follows `storage` events for the theme only. Sound is read from localStorage when an event fires, so the setting still applies live.
- **Cross-host table.** The table in "Across hosts" now carries the code's tooltip wording. The window has no `goElsewhere`: a window-side click on a dock-held row always brings it here. A blocked pop-up makes `goTo`/`goToAgent` fall back to bringing the session into the dock, which steals it from the window.
- **Spaces `dim` and numbers** (final review; before it, a space was dimmed only when every row was detached, every space was numbered, and Alt+N counted this page's spaces in the order they were added). A space is dimmed when no pane of it is held here (detached, elsewhere, or both). Only spaces with a pane here are numbered (`num`, in list order), the sidebar and rail show those numbers, and Alt+N goes to the space numbered N, so a keystroke never steals a session. A space without a pane here shows its mark (and, in the sidebar, its name) with no number, and its tooltip ends in the where-note of the row a click goes to. That click goes to `goId`, the space's most urgent row (`agentOrder`), else its first, through `goTo`, so the cross-host table applies; it used to do nothing.
- **Toast text.** The cap toast reads "12 terminals open · Close one to open another". The moved toast reads "<name> opened elsewhere".
- **Not split out.** `termui.js` stayed one file (about 1400 lines, Ruling R11). Splitting the server-list, presence and restore parts out is a follow-up.

**Final review fixes (2026-10-07)**
- **Hidden reconnect.** `term.js` keeps a `sized` flag, set the first time the fit runs on a real box. A connect from a hidden box sends the last real size when `sized` (none when not: Task 3's rule), and owes the server a size either way: the first fit on a real box with the socket open sends `{t:'resize'}` even when unchanged, and so does `ws.onopen` if the box is shown by then. A resize while the socket is down is owed too. Before, a server restart with the dock minimised left the fresh pty at 100×30.
- **Phone.** Every pane is drawn full size (`.tw-root[data-phone] .tw-pane`), the hidden ones too, as the Phone section says; only the focused one is visible. A hidden sibling used to keep its split-tree size, and every switch resized two ptys.
- **History-free cols.** The `term.js` fit wrapper takes cols from the renderer's unrounded cell width (`device.cell.width / dpr`) over FitAddon's own available width, within one column of FitAddon's answer. FitAddon divides by the css cell width, which is the canvas rounded to whole pixels over the current cols, so equal boxes could settle a column apart depending on what the pane was before (51 and 52 on a phone after a split).
- **Direct keys under overlays.** Alt+N and Ctrl+Shift+` do nothing while the `?` sheet or the Go-to picker is open (`ctx.overlayOpen`).
- **The `?` sheet** lists Ctrl+` (show or hide the terminals) on the dock host only.
- **The e2e URL guard** is an allowlist: only `http://127.0.0.1:7690` unless `TERM_E2E_OTHER_BASE=1`, and never port 7684.

**Release status.** Task 13 has not happened. Order when it does: 1) fast-forward master (the frontend is live on :7684 at once; names fall back to folders until the server restarts); 2) restart `vault-board` only with Ben's OK, since the restart kills live terminal sessions.
