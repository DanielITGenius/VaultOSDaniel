# Portable VaultOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One VaultOS image that starts blank on any machine with Docker, walks the user through a five-step setup, runs any coding agent in its terminal, and still runs Ben's homelab with its existing data.

**Architecture:**
- New pure-ish modules in `lib/` carry the logic, each with its own `node:test` file: `password`, `settings`, `migrate`, `setup`, `starter-kit`, `agents`, `host-check`.
- `server.js` swaps the hardcoded `WORKSPACES` registry for `.vaultos/settings.json`, gains setup and settings routes, and gates Today, the terminal and the no-login read path behind settings and env vars.
- The browser side adds one standalone page (`public/setup.html` + `setup.js`), and four new sections in the existing Settings sheet.
- Server behaviour is tested by spawning `server.js` against temp folders (`test/helpers/server.js`). The UI is tested with puppeteer against a preview container on `127.0.0.1:7692`.

**Tech Stack:** Node 22 (container) / 24 (host), CommonJS, Express 5, `node:test`, puppeteer from the npx cache, Docker. No new npm dependencies. The image gains the `curl` and `tini` apt packages.

**Spec:** `docs/superpowers/specs/2026-10-13-portable-vaultos-design.md`. Read it before Task 1. Every value below comes from it.

**Workspace:** worktree `/opt/vault/board-portable`, branch `portable`. Paths are relative to it unless absolute. `/opt/vault/board` is the **live** checkout, and `/opt/vault/docker-compose.yml` is the live compose file. Never edit either outside a release Ben has approved.

## Global Constraints

- **Settings file:** `<VAULT_DIR>/.vaultos/settings.json`, schema version `1`.
- **`DATA_DIR`:** defaults to `path.join(os.homedir(), '.vaultos')` and holds `config.json`, `lockout.json` and `sheet-backups/`.
- **Env vars and defaults:**
  - `VAULT_DIR=/vault`
  - `DATA_DIR=$HOME/.vaultos`
  - `LOCAL_READ` off unless `1`
  - `ALLOWED_HOSTS=localhost,127.0.0.1`
  - `SECURE_COOKIE` off unless `1`
  - `TRUST_PROXY` off unless `1`
  - `TERMINAL` on unless `0`
  - `SETUP_WINDOW_MIN=15` (an integer ≥ 0; `0` closes the window at once and is used by tests)
  - `SHEET_BACKUP_DIR=$DATA_DIR/sheet-backups`
- **Input limits:** password at least 8 characters; board label 1–60 characters; at most 10 boards in one setup request.
- **Board statuses:** `backlog | scheduled | in-progress | blocked | needs-decision | review | done`. Column titles come from `COLUMN_TITLES` in `server.js:762`.
- **Agent constants:**
  - Hook command, exactly: `[ -n "$VAULTOS_TERM_ID" ] && node "$HOME/.claude/hooks/vaultos-state.js" || true`, in entries shaped `{ "hooks": [{ "type": "command", "command": <cmd>, "timeout": 5 }] }`
  - Hook events: `SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop, SessionEnd`
  - Kickoff prompt, unchanged from `public/workbench.js:948`: `Catch me up on this task. From task.md (Plan, Progress log, Comments), give me a short brief: where it stands, what is done, what is next, and anything blocked or waiting on me. Then suggest what we tackle today. Do not start the work or change any files until I say so.`
  - `AGENT_QUIET_MS = 20e3` (existing).
- **Nothing personal in new code, the starter kit, tests or fixtures:** no person or employer names, no workspace names from Ben's vault (Personal, Lancashire, Sucden, Business, Health), and no hostnames, domains or IPs. The only exceptions are the homelab `docker-compose.yml` and `CLAUDE.md`. Fixtures use names like `Work`, `alpha`, `Beta`.
- **Writes:** every vault and settings write goes through `atomicWrite` (`lib/atomic-write.js`). Text read from the vault or settings goes into the DOM with `textContent`, never `innerHTML` (or through the existing `esc()`).
- **Where tests run:**
  - Server tests spawn `server.js` on a free port with `TERMINAL=0`, `TODAY_QUOTES=0` and temp `VAULT_DIR`, `DATA_DIR` and `HOME`. They never use the network.
  - E2E runs only against `http://127.0.0.1:7692`, **never** `:7684`.
- **Never** restart, rebuild or recreate `vault-board` without Ben's explicit OK. It kills his live terminals.
- **Code and commit style:**
  - `'use strict'`, CommonJS, `node:test` + `node:assert/strict`, and the comment density of the surrounding code.
  - Commit messages are `Portable: <what>` and end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` passes after every task. Task 0 records the baseline.

## Review Focus

1. **A board label with no usable characters** (`🚀`, `!!!`) is refused with "A board name needs a letter or number", and no folder is created. Tested in Task 2 (`boardDirName refuses labels with nothing usable`) and Task 9 (`boards with no usable label create nothing`).
2. **Two boards differing only by case** (`work` next to `Work`) are one folder on a Windows or macOS mount, so they are refused as a clash. Tested in Task 2 (`addBoard clash is case-insensitive`).
3. **Setup step 2 submitted twice at once** (double click, two tabs): exactly one wins, the other gets 409, and `config.json` holds one hash. Tested in Task 9 (`concurrent password posts: one wins`).
4. **A user's own `AGENTS.md` or `CLAUDE.md`** without the markers is never modified: setup does not overwrite it and board changes do not touch it. Tested in Task 5 (`own AGENTS.md without markers is never touched`).
5. **A broken `settings.json`** (bad JSON from a sync conflict, a hand edit) is never overwritten. `/health` still answers, and the setup page shows the error. Tested in Task 8 (`invalid settings.json is reported, not replaced`).

---

### Task 0: Baseline and spikes

Throwaway checks. The only commit is the findings note.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-portable-vaultos-design.md` (append `## Decisions made during implementation`)

- [ ] **Step 1: Install and record the baseline.** `cd /opt/vault/board-portable && npm ci && npm test 2>&1 | tail -5`. Record the `pass` count. Expected: 0 failures.
- [ ] **Step 2: Start a scratch container.** `docker run -d --name portable-spike node:22-bookworm-slim sleep infinity`, then `docker exec portable-spike sh -c 'apt-get update && apt-get install -y curl ca-certificates procps && install -d -o 1000 -g 1000 /home/spike'`.
- [ ] **Step 3: Cursor CLI.**
  - Install with `docker exec -u 1000 -e HOME=/home/spike portable-spike bash -lc 'curl https://cursor.com/install -fsS | bash; ls -la ~/.local/bin; command -v agent cursor-agent'`. Record the install path and binary names.
  - Run `docker exec -it -u 1000 -e HOME=/home/spike -e NO_OPEN_BROWSER=1 portable-spike bash -lc 'agent login'`. **Ben opens the printed URL.** Record whether sign-in completes and survives a second `docker exec` (`agent status`). If the CLI complains about a keyring, record the error.
  - With `agent` running in one `docker exec -it`, record `docker exec portable-spike sh -c 'for p in $(pgrep -u 1000); do tr "\0" " " < /proc/$p/cmdline; echo; done'`. node-pty reports `basename(argv[0])` of the foreground process, so the first word of the agent's line is the name that matters.
  - Check `agent --help` and https://cursor.com/docs/cli for custom slash commands in `.cursor/commands/`. Record yes or no.
- [ ] **Step 4: Claude Code.** Same container: `curl -fsSL https://claude.ai/install.sh | bash` as uid 1000. Record the path (`command -v claude`), `claude --version`, and argv[0] while it runs.
- [ ] **Step 5: Clean up and write it down.**
  - `docker rm -f portable-spike`.
  - Append the findings to the spec under `## Decisions made during implementation`: install paths, process names, Cursor sign-in result (or "use `CURSOR_API_KEY`"), and `.cursor/commands` yes/no.
  - If a path or name differs from the spec's agent table, fix the table in the same edit.
- [ ] **Step 6: Commit** (`git commit -am "Portable: spike findings"`).

### Task 1: Password and config in `DATA_DIR`

**Files:**
- Create: `lib/password.js`
- Modify: `set-password.js`
- Test: `test/password.test.js`

**Interfaces — Produces:**
- `MIN_PASSWORD = 8`
- `dataDirFrom(env) → string`
- `readConfig(dataDir) → { salt, passwordHash, sessionSecret } | null`: null when the file is missing; throws on bad JSON.
- `writePassword(dataDir, password, { sessionSecret } = {}) → config`
  - **Synchronous** (Task 9 relies on that for the double-submit guard).
  - Runs `mkdirSync(dataDir, { recursive: true, mode: 0o700 })`.
  - Keeps an existing `sessionSecret`; otherwise uses the one given, otherwise 32 random bytes in hex.
  - Writes `config.json` with mode `0o600`.
  - Rewrites `lockout.json` to `{"attempts":0,"lockedUntil":0,"lockLevel":0}`, and never unlinks it.
  - Throws `Error('Password must be at least 8 characters')` when the password is too short.
- `verifyPassword(config, password) → boolean`: scrypt, keylen 64, `timingSafeEqual`, the same as `server.js:75`.
- `readLockout(dataDir)`, `writeLockout(dataDir, state)`: the same as `server.js:83-89`, with the path moved.

- [ ] **Step 1: Write the failing tests.**
  - `writePassword creates the dir and a verifiable config`: `salt` matches `/^[0-9a-f]{32}$/`, `passwordHash` matches `/^[0-9a-f]{128}$/`, `verifyPassword(cfg,'correct horse')===true`, `verifyPassword(cfg,'wrong')===false`.
  - `keeps an existing sessionSecret`.
  - `uses the given sessionSecret when there is no config`.
  - `lockout.json is rewritten in place`: create it, record `statSync().ino`, call `writePassword`, assert the same `ino` and the reset content.
  - `refuses a 7-character password`.
  - `readConfig returns null when missing`.
  - `dataDirFrom`: `{DATA_DIR:'/x'}` → `/x`; `{}` → `path.join(os.homedir(), '.vaultos')`.
- [ ] **Step 2: Run them and see them fail.** `node --test test/password.test.js`. Expected: FAIL, cannot find `../lib/password`.
- [ ] **Step 3: Implement `lib/password.js`.** Point `set-password.js` at `writePassword(dataDirFrom(process.env), argv[2])` and keep its usage text and exit codes.
- [ ] **Step 4: Run the tests.** `node --test test/password.test.js`, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** (`Portable: password and lockout live in DATA_DIR`).

### Task 2: Settings model and store

**Files:**
- Create: `lib/settings.js`
- Test: `test/settings.test.js`

**Interfaces — Produces** (pure functions return new objects and never mutate their input):
- `SETTINGS_REL = '.vaultos/settings.json'`
- `defaults() → Settings`, exactly `{ version: 1, setupDone: false, boards: [], features: { today: false, terminal: true }, today: { dir: 'Today', timezone: 'UTC' }, agent: { profile: 'none' } }`
- `validate(raw) → Settings`
  - Missing sections are filled from `defaults()`.
  - Throws `Error('settings.json: <what>')` on a wrong type, `version !== 1`, a duplicate board key or (case-insensitive) dir, an invalid board, a `today.dir` that is absolute or contains `..`, a timezone that `Intl.DateTimeFormat` rejects, a profile not in `['claude','cursor','custom','none']`, or a `custom` profile whose `start` lacks `{prompt}` or which has no `label`/`detect`.
  - A board is `{ key, dir, label, hidden }`: `key` matches `/^[a-z0-9][a-z0-9._-]*$/`; `dir` has no `/` or `\` and does not start with `.` or `_`; `label` is 1–60 characters; `hidden` is a boolean.
- `boardDirName(label) → string`: removes characters outside `[A-Za-z0-9 _.-]`, collapses whitespace, trims, strips leading `.`/`_`, cuts to 60 and trims again. Throws `Error('A board name needs a letter or number')` when nothing alphanumeric is left.
- `boardKey(dir) → string`: lowercase, runs of spaces become `-`.
- `addBoard(s, label) → { settings, board }`: label trimmed. Throws `Error('A board called "<label>" already exists')` when the key or dir clashes case-insensitively.
- `addExistingBoard(s, dir, { todayDir }) → { settings, board }`: label = dir. Refuses a `.`/`_` dir, and `todayDir` with `Error("That folder is Today's")`.
- `updateBoard(s, key, { label, hidden, index }) → Settings`: `index` is 0-based and clamped. Errors: `'Unknown board'`, `'At least one board must stay visible'`.
- `visibleBoards(s) → Board[]`
- `createSettingsStore(vaultDir) → { file, load(): Settings|null, current(): Settings|null, save(next): Promise<Settings> }`. `load` validates and throws on a bad file. `save` validates, makes `.vaultos/`, calls `atomicWrite` with 2-space JSON plus `\n`, and updates `current()`.

- [ ] **Step 1: Write the failing tests.**
  - `defaults validate`.
  - `validate fills missing sections` (input `{version:1}`).
  - `validate rejects …`: one `assert.throws(…, /^Error: settings\.json:/)` per rule above.
  - `boardDirName`: `'Work'→'Work'`, `"Team's Work!"→'Teams Work'`, `'  a   b '→'a b'`, `'_x'→'x'`, `'.x'→'x'`, a 70-character label → length 60.
  - `boardDirName refuses labels with nothing usable` (`'🚀'`, `'!!!'`).
  - `boardKey('Teams Work')==='teams-work'`, `boardKey('A.B_c')==='a.b_c'`.
  - `addBoard appends a visible board`.
  - `addBoard clash is case-insensitive` (`Work`, then `work`).
  - `addExistingBoard refuses Today's folder and dot folders`.
  - `updateBoard renames, hides, moves`; `refuses hiding the last visible board`; `unknown key`.
  - `store round-trips and leaves no temp file`.
  - `store load throws on bad JSON` (message includes `settings.json`).
- [ ] **Step 2: Run them and see them fail.** `node --test test/settings.test.js`
- [ ] **Step 3: Implement `lib/settings.js`.**
- [ ] **Step 4: Run the tests.** `node --test test/settings.test.js && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** (`Portable: settings model and store`).

### Task 3: Homelab migration

**Files:**
- Create: `lib/migrate.js`
- Test: `test/migrate.test.js`

**Interfaces:**
- **Consumes:** `validate`, `defaults`, `boardKey` (Task 2).
- **Produces:**
  - `findBoards(vaultDir) → Promise<string[]>`: top-level non-dot folders that contain `_tasks/Board.md`, sorted with `localeCompare(b, undefined, { sensitivity: 'base' })`.
  - `findTodayDir(vaultDir) → Promise<string|null>`: POSIX path relative to the vault, of a folder named `Today` holding `habits.md`, at depth 1 (`Today`) or 2 (`X/Today`).
  - `legacySettings(vaultDir, { env, hasCommand }) → Promise<Settings|null>`: `hasCommand(name) → Promise<boolean>`. Writes nothing. Returns null when there are no boards.

- [ ] **Step 1: Write the failing tests.** The fixture is built in a temp dir: `Beta/_tasks/Board.md`, `alpha/_tasks/Board.md`, `Gamma/notes.md`, `.obsidian/x`, `Beta/Today/habits.md`, and `a/b/Today/habits.md` (depth 3, ignored).
  - `findBoards sorts case-insensitively` → `['alpha','Beta']`.
  - `findTodayDir finds depth 1–2 only` → `'Beta/Today'`; null after removing it.
  - `legacySettings maps the vault`: `env {TZ:'Europe/London'}`, `hasCommand` → true. `deepEqual` to `{version:1,setupDone:true,boards:[{key:'alpha',dir:'alpha',label:'alpha',hidden:false},{key:'beta',dir:'Beta',label:'Beta',hidden:false}],features:{today:true,terminal:true},today:{dir:'Beta/Today',timezone:'Europe/London'},agent:{profile:'claude'}}`.
  - `TERMINAL=0, no claude, no TZ, no Today` → `terminal:false`, `profile:'none'`, `timezone:'UTC'`, `today:false`, `today.dir:'Today'`.
  - `no boards → null`.
  - `writes nothing`: the recursive path list and mtimes are equal before and after.
  - `ignores workspace-visibility.json`: a `{"beta":true}` file in a sibling data dir leaves every board visible.
- [ ] **Step 2: Run them and see them fail.** `node --test test/migrate.test.js`
- [ ] **Step 3: Implement `lib/migrate.js`.**
- [ ] **Step 4: Run the tests.** `node --test test/migrate.test.js && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** (`Portable: derive settings from an existing vault`).

### Task 4: Setup checks

**Files:**
- Create: `lib/setup.js`
- Test: `test/setup.test.js`

**Interfaces:**
- **Consumes:** `SETTINGS_REL`, `validate` (Task 2).
- **Produces:**
  - `isMounted(dir, stat = fs.statSync) → boolean`: `stat(dir).dev !== stat('/').dev`.
  - `folderCheck(vaultDir, { stat, probeWrite } = {}) → Promise<{ mounted, writable, state: 'existing'|'empty'|'has-files', boardCount }>`
    - The default `probeWrite` writes and deletes `<vault>/.vaultos-write-test`, in the vault root so that nothing is created inside `.vaultos/` before the user goes ahead.
    - `existing` = a valid settings file is present. `empty` = no non-dot entries.
  - `setupStage({ hasPassword, settings, settingsError }) → 'full'|'existing-folder'|'boards'|'resume'|'done'|'broken'`. `broken` when `settingsError`; otherwise the spec's table. Migration happens at boot, so `migrate` is never a runtime stage.
  - `stepsFor(stage, settings) → number[]`: `full [1,2,3,4,5]`, `existing-folder [1,2,4]`, `boards [3,4,5]`, `resume` → `[4,5]` if `settings.boards.length`, else `[3,4,5]`, `done []`, `broken [1]`.
  - `windowOpen(startedAt, now, minutes) → boolean`: `now - startedAt < minutes * 60e3`.

- [ ] **Step 1: Write the failing tests.**
  - `isMounted` with stubbed `dev` values.
  - `folderCheck states`:
    - an empty dir is `empty`;
    - only `.stfolder` is `empty`;
    - `notes.md` is `has-files`;
    - a valid settings file with 2 boards is `existing` with `boardCount 2`;
    - `writable true` leaves no `.vaultos-write-test` behind;
    - a `probeWrite` that throws gives `writable false`.
  - `setupStage`: one assertion per row of the spec's table, plus `broken`.
  - `stepsFor`: each stage.
  - `windowOpen`: `(0, 899999, 15)` true; `(0, 900000, 15)` false; minutes `0` always false.
- [ ] **Step 2: Run them and see them fail.** `node --test test/setup.test.js`
- [ ] **Step 3: Implement `lib/setup.js`.**
- [ ] **Step 4: Run the tests.** Expected: PASS, and `npm test` PASS.
- [ ] **Step 5: Commit** (`Portable: setup stage and folder checks`).

### Task 5: Starter kit

**Files:**
- Create under `starter-kit/`:
  - `root/AGENTS.md`, `root/CLAUDE.md`
  - `root/.vaultos/guides/new-task.md`, `done.md`, `new-subtask.md`
  - `root/.claude/commands/new-task.md`, `done.md`, `new-subtask.md`
  - only if Task 0 found the CLI reads them: `root/.cursor/commands/new-task.md`, `done.md`, `new-subtask.md`
  - `board/_tasks/Board.md`, `board/_tasks/_Templates/task.md`, `board/_tasks/_Templates/article.md`
  - `welcome/1. getting-started/01-welcome-to-vaultos/task.md`
- Create: `lib/starter-kit.js`
- Test: `test/starter-kit.test.js`

**Content:**
- **Sources:** `/opt/vault/vault/.claude/commands/{new-task,done,new-subtask}.md`, `/opt/vault/vault/Personal/_tasks/_Templates/{task,article}.md`, `/opt/vault/vault/Personal/_tasks/README.md`. Read them; never edit them.
- **Removals:** everything named in Global Constraints, plus ticket and CAB examples (`INC…`, change dates). Routing becomes "pick the board from the list in AGENTS.md; if none fits, ask". `owner:` is blank.
- **`AGENTS.md`:** contains the markers `<!-- vaultos:boards -->` and `<!-- /vaultos:boards -->` around the board list.
- **`CLAUDE.md`:** exactly `@AGENTS.md\n`.
- **Slash commands:** each `.claude/commands/*.md` keeps a `description:` frontmatter, and its body is `Follow .vaultos/guides/<name>.md for: $ARGUMENTS`.
- **`Board.md`:** what `regenerateBoard()` writes for an empty board. That is the header `---`, ``, `kanban-plugin: board`, ``, `---`, ``, then `## <title>` and a blank line for each of the 7 `COLUMN_TITLES` in status order, `**Complete**` under Done, and the `%% kanban:settings` block from `server.js:785-791`.
- **Welcome task:**
  - Frontmatter: `type: task`, `id: welcome-to-vaultos`, `aliases: ["welcome-to-vaultos"]`, `title: "Welcome to VaultOS"`, `status: backlog`, `priority: low`, `created: {{today}}`, `updated: {{today}}`.
  - `## Goal`: one line.
  - `## Plan`, with these four checkboxes:
    - Move this card to In Progress.
    - Open the card's folder in Files.
    - If you skipped it during setup, sign your coding agent in from Settings → Agent.
    - Press Start agent on this card for a brief.
  - `## Progress log`: `- {{today}} — created by setup.`

**Interfaces — Produces:**
- `KIT_DIR = path.join(__dirname, '..', 'starter-kit')`
- `boardsBlock(boards) → string`: one line per board, in order: ``- **<label>** → `<dir>/` ``
- `writeRootKit(vaultDir, boards, { cursor = false } = {}) → Promise<string[]>`: copies `root/` files that are missing; fills the block in a new `AGENTS.md`; returns the POSIX paths written.
- `writeBoardKit(vaultDir, board, { welcome = false, today }) → Promise<string[]>`: creates `<dir>/`, copies the missing `board/` files, and with `welcome` the `welcome/` tree, with `{{today}}` replaced.
- `updateAgentsBlock(vaultDir, boards) → Promise<boolean>`: rewrites only between the markers. Returns false when there is no file, a marker is missing, or nothing changed.

- [ ] **Step 1: Write the failing tests.**
  - `writeRootKit into an empty vault writes the expected list` (exact sorted array; the AGENTS block has ``- **Work** → `Work/` ``).
  - `second writeRootKit writes nothing` and an edited AGENTS.md stays byte-identical.
  - `own AGENTS.md without markers is never touched`: a pre-existing `AGENTS.md` with `# mine\n` is unchanged after `writeRootKit` and after `updateAgentsBlock` (returns false). Same check for `CLAUDE.md`.
  - `updateAgentsBlock replaces only between markers`: text before and after is byte-identical.
  - `writeBoardKit with welcome`: `Work/_tasks/Board.md` contains `kanban-plugin: board` and all 7 `## ` titles; the welcome `task.md` has `status: backlog` and today's ISO date, and contains no `{{`.
  - `writeBoardKit never overwrites a template`.
  - `.cursor/commands only with cursor:true`.
  - `kit has nothing personal`: walk `starter-kit/` and assert no file matches `/\b(Ben|Lancashire|Sucden|ctrlaltautomate|outageindex|gitea\.home)\b|192\.168\./`.
- [ ] **Step 2: Run them and see them fail.** `node --test test/starter-kit.test.js`
- [ ] **Step 3: Write the kit files and `lib/starter-kit.js`.**
- [ ] **Step 4: Run the tests.** Expected: PASS, and `npm test` PASS.
- [ ] **Step 5: Commit** (`Portable: generic starter kit`).

### Task 6: Agent profiles

**Files:**
- Create: `lib/agents.js`
- Test: `test/agents.test.js`

**Interfaces — Produces:**
- `PROFILES`, with values corrected by Task 0:
  - `claude`: `{ id:'claude', label:'Claude Code', detect:['claude'], proc:['claude'], install:'curl -fsSL https://claude.ai/install.sh | bash', login:'claude', start:'claude {prompt}', hooks:'claude' }`
  - `cursor`: `{ id:'cursor', label:'Cursor CLI', detect:['agent','cursor-agent'], proc:['agent','cursor-agent'], install:'curl https://cursor.com/install -fsS | bash', login:'NO_OPEN_BROWSER=1 agent login', start:'agent {prompt}', hooks:null }`
- `KICKOFF_PROMPT` (exact text from Global Constraints).
- `profileFor(settings) → Profile|null`: `none` → null. `custom` → built from `settings.agent.custom` with `detect:[detect]`, `proc:[detect]`, `hooks:null`.
- `shellQuote(s) → string`: wraps in single quotes; `'` becomes `'\''`.
- `startCommand(profile, prompt) → string`: replaces `{prompt}` with `shellQuote(prompt)`.
- `isInstalled(profile, { run }) → Promise<boolean>`: true if any `detect` name gives `run(\`command -v ${name}\`)` → `{ code: 0 }`. The default `run` uses `bash -lc` with the process env.
- `HOOK_CMD`, `HOOK_EVENTS` (Global Constraints).
- `installClaudeHook(home, hookSrc) → Promise<boolean>`
  - Copies `hookSrc` to `<home>/.claude/hooks/vaultos-state.js` only if the contents differ.
  - For each event in `<home>/.claude/settings.json`, appends the entry if no existing hook command contains `vaultos-state.js`. Every other key stays as it was.
  - Returns whether anything changed.
- `processMatches(profile, cmd) → boolean`: `profile.proc.includes(path.basename(cmd))`.
- `processState({ running, quietMs }) → 'working'|'idle'|null`: `!running` → null; `quietMs > 20e3` → `'idle'`; otherwise `'working'`.

- [ ] **Step 1: Write the failing tests.**
  - `shellQuote("it's")` gives `'it'\''s'`.
  - `startCommand(PROFILES.claude, 'Catch me up')` gives `claude 'Catch me up'`.
  - `custom start template`: `aider --message {prompt}` gives `aider --message 'x'`.
  - `profileFor none is null`.
  - `isInstalled tries each detect name`, using a stubbed `run`.
  - `installClaudeHook writes the hook and 8 events`, with the exact entry shape from Global Constraints.
  - `installClaudeHook is idempotent`: the second call returns false and the file is byte-identical.
  - `installClaudeHook keeps other settings and hooks`: a pre-existing `{ model:'x', hooks:{ Stop:[{hooks:[{type:'command',command:'echo hi'}]}] } }` keeps `model` and the `echo hi` entry.
  - `processMatches` and `processState` cases: running+quiet 5 s → working; running+quiet 25 s → idle; not running → null.
- [ ] **Step 2: Run them and see them fail.** `node --test test/agents.test.js`
- [ ] **Step 3: Implement `lib/agents.js`.**
- [ ] **Step 4: Run the tests.** Expected: PASS, and `npm test` PASS.
- [ ] **Step 5: Commit** (`Portable: agent profiles`).

### Task 7: Today's timezone, stop and starter habits

**Files:**
- Modify: `lib/today-note.js` (formatters `:5-12`, `DEFAULT_HABITS_MD :31-44`, exports `:388`)
- Modify: `lib/today-service.js` (`createToday :16`, `todayDate :18`, the timer handle `:246-249`, `focus :265-274`, return `:342`)
- Modify: `scripts/today-sandbox.js`
- Test: `test/today-note.test.js`, `test/today-service.test.js`; create `test/today-fixtures.js`

**Interfaces — Produces:**
- `zonedDate(d, timeZone) → 'YYYY-MM-DD'` and `zonedTime(d, timeZone) → 'HH:MM'`. Cache one `Intl.DateTimeFormat` per zone. `londonDate`/`londonTime` stay as wrappers for `'Europe/London'`.
- `createToday({ …, timeZone = 'Europe/London' })` uses `zonedDate`/`zonedTime` with it. The payload gains `timeZone`. The return object gains `stop()`, which clears the pending timer handle; a completion never fires after `stop()`.
- The new `DEFAULT_HABITS_MD` rows, under the existing header and help line:
  - `| move | Move 30m | walk | |`
  - `| read | Read 30m | book | 30 |`
  - `| learn | Learn something | cap | 60 |`
  - `| water | Drink water | droplet | |`
  - `| plan | Plan tomorrow | pen | |`

- [ ] **Step 1: Move the old habits into a fixture.** Copy the current `DEFAULT_HABITS_MD` text verbatim into `test/today-fixtures.js` as `LEGACY_HABITS_MD`. Point every test, and `scripts/today-sandbox.js`, that depends on the old rows at it. Run `npm test`. Expected: PASS, with nothing else changed yet.
- [ ] **Step 2: Write the failing tests.**
  - `zonedDate across midnight`: `new Date('2026-07-01T23:30:00Z')` is `2026-07-02` in London and `2026-07-01` in `America/New_York`; `zonedTime` in London is `00:30`.
  - `payload uses the configured timezone`: `timeZone:'America/New_York'`, now `2026-10-12T02:00:00Z` → `payload.today === '2026-10-11'` and `payload.timeZone === 'America/New_York'`.
  - `stop cancels a running timer`: fake `timers`; start a focus; `stop()`; assert `clear` was called and no completion ran.
  - `starter habits parse`: ids `['move','read','learn','water','plan']`, no warnings.
- [ ] **Step 3: Run them and see them fail.** `node --test test/today-note.test.js test/today-service.test.js`
- [ ] **Step 4: Implement the changes.**
- [ ] **Step 5: Run the tests.** Expected: PASS, and `npm test` PASS.
- [ ] **Step 6: Commit** (`Portable: Today takes a timezone and can stop; neutral starter habits`).

### Task 8: Server boots from settings

**Files:**
- Modify: `server.js`:
  - config `:14-23, :68-90`
  - `WORKSPACES`/visibility `:24-56`
  - `TODAY_DIR` `:18`, plus the walk skips at `:199, :335`
  - Today construction `:688-690`
  - `/health` `:870-882`
  - `sessionMw` `:897-905`
  - `/api/me` `:942-946`
  - workspaces `:1020-1040`
  - `wsKeyForRel` `:1543-1547` and its caller `:1596`
  - `termMeta` `:1779`
  - `SHEET_BACKUP_DIR` `:1793`
  - `formatComment` `:742-747`: entries become `- **<date> <time>:** text`, with no name
  - listen `:2381-2398`
- Create: `test/helpers/server.js`
- Test: `test/server-boot.test.js`

**Interfaces:**
- **Consumes:** Tasks 1–4, 6 and 7.
- **Produces** (inside `server.js`; later tasks use these names):
  - `DATA_DIR`
  - `settingsStore`
  - `SETTINGS()`: current settings or null.
  - `SETTINGS_ERROR`: a string or null.
  - `boards()`
  - `resolveWorkspace(key) → { key, dir, label }`: falls back to the first visible board.
  - `todayDir() → string|null`
  - `todayService() → service|null`: lazy; built from settings with `quotes` = a null-returning stub when `TODAY_QUOTES=0`.
  - `stage()`: `setupStage({ hasPassword: !!config, settings: SETTINGS(), settingsError: SETTINGS_ERROR })`.
  - `PENDING_SECRET`: random at boot. The session uses `config ? config.sessionSecret : PENDING_SECRET`.
  - `async function boot()`, run before `app.listen`:
    - load settings (catch into `SETTINGS_ERROR`);
    - if there is a config, no settings file and no error, run `legacySettings`;
    - if that returns settings, save them and log `migrated: wrote .vaultos/settings.json (<n> boards)`;
    - then regenerate each board's Board.md and boot Today if it is on.
  - `/health`:
    - `stage()` `done`: today's rule plus `setup:false`;
    - otherwise: 200 `{ ok:true, setup:true }` when `VAULT_DIR` is a readable directory, with `error` when `SETTINGS_ERROR` is set.
  - `/api/me`:
    - authed or localRead: `{ authed:true, localRead?, features:{ today, terminal }, agent:{ profile, label, startCommand } | null }`;
    - otherwise: `{ authed:false, setup: stage() !== 'done' }`.
  - `GET /api/workspaces` → `[{ key, label }]` (visible boards, in order). `POST /api/workspaces/:key/visibility` is deleted.
  - `test/helpers/server.js`:
    - `startServer({ vault, data, home, env }) → Promise<{ base, stop(), output() }>`: free port via `net`, spawns `process.execPath server.js` with `cwd` at the repo root, waits for `listening on` in stdout (rejects after 10 s with the output).
    - `login(base, password) → Promise<string>`: returns the cookie header.
    - `seedVault(dir, files)`: an object of `{ relPath: content }`.

- [ ] **Step 1: Write the failing tests.**
  - `fresh folder: health 200 setup:true, me setup:true, api 409`. `GET /api/tasks` → 409 `{setup:true}`. The 409 comes from the setup gate, which Task 9 adds. For this task, assert 409 **or** 401 and leave a `// Task 9 tightens to 409` note, so the test stays honest.
  - `migrates an existing vault`: `alpha` and `Beta` boards plus `Beta/Today/habits.md`; `writePassword` into `data`.
    - The paths that are new afterwards are exactly `['.vaultos', '.vaultos/settings.json']`.
    - The output contains `migrated:`.
    - After login, `/api/workspaces` deep-equals `[{key:'alpha',label:'alpha'},{key:'beta',label:'Beta'}]` and `/api/me` has `features.today === true`.
  - `invalid settings.json is reported, not replaced`: content `{`. The server starts; `/health` is 200 with `error` matching `/settings\.json/`; the file is still `{`; nothing migrated.
  - `configured but empty vault is 503`: a settings file with one board and no other entries, and a config. `/health` → 503.
  - `comment entries carry no name`: in the migrated vault, add a `task.md` under `alpha/1. x/01-y/`. `POST /api/task/comment` (body shape as in `server.js:1453`) appends a line matching `/^- \*\*\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\*\* hi$/m`.
- [ ] **Step 2: Run them and see them fail.** `node --test test/server-boot.test.js`
- [ ] **Step 3: Implement it.** Remove `WORKSPACES`, `DEFAULT_WS`, `readHiddenWorkspaces` and `writeHiddenWorkspaces`; `grep -n "WORKSPACES\|DEFAULT_WS\|TODAY_DIR\|CONFIG_PATH\|LOCKOUT_PATH" server.js` must print nothing. Route every lockout read and write through `lib/password.js` with `DATA_DIR`.
- [ ] **Step 4: Run the tests.** `node --test test/server-boot.test.js && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** (`Portable: server reads boards and Today from settings; migrates an existing vault`).

### Task 9: Setup routes and gate

**Files:**
- Modify: `server.js` (a new `// ---------- Setup ----------` section after Auth, with the gate inserted before the `/api` auth gate at `:954`)
- Create: `public/setup.html`, a placeholder for now: a page with `<main id="setup">VaultOS setup</main>`. Task 14 builds it out.
- Test: `test/server-setup.test.js`

**Interfaces:**
- **Consumes:** `stage()`, `PENDING_SECRET`, `settingsStore` (Task 8); `writePassword` (Task 1); `addBoard` (Task 2); `folderCheck`, `stepsFor`, `windowOpen` (Task 4); `writeRootKit`, `writeBoardKit` (Task 5).
- **Produces:**
  - `STARTED_AT = Date.now()` at boot; `SETUP_WINDOW_MIN`.
  - **Setup gate:** under `/api`, when `stage() !== 'done'`, every path except `/setup/*`, `/login`, `/logout`, `/me`, `/agent` and `/settings/agent` answers 409 `{ setup:true }`.
  - **Pages:** `GET /` and `/index.html` send `public/setup.html` while `stage() !== 'done'`. `GET /setup` always sends it.
  - **`GET /api/setup/state`:**
    - `done` → `{ stage:'done' }`;
    - otherwise → `{ stage, steps, authed, windowOpen, terminalAllowed, settingsError, folder }`, where `folder` is present only when `windowOpen || authed`.
  - **`POST /api/setup/password { password }`:**
    - 403 `{ error:'Setup window closed. Restart the container to finish setup.' }` when the window is shut;
    - 409 when a config exists;
    - 400 for a short password;
    - otherwise `config = writePassword(DATA_DIR, password, { sessionSecret: PENDING_SECRET })` (synchronous: check and write with no `await` in between), then `req.session.authed = true` → `{ ok:true }`.
  - **`POST /api/setup/boards { labels, timezone }`:**
    - Needs a session (401) and a stage of `boards` or `resume` with no boards yet (409).
    - 1–10 labels. Every `addBoard` is computed before anything is written; any error → 400 with its message and nothing created.
    - Then `writeRootKit`, then `writeBoardKit` for each board (`welcome` on the first), then save with `setupDone:false` and `today.timezone` (when valid) → `{ settings }`.
  - **`POST /api/setup/finish { today, timezone }`:** needs a session and settings. Sets `features.today`, `today.timezone` and `setupDone:true`, saves, and starts Today when it is on → `{ ok:true }`.

- [ ] **Step 1: Write the failing tests.**
  - `full setup flow`:
    - The password gives a cookie.
    - Boards `['Work','Home']` create `Work/_tasks/Board.md` and `Home/_tasks/Board.md`; `AGENTS.md` lists both; the welcome task exists only under `Work`.
    - `/api/tasks?ws=work` → 409.
    - `finish {today:false, timezone:'Europe/London'}`.
    - Then `/api/tasks?ws=work` → 200 with exactly one task, `title 'Welcome to VaultOS'`, `status 'backlog'`.
    - `GET /` contains `id="board"`.
  - `GET / is the setup page while setup is due` (contains `id="setup"`).
  - `window closed refuses the password`: `SETUP_WINDOW_MIN=0` → 403, no config, and `state.folder` is undefined.
  - `concurrent password posts: one wins`: two posts at once give statuses sorted `[200, 409]`, and `config.json` verifies the winning password.
  - `short password is 400`.
  - `boards with no usable label create nothing`: `['🚀']` → 400, and the vault still has no entries.
  - `boards without a session is 401`.
  - `existing folder on a new machine`: a vault with a valid settings file (`setupDone:true`, one board, plus its Board.md) and no config. `state.stage === 'existing-folder'`, `steps [1,2,4]`; after the password, `/api/tasks?ws=<key>` → 200.
  - Tighten Task 8's 409-or-401 assertion to 409.
- [ ] **Step 2: Run them and see them fail.** `node --test test/server-setup.test.js`
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests.** `node --test test/server-*.test.js && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** (`Portable: first-run setup routes and gate`).

### Task 10: Settings routes and Today gating

**Files:**
- Modify: `server.js`: a new `// ---------- Settings ----------` section; the Today routes `:961-1018` return 404 when Today is off.
- Test: `test/server-settings.test.js`

**Interfaces:**
- **Consumes:** Tasks 2, 5, 7 and 8.
- **Produces** (session required; a local read is not enough):
  - `GET /api/settings` → `{ settings, terminalAllowed, folders }`, where `folders` is the top-level non-dot, non-`_` folders that are not boards and not `today.dir`.
  - `POST /api/settings/boards { label }`: `addBoard`, `writeBoardKit` (no welcome), save, `updateAgentsBlock` → `{ settings }`.
  - `POST /api/settings/boards/existing { dir }`: `dir` must be in `folders`, else 400. Then `addExistingBoard` → the same sequence.
  - `PATCH /api/settings/boards/:key { label?, hidden?, index? }`: `updateBoard`, save, `updateAgentsBlock`.
  - `POST /api/settings/features { today?, terminal?, timezone? }`. Today on starts the service. Off calls `stop()` and drops it. A timezone change while on stops and rebuilds it.
  - `POST /api/settings/password { current, next }`: 401 `{ error:'Current password is wrong' }`, 400 for a short one; otherwise `writePassword` (the secret is kept, so existing sessions stay valid).
  - Errors from `lib/settings.js` → 400 `{ error: message }`.

- [ ] **Step 1: Write the failing tests.** Every test runs setup through its routes first, using a helper in this file.
  - `add a board`: `Notes` shows in `/api/workspaces`, `Notes/_tasks/Board.md` exists, and `AGENTS.md` lists it.
  - `add clashing board is 400` (`work` when `Work` exists).
  - `add an existing folder`: `Archive/old.md`; afterwards `Archive/_tasks/Board.md` exists and `old.md` is byte-identical.
  - `existing folder must be a candidate` (`.git` → 400).
  - `hide the last visible board is 400`; `move to index 0 reorders /api/workspaces`.
  - `Today off → /api/today 404; on → 200 with timeZone; off again → 404`.
  - `password change`: wrong current → 401; right → the old password fails `/api/login`, the new one works, and the old cookie still works.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests.** `node --test test/server-*.test.js && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** (`Portable: Settings routes for boards, features and password`).

### Task 11: Agent endpoint, Claude hook, process badge

**Files:**
- Modify: `server.js`:
  - the terminal section `:2132-2310`: `TERMINAL` becomes `TERMINAL_ENV`; `sweepAgents :2204`; `termEnv :2241`
  - the upgrade handler `:2315-2343`: refuses 403 when `features.terminal` is false
  - the `/api/term/agent` registration `:951`
- Test: `test/server-agent.test.js`

**Interfaces:**
- **Consumes:** Task 6 and `SETTINGS()`.
- **Produces:**
  - `TERMINAL_ENV = process.env.TERMINAL !== '0'`.
  - `terminalOn() = TERMINAL_ENV && SETTINGS()?.features.terminal`.
  - `mountTerminal` runs when `TERMINAL_ENV`. The upgrade checks `terminalOn()` on every connect.
  - `GET /api/agent` → `{ profile, label, installed, startCommand, install, login, hooks }`. All but `profile` are null when the profile is `none`. `startCommand` = `startCommand(profile, KICKOFF_PROMPT)`.
  - `POST /api/settings/agent { profile, custom? }`: validates through `validate` (400 on error) and saves. If the profile is `claude` and it is installed, runs `installClaudeHook(os.homedir(), path.join(ROOT, 'hooks', 'vaultos-state.js'))`. Returns the same shape as GET.
  - Boot runs the same hook install when the saved profile is `claude` and installed, logging `claude hook installed` only when something changed.
  - `/api/me`'s `agent` is null when `!terminalOn()` or the profile is `none`.
  - `sweepAgents`:
    - when the profile's `hooks` is `'claude'`, keep the existing logic;
    - otherwise, for each terminal: `next = processState({ running: termBusy(t) && processMatches(profile, termCmd(t)), quietMs: now - t.lastOut })`, and `setAgent(t, next)` when it differs from the current state.
  - `termEnv` also deletes `LOCAL_READ`, `ALLOWED_HOSTS`, `DATA_DIR`, `SETUP_WINDOW_MIN` and `TODAY_QUOTES`.

- [ ] **Step 1: Write the failing tests.**
  - The helper `HOME` is a temp dir holding `.local/bin/claude` (`#!/bin/sh\necho 1.0`, mode 755). `PATH` puts that bin first.
  - `agent claude reports installed and a start command`: `installed === true`; `startCommand` starts with `claude 'Catch me up on this task.`
  - `choosing claude installs the hook once`: `<home>/.claude/settings.json` has 8 events; a second POST leaves the file byte-identical.
  - `custom profile needs {prompt}` → 400.
  - `profile none hides the agent`: `/api/me` `agent === null`.
  - `terminal off refuses the socket`: with `features.terminal:false`, a raw upgrade request to `/api/term` with a valid cookie, a matching Origin and `TERMINAL` unset gets 403. The helper's default `TERMINAL=0` is overridden to unset for this test.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests.** `node --test test/server-*.test.js && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** (`Portable: agent endpoint, Claude hook install, process badge`).

### Task 12: Host check, local reads, terminal default

**Files:**
- Create: `lib/host-check.js`
- Modify: `server.js`:
  - a first middleware before `/health` (`:879`)
  - the upgrade handler
  - `isLocalPeer :854-862` and its startup log `:851`
- Test: `test/host-check.test.js`, `test/server-security.test.js`

**Interfaces — Produces:**
- `parseAllowedHosts(value = 'localhost,127.0.0.1') → Set<string>`: lowercased and trimmed, with empty entries dropped.
- `hostAllowed(hostHeader, allowed) → boolean`:
  - strips `:port`;
  - `[::1]:7684` becomes `::1`;
  - a missing header is false.
- **The middleware:**
  - `/health` passes.
  - Otherwise a host that isn't allowed gets 421 `text/plain`: ``This address isn't in ALLOWED_HOSTS. Open VaultOS at http://localhost:<port you published>, or add "<host>" to ALLOWED_HOSTS.``
  - It logs `host rejected: <host>` once per host.
- The upgrade handler calls the same check and answers `deny(421, 'Misdirected Request')`.
- `isLocalPeer` returns false unless `process.env.LOCAL_READ === '1'`. The "same-box read path trusts" line is logged only when it is on.

- [ ] **Step 1: Write the failing tests.**
  - `hostAllowed`:
    - true: `'localhost:7684'`, `'127.0.0.1'`, `'LOCALHOST:1'`;
    - false: `'evil.example'`, `undefined`;
    - `'[::1]:7684'` is false by default and true with `'::1'` in the set.
  - `bad Host gets 421 naming ALLOWED_HOSTS`: a raw `http.request` with `Host: evil.example`.
  - `health ignores Host`.
  - `local reads are off by default`: after setup, an unauthenticated `GET /api/tasks` → 401; with `LOCAL_READ=1` → 200.
  - `TERMINAL unset means on`: `/api/me` has `features.terminal === true` (settings true); with `TERMINAL=0` it is false.
  - `socket with a bad Host gets 421`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests.** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** (`Portable: Host allowlist; no-login reads and terminal behind env`).

### Task 13: Image, compose and preview

**Files:**
- Modify: `Dockerfile`, `.dockerignore`, `.gitignore` (add `!.env.example`)
- Create: `compose.yaml`, `.env.example`, `/opt/vault/portable-preview/compose.yml`, `/opt/vault/portable-preview/reset.sh` (the last two are not in the repo)

**Contents:**
- **`Dockerfile`:**
  - Add `curl` and `tini` to the runtime apt list.
  - `RUN groupmod -n vaultos node && usermod -l vaultos -d /home/vaultos -m node`.
  - `ENV HOME=/home/vaultos PATH=/home/vaultos/.local/bin:$PATH`.
  - Also `COPY hooks ./hooks` and `COPY starter-kit ./starter-kit`.
  - `HEALTHCHECK` with the same `node -e` probe as the homelab compose (`interval 30s`, `timeout 10s`, `start-period 10s`, `retries 3`).
  - `USER 1000:1000`.
  - `ENTRYPOINT ["/usr/bin/tini", "-s", "--"]`, with `CMD ["node", "server.js"]`.
  - No `VOLUME`.
  - Update the header comment: the `coder` rename is gone, and why `tini -s` is used.
- **`compose.yaml`:** project `vaultos`, with a `vaultos` service:
  - `build: .`, `image: vaultos:latest`, `container_name: vaultos`, `restart: unless-stopped`;
  - `ports: ["127.0.0.1:${VAULTOS_PORT:-7684}:8080"]`;
  - volumes `"${VAULT_PATH:?Set VAULT_PATH in .env to the folder VaultOS should use}:/vault"` and `vaultos-home:/home/vaultos`;
  - a top-level `volumes: { vaultos-home: {} }`.
- **`.env.example`:** `VAULT_PATH=` with a comment giving a Windows and a macOS example, and `VAULTOS_PORT=7684`.
- **Preview compose:** image `vaultos:portable`, container `portable-preview`, `ports ["127.0.0.1:7692:8080"]`. Volumes:
  - `./vault:/vault`
  - `portable-preview-home:/home/vaultos`
  - read-only mounts of the worktree's `server.js`, `lib`, `public`, `starter-kit`, `hooks` and `scripts` into `/app/…`
- **`reset.sh`** (in the style of `/opt/vault/today-preview/reset.sh`):
  - `docker compose down`, `docker volume rm portable-preview-home`;
  - `rm -rf vault`, `mkdir vault`, `chown 1000:1000 vault`;
  - `docker compose up -d`.

- [ ] **Step 1: Build.** `cd /opt/vault/board-portable && docker build -t vaultos:portable .` Expected: success.
- [ ] **Step 2: Check the image.** `docker run --rm vaultos:portable sh -c 'id; echo $HOME; echo $PATH; ls /app/starter-kit /app/hooks; command -v curl tini'`. Expected: `uid=1000(vaultos)`, `/home/vaultos`, the PATH starting `/home/vaultos/.local/bin`, both folders listed, and both commands found.
- [ ] **Step 3: Start the preview.** `/opt/vault/portable-preview/reset.sh && sleep 5 && curl -s http://127.0.0.1:7692/health`. Expected: `{"ok":true,"setup":true}`.
- [ ] **Step 4: Check the compose file.** `docker compose -f compose.yaml config` with `VAULT_PATH=/tmp/x`. Expected: valid. Without `VAULT_PATH` it must fail with the message above.
- [ ] **Step 5: Commit** (`Portable: self-contained image and compose.yaml`).

### Task 14: Setup page

**Files:**
- Modify: `public/setup.html` (replacing the placeholder), `public/styles.css` (a `/* ---------- Setup ---------- */` block using existing tokens only)
- Create: `public/setup.js`

**What it does** (the copy comes from the spec's Setup section):
- **Loading:**
  - `setup.html` loads `styles.css`, the five `/vendor/*.js` xterm files, `term.js` and `setup.js`, and applies `vaultboard.theme` from localStorage before paint.
  - On load, `GET /api/setup/state`: `done` → `location.replace('/')`. Otherwise render the first of `steps`, with a "Step i of n" line and Back/Next.
  - If `authed` is false and the stage is `boards` or `resume`, show a password field that posts `/api/login`, then reload the state.
- **Step 1, folder:**
  - The three states, with the spec's wording.
  - Not mounted: the warning, the `docker run` command from the spec with `-v "<your folder>:/vault"` in a copyable `<pre>`, and **Continue anyway**.
  - Not writable: stop, and show the `--user $(id -u):$(id -g)` fix.
  - `settingsError`: show the error and stop.
  - `windowOpen:false`: the restart message, with nothing else to do.
- **Step 2, password:**
  - Password and confirm fields; at least 8 characters; "Passwords don't match".
  - Posts `/api/setup/password`.
- **Step 3, boards:**
  - Label inputs, starting with one set to "Work"; **+ Add another** up to 10.
  - Posts `/api/setup/boards` with `timezone: Intl.DateTimeFormat().resolvedOptions().timeZone`.
  - Server errors appear under the inputs.
- **Step 4, coding agent** (skipped entirely when `terminalAllowed` is false):
  - Four radio cards: Claude Code, Cursor CLI, Other (fields: label, detect, install, login, start with `{prompt}`), None. Choosing one posts `/api/settings/agent`.
  - **Install** and **Sign in** open `createTerminal(panel, { run: agent.install | agent.login })` in an inline panel.
  - While the panel is open, poll `GET /api/agent` every 3 s and show "Installed" or "Not installed yet".
  - **Skip** goes to step 5.
- **Step 5, extras:**
  - A Today toggle (off), and a timezone input prefilled from `Intl`.
  - Theme (Dark/Sepia) and reading font (Standard/OpenDyslexic), written to `vaultboard.theme` and `vaultboard.font` as `app.js` does.
  - **Finish** posts `/api/setup/finish`, then `location.replace('/')`.
- **Safety:** every server or vault string is set with `textContent`.

- [ ] **Step 1: Build the page.**
- [ ] **Step 2: Check it visually.**
  - `reset.sh`, then take headless Chrome screenshots (the command in `CLAUDE.md` "Fastest path", aimed at `http://127.0.0.1:7692/`) at `1600,1000` and `390,844`, for steps 1, 2 and 3. Reach the later steps by driving the page through puppeteer, as Task 16's script will.
  - Check Dark and Sepia.
  - Read each PNG. Expected: no overflow at 390 px, the step line is readable, and errors are visible.
- [ ] **Step 3: Commit** (`Portable: setup page`).

### Task 15: Main app: Settings sections and feature gating

**Files:**
- Modify: `public/index.html` (settings nav `:64-68` and panes `:71-175`, plus three new `ss-pane` sections)
- Modify: `public/app.js`:
  - startup `:2015-2022`
  - `STATE.mode` default `:32`
  - `showSection :219-228`
  - `renderWsList :1966-1980`
  - mode twins `:1115-1131`
  - the card pill `:581`
- Modify: `public/workbench.js` (`AGENT_KICKOFF :948`, tooltip `:916`)
- Modify: `public/today.js` (`LONDON :122-126`)
- Modify: `public/styles.css`

**What it does:**
- **`ME`:** a module global in `app.js`, the `/api/me` result.
  - Unauthenticated with `ME.setup` → `location.replace('/setup')`.
  - Authed: hide `#mode-today` and its `[data-for="mode-today"]` twin when `!ME.features.today`.
  - The default mode is `'board'` when Today is off, including when `restoreAfterReload()` would restore `'today'`.
  - Hide `#termbtn` and its twin when `!ME.features.terminal`. Hide `#d-agent` when `!ME.agent`.
- **Boards section** (the `ws` section, renamed "Boards"):
  - The existing radio pick list shows visible boards only.
  - Below it is a manage list, one row per board from `GET /api/settings`:
    - a label input (Enter or blur → `PATCH {label}`);
    - ↑ and ↓ (`PATCH {index}`);
    - Hide/Show (`PATCH {hidden}`).
  - **Add board** (input + button → `POST`).
  - **Add existing folder** (a `<select>` of `folders` → `POST …/existing`).
  - Each change re-runs `loadWorkspaces()`. Errors appear inline.
- **Features section:**
  - Today toggle + timezone, and a terminal toggle. The terminal toggle is disabled, with "Turned off for this machine (TERMINAL=0)", when `terminalAllowed` is false.
  - Saving → `location.reload()`.
- **Agent section:**
  - The same four choices as setup step 4.
  - Install and Sign in call the existing `termOpen({ cwd: '', run })` in `workbench.js`.
  - Shows the status line from `GET /api/agent`, and the editable custom fields.
- **Password section:** current, new and confirm → `POST /api/settings/password`.
- **Start agent:** `run: ME.agent.startCommand`. The tooltip reads `Opens ${ME.agent.label} in …`. The card pill uses `ME.agent.label` instead of `Claude`.
- **`today.js`:** builds the date formatter from `P.timeZone` on every payload.

- [ ] **Step 1: Build it.**
- [ ] **Step 2: Check it visually.** On the preview after a scripted setup, screenshot the Settings sheet's Boards, Features, Agent and Password sections at 1600 and 390 wide, in Dark and Sepia. Then turn Today on and screenshot the header with Today showing.
- [ ] **Step 3: Run the old e2e against the new code.** Point `scripts/today-e2e.js` at `TODAY_E2E_OTHER_BASE=1 node scripts/today-e2e.js http://127.0.0.1:7692` once the preview has Today on and a sandbox vault. Expected: all scenarios pass. If a scenario depends on the legacy habits, run the preview with the sandbox written from `LEGACY_HABITS_MD` (Task 7).
- [ ] **Step 4: Commit** (`Portable: Settings for boards, features, agent and password; UI follows features`).

### Task 16: End-to-end and migration check

**Files:**
- Create: `scripts/portable-e2e.js`, `scripts/portable-migrate-check.sh`

**`portable-e2e.js`:**
- Uses the same puppeteer and Chrome loading as `scripts/today-e2e.js:17-18,61-62`.
- Refuses any base whose port is `7684`, and runs `reset.sh` before starting. Scenarios:
  1. F1: `/` shows setup; step 1 says the folder is empty and mounted.
  2. F2: mismatched passwords show the error; a good password moves to step 3.
  3. F3: boards `Work` and `Home`, agent None, Today off, Finish. The switcher lists Work and Home, the Backlog column has "Welcome to VaultOS", and there is no Today button.
  4. F4: open the welcome card and pick In Progress in the drawer's `#d-status-select`. The welcome `task.md` on disk (`/opt/vault/portable-preview/vault/Work/1. getting-started/01-welcome-to-vaultos/task.md`) then has `status: in-progress`.
  5. F5: Settings → Features → Today on. After the reload the Today button shows and Today renders.
  6. F6: Settings → Boards → add `Notes`. It is in the switcher, and `AGENTS.md` lists it.
  7. F7: Settings → Agent → Other with label `Fake`, detect `fakeagent`, start `bash -c 'exec -a fakeagent sleep 60' {prompt}`. Start agent on the welcome card opens a terminal; within 10 s the card pill reads `Fake` with `data-agent="working"`, and within 35 s `idle`.
  8. `--with-installs` (opt-in, needs network): Settings → Agent → Claude Code → Install, waiting up to 180 s for `GET /api/agent` to report `installed:true`; the same for Cursor CLI.

**`portable-migrate-check.sh`:**
1. `rsync -a /opt/vault/vault/ /opt/vault/portable-preview/migrate/vault/`, and copy `/opt/vault/board/config.json` to `migrate/data/`.
2. Run the **current** image (`vault-board:latest`) on the copy for 15 s (port `127.0.0.1:7693`, `TERMINAL=0`), so Board.md catches up with today's rules. Stop it.
3. Snapshot with `find migrate/vault -printf '%P %s %T@\n' | sort > before`.
4. Run `vaultos:portable` on the copy with the homelab env (`DATA_DIR=/data`, `LOCAL_READ=1`, `TZ=Europe/London`, `TERMINAL=0`).
5. Wait for health, then snapshot `after` and `diff before after`. Expected: exactly the lines for `.vaultos` and `.vaultos/settings.json`.
6. Print `settings.json`, then take a headless screenshot of `http://127.0.0.1:7693/` (a local read).
7. Stop and `rm -rf /opt/vault/portable-preview/migrate`. The copy holds Ben's real notes and must not linger.

- [ ] **Step 1: Write both scripts.**
- [ ] **Step 2: Run them.** `node scripts/portable-e2e.js`. Expected: `7 passed` (`8` with `--with-installs`).
- [ ] **Step 3: Run the migration check.** `bash scripts/portable-migrate-check.sh`. Expected:
  - the diff shows only the two `.vaultos` lines;
  - the settings list the five boards alphabetically, with Today on at `Personal/Today`, timezone `Europe/London`, and profile `none` (no `claude` on the preview's PATH);
  - the screenshot shows the board.
- [ ] **Step 4: Commit** (`Portable: e2e and migration check`).

### Task 17: Docs and homelab compose

**Files:**
- Create: `docs/portable.md`
- Modify: `docker-compose.yml` (the repo copy only)
- Modify: `CLAUDE.md`
- Modify: the spec (`## Decisions made during implementation`)

**Contents:**
- **`docs/portable.md`**, for Ben on the work laptop:
  - Running it three ways: the Docker Desktop Run dialog, `docker run`, and `compose.yaml` with `.env`.
  - Building the image locally until project 2 publishes it (`git clone` + `docker build -t vaultos .`, or `docker save vaultos:latest | gzip > vaultos.tar.gz` here and `docker load` there).
  - The OneDrive tip: "Always keep on this device".
  - Signing in to Cursor, and `CURSOR_API_KEY` as the fallback.
  - Corporate proxies (`HTTPS_PROXY`, `NO_PROXY`, and mounting a CA with `NODE_EXTRA_CA_CERTS`).
  - Resetting a forgotten password (`docker exec -it vaultos node set-password.js "…"`).
  - Moving to a new laptop.
  - The licence note (Rancher Desktop or Podman Desktop as alternatives).
- **The repo `docker-compose.yml`**, `board` service `environment`:
  - add `DATA_DIR=/app`, `LOCAL_READ=1`, `TZ=Europe/London`, and `ALLOWED_HOSTS=vb.ctrlaltautomate.com,192.168.1.188,localhost,127.0.0.1` (the hostnames from `Caddyfile` and the tunnel);
  - keep `TERMINAL=1`, `HOME=/home/coder` and every mount.
- **`CLAUDE.md`**: a new section, "Portable mode (settings, setup, env)". It covers the settings file, the setup stages, the env table, the never-do list (no e2e on :7684, no edits to the kit's personal-free rule), and the `host rejected:` log line to check after a release.

- [ ] **Step 1: Write the docs and the compose env.** Then `diff <(sed -n '/^  board:/,/^  [a-z]*:$/p' docker-compose.yml) <(sed -n '/^  board:/,/^  [a-z]*:$/p' /opt/vault/docker-compose.yml)`. Expected: only the four new env lines differ.
- [ ] **Step 2: Fill in the spec's implementation decisions.**
- [ ] **Step 3: Run the tests.** `npm test`. Expected: PASS; record the count.
- [ ] **Step 4: Commit** (`Portable: docs and homelab compose env`).

---

## Releasing to the homelab

Only with Ben's explicit OK. This kills his live terminals.

1. `docker tag vault-board:latest vault-board:pre-portable`.
2. `git -C /opt/vault/board merge --ff-only portable`.
3. Copy the four new env lines into `/opt/vault/docker-compose.yml`, then `diff` the `board` service against the repo copy. Expected: identical.
4. `cd /opt/vault && docker compose build board && docker compose up -d board`.
5. Checks:
   - `curl -s localhost:7684/health` gives `setup:false`.
   - `docker logs vault-board 2>&1 | grep -E 'migrated:|host rejected:'`.
   - `cat /opt/vault/vault/.vaultos/settings.json`.
   - `find /opt/vault/vault/.vaultos ! -uid 1000` prints nothing.
   - A headless screenshot of `http://127.0.0.1:7684/`.
6. Ben reorders his boards in Settings → Boards. For a day, add any legitimate `host rejected:` host to `ALLOWED_HOSTS`.
7. **Rollback:**
   - `docker tag vault-board:pre-portable vault-board:latest`;
   - `git -C /opt/vault/board reset --hard <previous master sha>` (ask first);
   - remove the four env lines;
   - `docker compose up -d board`.
   - `.vaultos/settings.json` can stay; the old code ignores it.
