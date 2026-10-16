# Agent picker: eight agents, a default, skills for all

Approved in conversation 2026-10-15. Mockup: https://claude.ai/artifact/HybmViBpCN8kQnwSDpiRpW (logos there are first-pass; this spec supersedes them).

## Why

VaultOS is going public. Setup step 4 and Settings → Agent offer only Claude Code and the Cursor CLI, which reads as "a Claude tool". People use many terminal agents. Ben uses Claude Code, the Cursor CLI and Pi; those three must work end to end. The others must be installable and startable; pull requests can deepen them.

## What Ben asked for

- The eight most popular terminal coding agents on the agent screen, each with its logo in a VaultOS treatment.
- A redesigned screen that stays calm with ten choices.
- Several agents can be installed; one is the **default**. Start agent on a card opens the default. The default is set in setup and in Settings.
- Start agent opens the default only (no per-card picker).
- The skills shipped in the starter kit work in Claude Code, the Cursor CLI and Pi.

## The agents

| id | Label | Maker | Tier | Detect (`command -v`) | Process names (badge) |
|---|---|---|---|---|---|
| `claude` | Claude Code | Anthropic | tested | `claude` | `claude` |
| `cursor` | Cursor CLI | Cursor | tested | `agent`, `cursor-agent` | `agent`, `cursor-agent` |
| `pi` | Pi | pi.dev | tested | `pi` | `pi`, `node` (argv[1] ends `pi`) |
| `codex` | Codex CLI | OpenAI | more | `codex` | `codex` |
| `antigravity` | Antigravity CLI | Google | more | `agy` | `agy` |
| `copilot` | Copilot CLI | GitHub | more | `copilot` | `copilot`, `node` |
| `opencode` | OpenCode | open source | more | `opencode` | `opencode` |
| `kilo` | Kilo CLI | Kilo | more | `kilo` | `kilo` |

Plus `custom` (Other agent) and `none` (No agent for now), as today.

Gemini CLI is left out: Google retired it for personal accounts on 2026-06-18 in favour of Antigravity CLI. Aider and Goose were considered and dropped for Kilo CLI (most used coding app on OpenRouter).

**Install, sign-in and start commands** are verified, not guessed: implementation installs every agent into the `vaultos:portable` image and reads its `--help` before writing its profile. The rules each command must meet:

- **install** runs as the `vaultos` user with no sudo and puts the binary on the terminal's PATH (`~/.local/bin` or the npm prefix in the home volume). npm installs use `npm install -g --prefix ~/.local <pkg>` so they land in the home volume and survive image rebuilds.
- **login** opens the agent's own sign-in in the terminal; where an agent signs in from inside its own UI (Pi `/login`, Copilot `/login`), login is the bare start command and the status panel says what to type.
- **start** opens the agent interactively with the check-in prompt as its first message (`{prompt}`, shell-quoted as today). Where an agent cannot take a first message, start opens it bare and VaultOS types nothing.

Expected starting points, to be confirmed: Claude `claude {prompt}`; Cursor `agent {prompt}`; Pi `npm i -g @mariozechner/pi-coding-agent`, `pi {prompt}`; Codex `npm i -g @openai/codex`, `codex {prompt}`; Antigravity per Google's install script, `agy`; Copilot `npm i -g @github/copilot`, `copilot -i {prompt}`; OpenCode `npm i -g opencode-ai`, `opencode --prompt {prompt}`; Kilo `npm i -g @kilocode/cli`, `kilo --prompt {prompt}`. An agent whose install cannot be made to work in the image as the `vaultos` user ships with install hidden and a note to install it by hand.

## Settings

No schema change. `settings.agent.profile` already names one agent; it now means **the default**. The allowed profiles grow to the ten ids above. `custom` keeps its fields. Existing settings files stay valid as they are.

Installed is never stored: it is checked live with `command -v`, per agent, as `isInstalled` does today.

## Server

- `lib/agents.js`: `PROFILES` gains the six new agents, each with `tier` (`tested` | `more`), `maker`, and the fields it has today. `profileFor` is unchanged.
- **New `GET /api/agents`** (settings guard): every profile with `{ id, label, maker, tier, installed, install, login, hooks }` plus `default` (the saved profile). The installed checks run in parallel. This feeds the grid.
- `GET /api/agent` and `POST /api/settings/agent` keep their shapes; POST sets the default.
- **Install and Sign in for any agent**, not only the default: the existing install/login actions take an optional `id` and run that profile's command in a terminal, as they do for the default today.
- Claude Code's status hook is installed whenever Claude Code is installed (checked by `GET /api/agents` and after an install), not only when it is the default, so switching default later needs no resave.
- Status badges: Claude Code keeps its hooks. Every other agent uses the existing process check (working, then idle after 20 s quiet). Agents that run under `node` match on the script name in argv, so a bare `node` process doesn't count.

## Skills for every agent

Facts checked 2026-10-15 in the real binaries: Claude Code reads only `.claude/skills`. Pi reads `.agents/skills` in the start folder and every parent up to the git root or `/`, and `~/.agents/skills`. The Cursor CLI reads `.cursor/skills`, `.agents/skills` and `.claude/skills`. Codex, Copilot, OpenCode and Antigravity document `.agents/skills`.

- The starter kit writes each skill twice: `starter-kit/root/.agents/skills/<name>/` and `starter-kit/root/.claude/skills/<name>/`. `.agents/skills` is the copy for every agent; `.claude/skills` is for Claude Code.
- The kit build keeps one source per skill (`starter-kit/skills/<name>/`) and `writeRootKit` copies it to both places, so the repo holds one copy and only vaults hold two.
- The Cursor CLI reads both folders, so it may list each skill twice. Implementation checks this; if it happens, no third copy is written and AGENTS.md notes it as harmless.
- `AGENTS.md` (every agent reads it) names both folders and says to turn on an optional skill by copying it into both.
- The `/new-task`, `/new-subtask`, `/done` guides stay in `.vaultos/guides/` and AGENTS.md points to them, so agents without slash commands follow them from there.

## The screen

One shared component (`public/agent-form.js`) still renders it in setup step 4 and Settings → Agent.

- Heading "Your coding agents", one line: install the ones you use; the default opens when you press Start agent.
- **Tested with VaultOS**: three tiles in a row. **More agents**: five tiles in a row (three, then two columns on narrow screens). **Other agent** and **No agent for now** as two smaller dashed tiles.
- A tile: logo mark, name, maker, and one row of chips: `Default` (gold), `Installed` (green) or `Not installed`. Tiles are buttons; the picked tile has the accent ring.
- Under the grid, a detail panel for the picked tile: large mark, name, chips, three facts (maker; reads AGENTS.md and the vault's skills; what the card badge shows), the next command in a code line, and the buttons **Install** or **Sign in**, and **Make default** (shows **Default**, disabled, when it is). Other agent opens today's custom fields here.
- Footer line: the default's mark and name.
- Start agent on a card shows the default's mark before its label.
- Keyboard: tiles are a roving-tabindex group with arrow keys; the panel follows the picked tile; focus rings as elsewhere.

## Logos

Each mark is a single-colour glyph on the VaultOS tile: rounded square, the app icon's gradient (`#594e35 → #343025` dark; a sepia pair in light), glyph in the icon gold (`#e5ce9e` dark, `#8a5a12` light). Glyphs live as inline SVG in one file (`public/agent-marks.js`), 24×24 viewBox.

Sources: Claude, OpenAI, GitHub Copilot from Simple Icons (CC0). Cursor: the cube from cursor.com's own favicon. Pi: the three-block pixel mark from pi.dev's logo, all blocks in one colour. OpenCode: the square-in-frame mark from opencode.ai's favicon. Antigravity and Kilo: from each maker's own site or brand page, fetched at implementation. Other agent: a terminal prompt; None: a slashed circle. Logos are used only to name each agent; the README notes they belong to their owners.

## Testing

- Unit: every profile has the required fields and a start command containing `{prompt}` or a declared no-prompt flag; `GET /api/agents` shape, parallel checks with a fake `run`; settings accept the ten ids and reject others; the kit writes each skill to both folders; the Claude hook goes in when Claude is installed but not default.
- In the image: a script installs each agent as `vaultos`, checks `command -v`, and records `--help` for the start flags. Results go into the spec's decisions section.
- E2E (preview container): setup step 4 shows ten tiles; picking, Install (fake agent), Make default, and Start agent on the welcome card opening the default.
- Manual on Windows: fresh setup, install Pi and the Cursor CLI beside Claude Code, switch the default between them, Start agent with each, and each lists `diagram-design` and `stop-slop`.

## Out of scope

A per-card agent picker; Pi or Cursor hook integrations for richer badges (process badges for now); agents beyond these eight (pull requests).

## Decisions made during implementation

**Agent probe, 2026-10-15** (`scripts/agent-probe.sh`, image `vaultos:portable`, user `vaultos`). All eight install with no sudo and land in `~/.local/bin`.

| id | install | detect | login (+ note) | start | foreground process |
|---|---|---|---|---|---|
| claude | `curl -fsSL https://claude.ai/install.sh \| bash` | `claude` | `claude` | `claude {prompt}` | `claude` |
| cursor | `curl https://cursor.com/install -fsS \| bash` | `agent` | `NO_OPEN_BROWSER=1 agent login` | `agent {prompt}` | `agent` (argv0) |
| pi | `npm install -g --prefix ~/.local @mariozechner/pi-coding-agent` | `pi` | `pi` + "Then type /login" | `pi {prompt}` | `pi` (sets its title) |
| codex | `npm install -g --prefix ~/.local @openai/codex` | `codex` | `codex login --device-auth` | `codex {prompt}` | `node` wrapper → native `codex` |
| antigravity | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` | `agy` | `agy` + "Sign in when it asks" | `agy -i {prompt}` | `agy` |
| copilot | `npm install -g --prefix ~/.local @github/copilot` | `copilot` | `copilot` + "Then type /login" | `copilot -i {prompt}` | `node` wrapper |
| opencode | `npm install -g --prefix ~/.local opencode-ai` | `opencode` | `opencode auth login` | `opencode --prompt {prompt}` | `opencode` |
| kilo | `npm install -g --prefix ~/.local @kilocode/cli` | `kilo` | `kilo auth login` | `kilo --prompt {prompt}` | `node` wrapper → `.kilo` |

`nodeTitle` (badge matches `node`, only in the terminal Start agent opened): codex, copilot, kilo.

**Checked 2026-10-15 (Task 8).** Pi, started by Start agent's command in a fresh vault's task folder, loaded `/vault/AGENTS.md` and both skills from `.agents/skills` (its own startup listing). The portable e2e with `--with-installs` installed Claude Code, the Cursor CLI and Pi from the picker's Install button, each reported installed by `GET /api/agents`; all 8 scenarios pass. Not checked here, because it needs Ben's accounts: signing in to Claude Code and the Cursor CLI and seeing them list the skills (Claude reads `.claude/skills`, documented; the Cursor binary references `.agents/skills` and `.claude/skills`), and whether the Cursor CLI lists each skill twice. That is the manual check on Windows.
