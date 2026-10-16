'use strict';
// Agent profiles: what VaultOS knows about each supported coding agent.
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { atomicWrite } = require('./atomic-write');

// Commands verified in the image on 2026-10-15 (scripts/agent-probe.sh). `nodeTitle`: the agent's
// foreground process is a `node` wrapper, so the badge can only trust it in the terminal Start agent opened.
const npm = (pkg) => `npm install -g --prefix ~/.local ${pkg}`;
const agent = (p) => ({ loginNote: null, hooks: null, nodeTitle: false, ...p });
const PROFILES = {
  claude: agent({
    id: 'claude', label: 'Claude Code', maker: 'Anthropic', tier: 'tested', detect: ['claude'], proc: ['claude'],
    install: 'curl -fsSL https://claude.ai/install.sh | bash', login: 'claude', start: 'claude {prompt}', hooks: 'claude',
  }),
  cursor: agent({
    id: 'cursor', label: 'Cursor CLI', maker: 'Cursor', tier: 'tested', detect: ['agent', 'cursor-agent'], proc: ['agent', 'cursor-agent'],
    install: 'curl https://cursor.com/install -fsS | bash', login: 'NO_OPEN_BROWSER=1 agent login', start: 'agent {prompt}',
  }),
  pi: agent({
    id: 'pi', label: 'Pi', maker: 'pi.dev', tier: 'tested', detect: ['pi'], proc: ['pi'],
    install: npm('@mariozechner/pi-coding-agent'), login: 'pi', loginNote: 'Then type /login', start: 'pi {prompt}',
  }),
  codex: agent({
    id: 'codex', label: 'Codex CLI', maker: 'OpenAI', tier: 'more', detect: ['codex'], proc: ['codex'],
    install: npm('@openai/codex'), login: 'codex login --device-auth', start: 'codex {prompt}', nodeTitle: true,
  }),
  antigravity: agent({
    id: 'antigravity', label: 'Antigravity CLI', maker: 'Google', tier: 'more', detect: ['agy'], proc: ['agy'],
    install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', login: 'agy', loginNote: 'Sign in when it asks', start: 'agy -i {prompt}',
  }),
  copilot: agent({
    id: 'copilot', label: 'Copilot CLI', maker: 'GitHub', tier: 'more', detect: ['copilot'], proc: ['copilot'],
    install: npm('@github/copilot'), login: 'copilot', loginNote: 'Then type /login', start: 'copilot -i {prompt}', nodeTitle: true,
  }),
  opencode: agent({
    id: 'opencode', label: 'OpenCode', maker: 'open source', tier: 'more', detect: ['opencode'], proc: ['opencode'],
    install: npm('opencode-ai'), login: 'opencode auth login', start: 'opencode --prompt {prompt}',
  }),
  kilo: agent({
    id: 'kilo', label: 'Kilo CLI', maker: 'Kilo', tier: 'more', detect: ['kilo'], proc: ['kilo', '.kilo'],
    install: npm('@kilocode/cli'), login: 'kilo auth login', start: 'kilo --prompt {prompt}', nodeTitle: true,
  }),
};
// Every profile settings.json takes, in the order the picker shows them.
const PROFILE_IDS = [...Object.keys(PROFILES), 'custom', 'none'];

const KICKOFF_PROMPT = 'Catch me up on this task. From task.md (Plan, Progress log, Comments), give me a short brief: where it stands, what is done, what is next, and anything blocked or waiting on me. Then suggest what we tackle today. Do not start the work or change any files until I say so.';

const HOOK_CMD = '[ -n "$VAULTOS_TERM_ID" ] && node "$HOME/.claude/hooks/vaultos-state.js" || true';
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'];

// settings.agent comes from lib/settings.js.
function profileFor(settings) {
  const a = settings && settings.agent;
  if (!a || a.profile === 'none') return null;
  if (a.profile === 'custom') {
    const c = a.custom;
    return {
      id: 'custom', label: c.label, detect: [c.detect], proc: [c.detect],
      install: c.install, login: c.login, start: c.start, hooks: null, loginNote: null, nodeTitle: false,
    };
  }
  return PROFILES[a.profile] || null;
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function startCommand(profile, prompt) {
  return profile.start.split('{prompt}').join(shellQuote(prompt));
}

// A login shell, so PATH matches a VaultOS terminal (which runs bash -l).
function defaultRun(cmd) {
  return new Promise((resolve) => {
    execFile('bash', ['-lc', cmd], { env: process.env, timeout: 10000 }, (err) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0 });
    });
  });
}

async function isInstalled(profile, { run = defaultRun } = {}) {
  for (const name of profile.detect) {
    const r = await run(`command -v -- ${shellQuote(name)}`);
    if (r && r.code === 0) return true;
  }
  return false;
}

// Copy the hook script and register it for every event, without touching
// anything else in settings.json. Returns whether anything changed.
async function installClaudeHook(home, hookSrc) {
  const dir = path.join(home, '.claude');
  const hookDst = path.join(dir, 'hooks', 'vaultos-state.js');
  const src = await fsp.readFile(hookSrc, 'utf8');
  let changed = false;

  await fsp.mkdir(path.dirname(hookDst), { recursive: true });
  let cur = null;
  try { cur = await fsp.readFile(hookDst, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (cur !== src) { await atomicWrite(hookDst, src); changed = true; }

  const file = path.join(dir, 'settings.json');
  let settings = {};
  try { settings = JSON.parse(await fsp.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  let edited = false;
  for (const ev of HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[ev])) settings.hooks[ev] = [];
    const has = settings.hooks[ev].some((g) => g && Array.isArray(g.hooks) &&
      g.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes('vaultos-state.js')));
    if (!has) {
      settings.hooks[ev].push({ hooks: [{ type: 'command', command: HOOK_CMD, timeout: 5 }] });
      edited = true;
    }
  }
  if (edited) {
    await atomicWrite(file, JSON.stringify(settings, null, 2) + '\n');
    changed = true;
  }
  return changed;
}

// Hook-less agents: match the pty's foreground process by argv[0] basename. A `node` wrapper only counts
// for a nodeTitle agent, and only in the terminal Start agent opened ({ agentTerm: true }).
function processMatches(profile, cmd, { agentTerm = false } = {}) {
  const name = path.basename(cmd);
  if (name === 'node') return !!(profile.nodeTitle && agentTerm);
  return profile.proc.includes(name);
}

// A terminal's card and whether it is the agent's own. Start agent names its task (explicit); a terminal merely
// opened inside a job folder is linked to that card (found) but is not the agent's, so a dev server there
// never wears a node agent's badge.
function terminalTask({ explicit, found }) {
  if (explicit) return { task: explicit, agentTerm: true };
  return { task: found || '', agentTerm: false };
}

function processState({ running, quietMs }) {
  if (!running) return null;
  return quietMs > 20e3 ? 'idle' : 'working';
}

module.exports = {
  PROFILES, PROFILE_IDS, KICKOFF_PROMPT, HOOK_CMD, HOOK_EVENTS,
  profileFor, shellQuote, startCommand, isInstalled, installClaudeHook, processMatches, processState, terminalTask,
};
