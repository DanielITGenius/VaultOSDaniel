# Agent Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setup step 4 and Settings → Agent offer eight coding agents as logo tiles; any can be installed, one is the default that Start agent opens, and the starter-kit skills load in Claude Code, the Cursor CLI and Pi.

**Architecture:** `lib/agents.js` grows from two profiles to eight, with `tier` and `maker`. `settings.agent.profile` keeps its shape and now means the default. A new `GET /api/agents` lists every profile with a live installed check. One shared picker (`AgentForm.mountPicker` in `public/agent-form.js`) replaces the radio list in both pages; logos live in `public/agent-marks.js`. The starter kit keeps one source per skill and writes it to `.agents/skills` and `.claude/skills`.

**Tech Stack:** Node 22, Express 5, node:test, vanilla browser JS (UMD modules shared with tests), node-pty, Docker image `vaultos:portable`, puppeteer e2e against the preview container.

**Spec:** `docs/superpowers/specs/2026-10-15-agent-picker-design.md`

## Global Constraints

- Branch `portable`, worktree `/opt/vault/board-portable`. Tests run inside the image: `docker run --rm -v "$PWD":/src:ro --entrypoint bash vaultos:portable -lc 'cp -a /src /tmp/w && cd /tmp/w && rm -rf node_modules && cp -a /app/node_modules . && npm test'`.
- Never e2e against :7684 (the live homelab board). The preview is `portable-preview` on 127.0.0.1:7692.
- The ten profile ids, exactly: `claude`, `cursor`, `pi`, `codex`, `antigravity`, `copilot`, `opencode`, `kilo`, `custom`, `none`. Tiers: `tested` = claude, cursor, pi; `more` = the next five.
- Labels and makers, exactly: Claude Code / Anthropic; Cursor CLI / Cursor; Pi / pi.dev; Codex CLI / OpenAI; Antigravity CLI / Google; Copilot CLI / GitHub; OpenCode / open source; Kilo CLI / Kilo.
- Installs run as the `vaultos` user, no sudo; npm installs use `npm install -g --prefix ~/.local <pkg>`.
- Existing settings files stay valid with no migration step.
- Logo glyphs: 24×24 viewBox, single colour (`currentColor`). Tile gradient `#594e35 → #343025` with glyph `#e5ce9e` (dark); a sepia gradient with glyph `#8a5a12` (light).
- Copy on screen: heading "Your coding agents"; tier labels "Tested with VaultOS" and "More agents"; chips "Default", "Installed", "Not installed"; buttons "Install", "Sign in", "Make default" / "Default".
- Nothing private in published files: `bash scripts/publish.sh` must still pass its private-word check.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **The default agent is later uninstalled or its binary leaves PATH.** `GET /api/agents` must report it `installed: false` while it stays the default, and the picker must show "Default" + "Not installed" on it rather than hiding it. Test in Task 3.
- **A settings file written before this change** (`{ profile: 'cursor' }` or `{ profile: 'custom', custom: {...} }`) loads unchanged and Cursor/custom stays the default. Test in Task 2.
- **A vault whose `.claude/skills/<name>/` the person has already edited.** Writing the kit fills `.agents/skills/<name>/` but never overwrites the edited `.claude` copy. Test in Task 4.
- **An "Other agent" label containing markup** (`<img src=x onerror=…>`) shows as literal text on its tile, in the detail panel and on Start agent. Test in Task 6.
- **A node-based agent (shows as `node` in the terminal)** gets a working/idle badge only in the terminal Start agent opened, never in a plain terminal running some other node program. Test in Task 2.

---

### Task 1: Probe every agent in the image

Facts first: each profile's commands come from the real binaries.

**Files:**
- Create: `scripts/agent-probe.sh` (homelab-only; `scripts/` is never published)
- Modify: `docs/superpowers/specs/2026-10-15-agent-picker-design.md` (section "Decisions made during implementation")

**Interfaces:**
- Produces: a verified table (install, detect, login, start with `{prompt}`, foreground process name while running, skills folders it reads) for all eight agents, written into the spec. Tasks 2 and 5 copy values from it.

- [ ] **Step 1: Write `scripts/agent-probe.sh <id>`**: in a throwaway `vaultos:portable` container as `vaultos`, run the agent's install, then `bash -lc 'command -v <detect>'`, `<detect> --help`, and start it under `script -qc` for 5 s while `ps -o comm=,args= -t <pty>` records the foreground process. Antigravity and Kilo: take the install command from each maker's docs page; Antigravity's from antigravity.google's install instructions.
- [ ] **Step 2: Run it for all eight**

Run: `for a in claude cursor pi codex antigravity copilot opencode kilo; do bash scripts/agent-probe.sh $a; done`
Expected: each prints `installed: yes`, its help excerpt for an initial-prompt flag, and a process name. An agent that cannot install as `vaultos` prints `installed: no` with the error.

- [ ] **Step 3: Record the table in the spec's decisions section**, one row per agent, including: which agents show as `node`; any agent whose install failed (it ships with `install: null` and a "install it by hand" note); the start form chosen for each (`{prompt}` flag, or bare when no first-message support).
- [ ] **Step 4: Commit**

```bash
git add scripts/agent-probe.sh docs/superpowers/specs/2026-10-15-agent-picker-design.md
git commit -m "Agent probe: verified install, start and process names for eight agents"
```

### Task 2: Eight profiles, default semantics, badges for node agents

**Files:**
- Modify: `lib/agents.js` (`PROFILES`, `processMatches`)
- Modify: `lib/settings.js:10` (`PROFILES` list)
- Modify: `server.js` (`sweepAgents`, the Start-agent terminal flag)
- Test: `test/agents.test.js`, `test/settings.test.js`

**Interfaces:**
- Consumes: Task 1's table.
- Produces: `PROFILES[id] = { id, label, maker, tier, detect: string[], proc: string[], install: string|null, login: string|null, loginNote: string|null, start: string, hooks: 'claude'|null, nodeTitle: boolean }` for the eight ids; `PROFILE_IDS` (the ten ids, in the Global Constraints order) exported from `lib/agents.js`; `processMatches(profile, cmd, { agentTerm })` returning true for `cmd === 'node'` only when `profile.nodeTitle && agentTerm`.

- [ ] **Step 1: Write the failing tests**

```js
test('eight built-in profiles with the spec labels, makers and tiers', () => {
  assert.deepEqual(PROFILE_IDS, ['claude','cursor','pi','codex','antigravity','copilot','opencode','kilo','custom','none']);
  assert.deepEqual(Object.values(PROFILES).filter((p) => p.tier === 'tested').map((p) => p.id), ['claude','cursor','pi']);
  assert.equal(PROFILES.antigravity.label, 'Antigravity CLI'); assert.equal(PROFILES.antigravity.maker, 'Google');
  for (const p of Object.values(PROFILES)) {
    assert.ok(p.detect.length && p.proc.length && p.start, p.id);
    assert.ok(p.install === null || /--prefix ~\/\.local|curl|install\.sh/.test(p.install), p.id);
  }
});
test('node agents match only in the terminal Start agent opened', () => {
  const p = Object.values(PROFILES).find((x) => x.nodeTitle) || { ...PROFILES.pi, nodeTitle: true, proc: ['pi'] };
  assert.equal(processMatches(p, 'node', { agentTerm: true }), true);
  assert.equal(processMatches(p, 'node', { agentTerm: false }), false);
  assert.equal(processMatches(PROFILES.claude, 'node', { agentTerm: true }), false);
});
// settings.test.js
test('old agent settings load unchanged and every new id saves', () => {
  assert.deepEqual(validate({ ...BASE, agent: { profile: 'cursor' } }).agent, { profile: 'cursor' });
  for (const id of ['pi','codex','antigravity','copilot','opencode','kilo']) assert.equal(validate({ ...BASE, agent: { profile: id } }).agent.profile, id);
  assert.throws(() => validate({ ...BASE, agent: { profile: 'gemini' } }), /unknown agent profile/);
});
```

(`BASE` is the valid settings fixture the file already uses; use its existing name.)

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/agents.test.js test/settings.test.js`
Expected: FAIL (`PROFILE_IDS` undefined, `gemini`/`pi` checks).

- [ ] **Step 3: Implement** the six new profiles from Task 1's table; `PROFILE_IDS`; `lib/settings.js` takes its list from `require('./agents').PROFILE_IDS`; `processMatches(profile, cmd, opts = {})`. In `server.js`, mark terminals opened with a `run` equal to the default's start command as `t.agentTerm = true` when created, and pass `{ agentTerm: !!t.agentTerm }` from `sweepAgents`.
- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test test/agents.test.js test/settings.test.js test/server-agent.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agents.js lib/settings.js server.js test/agents.test.js test/settings.test.js
git commit -m "Agents: eight profiles; the saved agent is the default; node agents badge only in their own terminal"
```

### Task 3: `GET /api/agents` and the Claude hook whenever Claude is installed

**Files:**
- Modify: `server.js` (near `agentStatus`, ~line 1397)
- Test: `test/server-agent.test.js`

**Interfaces:**
- Consumes: `PROFILES`, `PROFILE_IDS`, `isInstalled` from Task 2.
- Produces: `GET /api/agents` (settings guard) → `{ default: string, agents: [{ id, label, maker, tier, installed: boolean, install, login, loginNote, hooks }] }` for the eight built-ins in `PROFILE_IDS` order, then `custom` (only when saved; `label` from settings, `tier: 'other'`). `ensureClaudeHook()` installs when Claude Code is installed, whatever the default.

- [ ] **Step 1: Write the failing tests**

```js
test('GET /api/agents lists eight agents with live installed checks and the default', async (t) => {
  const s = await boot(t, { bins: ['claude', 'pi'] });   // the file's helper that puts fake binaries on PATH
  await s.post('/api/settings/agent', { profile: 'cursor' });
  const r = await s.get('/api/agents');
  assert.equal(r.body.default, 'cursor');
  assert.deepEqual(r.body.agents.map((a) => a.id), ['claude','cursor','pi','codex','antigravity','copilot','opencode','kilo']);
  assert.deepEqual(r.body.agents.filter((a) => a.installed).map((a) => a.id), ['claude','pi']);
  assert.equal(r.body.agents.find((a) => a.id === 'cursor').installed, false);   // the default, not installed
});
test('the Claude hook goes in when Claude Code is installed but another agent is the default', async (t) => {
  const s = await boot(t, { bins: ['claude', 'pi'] });
  await s.post('/api/settings/agent', { profile: 'pi' });
  await s.get('/api/agents');
  assert.ok(fs.existsSync(path.join(s.home, '.claude', 'hooks', 'vaultos-state.js')));
});
test('GET /api/agents needs a session', async (t) => { /* 401 without the cookie, as the other agent routes */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/server-agent.test.js`
Expected: FAIL with 404 on `/api/agents`.

- [ ] **Step 3: Implement** the route with `Promise.all` over the installed checks; call `ensureClaudeHook()` from it (errors logged, not fatal); change `ensureClaudeHook` to look at `PROFILES.claude` instead of the default.
- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test test/server-agent.test.js`
Expected: PASS (all old tests too).

- [ ] **Step 5: Commit**

```bash
git add server.js test/server-agent.test.js
git commit -m "GET /api/agents: every agent with a live installed check; Claude hook whenever Claude is installed"
```

### Task 4: One source per skill, written to `.agents/skills` and `.claude/skills`

**Files:**
- Move: `starter-kit/root/.claude/skills/*` → `starter-kit/skills/` (`git mv`)
- Modify: `lib/starter-kit.js` (`writeRootKit`)
- Modify: `starter-kit/root/AGENTS.md` (Skills section)
- Test: `test/starter-kit.test.js`

**Interfaces:**
- Produces: `writeRootKit(vaultDir, boards, opts)` also writes every file of `starter-kit/skills/<name>/` to `<vault>/.agents/skills/<name>/` and `<vault>/.claude/skills/<name>/`, skipping files that exist (same rule as the rest of the kit), and returns them in its written list.

- [ ] **Step 1: Write the failing tests**: in `starter-kit.test.js`, `SKILL_DIRS` becomes the kit-source dirs; `ROOT_FILES` expects each skill file twice (`.agents/skills/...` and `.claude/skills/...`); plus:

```js
test('an edited .claude skill stays; the .agents copy is still written', async () => {
  const v = tmp();
  fs.mkdirSync(path.join(v, '.claude/skills/stop-slop'), { recursive: true });
  fs.writeFileSync(path.join(v, '.claude/skills/stop-slop/SKILL.md'), 'mine\n');
  await writeRootKit(v, [WORK]);
  assert.equal(read(v, '.claude', 'skills', 'stop-slop', 'SKILL.md'), 'mine\n');
  assert.match(read(v, '.agents', 'skills', 'stop-slop', 'SKILL.md'), /^---/);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/starter-kit.test.js`
Expected: FAIL (no `.agents/skills` files).

- [ ] **Step 3: Implement**: `git mv` the two skills to `starter-kit/skills/`; `writeRootKit` lists `starter-kit/skills` and calls `copyMissing` twice with dest `.agents/skills` and `.claude/skills`. AGENTS.md Skills section: skills are in `.agents/skills/` (every agent) and `.claude/skills/` (Claude Code); to turn on an optional skill, copy its folder into both.
- [ ] **Step 4: Run to see them pass**

Run: `node --test test/starter-kit.test.js`
Expected: PASS, including "kit has nothing personal" and the LICENSE check.

- [ ] **Step 5: Commit**

```bash
git add -A starter-kit lib/starter-kit.js test/starter-kit.test.js
git commit -m "Starter kit: one copy of each skill, written to .agents/skills and .claude/skills"
```

### Task 5: Agent logos

**Files:**
- Create: `public/agent-marks.js` (UMD, same wrapper as `agent-form.js`)
- Test: `test/agent-marks.test.js`
- Modify: `README.md` (one line: logos belong to their owners and only name each agent)

**Interfaces:**
- Produces: `AgentMarks.svg(id: string) → string` (an `<svg viewBox="0 0 24 24" …>` using `currentColor`, `aria-hidden="true"`), with a mark for each of the ten ids and a neutral terminal glyph for unknown ids.

- [ ] **Step 1: Write the failing test**

```js
test('a single-colour 24px mark for every profile id', () => {
  for (const id of PROFILE_IDS) {
    const s = AgentMarks.svg(id);
    assert.match(s, /^<svg [^>]*viewBox="0 0 24 24"/, id);
    assert.match(s, /currentColor/, id);
    assert.doesNotMatch(s, /<script|on\w+=|#[0-9a-f]{3,6}/i, id);
  }
  assert.equal(AgentMarks.svg('nope'), AgentMarks.svg('custom'));
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test test/agent-marks.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** with the glyphs from the spec's Logos section, scaled into 24×24: Claude, OpenAI (Codex), GitHub Copilot from `simple-icons@15.0.0`; Cursor's cube from `https://cursor.com/marketing-static/favicon.svg` (the clip-path group, rescaled); Pi's three blocks from `https://pi.dev/logo-auto.svg` as one path; OpenCode's square-in-frame from `https://opencode.ai/favicon.svg`; Antigravity and Kilo from each maker's site favicon or brand page; `custom` a terminal prompt, `none` a slashed circle. All fills become `currentColor`.
- [ ] **Step 4: Run to see it pass**

Run: `node --test test/agent-marks.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/agent-marks.js test/agent-marks.test.js README.md
git commit -m "Agent marks: official logo shapes in one colour for the agent tiles"
```

### Task 6: The shared picker

**Files:**
- Modify: `public/agent-form.js` (replace `CHOICES` radios with the picker)
- Modify: `public/styles.css` (new `.ap-*` rules beside the `.su-opt` rules, which go)
- Test: `test/agent-form.test.js`

**Interfaces:**
- Consumes: `GET /api/agents` (Task 3), `AgentMarks.svg` (Task 5), the existing `customBody`, `customProblem`, `saveCustom`, `renderStatus` helpers.
- Produces:
  - `chipsFor(agent, defaultId) → Array<'Default'|'Installed'|'Not installed'>` (Default first; none of these for `none`; custom shows Installed/Not installed like the rest).
  - `groups(list) → { tested: Agent[], more: Agent[], minor: Agent[] }` (`minor` = custom + none, always present).
  - `moveFocus(ids: string[], current: string, key: string) → string` (ArrowRight/Down next, ArrowLeft/Up previous, Home/End, wrapping).
  - `mountPicker(host: Element, ui) → { refresh(payload), pick(id) }` where `ui = { save(body) → Promise<{ok}|{error}|{stale}>, openTerm(kind: 'install'|'login', agent), customFields: Element }`. It renders the three tile groups, the detail panel and the footer line, wires clicks and arrow keys, and calls `ui.save({ profile: id })` on Make default. All agent text goes in as text nodes.

- [ ] **Step 1: Write the failing tests** (the file's existing fake-DOM helper drives `mountPicker`):

```js
test('chips: Default first, then installed state', () => {
  assert.deepEqual(chipsFor({ id: 'pi', installed: true }, 'pi'), ['Default', 'Installed']);
  assert.deepEqual(chipsFor({ id: 'cursor', installed: false }, 'pi'), ['Not installed']);
  assert.deepEqual(chipsFor({ id: 'cursor', installed: false }, 'cursor'), ['Default', 'Not installed']);
});
test('groups put custom and none last, always', () => {
  const g = groups(AGENTS_FIXTURE);
  assert.deepEqual(g.tested.map((a) => a.id), ['claude','cursor','pi']);
  assert.deepEqual(g.minor.map((a) => a.id), ['custom','none']);
});
test('arrow keys move through every tile and wrap', () => {
  const ids = ['claude','cursor','pi','codex'];
  assert.equal(moveFocus(ids, 'pi', 'ArrowRight'), 'codex');
  assert.equal(moveFocus(ids, 'codex', 'ArrowRight'), 'claude');
  assert.equal(moveFocus(ids, 'claude', 'End'), 'codex');
});
test('Make default saves the picked agent; a markup label stays text', async () => {
  const saves = []; const host = fakeDoc().createElement('div');
  const p = mountPicker(host, { save: async (b) => { saves.push(b); return { ok: true }; }, openTerm() {}, customFields: fakeDoc().createElement('div') });
  p.refresh({ default: 'claude', agents: [...AGENTS_FIXTURE, { id: 'custom', label: '<img src=x onerror=alert(1)>', tier: 'other', installed: false }] });
  p.pick('pi'); host.querySelector('[data-act="default"]').click();
  assert.deepEqual(saves, [{ profile: 'pi' }]);
  assert.ok(!host.innerHTML.includes('<img'));
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/agent-form.test.js`
Expected: FAIL (`chipsFor` undefined). Remove the old `CHOICES` test.

- [ ] **Step 3: Implement** the four functions and the `.ap-*` styles: grids of 3 / 5 / 2 columns (5 → 3 under 820px, all → 2 under 560px), tile = 44px mark + name + maker + one chip row, picked tile accent ring, dashed minor tiles, detail panel with a 56px mark, three facts, the next command in a code line (plus the agent's `loginNote` under it when set, e.g. "Then type /login"), and the buttons; tile mark uses the gradient and glyph colours from Global Constraints for each theme. The detail for `custom` shows `ui.customFields` (today's fields and Save agent); for `none`, Make default only.
- [ ] **Step 4: Run to see them pass**

Run: `node --test test/agent-form.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/agent-form.js public/styles.css test/agent-form.test.js
git commit -m "Agent picker: logo tiles in three groups, a detail panel, Make default"
```

### Task 7: Use the picker in setup and Settings; Start agent shows the default's mark

**Files:**
- Modify: `public/setup.js` (step 4, ~lines 420–610), `public/setup.html` (load `agent-marks.js` before `agent-form.js`)
- Modify: `public/app.js` (Agent section, ~lines 2250–2370), `public/index.html` (the `#ag-opts` block and the script tag)
- Modify: `public/workbench.js:946-953` (Start agent label)
- Modify: `scripts/portable-e2e.js` (step 4 scenario)

**Interfaces:**
- Consumes: `AgentForm.mountPicker` (Task 6), `GET /api/agents` (Task 3), `ME.agent.profile` (already in `/api/me`).

- [ ] **Step 1: Update the e2e first**: step 4 shows 10 tiles (`.ap-tile`); picking Pi shows Install; Install with the fake agent profile still passes; Make default on a tile updates the footer; the welcome card's Start agent shows `.ap-mark` and the default's label.
- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/portable-e2e.js`
Expected: FAIL on the step 4 tile count.

- [ ] **Step 3: Implement**: both pages fetch `/api/agents` and call `mountPicker`; `ui.openTerm` uses the page's existing terminal (setup's `openTerm`, Settings' `agTerm`) with the picked agent's `install`/`login`; after a terminal closes, both re-fetch `/api/agents` (Settings keeps its 3 s poll while open). Start agent prepends `AgentMarks.svg(ME.agent.profile)` and keeps the label text.
- [ ] **Step 4: Run e2e and the full suite**

Run: `node scripts/portable-e2e.js` then the Global Constraints test command.
Expected: e2e all PASS; `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add public scripts/portable-e2e.js
git commit -m "Setup and Settings use the agent picker; Start agent shows the default's mark"
```

### Task 8: Prove Claude, Cursor and Pi end to end, then publish

**Files:**
- Modify: `README.md` (How it works: "Any coding agent" line lists the eight), `docs/portable.md` (agents section)
- Modify: spec decisions section (results)

- [ ] **Step 1: In a throwaway container with a fresh vault**, install Claude Code, the Cursor CLI and Pi from the picker, make each the default in turn, press Start agent on the welcome card, and in each ask "list your skills". Expected: each starts in the card's folder, the card shows working then idle, and each lists `diagram-design` and `stop-slop`. Record whether Cursor lists them twice.
- [ ] **Step 2: Docs**: README and `docs/portable.md` list the eight agents and say the tested three are Claude Code, the Cursor CLI and Pi.
- [ ] **Step 3: Full suite and publish check**

Run: the Global Constraints test command; then `bash scripts/publish.sh` (Ben runs it if the sandbox refuses).
Expected: `# fail 0`; publish commits with no private-word hits.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/portable.md docs/superpowers/specs/2026-10-15-agent-picker-design.md
git commit -m "Docs: eight agents; Claude Code, Cursor CLI and Pi checked end to end"
```
