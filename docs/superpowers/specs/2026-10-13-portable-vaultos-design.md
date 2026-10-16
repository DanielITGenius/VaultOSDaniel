# Portable VaultOS: run it on any machine with Docker

Date: 2026-10-13 · Status: design approved by Ben in chat 2026-10-13, spec awaiting his review · Branch `portable`, worktree `/opt/vault/board-portable` · Project 1 of 2 (project 2 is the public release)

## Why

VaultOS runs on Ben's Proxmox homelab and holds his personal and work notes together. His employer is uneasy about work data sitting on a home lab. Ben wants to run VaultOS on his work laptop instead: install Docker Desktop, start one container, point it at a folder (C drive, OneDrive, Google Drive), and get a blank VaultOS that walks him through setup on first launch. Later he wants to publish it so other people can try it.

Today the app only works on the homelab. Its five boards are hardcoded, Today mode is wired to `Personal/Today`, the terminal borrows the host's `claude` binary and login, the password is set from the command line, and the files that make agents work (templates, `/new-task`, `/done`, hooks) live in Ben's vault rather than in the app.

**Goal:** `docker run` with a folder on any machine opens a setup screen. Five steps later Ben has an empty VaultOS with his own boards and his chosen coding agent signed in. The homelab runs the same image with its existing data and behaviour.

## Decisions

### Ben's (2026-10-13)

1. **Two projects, in order.** This spec is project 1 (portable VaultOS). Project 2 (public GitHub repo with fresh history, README, licence, GitHub Actions building the image to GHCR) gets its own spec afterwards.
2. **One codebase.** The homelab moves to the portable image. No fork.
3. **Any coding agent.** VaultOS is not tied to Claude. Ben uses the Cursor CLI at work.
4. **Agents install on demand** (approach A). Setup runs the chosen agent's official installer into the home volume. Agents are not baked into the image.
5. **Today mode is off by default** on a new install, switchable in Settings.
6. Sections 1–5 of the chat design (how it runs, setup screen, agents, security defaults, migration and testing) approved as presented, with one change listed under "Changed since the chat design".

### Defaults in this spec

- The image's user is `vaultos`, uid 1000, home `/home/vaultos`. The homelab keeps `HOME=/home/coder` through its compose file, so its terminal prompt reads `vaultos@vault-workbench` instead of `coder@vault-workbench`. Nothing else about the homelab terminal changes.
- The password and session secret stay on the machine (home volume), never in the synced folder.
- Board folders are named after the board's label when created. Renaming a board changes its label only, never the folder.
- There is no way to delete a board or a folder from the UI.
- A new install's timezone comes from the browser during setup.

### Changed since the chat design

- **Setup step 2 no longer asks for your name.** I said the name would replace "Ben" on progress-log and comment entries. Checking the code: progress-log lines carry no name, and the comment composer that wrote "Ben" was removed on 2026-09-29. Nothing visible would use the name, so the step only sets the password. The unused comment endpoint stops writing a name.

### Changed during planning (2026-10-13)

- The welcome card starts in `backlog`: the board has no `todo` status.
- Migration ignores `workspace-visibility.json` (see Homelab migration).
- `defaultBoard` is dropped from the settings file: the first visible board is the default, so reordering sets it.
- The setup gate's open routes are named as the server actually has them.
- The process badge reuses the `working` / `idle` states.

## How it runs

One image. Started with:

```
docker run -d --name vaultos -p 127.0.0.1:7684:8080 \
  -v "C:\Users\Ben\OneDrive\VaultOS:/vault" \
  -v vaultos-home:/home/vaultos \
  vaultos:latest
```

or the same three values in Docker Desktop's Run dialog (Optional settings: host port, host path → `/vault`, volume → `/home/vaultos`). The repo gains a `compose.yaml` for the portable case that reads `VAULT_PATH` from `.env` and binds `127.0.0.1:7684`. The homelab keeps its own `docker-compose.yml`.

Project 2 publishes the image to a registry. Until then it is built locally (`docker build -t vaultos .`), which is how Ben gets it onto the work laptop for the first trial (build from a clone, or `docker save` / `docker load`).

The Dockerfile does **not** declare `VOLUME /vault`. An anonymous volume would hide a forgotten mount, which setup step 1 needs to see.

### Where things live

| Place | Holds | Synced by OneDrive |
|---|---|---|
| The folder (`/vault`) | Boards, tasks, KB articles, files; `.vaultos/settings.json`; the starter kit | Yes |
| Home volume (`/home/vaultos`) | `DATA_DIR` (default `~/.vaultos`): `config.json` (password hash, salt, session secret), `lockout.json`, `sheet-backups/`. Also the installed agent, its sign-in, shell history | No |

### `.vaultos/settings.json`

```json
{
  "version": 1,
  "setupDone": true,
  "boards": [
    { "key": "work", "dir": "Work", "label": "Work", "hidden": false }
  ],
  "features": { "today": false, "terminal": true },
  "today": { "dir": "Today", "timezone": "Europe/London" },
  "agent": { "profile": "cursor" }
}
```

- `boards` order is the switcher order. The first visible board is the default.
- `agent.profile` is `claude`, `cursor`, `custom` or `none`. For `custom`, `agent.custom` holds `label`, `detect`, `install`, `login` and `start` (a template containing `{prompt}`).
- Written atomically (temp file + rename, as every other write). Read once at boot and cached. Every settings write updates the cache.
- An invalid or unreadable file is a hard error on the setup screen, never silently replaced.

### Environment variables

| Variable | Default | Status | Homelab sets |
|---|---|---|---|
| `VAULT_DIR` | `/vault` | existing | — |
| `DATA_DIR` | `$HOME/.vaultos` | new | `/app` (where its `config.json` and `lockout.json` are bind-mounted today) |
| `PORT` | `8080` | existing | — |
| `LOCAL_READ` | `0` | new | `1` |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | new | the hostnames it is reached on (checked against Caddy and the tunnel before release) |
| `SECURE_COOKIE` | `0` | existing | `1` |
| `TRUST_PROXY` | `0` | existing | `1` |
| `TERMINAL` | on | changed: was on only when `1`, now on unless `0` | `1` |
| `SETUP_WINDOW_MIN` | `15` | new | — |
| `TZ` | unset | existing | `Europe/London` (used by migration for Today's timezone) |
| `SHEET_BACKUP_DIR` | `$DATA_DIR/sheet-backups` | default changed | `/app/sheet-backups` (unchanged) |

`TERMINAL=0` is a hard switch: it overrides `features.terminal` and hides the terminal, Start agent and the agent setup step. It exists for machines where IT wants no shell at all.

## Boards

`settings.boards` replaces the `WORKSPACES` constant (`server.js:28`) and `workspace-visibility.json`. `resolveWorkspace(key)` reads the cached settings; an unknown key falls back to the first visible board. `GET /api/workspaces` returns the visible boards in order as `[{ key, label }]`. `POST /api/workspaces/:key/visibility` is removed (the UI stopped calling it when the switcher became a single radio pick); hiding moves to Settings → Boards.

Settings → Boards:

- **Add board:** a label. The folder name is the label with anything outside letters, digits, space, `-`, `_` and `.` removed, at most 60 characters, not starting with `.` or `_`. The key is the folder name lowercased with spaces turned into `-`. A clash with an existing key or folder is refused with a message. The starter kit's board files are written into it.
- **Add an existing folder:** lists top-level folders that are not boards, not `.`-folders and not the Today folder. Writes whichever starter kit board files are missing; never overwrites.
- **Rename** (label only), **reorder**, **hide / show**.
- After any change, the boards block in `AGENTS.md` is rewritten (see Starter kit).

## Setup

### When it shows

| `config.json` (password) | `settings.json` | What happens |
|---|---|---|
| missing | missing | Full setup, steps 1–5 |
| missing | present | Existing folder on a new machine: steps 1, 2, 4 |
| present | missing, vault has `*/_tasks/Board.md` | Migration (below), no setup |
| present | missing, no boards | Sign in, then steps 3–5 |
| present | present, `setupDone: false` | Sign in, then the remaining steps |
| present | present, `setupDone: true` | Normal app |

While setup is due, `GET /` serves `setup.html`, and every `/api` route except `/api/setup/*`, `/api/login`, `/api/logout`, `/api/me`, `/api/agent` and `/api/settings/agent` (step 4 uses the last two) answers `409 {"setup": true}`. `/health` sits outside `/api`.

**Setup window:** the unauthenticated part (steps 1 and 2) only works for `SETUP_WINDOW_MIN` minutes after the process starts. After that, the page says to restart the container to finish setup. Once step 2 sets the password and signs the browser in, the remaining steps need that session, not the window.

### Steps

1. **Folder.** Server checks, shown as one card:
   - *Mounted:* `stat(VAULT_DIR).dev !== stat('/').dev`. If not mounted: a warning that anything added lives only inside this container, the exact `docker run` line with `-v`, and a "Continue anyway" button (for people only trying it out).
   - *Writable:* create and delete `.vaultos/.write-test`. If that fails, setup stops here with the fix (on Linux hosts, `--user $(id -u):$(id -g)`).
   - *State:* **existing** (`.vaultos/settings.json` present: "Found N boards"), **empty** (no non-dot entries), or **has files** ("VaultOS adds its own folders next to yours. Nothing is moved or changed").
2. **Password.** Password and confirm, at least 8 characters. Writes `config.json` (same scrypt format `set-password.js` writes) and signs the browser in.
3. **Boards.** One or more board labels, default "Work". Writes the root starter kit, each board's files, the welcome card on the first board, and `settings.json` with `setupDone: false`.
4. **Coding agent.** Claude Code, Cursor CLI, Other, or None. For Claude or Cursor: **Install** opens an embedded terminal running the installer. **Sign in** opens one running the login command. A status line shows installed / not installed from `GET /api/agent`. "Other" shows the custom fields. The step can be skipped.
5. **Extras.** Today mode (off), its timezone (prefilled from `Intl.DateTimeFormat().resolvedOptions().timeZone`), theme and reading font (the existing per-browser preferences). **Finish** sets `setupDone: true` and opens the first board.

### Settings after setup

The existing Settings sheet gains four sections: **Boards** (above), **Features** (Today, terminal), **Agent** (change profile, Install, Sign in, edit the Start agent command), **Password** (current + new). `set-password.js` stays for recovery (`docker exec -it vaultos node set-password.js "..."`) and writes to `DATA_DIR`.

## Starter kit

Lives in the repo at `starter-kit/` and is copied into the image. Written only where a file is missing; never overwrites. Content is generic: derived from the current templates and the `/new-task`, `/done` and `/new-subtask` commands, with everything about Ben, his employers and the homelab removed.

**Vault root** (written at step 3):

- `AGENTS.md`: what VaultOS is, how `status:` in a task's frontmatter drives the board, the folder layout (`<Board>/<N. project>/<NN-job>/task.md`), how to create, split and finish a task. Contains a managed block:
  ```
  <!-- vaultos:boards -->
  - **Work** → `Work/`
  <!-- /vaultos:boards -->
  ```
  VaultOS rewrites only what is between the markers, and only if both markers exist. Text outside them is never touched.
- `CLAUDE.md`: one line, `@AGENTS.md`.
- `.vaultos/guides/new-task.md`, `done.md`, `new-subtask.md`: the procedures as plain instructions.
- `.claude/commands/new-task.md`, `done.md`, `new-subtask.md`: each says to follow the matching guide. `.cursor/commands/` gets the same files if spike 1 shows the Cursor CLI reads them.

**Each board:**

- `_tasks/Board.md`: the kanban skeleton. Required, because `regenerateBoard()` never creates a missing Board.md.
- `_tasks/_Templates/task.md` and `article.md`.

**First board only:** `1. getting-started/01-welcome-to-vaultos/task.md`, status `backlog`: what cards, the KB, Files and agents are, with a short checklist (move this card, open a terminal, ask your agent for a brief). Deletable like any task.

The kit's root also carries the Claude task-board hooks (`.claude/hooks/inject-plan.sh`, `check-progress.sh`, registered in `.claude/settings.json`); see "Decisions made during implementation".

## Agents

New `lib/agents.js` holds the profiles:

| Profile | `detect` | `install` | `login` | `start` | Badges |
|---|---|---|---|---|---|
| Claude Code | `claude` | `curl -fsSL https://claude.ai/install.sh \| bash` | `claude` | `claude '<prompt>'` | hooks |
| Cursor CLI | `agent`, then `cursor-agent` | `curl https://cursor.com/install -fsS \| bash` | `NO_OPEN_BROWSER=1 agent login` | `agent '<prompt>'` | process |
| Other | user | user (optional) | user (optional) | user template with `{prompt}` | process |
| None | — | — | — | Start agent hidden | — |

- **Install and sign-in** run in ordinary VaultOS terminal sessions (the existing node-pty path and `termOpen({ run })`), so output and errors are visible. The image puts `~/.local/bin` on `PATH`. Both installers are expected to land there; spike 1 confirms.
- **`GET /api/agent`** returns `{ profile, label, installed, startCommand }`. `installed` is `command -v <detect>` in a login shell with the terminal's environment.
- **Start agent** (`public/workbench.js`, `AGENT_KICKOFF`) uses `startCommand` with today's check-in prompt. The prompt is single-quoted server-side; it contains no single quotes.
- **Claude hook:** when the profile is `claude` and it is installed, the server copies `hooks/vaultos-state.js` to `~/.claude/hooks/` and adds the eight hook events to `~/.claude/settings.json`, adding only entries that are missing. On the homelab this is a no-op.
- **Process badge:** for agents without hooks, a terminal shows `working` while its foreground process matches the profile and it has printed something in the last 20 s, `idle` once it has been quiet longer, and no badge when the agent is not running. These are the existing badge states, so the tab, card and drawer need no new styles. The card pill's "Claude" label becomes the profile's label. Uses the foreground-process lookup the server already does for node-pty. Spike 1 records the process name the Cursor CLI actually reports.

## Today

- `features.today: false`: no Today button, the app opens on the Board, `/api/today/*` answer 404, and the timer service and quote fetch never start.
- Switching it on or off in Settings starts or stops the service and takes effect on the next page load.
- `today.dir` replaces `TODAY_DIR` (`server.js:18`). Default for new installs: `Today` at the vault root. Board scans keep skipping it, as they skip `Personal/Today` today.
- `today.timezone` replaces the hardcoded `Europe/London` in `lib/today-note.js` and `public/today.js`.
- `DEFAULT_HABITS_MD` becomes a neutral starter list (move, read with a focus goal, learn with a focus goal, water, plan tomorrow). Only used when `habits.md` is missing, so Ben's homelab habits are untouched.

## Security

- **Password always required.** Sessions already last 30 days (`server.js:901`); unchanged.
- **No-login local reads off** unless `LOCAL_READ=1`. On Docker Desktop the client's real address is not kept, so the current gateway rule could let other machines on an office network read the board.
- **Host check:** a middleware rejects any request whose raw `Host` header (port stripped) is not in `ALLOWED_HOSTS`, including the terminal's WebSocket upgrade. `/health` is exempt. This blocks DNS-rebinding pages from reaching the terminal; the existing same-origin check on the WebSocket stays.
- **Port bound to `127.0.0.1`** in every documented command and in `compose.yaml`.
- **Setup window** as above.
- **Outbound traffic:** the chosen agent's installer and API; ZenQuotes only while Today is on. No telemetry.
- **Scope:** non-root uid 1000. The app, terminals and agents see `/vault` and the home volume only.

## Homelab migration

Runs at boot when `config.json` exists in `DATA_DIR`, `settings.json` is missing, and at least one top-level folder has `_tasks/Board.md`. Generic, with no names from Ben's vault in the code:

- `boards`: every top-level folder with `_tasks/Board.md`, alphabetical, label = folder name, key = folder name lowercased with spaces turned into `-`. Gives the current keys (`business`, `health`, `lancashire`, `personal`, `sucden`).
- Every board visible. `workspace-visibility.json` is ignored: the UI has not read it since the switcher became a single radio pick (0aa64eb), and on the homelab it marks four of the five boards hidden, so honouring it would leave only Business showing.
- `features.today: true` and `today.dir` if a `habits.md` exists under a folder named `Today` at most two levels down (`Personal/Today` here). `today.timezone` from `TZ`, else `UTC`.
- `features.terminal`: true unless `TERMINAL=0`. `agent.profile`: `claude` if `claude` is on `PATH`, else `none`.
- `setupDone: true`. No starter-kit files are written. The only change on disk is the new `.vaultos/settings.json`.

Visible change for Ben: board order becomes alphabetical, so the default board (the first) becomes Business instead of today's `lancashire`. One reorder in Settings fixes both.

## Changes by file

- `server.js`: settings-driven boards; `DATA_DIR` paths; setup gate and `/api/setup/*`; `/api/settings/*`; `/api/agent`; host check; `LOCAL_READ`; `TERMINAL` default; Today gating; `/health` (below); comment endpoint without a name.
- New `lib/settings.js` (load, validate, atomic save, migration), `lib/setup.js` (folder checks, starter-kit writer, `AGENTS.md` block), `lib/agents.js` (profiles, detection, Claude hook install).
- `lib/today-note.js`, `lib/today-service.js`: timezone parameter, starter habits.
- New `public/setup.html` and `public/setup.js` (reuses `term.js` for the embedded terminal). `public/app.js`: Settings sections, Today button gated. `public/workbench.js`: Start agent command. `public/today.js`: timezone.
- New `starter-kit/`, `compose.yaml`.
- `Dockerfile`: add `curl`; user `vaultos` with `HOME=/home/vaultos`; `~/.local/bin` on `PATH`; `COPY hooks starter-kit`; no `VOLUME`.
- `set-password.js`: writes to `DATA_DIR`.
- Homelab `docker-compose.yml` (both copies, kept identical): `DATA_DIR=/app`, `LOCAL_READ=1`, `ALLOWED_HOSTS=...`, `TZ=Europe/London`.

`/health`: 200 when `VAULT_DIR` is a readable directory and setup is due. Once set up, keeps today's rule (503 when the vault has no non-dot entries, which catches a failed bind mount). The body adds `setup: true|false`.

## Verification

**Spikes first** (throwaway, in a scratch container from the current image):

1. **Cursor CLI:** install path, whether `agent login` completes in a container with no keyring (if not, `CURSOR_API_KEY` is the documented route), the foreground process name node-pty reports, and whether the CLI reads `.cursor/commands/`.
2. **Claude Code native installer:** install path and sign-in from a VaultOS terminal.

**Unit tests** (`node --test`, as the existing suite):

- settings load / validate / atomic save; invalid file is an error
- board add, rename, reorder, hide; folder-name cleaning; key and folder clashes
- migration on a fixture vault (three boards, `Personal/Today`, a visibility file): expected settings, and a before/after tree listing showing only `.vaultos/settings.json` added
- folder check: empty / existing / has files; mounted vs not (stat injected)
- setup gate: every row of the table, plus window expiry
- host check, including the WebSocket upgrade
- `AGENTS.md` block rewrite keeps text outside the markers; no markers means no write
- starter-kit writer never overwrites
- start-command quoting; Claude hook merge is idempotent
- Today off: routes 404, service never started

**End to end** (puppeteer, as `scripts/today-e2e.js`; preview port, never against :7684):

- **Fresh install:** new image, empty temp folder, fresh home volume. Go through setup, create "Work", see the welcome card, drag it and check `status:` changed in `task.md`. Today hidden; switch it on and its button appears. Add a second board in Settings and check the switcher and `AGENTS.md`.
- **Agents:** in the preview container, install Claude Code and the Cursor CLI from setup step 4 and check `GET /api/agent` reports both installed. Sign-in is manual.
- **Migration:** a copy of the live vault and of `config.json` under the homelab's env. `diff -r` against the copy shows only `.vaultos/settings.json`. Boards and Today work. The `LOCAL_READ` headless screenshot works.

**Ben, on the work laptop:** Docker Desktop on Windows, a OneDrive folder, Cursor CLI sign-in, and how quickly the board loads.

## Deploy (homelab)

Needs Ben's OK, as every release here. Tag the current image `vault-board:pre-portable`. Edit both compose copies. Rebuild (the Dockerfile changes). Start. Check health, the switcher and Today, and screenshot. Rollback: retag `pre-portable`, revert the compose env lines, restart; the extra `.vaultos/settings.json` is harmless to the old code.

## Risks

- **Corporate proxy or TLS inspection** can break the installers and agent sign-in. Terminals inherit `HTTPS_PROXY`, `NO_PROXY` and `NODE_EXTRA_CA_CERTS` from the container's environment; project 2's README documents mounting a corporate CA.
- **Docker Desktop licence:** paid at companies with 250+ staff or $10M+ revenue. Rancher Desktop and Podman Desktop run the same image.
- **OneDrive Files On-Demand:** cloud-only files are slow on first read. Mark the VaultOS folder "Always keep on this device".
- **Windows folder mounts are slower** than Linux ones. Scans run per request; fine for hundreds of tasks. Ben measures on the laptop.
- **Cursor CLI hooks** are unreliable on Linux, so Cursor gets the process badge only.
- **Linux hosts with a uid other than 1000:** the step 1 write test catches it.
- **The migration's board order** changes on the homelab (above).

## Not in this round

- Project 2: public repo with fresh history, README, licence, GitHub Actions, registry, multi-arch builds, scrubbing personal references from code comments
- Logins for more than one person; a chat UI instead of the terminal
- A folder picker inside the app (Docker decides the folder at start)
- Deleting boards or folders from the UI
- A Settings switch for the task-board Stop hook (project 2; the hooks themselves are in the kit since 2026-10-14)
- Google Calendar card and the 8 PM check-in (Today follow-ups, separate)

## Decisions made during implementation

Spike 1 (2026-10-13, scratch `node:22-bookworm-slim` container, uid 1000, `HOME=/home/spike`, container removed afterwards). Baseline: `npm ci` and `npm test` on master pass, 510 of 510, 0 failures.

- **Cursor CLI install:** `curl https://cursor.com/install -fsS | bash` puts symlinks `agent` and `cursor-agent` in `~/.local/bin`, both pointing at `~/.local/share/cursor-agent/versions/<version>/cursor-agent` (tested 2026.10.01-e373342). Both names exist, so the spec's `agent`, then `cursor-agent` detect order holds. The agent table needed no change.
- **PATH:** `~/.local/bin` is not on the PATH of a fresh `bash -lc` in this image (Debian's `/etc/profile` resets it and the home has no `.profile`). The installers only print a "add to PATH" note. The Dockerfile must set `ENV PATH` itself, and detect and start commands must not rely on shell rc files.
- **Cursor process name:** started inside a pseudo-terminal, the main process has argv[0] `/home/spike/.local/bin/agent`, so node-pty's `basename(argv[0])` is `agent` (it would be `cursor-agent` if launched by that name). The full command line is `agent --use-system-ca .../versions/<v>/index.js`. It is not a generic `node`, but `/proc/<pid>/comm` says `MainThread`, so match on argv[0] basename `agent` or `cursor-agent`, not on comm. The parent `sh -c agent` wrapper is not the foreground process.
- **Cursor sign-in:** `NO_OPEN_BROWSER=1 agent login` run non-interactively, with and without a pseudo-terminal, prints "Starting login process...", "Authenticating with Cursor...", "Waiting for browser authentication..." and "Open a browser and navigate to this link: <url>", then waits. There was no keyring or secret-service error and no TTY requirement. `agent status` afterwards says "Not logged in". Completing sign-in and having it survive a second `docker exec` is **not verified in a container**; Ben verifies on the laptop. `CURSOR_API_KEY` (or `--api-key`) is the documented fallback.
- **`.cursor/commands`:** yes. The CLI docs (slash-commands page) list built-in commands only and do not mention custom ones, but the shipped CLI code loads `*.md` files from the workspace `.cursor/commands` (and `.claude/commands`, plus plugin `commands`). Not exercised end to end, as that needs a signed-in session.
- **Claude Code install:** `curl -fsSL https://claude.ai/install.sh | bash` installs `~/.local/bin/claude`, a link to `~/.local/share/claude/versions/<version>` (tested 2.1.296). Like Cursor it only warns that `~/.local/bin` is not on PATH. Running in a pseudo-terminal, argv[0] is `claude` and comm is `claude`. Sign-in not attempted.

Build decisions (2026-10-13 to 2026-10-14). Behaviour and design choices taken while implementing:

- **PATH in login shells.** `~/.local/bin` is put on `PATH` twice: `ENV PATH` in the Dockerfile and `/etc/profile.d/vaultos-path.sh`. Debian's `/etc/profile` resets `PATH` in login shells, and VaultOS terminals and the agent check run `bash -l`, so `ENV PATH` alone left installed agents "not found". The agent check (`isInstalled`) runs `bash -lc` to see the same `PATH` as a terminal.
- **`LOCAL_READ` gate.** The no-login same-box read path is gated on `LOCAL_READ=1` inside `isLocalPeer`, not left on for loopback. Tests call the server from 127.0.0.1 unauthenticated and must see 409 or 401, not a read.
- **Cursor sign-in.** Not blocked on in the spike: `agent login` was run non-interactively and only the printed URL was recorded. Finishing sign-in in a container is unverified. `CURSOR_API_KEY` is the documented fallback (see `docs/portable.md`).
- **Cursor commands in the kit.** `root/.cursor/commands/` is written with the root kit when it exists in the starter kit, because the agent is not chosen until step 4 and the files are harmless for other agents.
- **Migration hasCommand.** The migration is given a `hasCommand(name)` function by `server.js` (backed by `isInstalled`), so `lib/migrate.js` does not import `child_process`.
- **Broken settings do not crash.** If the migration or a settings load throws at boot (for example a folder name outside the key rules), the server stays up with the stage `broken` and the setup page shows the error, instead of crash-looping.
- **`/health` stays vague.** It never echoes settings fragments or folder names; it reports a fixed string and `setup: true|false`. Detail goes to the logs and to the setup state endpoint for the signed-in or in-window caller only.
- **Custom agent `detect` is restricted.** `settings.json` lives in a synced folder, and `GET /api/agent` runs the detect check without a click, so a crafted value would run as a shell command. `custom.detect` must match `/^[A-Za-z0-9._+-]{1,64}$/` (not starting with `-` or `.`), and each name is shell-quoted in `command -v`.
- **Today dir is always skipped by board scans** (`today.dir`), also while Today is switched off, as the spec says.
- **Setup routes.** `finish` answers 409 unless the stage is `resume`. The password step answers 409 also when a `config.json` is already on disk. A second `/api/setup/boards` request while one is running is refused. Other password write errors return a generic 500. `AGENTS.md` is updated after the boards are saved. Setup refuses a board label whose folder already exists on disk (case-insensitive), the same clash rule as Settings → Boards, so nothing of the user's is adopted by accident.
- **Agent save and hook.** A failure installing the Claude hook after the profile is saved is reported as `hookError` in the response and logged; the profile stays saved and later saves are not blocked.
- **Host check.** The WebSocket upgrade handler survives a malformed raw request target (`//[`), which made `new URL` throw. `POST /api/term/agent` (loopback caller with a per-terminal token) is exempt from the Host check, so agent badges keep working when `ALLOWED_HOSTS` lacks `127.0.0.1`. A rejected host is logged once as `host rejected: <host>` (at most 100 distinct hosts) and answered 421.
- **`compose.yaml` shadows `docker-compose.yml` in the repo directory.** Running `docker compose` inside the repo picks up the portable file. The live stack is run from `/opt/vault` (its own `docker-compose.yml`) or with `-f`; this is in `CLAUDE.md`.
- **New-install defaults that were personal.** The client default workspace falls back to the first visible board when the stored one is not a board, and the terminal's vault-folder link matching has no built-in folder names. Personal names left in older code comments are scrubbed in project 2.
- **Settings → Agent shares code with setup step 4** through one small browser file loaded by both pages, so the agent choices and the custom-field checks are not copied.
- **Agent wording.** The card pill, drawer tooltip and aria text use the profile's label (or neutral wording), never "Claude", since the agent may be Cursor or custom.
- **Setup page marker.** `setup.html` keeps `id="setup"` on its `<main>`; the server tests use it to check that setup routing serves the right page.
- **Terminal copy.** Setup uses `term.js`'s `termCopy` (secure-context clipboard with an `execCommand` fallback) rather than a second copy of that logic.
- **Setup page recovery.** The boards, agent and finish steps reload the setup state and recover when they get a 401 or 409. The run command shown in step 1 starts with `docker rm -f vaultos`, so it does not collide with the running container.
- **Today e2e against the preview.** `scripts/today-e2e.js` takes `TODAY_E2E_PREVIEW` (dir with `reset.sh` and `mint-cookie.js`) and `TODAY_E2E_CONTAINER`; defaults are unchanged. A companion in `/opt/vault/portable-preview/today/` seeds the Today sandbox into the portable preview and mints a cookie from that container's `config.json`. It sets `TERMINAL=0`, `TZ` and `TODAY_SECONDS_PER_MINUTE=1`, which stay out of shipped code.
- **Migration check never touches the live vault.** `scripts/portable-migrate-check.sh` works on a copy, runs both containers with `docker run --rm` outside any compose project under names other than `vault-board`, and deletes the copy and its screenshots in an `EXIT` trap, even on failure. The snapshot uses `find -mindepth 1`, because the vault root's own entry changes when `.vaultos` is created. It runs the old image with the live code mounted read-only, because the image is older than the code that runs live. It also asserts the migrated settings content (five boards in order, Today on at its dir, `Europe/London`, profile `none`).
- **`config.json` and `lockout.json` are never written by temp file + rename.** The homelab bind-mounts each as a single file; a rename would replace the inode and break the mount. They are written in place. `config.json` gets mode 0600 when created.
- **Homelab release needs `ALLOWED_HOSTS`.** The live compose must gain the four env lines before release, and Caddy and the Cloudflare tunnel must pass the original `Host` header or every request is refused with 421.
- **Task-board hooks are in the kit (2026-10-14, Ben's call after release).** `starter-kit/root/.claude/` carries `inject-plan.sh` and `check-progress.sh`, byte-identical to the homelab vault's, and a `settings.json` registering them on `UserPromptSubmit` and `Stop`. They are pure shell, fail open, and act only inside a folder with a `task.md`. They are Claude Code only; `AGENTS.md` states the same two rules (re-read task.md each session; today's progress entry and `updated:` before stopping) for Cursor and other agents. An existing `.claude/settings.json` is left alone like every kit file, so a non-empty folder gets the scripts but not the registration (`docs/portable.md` says so). A Settings switch for the strict Stop hook is left for project 2.
- **Terminals get the setup timezone.** Without `TZ` the container is on UTC, so the Stop hook's `date +%F` could call a task stale near midnight. `termEnv` sets `TZ` from `settings.today.timezone` when the container has none; a container `TZ` (the homelab's `Europe/London`) wins.
